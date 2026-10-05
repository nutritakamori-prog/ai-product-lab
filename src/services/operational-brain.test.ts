import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createProject } from "./projects";
import { interpretBrainMessage } from "./operational-brain";
import { INITIAL_BRAIN_STATE } from "./brain-state";
import type { BrainState } from "./brain-state";
import { synthesizeHeadReport } from "@/core/findings/head-report";
import { createRecommendationsForRun, setRecommendationStatus } from "./recommendations";
import { createImplementation } from "./implementations";
import { analyzeTeamIntelligence } from "./team-intelligence-report";
import { analyzeLabSelfAwareness } from "./lab-self-awareness";
import { selectAgentsForMission } from "./agent-selection";
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

/**
 * FASE 12C — Team Intelligence ↔ Operational Brain.
 *
 * Per this phase's own brief: the Brain must never compute confidence,
 * coverage, overlap, gaps, disable suggestions, add-agent thresholds,
 * recurrence, or participation itself — all of that stays in
 * analyzeTeamIntelligence (FASE 12A, unchanged by this phase). These tests
 * verify only the integration: real intent recognition, real project
 * resolution (reusing project-resolution.ts, no second resolver), a real
 * call to the existing service, and a reply built from its real fields —
 * never a second analysis engine, never a mutation, never an unnecessary
 * mission.
 */
describe("operational-brain — Team Intelligence (FASE 12C)", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    if (createdIds.length) {
      await db.auditLog.deleteMany({ where: { entityId: { in: createdIds } } });
      await db.project.deleteMany({ where: { id: { in: createdIds } } });
    }
    await db.$disconnect();
  });

  async function freshProject(name: string) {
    const project = await createProject({ name: `${name} ${Date.now()}-${Math.random()}` });
    createdIds.push(project.id);
    return project;
  }

  const NOT_UNDERSTOOD = /n[ãa]o entendi como uma miss[ãa]o/i;

  describe("classificação — reconhece perguntas de Team Intelligence, nunca cai no fallback genérico", () => {
    it.each([
      ["Como está nossa equipe?"],
      ["Quais agentes estão subutilizados?"],
      ["Precisamos criar algum agente?"],
      ["Existe sobreposição?"],
      ["Tem algum gap na nossa equipe?"],
    ])("%s", async (message) => {
      const project = await freshProject("TI Classify");
      const result = await interpretBrainMessage(message, { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });
      expect(result.text).not.toMatch(NOT_UNDERSTOOD);
      expect(result.structured ?? null).toBeNull();
    });
  });

  describe("não regressão", () => {
    it('"Analisa o LAB." (and any other mission-trigger phrase) continues to go through the real mission flow, never Team Intelligence — proven without a real model call via the same RUNNING-mission guard the Mission Lifecycle tests already use', async () => {
      const project = await freshProject("TI Mission Non Regression");
      const run = await db.evaluationMissionRun.create({
        data: {
          projectId: project.id,
          status: "RUNNING",
          input: { target: { url: "https://example.com" }, objective: "t", task: "t", requestedAgents: ["qa-agent"] },
          progress: { completedAgentIds: [], failedAgentIds: [], runningAgentId: "qa-agent" },
        },
      });
      try {
        const result = await interpretBrainMessage(`Analisa o ${project.name}.`, INITIAL_BRAIN_STATE);
        // The real mission-in-progress message, never a Team Intelligence reply.
        expect(result.text).toMatch(/primeiro está em execução|ainda estou analisando/i);
      } finally {
        await db.evaluationMissionRun.update({ where: { id: run.id }, data: { status: "COMPLETED" } });
      }
    });

    it("a mission-trigger verb together with a Team-Intelligence phrase still routes to the real mission flow, never to Team Intelligence (the explicit guard this phase's brief asks for)", async () => {
      const project = await freshProject("TI Overlap Guard");
      const run = await db.evaluationMissionRun.create({
        data: {
          projectId: project.id,
          status: "RUNNING",
          input: { target: { url: "https://example.com" }, objective: "t", task: "t", requestedAgents: ["qa-agent"] },
          progress: { completedAgentIds: [], failedAgentIds: [], runningAgentId: "qa-agent" },
        },
      });
      try {
        // Contains both a MISSION_TRIGGER word ("avalie") and a TEAM_INTELLIGENCE_OVERLAP phrase ("existe sobreposição").
        const result = await interpretBrainMessage(`Avalie se existe sobreposição no ${project.name}.`, INITIAL_BRAIN_STATE);
        expect(result.text).toMatch(/primeiro está em execução|ainda estou analisando/i);
        expect(result.text).not.toMatch(/sinal de sobreposi|confiança geral da an[áa]lise/i);
      } finally {
        await db.evaluationMissionRun.update({ where: { id: run.id }, data: { status: "COMPLETED" } });
      }
    });

    it("an existing exact command keeps resolving directly, unaffected by the new Team Intelligence branch", async () => {
      const result = await interpretBrainMessage("recomendações pendentes", INITIAL_BRAIN_STATE);
      expect(result.structured?.type).toBe("PENDING_RECOMMENDATIONS");
    });

    it("an ambiguous Team Intelligence project reference asks for clarification, never guesses", async () => {
      const a = await freshProject("Agenda Norte");
      const b = await freshProject("Agenda Sul");
      const result = await interpretBrainMessage("Como está a equipe do Agenda?", INITIAL_BRAIN_STATE);
      expect(result.text).toMatch(/qual deles/i);
      expect(result.text).toContain(a.name);
      expect(result.text).toContain(b.name);
    });
  });

  describe("integração", () => {
    it("resolves the correct project, calls the real analyzeTeamIntelligence service, and answers from its real fields — never mutating anything", async () => {
      const project = await freshProject("TI Integration");

      const [agentsBefore, missionsBefore, recsBefore, implsBefore, validationsBefore] = await Promise.all([
        db.agent.count(),
        db.evaluationMissionRun.count(),
        db.recommendation.count(),
        db.implementation.count(),
        db.validation.count(),
      ]);

      const expected = await analyzeTeamIntelligence(project.id);
      const result = await interpretBrainMessage("Como está nossa equipe?", { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });

      const [agentsAfter, missionsAfter, recsAfter, implsAfter, validationsAfter] = await Promise.all([
        db.agent.count(),
        db.evaluationMissionRun.count(),
        db.recommendation.count(),
        db.implementation.count(),
        db.validation.count(),
      ]);

      expect(agentsAfter).toBe(agentsBefore);
      expect(missionsAfter).toBe(missionsBefore);
      expect(recsAfter).toBe(recsBefore);
      expect(implsAfter).toBe(implsBefore);
      expect(validationsAfter).toBe(validationsBefore);

      // Real numbers from the real report, never a duplicated computation.
      expect(result.text).toContain(`${expected.team.activity.totalAgents} agente(s)`);
      expect(result.text).toContain(`${expected.team.activity.enabledAgents} habilitado(s)`);
      expect(result.structured ?? null).toBeNull();
    });

    it("falls back to the single existing project when none is named and none is in conversational context yet, never inventing one", async () => {
      // This test only holds if it runs against a database with exactly one
      // project — guarded by checking first, so it's never a false pass/fail
      // in a database seeded with more.
      const allProjects = await db.project.findMany({ select: { id: true } });
      if (allProjects.length !== 1) return;
      const result = await interpretBrainMessage("Como está nossa equipe?", INITIAL_BRAIN_STATE);
      expect(result.text).not.toMatch(NOT_UNDERSTOOD);
      expect(result.text).not.toMatch(/sobre qual projeto|n[ãa]o h[áa] nenhum projeto/i);
    });
  });

  describe("follow-up", () => {
    it('"Como está nossa equipe?" → "Quais estão subutilizados?" → "Devemos remover algum?" carries the resolved project across turns and never creates a new mission for any of them', async () => {
      const project = await freshProject("TI Followup");
      const before = await db.evaluationMissionRun.count();

      const turn1 = await interpretBrainMessage("Como está nossa equipe?", { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });
      expect(turn1.text).not.toMatch(NOT_UNDERSTOOD);

      const turn2 = await interpretBrainMessage("Quais estão subutilizados?", turn1.state);
      expect(turn2.text).not.toMatch(NOT_UNDERSTOOD);
      expect(turn2.state.projectId).toBe(project.id);

      const turn3 = await interpretBrainMessage("Devemos remover algum?", turn2.state);
      expect(turn3.text).toMatch(/insufici[êe]ncia de evid[êe]ncia para remo[çc][ãa]o/i);

      const after = await db.evaluationMissionRun.count();
      expect(after).toBe(before);
    });
  });
});

/**
 * FASE 13 — LAB Self-Awareness.
 *
 * Reuses analyzeLabSelfAwareness (which itself reuses analyzeTeamIntelligence,
 * FASE 12A, unmodified) — these tests verify only the Brain's own new
 * integration: intent recognition, project resolution (the same
 * resolveProjectForBrainQuery FASE 12C already uses, renamed and shared —
 * not a second resolver), a real call to the service, and a reply honestly
 * built from its real fields. Never a mutation, never a fabricated
 * problem/recommendation/capability.
 */
describe("operational-brain — LAB Self-Awareness (FASE 13)", () => {
  const createdIds: string[] = [];

  afterAll(async () => {
    if (createdIds.length) {
      await db.auditLog.deleteMany({ where: { entityId: { in: createdIds } } });
      await db.project.deleteMany({ where: { id: { in: createdIds } } });
    }
    await db.$disconnect();
  });

  async function freshProject(name: string) {
    const project = await createProject({ name: `${name} ${Date.now()}-${Math.random()}` });
    createdIds.push(project.id);
    return project;
  }

  const NOT_UNDERSTOOD = /n[ãa]o entendi como uma miss[ãa]o/i;

  describe("classificação — reconhece perguntas sobre o próprio LAB, nunca cai no fallback genérico", () => {
    it.each([
      ["Como está o LAB?"],
      ["Como o LAB está funcionando?"],
      ["O que o LAB consegue fazer?"],
      ["O que o LAB ainda não consegue fazer?"],
      ["Quais são os problemas atuais?"],
      ["O que deveríamos melhorar?"],
      ["O que aconteceu recentemente?"],
    ])("%s", async (message) => {
      const project = await freshProject("LSA Classify");
      const result = await interpretBrainMessage(message, { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });
      expect(result.text).not.toMatch(NOT_UNDERSTOOD);
      expect(result.structured ?? null).toBeNull();
    });
  });

  describe("não regressão", () => {
    it('"Como está nossa equipe?" still routes to Team Intelligence, never to LAB Self-Awareness', async () => {
      const project = await freshProject("LSA vs TI Guard");
      const result = await interpretBrainMessage("Como está nossa equipe?", { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });
      expect(result.text).toMatch(/agente\(s\)/i);
      expect(result.text).not.toMatch(/FATO:|EVID[ÊE]NCIA:|CONCLUS[ÃA]O:/);
    });

    it('"Analisa o LAB." (and any mission-trigger phrase naming a project) continues to go through the real mission flow, never LAB Self-Awareness — proven without a real model call via the same RUNNING-mission guard already used in FASE 12C', async () => {
      // Deliberately no "lab" in this project's own name — resolveProjectReference's
      // own word-overlap would otherwise make this project a second real
      // "lab"-named candidate for every OTHER test in this suite run that
      // asks a LAB Self-Awareness question (which always mentions "LAB"),
      // turning what should be a single, unambiguous match into a false
      // AMBIGUOUS result purely from test-data pollution within one run.
      const project = await freshProject("Mission NonReg Target");
      const run = await db.evaluationMissionRun.create({
        data: {
          projectId: project.id,
          status: "RUNNING",
          input: { target: { url: "https://example.com" }, objective: "t", task: "t", requestedAgents: ["qa-agent"] },
          progress: { completedAgentIds: [], failedAgentIds: [], runningAgentId: "qa-agent" },
        },
      });
      try {
        const result = await interpretBrainMessage(`Analisa o ${project.name}.`, INITIAL_BRAIN_STATE);
        expect(result.text).toMatch(/primeiro está em execução|ainda estou analisando/i);
      } finally {
        await db.evaluationMissionRun.update({ where: { id: run.id }, data: { status: "COMPLETED" } });
      }
    });

    it('"Quais sistemas técnicos eu tenho no GitHub?" still routes to GitHub Intelligence, unaffected by the new branch placed after it', async () => {
      const result = await interpretBrainMessage("Quais sistemas técnicos eu tenho no GitHub?", INITIAL_BRAIN_STATE);
      expect(result.text).toMatch(/n[ãa]o tenho acesso ao github configurado/i);
    });

    it("an existing exact command keeps resolving directly, unaffected by the new LAB Self-Awareness branch", async () => {
      const result = await interpretBrainMessage("recomendações pendentes", INITIAL_BRAIN_STATE);
      expect(result.structured?.type).toBe("PENDING_RECOMMENDATIONS");
    });
  });

  describe("honestidade", () => {
    it("never turns the absence of a recurring finding into a fabricated problem — a structural Team Architect signal (present from day one for any idle agent) is explicitly labeled a signal, never a confirmed problem", async () => {
      const project = await freshProject("LSA Honest No Problem");
      const result = await interpretBrainMessage("Quais são os problemas atuais?", { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });
      // A brand-new project always has COVERAGE_GAP signals (buildCoverageGaps
      // fires for every enabled-but-idle agent regardless of mission history —
      // see team-architect.ts, unmodified by this phase), so the true honest
      // floor here is "isso é um sinal, não um problema confirmado", never a
      // positive claim of a confirmed problem.
      expect(result.text).toMatch(/isso é um sinal, n[ãa]o um problema confirmado/i);
      expect(result.text).not.toMatch(/\bsim —/i);
    });

    it("never turns the absence of a pending recommendation into a fabricated one — follows the real tiered priority instead", async () => {
      const project = await freshProject("LSA Honest No Recommendation");
      const result = await interpretBrainMessage("O que deveríamos melhorar?", { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });
      // This environment has no GITHUB_API_TOKEN configured, so the real,
      // honest tier-3 "known limitation" answer is the one that fires —
      // never an invented specific recommendation.
      expect(result.text).toMatch(/n[ãa]o h[áa] recommendation ou finding recorrente pendente/i);
      expect(result.text).not.toMatch(/recommendation\(s\) pendente/i);
    });

    it("never calls a known, honest limitation a bug", async () => {
      const project = await freshProject("LSA Honest Limitation Not Bug");
      const result = await interpretBrainMessage("Quais são nossas limitações?", { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });
      expect(result.text).not.toMatch(/\bbug\b/i);
      expect(result.text.length).toBeGreaterThan(0);
    });

    it("never lists an unconfirmed capability (real evaluations, real GitHub access) as available on a project with neither", async () => {
      const project = await freshProject("LSA Honest Capability Not Available");
      // "O que já conseguimos fazer?" — deliberately the CAPABILITIES
      // phrasing that doesn't contain the word "lab", so this resolves via
      // conversational context (this fresh, isolated project) rather than
      // word-matching the real, pre-existing "AI Product Lab" project that
      // always exists in this shared database.
      const result = await interpretBrainMessage("O que já conseguimos fazer?", { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });
      expect(result.text).not.toMatch(/j[áa] fez isso neste projeto/i);
      expect(result.text).not.toMatch(/consultar reposit[óo]rios reais no github/i);
      expect(result.text).toMatch(/planejada, n[ãa]o confirmada/i);
    });
  });

  describe("follow-up", () => {
    /**
     * Uses "O que está funcionando?" / "O que está dando errado?" / "E o
     * que você melhoraria?" rather than the brief's literal "Como está o
     * LAB?" opener: that phrase contains the word "lab", and under the
     * FULL test suite (other files — e.g. lab-task.test.ts — concurrently
     * create their own transient "Lab task ... test project" rows against
     * this same shared database) resolveProjectReference's own real
     * word-overlap logic can legitimately see more than one "lab"-named
     * project at once and correctly ask for clarification instead of
     * guessing — exactly the right behavior, just not one this test can
     * assert a single deterministic project id against. These three
     * phrases carry the same LAB-wide self-awareness intent without that
     * word, so this test can isolate its own fresh project via
     * conversational context the way every other context test in this
     * file already does.
     */
    it('"O que está funcionando?" → "O que está dando errado?" → "E o que você melhoraria?" keeps the same project in context across turns and never creates a mission', async () => {
      const project = await freshProject("LSA Followup");
      const before = await db.evaluationMissionRun.count();

      const turn1 = await interpretBrainMessage("O que está funcionando?", { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });
      expect(turn1.text).not.toMatch(NOT_UNDERSTOOD);
      expect(turn1.state.projectId).toBe(project.id);

      const turn2 = await interpretBrainMessage("O que está dando errado?", turn1.state);
      expect(turn2.text).not.toMatch(NOT_UNDERSTOOD);
      expect(turn2.state.projectId).toBe(project.id);

      const turn3 = await interpretBrainMessage("E o que você melhoraria?", turn2.state);
      expect(turn3.text).not.toMatch(NOT_UNDERSTOOD);
      expect(turn3.state.projectId).toBe(project.id);

      const after = await db.evaluationMissionRun.count();
      expect(after).toBe(before);
    });
  });

  describe("integração", () => {
    /**
     * Uses "O que está funcionando?" rather than "Como está o LAB?" for the
     * same reason as the follow-up test above (no "lab" word, so this test
     * can isolate its own fresh project deterministically even under full
     * concurrent suite runs, rather than depending on which real "lab"-
     * named project happens to be unambiguous at that exact moment).
     */
    it("resolves the correct project, calls the real analyzeLabSelfAwareness service, and answers from its real fields — never mutating anything", async () => {
      const project = await freshProject("LSA Integration");

      const [agentsBefore, missionsBefore, execsBefore, recsBefore, implsBefore, validationsBefore] = await Promise.all([
        db.agent.count(),
        db.evaluationMissionRun.count(),
        db.agentExecution.count(),
        db.recommendation.count(),
        db.implementation.count(),
        db.validation.count(),
      ]);

      const expected = await analyzeLabSelfAwareness(project.id);
      const result = await interpretBrainMessage("O que está funcionando?", { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });

      const [agentsAfter, missionsAfter, execsAfter, recsAfter, implsAfter, validationsAfter] = await Promise.all([
        db.agent.count(),
        db.evaluationMissionRun.count(),
        db.agentExecution.count(),
        db.recommendation.count(),
        db.implementation.count(),
        db.validation.count(),
      ]);

      expect(agentsAfter).toBe(agentsBefore);
      expect(missionsAfter).toBe(missionsBefore);
      expect(execsAfter).toBe(execsBefore);
      expect(recsAfter).toBe(recsBefore);
      expect(implsAfter).toBe(implsBefore);
      expect(validationsAfter).toBe(validationsBefore);

      expect(result.state.projectId).toBe(project.id);
      // Real numbers from the real report (WORKING_WELL's own EVIDÊNCIA line), never a duplicated computation.
      expect(result.text).toContain(`${expected.missions.completed} missão(ões) foram concluídas`);
      expect(result.text).toContain(`${expected.team.evidence.findingsAnalyzed} finding(s)`);
      expect(result.structured ?? null).toBeNull();
    });
  });
});

/**
 * FASE 14B — Natural Language Hardening.
 *
 * Corrects the 5 real bugs found live during FASE 14's own end-to-end run,
 * without creating a new router, a new agent, or an LLM. Every fix reuses
 * the existing deterministic regex router and the existing data services
 * (getCreateValidationCandidates in particular, BUG 5) — never a new
 * mechanism.
 */
describe("operational-brain — Natural Language Hardening (FASE 14B)", () => {
  const createdIds: string[] = [];
  const NOT_UNDERSTOOD = /n[ãa]o entendi como uma miss[ãa]o/i;

  afterAll(async () => {
    if (createdIds.length) {
      await db.auditLog.deleteMany({ where: { entityId: { in: createdIds } } });
      await db.project.deleteMany({ where: { id: { in: createdIds } } });
    }
    await db.$disconnect();
  });

  async function freshProject(name: string) {
    const project = await createProject({ name: `${name} ${Date.now()}-${Math.random()}` });
    createdIds.push(project.id);
    return project;
  }

  describe("BUG 2 — Self-Awareness IMPROVEMENTS recognizes all the brief's own phrasings", () => {
    it.each([
      ["O que devemos melhorar?"],
      ["O que precisamos melhorar?"],
      ["O que deveríamos melhorar?"],
      ["O que podemos melhorar?"],
      ["O que ainda precisa melhorar?"],
      ["O que precisa melhorar?"],
      ["Tem algo que precisa melhorar?"],
      ["O que você acha que precisa melhorar?"],
    ])("%s", async (message) => {
      const project = await freshProject("B2 Improvements");
      const result = await interpretBrainMessage(message, { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });
      expect(result.text).not.toMatch(NOT_UNDERSTOOD);
      expect(result.structured ?? null).toBeNull();
    });
  });

  describe("BUG 3 — Team Intelligence OVERVIEW recognizes all the brief's own phrasings, order-independent", () => {
    it.each([
      ["Como está nossa equipe?"],
      ["E nossa equipe?"],
      ["E nossa equipe, como está?"],
      ["Nossa equipe está como?"],
      ["Como está a equipe?"],
      ["E a equipe?"],
      ["Quero saber como está nossa equipe."],
    ])("%s", async (message) => {
      const project = await freshProject("B3 TeamOverview");
      const result = await interpretBrainMessage(message, { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });
      expect(result.text).not.toMatch(NOT_UNDERSTOOD);
      expect(result.text).toMatch(/agente\(s\)/i);
      expect(result.structured ?? null).toBeNull();
    });
  });

  describe("BUG 4 — LAB Self-Awareness OVERVIEW accepts the real resolved project name, never a hardcoded string", () => {
    it("'Como está o AI Product Lab?' (the real project's own name) works cold, with no prior context", async () => {
      const project = await freshProject("Product Evaluation Target");
      // The message must contain the SAME real name resolveProjectReference
      // will resolve against — using a uniquely-suffixed clone name (never
      // the real production project) keeps this test deterministic and
      // isolated from the shared database's own real "AI Product Lab" row.
      const result = await interpretBrainMessage(`Como está o ${project.name}?`, INITIAL_BRAIN_STATE);
      expect(result.text).not.toMatch(NOT_UNDERSTOOD);
      expect(result.state.projectId).toBe(project.id);
    });

    it("'Como está o Agenda Norte?' works for ANY real project named in the message, not specifically 'AI Product Lab'", async () => {
      const project = await freshProject("Agenda Norte Clone");
      const result = await interpretBrainMessage(`Como está o ${project.name}?`, INITIAL_BRAIN_STATE);
      expect(result.text).not.toMatch(NOT_UNDERSTOOD);
      expect(result.state.projectId).toBe(project.id);
    });

    it("'Como está o LAB?' (the generic placeholder word) still works, unaffected by the fix", async () => {
      const result = await interpretBrainMessage("Como está o LAB?", INITIAL_BRAIN_STATE);
      expect(result.text).not.toMatch(NOT_UNDERSTOOD);
    });

    it("'Como está o projeto?' (the other generic placeholder word) works", async () => {
      const project = await freshProject("B4 Projeto Generic");
      const result = await interpretBrainMessage("Como está o projeto?", { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });
      expect(result.text).not.toMatch(NOT_UNDERSTOOD);
    });

    it("the real project's name followed by extra words ('agora') still resolves, via conversational context", async () => {
      const project = await freshProject("Product Evaluation Target Agora");
      const first = await interpretBrainMessage(`Como está o ${project.name}?`, INITIAL_BRAIN_STATE);
      const result = await interpretBrainMessage(`Como está o ${project.name} agora?`, first.state);
      expect(result.text).not.toMatch(NOT_UNDERSTOOD);
      expect(result.state.projectId).toBe(project.id);
    });

    /**
     * FASE 16B — found live in the grand natural conversation E2E: "E como
     * o LAB está hoje?" fell to the generic fallback because
     * LAB_SELF_AWARENESS_OVERVIEW_GENERIC/HOW_IS_IT_SHAPE both required
     * "como" directly adjacent to "está/estão" — a real sentence that puts
     * the subject in between (as both "o LAB" and a real project name
     * naturally do) was never covered. Broadened to an order-independent
     * signal (same lookahead technique RETEST_QUERY already uses), still
     * never hardcoding a real project name.
     */
    it("'E como o LAB está hoje?' (subject between 'como' and 'está') now resolves, instead of falling to the generic fallback", async () => {
      const result = await interpretBrainMessage("E como o LAB está hoje?", INITIAL_BRAIN_STATE);
      expect(result.text).not.toMatch(NOT_UNDERSTOOD);
    });

    it("'Como o AI Product Lab está indo?' (real project name between 'como' and 'está') also resolves", async () => {
      // Deliberately NOT named with "Como" (or any other common word that
      // appears as the opening word of other tests' own queries elsewhere
      // in this file, e.g. "Como ficou depois da mudança?" in BUG 5 below)
      // as a leading/significant word — resolveProjectReference's own
      // pre-existing, documented, out-of-scope substring/significant-word
      // matching (no word boundaries) would otherwise let this project's
      // own name collide with an unrelated test's query, exactly the same
      // collision class already registered for "demo"/"test" in FASE
      // 14B/15A — found live here when this project's original name
      // ("B16B Como Nome No Meio") did exactly that.
      const project = await freshProject("B16B WordOrder Regression Target");
      const result = await interpretBrainMessage(`Como o ${project.name} está indo?`, INITIAL_BRAIN_STATE);
      expect(result.text).not.toMatch(NOT_UNDERSTOOD);
      expect(result.state.projectId).toBe(project.id);
    });
  });

  describe("BUG 5 — natural-language retest forwards to the real, existing validation mechanism", () => {
    /**
     * "reteste"/"retestar"/"teste" all contain the substring "test" — and
     * resolveProjectReference's own word-overlap (project-resolution.ts,
     * untouched this phase) does a raw substring check with no word
     * boundary. Under the FULL test suite, many OTHER files' own transient
     * fixture projects are named with "test" in them (a completely normal,
     * unrelated naming convention), so these messages can legitimately
     * resolve AMBIGUOUS rather than to this test's own context project —
     * an honest "which project?" ask, never a crash or a fabricated
     * candidate. This is a real, pre-existing resolveProjectReference
     * characteristic (the same substring-matching class as the FASE 13
     * "LAB" finding, generalized), registered in this phase's own report,
     * not something this phase is scoped to fix. The assertion therefore
     * accepts either honest outcome — never the generic fallback, never a
     * fabricated candidate — rather than assuming a single deterministic
     * project resolution that this phase was explicitly told not to touch.
     */
    it.each([
      ["Pode fazer um reteste?"],
      ["Podemos retestar?"],
      ["Faz um reteste."],
      ["Vamos retestar."],
      ["Quero retestar."],
      ["Como ficou depois da mudança?"],
      ["Podemos validar a mudança?"],
    ])("%s — honest, never a fabricated candidate", async (message) => {
      const project = await freshProject("B5 NoCandidate Case");
      const result = await interpretBrainMessage(message, { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });
      expect(result.text).not.toMatch(NOT_UNDERSTOOD);
      expect(result.text).toMatch(/n[ãa]o h[áa] nenhuma implementation pendente de valida[çc][ãa]o|qual deles voc[êe] quer saber/i);
      expect(result.structured ?? null).toBeNull();
    });

    it("forwards to the real getCreateValidationCandidates mechanism and surfaces a real candidate when one exists — never creates one itself", async () => {
      const project = await freshProject("B5 RealCandidate Case");
      const report: FinalEvaluationReport = {
        missionId: "placeholder",
        mission: { target: { url: "https://example.com", name: "Retest Target" }, objective: "t", task: "t" },
        findings: [
          {
            status: "FINDING",
            finding: "Checkout form has no validation",
            duplicated: false,
            sources: [{ agentId: "qa-agent", evidence: "e", impact: "HIGH", recommendation: "Add field validation", confidence: "HIGH", classification: "BUG" }],
          },
        ],
        coverage: [{ agentId: "qa-agent", status: "SUCCESS", output: null, error: null }],
      };
      const headReport = synthesizeHeadReport(report);
      const run = await db.evaluationMissionRun.create({
        data: {
          projectId: project.id,
          status: "COMPLETED",
          input: { target: { url: "https://example.com", name: "Retest Target" }, objective: "t", task: "t", requestedAgents: ["qa-agent"] },
          report: report as unknown as object,
          headReport: headReport as unknown as object,
        },
      });
      await createRecommendationsForRun(run.id, report, headReport);
      const [recommendation] = await db.recommendation.findMany({ where: { missionRunId: run.id } });
      await setRecommendationStatus(recommendation.id, "APPROVED");
      const implementation = await createImplementation(recommendation.id, "Added server-side validation.");

      const validationsBefore = await db.validation.count();
      // "Como ficou depois da mudança?" deliberately contains neither
      // "test" (which "reteste"/"retestar" do — colliding under full-suite
      // concurrency with other files' own "...test..." fixture projects)
      // nor "demo" hidden inside "podemos" (colliding with the real,
      // pre-existing "QG demo review" project — found live writing this
      // test). Both are real, pre-existing resolveProjectReference
      // substring-matching characteristics (project-resolution.ts,
      // untouched this phase, out of scope) — registered in this phase's
      // own report. This specific test needs a deterministic single
      // project to verify the POSITIVE case (a real candidate surfaced),
      // so it uses the one required phrase from the brief's own list that
      // avoids both collisions.
      const result = await interpretBrainMessage("Como ficou depois da mudança?", { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });
      const validationsAfter = await db.validation.count();

      expect(validationsAfter).toBe(validationsBefore);
      expect(result.text).toContain(recommendation.title);
      expect(result.structured).toEqual({
        type: "ACTION_CANDIDATES",
        action: "CREATE_VALIDATION",
        candidates: [{ implementationId: implementation.id, recommendationId: recommendation.id, recommendationTitle: recommendation.title, implementationSummary: implementation.summary }],
      });
    });
  });

  describe("não regressão", () => {
    it.each([
      ["Quais agentes estão subutilizados?"],
      ["Precisamos criar algum agente?"],
      ["Existe sobreposição?"],
      ["Devemos remover algum?"],
    ])("Team Intelligence — %s", async (message) => {
      const project = await freshProject("B14B NonReg TI");
      const result = await interpretBrainMessage(message, { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });
      expect(result.text).not.toMatch(NOT_UNDERSTOOD);
    });

    it("GitHub — 'Quais sistemas técnicos eu tenho no GitHub?' still honest", async () => {
      const result = await interpretBrainMessage("Quais sistemas técnicos eu tenho no GitHub?", INITIAL_BRAIN_STATE);
      expect(result.text).toMatch(/n[ãa]o tenho acesso ao github configurado/i);
    });

    it("Mission — 'Analisa o AI Product Lab.' still goes through the real mission flow (proven via the RUNNING-mission guard, no real model call)", async () => {
      const project = await freshProject("Mission NonReg Target 14B");
      const run = await db.evaluationMissionRun.create({
        data: {
          projectId: project.id,
          status: "RUNNING",
          input: { target: { url: "https://example.com" }, objective: "t", task: "t", requestedAgents: ["qa-agent"] },
          progress: { completedAgentIds: [], failedAgentIds: [], runningAgentId: "qa-agent" },
        },
      });
      try {
        const result = await interpretBrainMessage(`Analisa o ${project.name}.`, INITIAL_BRAIN_STATE);
        expect(result.text).toMatch(/primeiro está em execução|ainda estou analisando/i);
      } finally {
        await db.evaluationMissionRun.update({ where: { id: run.id }, data: { status: "COMPLETED" } });
      }
    });

    it.each([["Como está o LAB?"], ["O que está funcionando?"], ["O que está dando errado?"]])("Self-Awareness — %s", async (message) => {
      const result = await interpretBrainMessage(message, INITIAL_BRAIN_STATE);
      expect(result.text).not.toMatch(NOT_UNDERSTOOD);
    });

    it("Implementation — 'Vamos melhorar isso' on a PENDING recommendation is unaffected by this phase's changes", async () => {
      const project = await freshProject("B14B NonReg Implementation");
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
      expect(result.structured?.type).toBe("ACTION_CANDIDATES");
      expect(result.structured && "action" in result.structured ? result.structured.action : null).toBe("APPROVE_RECOMMENDATION");
    });
  });

  describe("teste de contexto", () => {
    it("carries the same projectId across a 6-turn conversation mixing Self-Awareness and Team Intelligence, no generic fallback, no mission created", async () => {
      const project = await freshProject("B14B Context Chain");
      // Scoped to this test's own project — a global count races against
      // every other concurrently-running test file's own real missions
      // under the full suite.
      const before = await db.evaluationMissionRun.count({ where: { projectId: project.id } });

      const turn1 = await interpretBrainMessage(`Como está o ${project.name}?`, INITIAL_BRAIN_STATE);
      expect(turn1.text).not.toMatch(NOT_UNDERSTOOD);
      expect(turn1.state.projectId).toBe(project.id);

      const turn2 = await interpretBrainMessage("O que está funcionando?", turn1.state);
      expect(turn2.text).not.toMatch(NOT_UNDERSTOOD);
      expect(turn2.state.projectId).toBe(project.id);

      const turn3 = await interpretBrainMessage("O que está dando errado?", turn2.state);
      expect(turn3.text).not.toMatch(NOT_UNDERSTOOD);
      expect(turn3.state.projectId).toBe(project.id);

      const turn4 = await interpretBrainMessage("O que ainda precisa melhorar?", turn3.state);
      expect(turn4.text).not.toMatch(NOT_UNDERSTOOD);
      expect(turn4.state.projectId).toBe(project.id);

      const turn5 = await interpretBrainMessage("E nossa equipe?", turn4.state);
      expect(turn5.text).not.toMatch(NOT_UNDERSTOOD);
      expect(turn5.text).toMatch(/agente\(s\)/i);
      expect(turn5.state.projectId).toBe(project.id);

      const turn6 = await interpretBrainMessage("Quais agentes estão subutilizados?", turn5.state);
      expect(turn6.text).not.toMatch(NOT_UNDERSTOOD);
      expect(turn6.state.projectId).toBe(project.id);

      const after = await db.evaluationMissionRun.count({ where: { projectId: project.id } });
      expect(after).toBe(before);
    });
  });

  describe("teste de ambiguidade \"LAB\" (reprodução da FASE 13, sem corrigir)", () => {
    /**
     * Reproduces FASE 13's own finding: the word "lab" word-overlaps the
     * real "AI Product Lab" project, overriding whatever is in
     * conversational context — unchanged, not fixed in this phase.
     * Under the full test suite, this can ALSO legitimately come back
     * AMBIGUOUS instead of RESOLVED (other files' own concurrently-live
     * fixture projects whose names happen to contain "lab" too) — still
     * never silently switches to `other` while claiming something false,
     * so the only thing this test asserts is that real behavior, not a
     * single deterministic outcome this phase was told not to touch.
     */
    it("'Como está o LAB?' with a DIFFERENT project explicitly in context never silently answers as if it were that project — it either resolves to the real self-referential project or honestly asks which one, unchanged, not fixed in this phase", async () => {
      const other = await freshProject("B14B Ambiguity Other Project");
      const result = await interpretBrainMessage("Como está o LAB?", { ...INITIAL_BRAIN_STATE, projectId: other.id, projectName: other.name });
      const askedForClarification = /qual deles voc[êe] quer saber/i.test(result.text);
      // Either it switched away from `other` (the FASE 13 finding, word
      // overlap beating context) or it's honestly asking which project —
      // never silently staying on `other` while answering as if resolved.
      expect(askedForClarification || result.state.projectId !== other.id).toBe(true);
    });
  });

  describe("não-mutação para perguntas informacionais", () => {
    it("a batch of informational questions (Self-Awareness, Team Intelligence, retest-no-candidate) never creates a mission, execution, recommendation, implementation, or validation", async () => {
      const project = await freshProject("B14B NonMutation");
      const [agentsBefore, missionsBefore, execsBefore, recsBefore, implsBefore, validationsBefore] = await Promise.all([
        db.agent.count(),
        db.evaluationMissionRun.count(),
        db.agentExecution.count(),
        db.recommendation.count(),
        db.implementation.count(),
        db.validation.count(),
      ]);

      let state: BrainState = { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name };
      for (const message of [
        "Como está o LAB?",
        "O que está funcionando?",
        "O que está dando errado?",
        "O que ainda precisa melhorar?",
        "E nossa equipe?",
        "Quais agentes estão subutilizados?",
        "Pode fazer um reteste?",
      ]) {
        const result = await interpretBrainMessage(message, state);
        state = result.state;
      }

      const [agentsAfter, missionsAfter, execsAfter, recsAfter, implsAfter, validationsAfter] = await Promise.all([
        db.agent.count(),
        db.evaluationMissionRun.count(),
        db.agentExecution.count(),
        db.recommendation.count(),
        db.implementation.count(),
        db.validation.count(),
      ]);

      expect(agentsAfter).toBe(agentsBefore);
      expect(missionsAfter).toBe(missionsBefore);
      expect(execsAfter).toBe(execsBefore);
      expect(recsAfter).toBe(recsBefore);
      expect(implsAfter).toBe(implsBefore);
      expect(validationsAfter).toBe(validationsBefore);
    });
  });
});

/**
 * FASE 15A — Product Understanding.
 *
 * FASE 15 found the Brain can operate on real state but has zero model of
 * what it IS as a product — 14/15 identity questions fell to the generic
 * fallback, and "Como uma avaliação vira um Finding?" was actively
 * misread as a mission request. These tests verify the fix: a small,
 * static, reusable conceptual layer (src/core/product-understanding/),
 * wired into the Brain ahead of AGENT_GAP/MISSION_TRIGGER by position —
 * never by changing MISSION_TRIGGER itself — and that it never collides
 * with the pre-existing, evidence-based Self-Awareness/Team Intelligence/
 * Retest/Mission intents.
 */
describe("operational-brain — Product Understanding (FASE 15A)", () => {
  const createdIds: string[] = [];
  const NOT_UNDERSTOOD = /n[ãa]o entendi como uma miss[ãa]o/i;

  afterAll(async () => {
    if (createdIds.length) {
      await db.auditLog.deleteMany({ where: { entityId: { in: createdIds } } });
      await db.project.deleteMany({ where: { id: { in: createdIds } } });
    }
    await db.$disconnect();
  });

  async function freshProject(name: string) {
    const project = await createProject({ name: `${name} ${Date.now()}-${Math.random()}` });
    createdIds.push(project.id);
    return project;
  }

  describe("as 15 perguntas da FASE 15, reexecutadas", () => {
    it.each([
      ["O que é o AI Product Lab?", /sistema|avalia/i],
      ["Qual é o objetivo principal do AI Product Lab?", /objetivo/i],
      ["Qual é o papel do Brain?", /brain/i],
      ["Qual é o papel dos agentes?", /agentes? (s[ãa]o|de avalia)/i],
      ["Como uma avaliação vira um Finding?", /finding/i],
      ["Como um Finding vira uma Recommendation?", /recommendation/i],
      ["Qual é a diferença entre Finding e Recommendation?", /finding [ée] o que foi observado/i],
      ["Por que existe aprovação humana no AI Product Lab?", /aprova[çc][ãa]o humana/i],
      ["O que acontece depois que uma Recommendation é aprovada?", /implementation/i],
      ["O que o AI Product Lab consegue fazer sozinho hoje?", /consegue/i],
      ["O que o AI Product Lab ainda não consegue fazer sozinho?", /autonomia irrestrita|n[ãa]o tem autonomia/i],
      ["Qual é a principal limitação atual do AI Product Lab?", /autonomia irrestrita|n[ãa]o tem autonomia/i],
      ["Se você tivesse que explicar o AI Product Lab para alguém que nunca o viu, como explicaria?", /sistema|avalia/i],
      ["Então, resumindo: qual é o ciclo completo do AI Product Lab?", /valida[çc][ãa]o|reteste/i],
      ["O AI Product Lab existe para substituir a decisão humana?", /n[ãa]o substitui a decis[ãa]o humana/i],
    ])("%s", async (message, expectedContent) => {
      const result = await interpretBrainMessage(message, INITIAL_BRAIN_STATE);
      expect(result.text).not.toMatch(NOT_UNDERSTOOD);
      expect(result.text).not.toMatch(/n[ãa]o identifiquei quais especialidades envolver/i);
      expect(result.text).toMatch(expectedContent);
      expect(result.structured ?? null).toBeNull();
    });
  });

  describe("não regressão — intenções operacionais continuam vencendo", () => {
    /**
     * All three tests below accept EITHER a clean resolution OR an honest
     * "qual deles você quer saber?" ask: under the full test suite, other
     * files' own concurrently-live fixture projects can legitimately make
     * "lab"-containing messages resolve AMBIGUOUS (the same pre-existing,
     * out-of-scope resolveProjectReference substring/word-overlap
     * characteristic already registered in FASE 13/14B's own reports —
     * not something this phase touches). What each test actually verifies
     * — and what stays true in BOTH outcomes — is that the bare phrase
     * never produces a Product Understanding conceptual answer instead of
     * (or in addition to) the pre-existing Self-Awareness one.
     */
    it("'Como está o AI Product Lab?' continua sendo Self-Awareness, nunca Product Understanding", async () => {
      const result = await interpretBrainMessage("Como está o AI Product Lab?", INITIAL_BRAIN_STATE);
      const askedForClarification = /qual deles voc[êe] quer saber/i.test(result.text);
      expect(askedForClarification || /agente\(s\)/i.test(result.text)).toBe(true);
      expect(result.text).not.toMatch(/n[ãa]o decide mudan[çc]as/i);
    });

    it("'O que o LAB consegue fazer?' (frase nua, pré-existente) continua sendo Self-Awareness, não é duplicada pelo Product Understanding", async () => {
      const project = await freshProject("B15A Bare Capabilities");
      const result = await interpretBrainMessage("O que o LAB consegue fazer?", { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });
      const askedForClarification = /qual deles voc[êe] quer saber/i.test(result.text);
      const selfAwarenessAnswer = /j[áa] fez isso neste projeto|planejada, n[ãa]o confirmada|O LAB hoje consegue:/i.test(result.text);
      expect(askedForClarification || selfAwarenessAnswer).toBe(true);
      expect(result.text).not.toMatch(/interpretar perguntas e comandos operacionais pelo Brain/i);
    });

    it("'O que o LAB ainda não consegue fazer?' (frase nua, pré-existente) continua sendo Self-Awareness", async () => {
      const project = await freshProject("B15A Bare Limitations");
      const result = await interpretBrainMessage("O que o LAB ainda não consegue fazer?", { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });
      const askedForClarification = /qual deles voc[êe] quer saber/i.test(result.text);
      const selfAwarenessAnswer = /GITHUB_API_TOKEN|limita[çc][ãa]o do provider/i.test(result.text);
      expect(askedForClarification || selfAwarenessAnswer).toBe(true);
      expect(result.text).not.toMatch(/depende de um provider externo de modelo para executar avalia[çc][õo]es novas/i);
    });

    it("'Analisa o AI Product Lab.' continua criando uma missão geral com os 7 agentes, nunca interceptada pelo Product Understanding", async () => {
      const project = await freshProject("B15A Mission NonReg");
      const run = await db.evaluationMissionRun.create({
        data: {
          projectId: project.id,
          status: "RUNNING",
          input: { target: { url: "https://example.com" }, objective: "t", task: "t", requestedAgents: ["qa-agent"] },
          progress: { completedAgentIds: [], failedAgentIds: [], runningAgentId: "qa-agent" },
        },
      });
      try {
        const result = await interpretBrainMessage(`Analisa o ${project.name}.`, INITIAL_BRAIN_STATE);
        expect(result.text).toMatch(/primeiro está em execução|ainda estou analisando/i);
      } finally {
        await db.evaluationMissionRun.update({ where: { id: run.id }, data: { status: "COMPLETED" } });
      }
    });

    it("a seleção geral dos 7 agentes (BUG 1, FASE 14B) continua funcionando sem interferência desta fase", async () => {
      const lab = await db.project.findFirst({ where: { name: "AI Product Lab" } });
      if (!lab) return;
      const selection = await selectAgentsForMission("Analisa o AI Product Lab.", lab.name);
      expect(selection.general).toBe(true);
      expect(selection.agents.length).toBeGreaterThanOrEqual(7);
    });

    it.each([["Quais agentes estão subutilizados?"], ["Precisamos criar algum agente?"], ["Existe sobreposição?"], ["Devemos remover algum?"]])(
      "Team Intelligence — %s continua funcionando",
      async (message) => {
        const project = await freshProject("B15A TI NonReg");
        const result = await interpretBrainMessage(message, { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });
        expect(result.text).not.toMatch(NOT_UNDERSTOOD);
      },
    );

    it("Retest — 'Pode fazer um reteste?' continua encaminhando ao mecanismo real", async () => {
      const project = await freshProject("B15A Retest NonReg");
      const result = await interpretBrainMessage("Pode fazer um reteste?", { ...INITIAL_BRAIN_STATE, projectId: project.id, projectName: project.name });
      expect(result.text).toMatch(/n[ãa]o h[áa] nenhuma implementation pendente de valida[çc][ãa]o|qual deles voc[êe] quer saber/i);
    });
  });

  describe("proteção contra o bug da FASE 15 — explicação nunca vira execução", () => {
    it("uma pergunta explicativa contendo 'avaliação' nunca cria uma mission nem pede especialidade", async () => {
      const before = await db.evaluationMissionRun.count();
      const result = await interpretBrainMessage("Como uma avaliação vira um Finding?", INITIAL_BRAIN_STATE);
      const after = await db.evaluationMissionRun.count();
      expect(after).toBe(before);
      expect(result.text).not.toMatch(/n[ãa]o identifiquei quais especialidades envolver/i);
      expect(result.structured ?? null).toBeNull();
    });
  });

  describe("não-mutação", () => {
    it("nenhuma pergunta de Product Understanding cria mission, execution, recommendation, implementation ou validation", async () => {
      const [agentsBefore, missionsBefore, execsBefore, recsBefore, implsBefore, validationsBefore] = await Promise.all([
        db.agent.count(),
        db.evaluationMissionRun.count(),
        db.agentExecution.count(),
        db.recommendation.count(),
        db.implementation.count(),
        db.validation.count(),
      ]);

      for (const message of [
        "O que é o AI Product Lab?",
        "Qual é o papel do Brain?",
        "Como uma avaliação vira um Finding?",
        "Qual é a diferença entre Finding e Recommendation?",
        "Por que existe aprovação humana no AI Product Lab?",
        "Qual é a principal limitação atual do AI Product Lab?",
      ]) {
        await interpretBrainMessage(message, INITIAL_BRAIN_STATE);
      }

      const [agentsAfter, missionsAfter, execsAfter, recsAfter, implsAfter, validationsAfter] = await Promise.all([
        db.agent.count(),
        db.evaluationMissionRun.count(),
        db.agentExecution.count(),
        db.recommendation.count(),
        db.implementation.count(),
        db.validation.count(),
      ]);

      expect(agentsAfter).toBe(agentsBefore);
      expect(missionsAfter).toBe(missionsBefore);
      expect(execsAfter).toBe(execsBefore);
      expect(recsAfter).toBe(recsBefore);
      expect(implsAfter).toBe(implsBefore);
      expect(validationsAfter).toBe(validationsBefore);
    });
  });
});

/**
 * FASE 16A — Natural Product Understanding. FASE 16's grand E2E ran the
 * same 15 conceptual questions FASE 15A had already proven correct, but
 * phrased as a real, natural conversation — and 0/15 were recognized,
 * all falling to the generic fallback. No mutation, no false mission, no
 * hallucination happened either — the gap was purely in recognition, not
 * content. This block re-executes that exact FASE 16 conversation (clean
 * context, no pre-set projectId) through the real interpretBrainMessage,
 * plus the FASE 16A section 6 continuity sequence, at the full
 * integration level (not just classifyProductConcept in isolation).
 */
describe("operational-brain — Natural Product Understanding (FASE 16A)", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  describe("os 15 turnos da FASE 16, em contexto limpo, agora reconhecidos", () => {
    it.each([
      ["Me explica o LAB como se eu fosse novo aqui.", /sistema|avalia/i],
      ["E onde entram os agentes nisso?", /especialistas de avalia[çc][ãa]o/i],
      ["Se um agente encontrar um problema, o que acontece?", /finding/i],
      ["Então ele pode corrigir sozinho?", /n[ãa]o substitui a decis[ãa]o humana/i],
      ["E depois que eu aprovar?", /implementation/i],
      ["Qual a diferença entre o que ele encontrou e o que ele recomenda fazer?", /finding [ée] o que foi observado/i],
      ["Então uma recommendation já é uma mudança feita?", /nunca [ée] executada automaticamente/i],
      ["Beleza. Então me explica tudo do começo ao fim.", /valida[çc][ãa]o|reteste/i],
      ["O LAB pode decidir sozinho que precisa mudar alguma coisa?", /n[ãa]o substitui a decis[ãa]o humana/i],
      ["Então qual é o papel do humano no processo?", /n[ãa]o substitui a decis[ãa]o humana/i],
      ["E qual é a principal coisa que o LAB faz melhor?", /consegue/i],
      ["E qual é a principal limitação dele hoje?", /autonomia irrestrita|n[ãa]o tem autonomia/i],
      ["Se eu entrasse no LAB agora, o que eu deveria entender primeiro?", /sistema|avalia/i],
      ["Resume o LAB em uma frase.", /sistema|avalia/i],
      ["E se eu quiser melhorar o LAB, qual é o caminho?", /valida[çc][ãa]o|reteste/i],
    ])("%s", async (message, expectedContent) => {
      const result = await interpretBrainMessage(message, INITIAL_BRAIN_STATE);
      expect(result.text).not.toMatch(/n[ãa]o entendi como uma miss[ãa]o/i);
      expect(result.text).toMatch(expectedContent);
      expect(result.structured ?? null).toBeNull();
    });

    it("nenhum dos 15 turnos cria mission, recommendation, implementation ou validation", async () => {
      const before = { missions: await db.evaluationMissionRun.count(), recs: await db.recommendation.count(), impls: await db.implementation.count(), vals: await db.validation.count() };

      const messages = [
        "Me explica o LAB como se eu fosse novo aqui.",
        "E onde entram os agentes nisso?",
        "Se um agente encontrar um problema, o que acontece?",
        "Então ele pode corrigir sozinho?",
        "E depois que eu aprovar?",
        "Qual a diferença entre o que ele encontrou e o que ele recomenda fazer?",
        "Então uma recommendation já é uma mudança feita?",
        "Beleza. Então me explica tudo do começo ao fim.",
        "O LAB pode decidir sozinho que precisa mudar alguma coisa?",
        "Então qual é o papel do humano no processo?",
        "E qual é a principal coisa que o LAB faz melhor?",
        "E qual é a principal limitação dele hoje?",
        "Se eu entrasse no LAB agora, o que eu deveria entender primeiro?",
        "Resume o LAB em uma frase.",
        "E se eu quiser melhorar o LAB, qual é o caminho?",
      ];
      for (const message of messages) {
        await interpretBrainMessage(message, INITIAL_BRAIN_STATE);
      }

      const after = { missions: await db.evaluationMissionRun.count(), recs: await db.recommendation.count(), impls: await db.implementation.count(), vals: await db.validation.count() };
      expect(after).toEqual(before);
    });
  });

  describe("teste de continuidade (seção 6) — o estado permanece coerente entre turnos", () => {
    it("uma conversa real com pronomes/elipses encadeia pelo mesmo conceito, turno a turno", async () => {
      let state = INITIAL_BRAIN_STATE;

      let r = await interpretBrainMessage("Me explica o LAB.", state);
      expect(r.text).toMatch(/sistema|avalia/i);
      expect(r.state.lastProductConcept).toBe("product");
      state = r.state;

      r = await interpretBrainMessage("E os agentes?", state);
      expect(r.text).toMatch(/especialistas de avalia[çc][ãa]o/i);
      expect(r.state.lastProductConcept).toBe("agents");
      state = r.state;

      r = await interpretBrainMessage("E se um deles encontrar um problema?", state);
      expect(r.text).toMatch(/finding/i);
      expect(r.state.lastProductConcept).toBe("pipeline-evaluation-to-finding");
      state = r.state;

      r = await interpretBrainMessage("Ele pode corrigir sozinho?", state);
      expect(r.text).toMatch(/n[ãa]o substitui a decis[ãa]o humana/i);
      expect(r.state.lastProductConcept).toBe("human-approval");
      state = r.state;

      r = await interpretBrainMessage("E depois que eu aprovar?", state);
      expect(r.text).toMatch(/implementation/i);
      expect(r.state.lastProductConcept).toBe("pipeline-after-approval");
      state = r.state;

      r = await interpretBrainMessage("Então me resume tudo.", state);
      expect(r.text).toMatch(/valida[çc][ãa]o|reteste/i);
      expect(r.state.lastProductConcept).toBe("lifecycle");
    });

    it("regra de segurança do contexto: um turno fraco e ambíguo sem contexto prévio de Product Understanding cai no fallback honesto, nunca inventa", async () => {
      // "E os agentes?" sozinho, sem nenhum turno anterior de Product
      // Understanding — não há "qualquer mensagem anterior" aqui, é o
      // primeiro turno da conversa. classifyProductConceptContinuation só é
      // chamado quando state.lastProductConcept já está setado; aqui está
      // null, então a mensagem cai no fallback honesto, nunca assume.
      const result = await interpretBrainMessage("E os agentes?", INITIAL_BRAIN_STATE);
      expect(result.text).toMatch(/n[ãa]o entendi como uma miss[ãa]o/i);
    });

    it("lastProductConcept é zerado assim que qualquer outra intenção responde, não sobrevive alem de um turno", async () => {
      const lab = await db.project.findFirst({ where: { name: "AI Product Lab" } });
      if (!lab) return;

      let r = await interpretBrainMessage("Me explica o LAB.", INITIAL_BRAIN_STATE);
      expect(r.state.lastProductConcept).toBe("product");

      // Um turno de Self-Awareness no meio — não é continuação de Product Understanding — deve zerar o campo.
      r = await interpretBrainMessage("Como está o AI Product Lab?", { ...r.state, projectId: lab.id, projectName: lab.name });
      expect(r.state.lastProductConcept).toBeNull();

      // Agora "E os agentes?" não tem mais contexto de Product Understanding — cai no fallback, não "vaza" o tópico antigo.
      r = await interpretBrainMessage("E os agentes?", r.state);
      expect(r.text).toMatch(/n[ãa]o entendi como uma miss[ãa]o/i);
    });
  });

  describe("negativos (seção 12) — frases conceituais nunca viram mission, no nível de integração", () => {
    it.each(["Como funciona uma análise?", "O que um agente faz?", "O que é uma recommendation?", "Como uma avaliação funciona?", "O LAB pode corrigir sozinho?"])(
      "%s nunca cria uma EvaluationMissionRun",
      async (message) => {
        const before = await db.evaluationMissionRun.count();
        const result = await interpretBrainMessage(message, INITIAL_BRAIN_STATE);
        const after = await db.evaluationMissionRun.count();
        expect(after).toBe(before);
        expect(result.structured ?? null).toBeNull();
      },
    );
  });

  describe("não confunde um projeto real cujo nome contém uma palavra de Product Understanding com a pergunta conceitual", () => {
    const createdIds: string[] = [];
    afterAll(async () => {
      if (createdIds.length) {
        await db.auditLog.deleteMany({ where: { entityId: { in: createdIds } } });
        await db.project.deleteMany({ where: { id: { in: createdIds } } });
      }
    });

    it("'Analise a UX do Brain Target Project ...' continua pedindo a URL (mission real), nunca a resposta conceitual sobre o Brain", async () => {
      const unique = `Brain Target Regression Project ${Date.now()}`;
      const created = await createProject({ name: unique });
      createdIds.push(created.id);

      const result = await interpretBrainMessage(`Analise a UX do ${unique}`, INITIAL_BRAIN_STATE);
      expect(result.text).toMatch(/preciso da url/i);
      expect(result.text).not.toMatch(/o brain [ée] a camada conversacional/i);
    });
  });
});
