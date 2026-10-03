import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createProject } from "./projects";
import { interpretBrainMessage } from "./operational-brain";
import { INITIAL_BRAIN_STATE } from "./brain-state";
import { synthesizeHeadReport } from "@/core/findings/head-report";
import { createRecommendationsForRun, setRecommendationStatus } from "./recommendations";
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

    // The realistic shape of a real Gemini quota-exhaustion error, observed
    // live via this exact phase's own Scenario F validation — a human
    // sentence followed by a multi-line raw JSON error body.
    const rawError =
      'Gemini API request failed with status 429 Too Many Requests: {\n"error": {\n"code": 429,\n"message": "You exceeded your current quota...",\n"status": "RESOURCE_EXHAUSTED"\n}\n}';
    const report: FinalEvaluationReport = {
      missionId: "placeholder",
      mission: { target: { url: "https://example.com" }, objective: "t", task: "t" },
      findings: [],
      coverage: [{ agentId: "qa-agent", status: "FAILED", output: null, error: rawError }],
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
    expect(result.text).toContain("Gemini API request failed with status 429 Too Many Requests");
    // FASE 10 — found live: the raw JSON error body itself must never reach
    // the conversational reply, only the human-readable lead sentence.
    expect(result.text).not.toContain("RESOURCE_EXHAUSTED");
    expect(result.text).not.toContain('"code": 429');
  });

  /**
   * FASE 10 — same class of bug as the "dá PARA melhorar" regression above,
   * found the same way (tracing the FASE 10 brief's own canonical phrases
   * against the real regex): "O que você acha que PODEMOS melhorar?" (the
   * brief's own primary example) and the shorter "O que podemos melhorar?"
   * (the brief's own test-matrix phrase) didn't match
   * FOLLOWUP_RECOMMENDATION at all — "podemos"/"poderíamos" weren't in the
   * vale/dá alternation, and the short form has no "você acha que" to match
   * against in the first place.
   */
  it("recognizes the FASE 10 brief's own canonical follow-up phrasing ('o que podemos melhorar')", async () => {
    const state = { ...INITIAL_BRAIN_STATE, missionRunId: "nonexistent-mission-id" };
    const full = await interpretBrainMessage("O que você acha que podemos melhorar?", state);
    const short = await interpretBrainMessage("O que podemos melhorar?", state);
    expect(full.text).not.toMatch(/n[ãa]o entendi/i);
    expect(short.text).not.toMatch(/n[ãa]o entendi/i);
  });

  /** Same bug, third variant: "faria primeiro" was recognized but "melhoraria primeiro" (the exact wording in the brief's own 3-turn conversation example) was not. */
  it("recognizes 'o que você melhoraria primeiro' as the same follow-up as 'faria primeiro'", async () => {
    const result = await interpretBrainMessage("E o que você melhoraria primeiro?", {
      ...INITIAL_BRAIN_STATE,
      missionRunId: "nonexistent-mission-id",
    });
    expect(result.text).not.toMatch(/n[ãa]o entendi/i);
  });

  it('"vamos melhorar isso" with no recommendation in context is honest, never invents one', async () => {
    const result = await interpretBrainMessage("Vamos melhorar isso.", INITIAL_BRAIN_STATE);
    expect(result.text).toMatch(/n[ãa]o existe nenhuma recomenda[çc][ãa]o pronta/i);
    expect(result.structured ?? null).toBeNull();
  });

  /**
   * FASE 10 Example 6 / Test E: a real PENDING Recommendation exists, and
   * the human hasn't decided on it yet. "Vamos melhorar isso" must start the
   * REAL human-approval step (APPROVE_RECOMMENDATION candidates, the exact
   * same ACTION_CANDIDATES shape and confirmation-token flow the "Aprovar
   * recomendação" exact command already uses) — never skip straight to
   * CREATE_IMPLEMENTATION, and never block with no path forward.
   */
  it('"vamos melhorar isso" on a PENDING recommendation offers the real approval step, never bypasses it', async () => {
    const project = await createProject({ name: `Brain Implementation Pending Project ${Date.now()}` });
    createdIds.push(project.id);

    const report: FinalEvaluationReport = {
      missionId: "placeholder",
      mission: { target: { url: "https://example.com" }, objective: "t", task: "t" },
      findings: [
        {
          status: "FINDING",
          finding: "Login button is hard to find",
          duplicated: false,
          sources: [{ agentId: "ux-agent", evidence: "e", impact: "HIGH", recommendation: "Move it above the fold", confidence: "HIGH", classification: "UX" }],
        },
      ],
      coverage: [{ agentId: "ux-agent", status: "SUCCESS", output: null, error: null }],
    };
    const headReport = synthesizeHeadReport(report);
    const run = await db.evaluationMissionRun.create({
      data: {
        projectId: project.id,
        status: "COMPLETED",
        input: { target: { url: "https://example.com" }, objective: "t", task: "t", requestedAgents: ["ux-agent"] },
        report: report as unknown as object,
        headReport: headReport as unknown as object,
      },
    });
    await createRecommendationsForRun(run.id, report, headReport);
    const [recommendation] = await db.recommendation.findMany({ where: { missionRunId: run.id } });

    const result = await interpretBrainMessage("Vamos melhorar isso.", { ...INITIAL_BRAIN_STATE, missionRunId: run.id, lastRecommendationId: recommendation.id });
    expect(result.structured).toEqual({
      type: "ACTION_CANDIDATES",
      action: "APPROVE_RECOMMENDATION",
      candidates: [
        {
          id: recommendation.id,
          title: recommendation.title,
          summary: recommendation.summary,
          impact: recommendation.impact,
          confidence: recommendation.confidence,
        },
      ],
    });
    expect(result.text).not.toMatch(/n[ãa]o entendi/i);
    expect(result.text).not.toMatch(/implementation task/i);
  });

  /** Same scenario, but the Recommendation is already APPROVED — "vamos melhorar isso" must move on to the existing Create Implementation step. */
  it('"vamos melhorar isso" on an APPROVED recommendation offers Create Implementation', async () => {
    const project = await createProject({ name: `Brain Implementation Approved Project ${Date.now()}` });
    createdIds.push(project.id);

    const report: FinalEvaluationReport = {
      missionId: "placeholder",
      mission: { target: { url: "https://example.com" }, objective: "t", task: "t" },
      findings: [
        {
          status: "FINDING",
          finding: "Checkout form has no validation",
          duplicated: false,
          sources: [{ agentId: "qa-agent", evidence: "e", impact: "CRITICAL", recommendation: "Add field validation", confidence: "HIGH", classification: "BUG" }],
        },
      ],
      coverage: [{ agentId: "qa-agent", status: "SUCCESS", output: null, error: null }],
    };
    const headReport = synthesizeHeadReport(report);
    const run = await db.evaluationMissionRun.create({
      data: {
        projectId: project.id,
        status: "COMPLETED",
        input: { target: { url: "https://example.com" }, objective: "t", task: "t", requestedAgents: ["qa-agent"] },
        report: report as unknown as object,
        headReport: headReport as unknown as object,
      },
    });
    await createRecommendationsForRun(run.id, report, headReport);
    const [recommendation] = await db.recommendation.findMany({ where: { missionRunId: run.id } });
    await setRecommendationStatus(recommendation.id, "APPROVED");

    const result = await interpretBrainMessage("Vamos melhorar isso.", { ...INITIAL_BRAIN_STATE, missionRunId: run.id, lastRecommendationId: recommendation.id });
    expect(result.structured?.type).toBe("ACTION_CANDIDATES");
    expect(result.structured && "action" in result.structured ? result.structured.action : null).toBe("CREATE_IMPLEMENTATION");
    expect(result.text).toMatch(/implementation task/i);
  });

  /**
   * FASE 11 — Mission Lifecycle. "O que vocês acharam?" while the mission
   * is genuinely still RUNNING must describe the REAL per-agent progress
   * (from EvaluationMissionRun.progress, written incrementally by
   * evaluation-orchestrator.ts's own onProgress) — not the old generic
   * "ainda está em andamento", which said nothing real at all.
   */
  it("a follow-up during a genuinely RUNNING mission reports real per-agent progress, never a generic placeholder", async () => {
    const project = await createProject({ name: `Brain Lifecycle Running Project ${Date.now()}` });
    createdIds.push(project.id);

    const run = await db.evaluationMissionRun.create({
      data: {
        projectId: project.id,
        status: "RUNNING",
        input: { target: { url: "https://example.com" }, objective: "t", task: "t", requestedAgents: ["qa-agent", "ux-agent", "security-agent"] },
        progress: { completedAgentIds: ["qa-agent"], failedAgentIds: [], runningAgentId: "ux-agent" },
      },
    });

    try {
      const result = await interpretBrainMessage("O que vocês acharam?", { ...INITIAL_BRAIN_STATE, missionRunId: run.id });
      expect(result.text).not.toMatch(/ainda está em andamento/i);
      expect(result.text).toMatch(/1 de 3/);
    } finally {
      // Never leave a RUNNING row behind — getRunningMissionRun() (used by
      // the concurrent-mission guard tested below) looks at the single most
      // recent RUNNING row GLOBALLY, so a lingering one here would make a
      // later test flaky depending on run order.
      await db.evaluationMissionRun.update({ where: { id: run.id }, data: { status: "COMPLETED" } });
    }
  });

  /**
   * FASE 11 Item 15 — a new mission-triggering message must never start a
   * second mission while a real one is genuinely RUNNING. The guard checks
   * the database directly (getRunningMissionRun), the same real fact a
   * concurrent poll would see — not something inferred from this
   * conversation's own BrainState, which wouldn't even know about a mission
   * a DIFFERENT concurrent request just started.
   */
  it("refuses to start a second mission while a real one is RUNNING, and describes the real one instead", async () => {
    const project = await createProject({ name: `Brain Lifecycle Concurrent Project ${Date.now()}` });
    createdIds.push(project.id);

    const run = await db.evaluationMissionRun.create({
      data: {
        projectId: project.id,
        status: "RUNNING",
        input: { target: { url: "https://example.com" }, objective: "t", task: "t", requestedAgents: ["qa-agent", "ux-agent"] },
        progress: { completedAgentIds: [], failedAgentIds: [], runningAgentId: "qa-agent" },
      },
    });

    try {
      const before = await db.evaluationMissionRun.count();
      const result = await interpretBrainMessage(`Analisa o ${project.name}.`, INITIAL_BRAIN_STATE);
      const after = await db.evaluationMissionRun.count();

      expect(after).toBe(before);
      expect(result.text).toMatch(/0 de 2|primeiro está em execução/i);
      expect(result.structured ?? null).toBeNull();
    } finally {
      await db.evaluationMissionRun.update({ where: { id: run.id }, data: { status: "COMPLETED" } });
    }
  });
});
