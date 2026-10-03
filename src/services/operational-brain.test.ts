import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createProject } from "./projects";
import { interpretBrainMessage } from "./operational-brain";
import { INITIAL_BRAIN_STATE } from "./brain-state";
import { synthesizeHeadReport } from "@/core/findings/head-report";
import type { FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";

/**
 * Covers the Operational Brain's deterministic paths only — never one that
 * would trigger a real agent/model call (createAndRunMissionEvaluation),
 * since this environment's only configured provider (Gemini) is currently
 * quota-exhausted, same pre-existing/external condition already affecting
 * src/core/testing/runner/round-runner.test.ts and friends. The mission-
 * triggering path itself is exercised by those existing integration tests
 * via createAndRunMissionEvaluation — not re-tested here.
 */
describe("operational-brain (integration)", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    if (createdIds.length) {
      await db.auditLog.deleteMany({ where: { entityId: { in: createdIds } } });
      await db.project.deleteMany({ where: { id: { in: createdIds } } });
    }
    await db.$disconnect();
  });

  it("a known exact phrase still resolves directly through the real, unmodified Command Router", async () => {
    const result = await interpretBrainMessage("recomendações pendentes", INITIAL_BRAIN_STATE);
    expect(result.structured?.type).toBe("PENDING_RECOMMENDATIONS");
  });

  it("a GitHub query is honest about not being configured, never fabricates repos", async () => {
    const result = await interpretBrainMessage("Quais sistemas técnicos eu tenho no GitHub?", INITIAL_BRAIN_STATE);
    expect(result.text).toMatch(/n[ãa]o tenho acesso ao github configurado/i);
    expect(result.text).not.toMatch(/github\.com\//);
  });

  it("lists real existing projects for a direct query, never an invented list", async () => {
    const unique = `Brain Query Project ${Date.now()}`;
    const created = await createProject({ name: unique });
    createdIds.push(created.id);

    const result = await interpretBrainMessage("Quais projetos existem?", INITIAL_BRAIN_STATE);
    expect(result.text).toContain(unique);
  });

  it("asks which specialty when a mission request names no recognizable category, never guessing a default agent", async () => {
    const unique = `Brain Mission Project ${Date.now()}`;
    const created = await createProject({ name: unique });
    createdIds.push(created.id);

    const result = await interpretBrainMessage(`Analise o ${unique}`, INITIAL_BRAIN_STATE);
    expect(result.text).toMatch(/n[ãa]o identifiquei quais especialidades envolver/i);
  });

  it("asks for a target URL when the resolved project has no prior mission and isn't the LAB itself, never guessing one", async () => {
    const unique = `Brain Target Project ${Date.now()}`;
    const created = await createProject({ name: unique });
    createdIds.push(created.id);

    const result = await interpretBrainMessage(`Analise a UX do ${unique}`, INITIAL_BRAIN_STATE);
    expect(result.text).toMatch(/preciso da url/i);
  });

  /**
   * Regression for a real bug caught during tonight's live BLOCO 13 replay:
   * the overnight brief's OWN canonical example phrase ("O que você acha
   * que dá para melhorar?") didn't match FOLLOWUP_RECOMMENDATION's original
   * pattern — only a variant without "para" did — so the brief's own
   * documented conversation would have silently fallen through to the
   * generic "não entendi" reply instead of surfacing a recommendation.
   */
  it("recognizes the overnight brief's own canonical follow-up phrasing ('dá PARA melhorar')", async () => {
    const result = await interpretBrainMessage("O que você acha que dá para melhorar?", {
      ...INITIAL_BRAIN_STATE,
      missionRunId: "nonexistent-mission-id",
    });
    expect(result.text).not.toMatch(/n[ãa]o entendi/i);
  });

  it("a follow-up question with no active mission in context never crashes and never invents a mission", async () => {
    const result = await interpretBrainMessage("O que vocês acharam?", INITIAL_BRAIN_STATE);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.structured ?? null).toBeNull();
  });

  /**
   * Regression for a real bug caught during tonight's live BLOCO 13 test:
   * a BLOCKED run (every requested agent failed to actually run — see
   * evaluation-orchestrator.ts's own status derivation) was being summarized
   * identically to a genuinely COMPLETED run with zero findings ("não
   * encontrou nenhum problema confirmado") — a false "all clear" for a
   * mission that never actually evaluated anything. Constructs the row
   * directly (no real agent/model call) with the exact shape
   * createAndRunMissionEvaluation() itself would persist for that outcome.
   */
  it("never reports a BLOCKED mission (no agent could run) as a clean 'no problems found' result", async () => {
    const project = await createProject({ name: `Brain Blocked Project ${Date.now()}` });
    createdIds.push(project.id);

    const report: FinalEvaluationReport = {
      missionId: "placeholder",
      mission: { target: { url: "https://example.com" }, objective: "t", task: "t" },
      findings: [],
      coverage: [{ agentId: "qa-agent", status: "FAILED", output: null, error: "Gemini API request failed with status 503" }],
    };
    const headReport = synthesizeHeadReport(report);

    const run = await db.evaluationMissionRun.create({
      data: {
        projectId: project.id,
        status: "BLOCKED",
        input: { target: { url: "https://example.com" }, objective: "t", task: "t", requestedAgents: ["qa-agent"] },
        report: report as unknown as object,
        headReport: headReport as unknown as object,
      },
    });

    const state = { ...INITIAL_BRAIN_STATE, missionRunId: run.id };
    const result = await interpretBrainMessage("O que vocês acharam?", state);
    expect(result.text).not.toMatch(/n[ãa]o encontrou nenhum problema confirmado/i);
    expect(result.text).toMatch(/nenhum agente conseguiu concluir/i);
    expect(result.text).toContain("qa-agent");
  });
});
