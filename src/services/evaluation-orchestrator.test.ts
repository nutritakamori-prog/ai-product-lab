import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { setModelProviderForTesting, MODEL_TIER_TO_ID, type ModelProvider } from "@/core/models/provider";
import { createClaudeCodeScriptedProvider } from "@/core/models/claude-code-scripted-provider";
import { AgentRegistry } from "@/core/agents/registry";
import { evaluationMissionSchema, type EvaluationMission } from "@/domain/evaluation-mission";
import * as smartRouter from "@/core/orchestrator/smart-router";
import * as planExecutor from "@/services/plan-executor";
import { runMissionEvaluation, createAndRunMissionEvaluation } from "./evaluation-orchestrator";
import type { Project } from "@/generated/prisma/client";

/** Returns outputs[callIndex] (last one repeats past the end) — no real LLM call. */
function sequentialProvider(outputs: unknown[]): ModelProvider {
  let callIndex = 0;
  return {
    name: "evaluation-orchestrator-test-provider",
    completeStructured: async <T>() => {
      const data = outputs[Math.min(callIndex, outputs.length - 1)];
      callIndex += 1;
      return {
        data: data as T,
        rawText: JSON.stringify(data),
        inputTokens: 10,
        outputTokens: 10,
        stopReason: "end_turn",
      };
    },
  };
}

const QA_OUTPUT = {
  agent: "qa-agent",
  status: "NO_FINDING" as const,
  finding: null,
  evidence: null,
  impact: null,
  recommendation: null,
  confidence: "MEDIUM" as const,
  classification: null,
  needsOtherAgent: null as string | null,
};

const UX_OUTPUT = {
  agent: "ux-agent",
  status: "FINDING" as const,
  finding: "The Continuar button appears with no visible transition, which may feel abrupt.",
  evidence: 'OBSERVED: An element matching "botão Continuar" was found on the page.',
  impact: "LOW" as const,
  recommendation: "Consider a brief visual transition when Continuar appears.",
  confidence: "MEDIUM" as const,
  classification: "UX" as const,
  needsOtherAgent: null as string | null,
};

describe("runMissionEvaluation", () => {
  let project: Project;

  const targetUrl =
    'data:text/html,<button id="entrar" onclick="document.getElementById(\'slot\').innerHTML=\'<button>Continuar</button>\'">Entrar</button><div id="slot"></div>';

  const mission: EvaluationMission = evaluationMissionSchema.parse({
    id: "mission-multi-agent",
    target: { url: targetUrl },
    objective: "Avaliar a primeira experiência do usuário.",
    task: "Abra o sistema, clique no botão Entrar e verifique se o botão Continuar aparece.",
    requestedAgents: ["qa-agent", "ux-agent"],
  });

  // This mission's task doesn't match any of the Mock provider's own
  // hardcoded sentence patterns ("aparece" instead of "existe") — the
  // Planner's response is scripted here (sequentialProvider, the same
  // zero-cost test infra used throughout this project) purely to keep this
  // test's own wording free to match the task description given in this
  // step's spec; the Browser execution and Observations that follow are
  // entirely real.
  const plannerPlanResponse = {
    actions: [
      { action: "navigate", target: targetUrl },
      { action: "click", target: "#entrar" },
      { action: "find", target: "botão Continuar" },
    ],
  };

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Evaluation orchestrator test project ${Date.now()}` },
    });
  });

  afterEach(() => {
    setModelProviderForTesting(null);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await db.agentExecution.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.$disconnect();
  });

  it("1-10. qa-agent and ux-agent both receive the exact same EvaluationAgentInput from a single real Browser run, and the Smart Router is never consulted", async () => {
    const executePlanSpy = vi.spyOn(planExecutor, "executePlan");
    const chooseInitialAgentIdSpy = vi.spyOn(smartRouter, "chooseInitialAgentId");
    const routeTaskSpy = vi.spyOn(smartRouter, "routeTask");
    setModelProviderForTesting(sequentialProvider([plannerPlanResponse, QA_OUTPUT, UX_OUTPUT]));

    const result = await runMissionEvaluation(mission, project);

    // 1,2. the Browser ran exactly once, and produced exactly 3 real
    // Observations (navigate, click, find) — never once per agent.
    expect(executePlanSpy).toHaveBeenCalledTimes(1);
    expect(result.observations).toHaveLength(3);
    expect(result.observations[0].evidence).toContain("page.goto(");
    expect(result.observations[1].observed).toBe('Clicked "#entrar" without error.');
    expect(result.observations[2].observed).toBe('An element matching "botão Continuar" was found on the page.');

    // 3,4. both requested agents actually ran.
    expect(result.missionId).toBe(mission.id);
    expect(result.evaluations.map((e) => e.agentId)).toEqual(["qa-agent", "ux-agent"]); // 5. agentsCalled contains exactly the two agents
    expect(result.evaluations.every((e) => e.status === "SUCCESS")).toBe(true);

    // 8,9. each agent produced its own, distinct AgentOutput, associated
    // with its own agentId.
    const qaEvaluation = result.evaluations.find((e) => e.agentId === "qa-agent");
    const uxEvaluation = result.evaluations.find((e) => e.agentId === "ux-agent");
    expect(qaEvaluation?.output?.status).toBe("NO_FINDING");
    expect(uxEvaluation?.output?.status).toBe("FINDING");
    expect(uxEvaluation?.output?.finding).toBe(UX_OUTPUT.finding);

    // 10. the Smart Router was never consulted — requestedAgents is
    // authoritative for this Orchestrator, resolved directly via the
    // AgentRegistry.
    expect(chooseInitialAgentIdSpy).not.toHaveBeenCalled();
    expect(routeTaskSpy).not.toHaveBeenCalled();

    // 6,7. both agents' persisted AgentExecution received the exact same
    // EvaluationAgentInput — same mission slice, same real Observations,
    // not two independently-produced copies.
    const qaAgentRow = await db.agent.findUnique({ where: { slug: "qa-agent" } });
    const uxAgentRow = await db.agent.findUnique({ where: { slug: "ux-agent" } });
    const qaExecution = await db.agentExecution.findFirst({ where: { projectId: project.id, agentId: qaAgentRow?.id } });
    const uxExecution = await db.agentExecution.findFirst({ where: { projectId: project.id, agentId: uxAgentRow?.id } });

    const qaInput = (qaExecution?.input as { context?: { evaluationInput?: unknown } })?.context?.evaluationInput;
    const uxInput = (uxExecution?.input as { context?: { evaluationInput?: unknown } })?.context?.evaluationInput;

    expect(qaInput).toBeDefined();
    expect(qaInput).toEqual(uxInput); // exactly the same EvaluationAgentInput, including the same Observations

    // The mission's objective must reach the agent in the same readable
    // prompt text it actually reasons from — not only inside the raw
    // evaluationInput JSON above (found missing during an integration
    // audit; see buildTaskWithEvidence's own objective parameter).
    const qaPrompt = (qaExecution?.input as { prompt?: string } | null)?.prompt ?? "";
    expect(qaPrompt).toContain(`Objective: ${mission.objective}`);

    // Final Evaluation Report: computed once, after both evaluations, via
    // the existing consolidator (src/core/findings/mission-evaluation-report.ts)
    // — never a second Browser run, never a new agent call.
    expect(result.report.missionId).toBe(mission.id);
    expect(result.report.mission).toEqual({ target: mission.target, objective: mission.objective, task: mission.task });
    // ux-agent's real FINDING surfaces in findings; qa-agent's NO_FINDING
    // never does — but both remain visible, unaltered, in coverage.
    expect(result.report.findings).toHaveLength(1);
    expect(result.report.findings[0].finding).toBe(UX_OUTPUT.finding);
    expect(result.report.findings[0].duplicated).toBe(false);
    expect(result.report.findings[0].sources).toEqual([
      {
        agentId: "ux-agent",
        evidence: UX_OUTPUT.evidence,
        impact: UX_OUTPUT.impact,
        recommendation: UX_OUTPUT.recommendation,
        confidence: UX_OUTPUT.confidence,
        classification: UX_OUTPUT.classification,
      },
    ]);
    expect(result.report.coverage).toEqual(result.evaluations);
  });

  it("an unregistered requested agent is reported as an explicit BLOCKED outcome, never substituted, and never stops the other requested agent from running", async () => {
    const executePlanSpy = vi.spyOn(planExecutor, "executePlan");
    setModelProviderForTesting(sequentialProvider([plannerPlanResponse, QA_OUTPUT]));

    const errorMission: EvaluationMission = evaluationMissionSchema.parse({
      ...mission,
      id: "mission-multi-agent-with-unknown",
      requestedAgents: ["qa-agent", "agente-inexistente"],
    });

    const result = await runMissionEvaluation(errorMission, project);

    // The Browser still ran exactly once — one bad agent id doesn't cause a
    // second, redundant execution or block the whole mission's evidence
    // gathering.
    expect(executePlanSpy).toHaveBeenCalledTimes(1);
    expect(result.evaluations).toHaveLength(2);

    const qaEvaluation = result.evaluations.find((e) => e.agentId === "qa-agent");
    expect(qaEvaluation?.status).toBe("SUCCESS");
    expect(qaEvaluation?.output?.status).toBe("NO_FINDING");

    // The unregistered agent is explicit and un-masked: BLOCKED, no output,
    // a clear reason — never silently dropped, never replaced by a
    // different (e.g. keyword-matched) agent.
    const unknownEvaluation = result.evaluations.find((e) => e.agentId === "agente-inexistente");
    expect(unknownEvaluation?.status).toBe("BLOCKED");
    expect(unknownEvaluation?.output).toBeNull();
    expect(unknownEvaluation?.error).toContain("agente-inexistente");
    expect(unknownEvaluation?.error).toContain("does not exist");

    // No AgentExecution row exists for the nonexistent agent — it was truly
    // never run, not run-and-hidden.
    const unknownAgentRow = await db.agent.findUnique({ where: { slug: "agente-inexistente" } });
    expect(unknownAgentRow).toBeNull();
  });
});

/**
 * Formalizes the manually-validated "Claude Code as executor" experiments
 * (a human reads each agent's real systemPrompt plus real Observations and
 * hands runMissionEvaluation() the resulting Plan/AgentOutput ahead of
 * time via createClaudeCodeScriptedProvider — see that file's own doc
 * comment) into a repeatable, tested capability. Real Browser (a `data:`
 * URL — genuine Playwright/Chromium navigation, no server needed), real
 * three-agent run, real persistence — the only thing "scripted" is the
 * model reasoning a human already produced.
 */
describe("runMissionEvaluation — Claude Code as executor (provider: CLAUDE_CODE)", () => {
  let project: Project;

  const targetUrl = 'data:text/html,<h1 id="title">AI Product Lab</h1><p id="status">Ready.</p>';

  const mission: EvaluationMission = evaluationMissionSchema.parse({
    id: "mission-claude-code-executor",
    target: { url: targetUrl },
    objective: "Confirmar que a página carrega e comunica seu estado com clareza.",
    task: "Abra a página e leia o conteúdo em #status.",
    requestedAgents: ["new-user", "qa-agent", "ux-agent"],
  });

  const plannerPlanResponse = {
    actions: [
      { action: "navigate", target: targetUrl },
      { action: "getText", target: "#status" },
    ],
  };

  function noFindingOutput(agent: string) {
    return {
      agent,
      status: "NO_FINDING",
      finding: null,
      evidence: null,
      impact: null,
      recommendation: null,
      confidence: "HIGH",
      classification: null,
      needsOtherAgent: null,
    };
  }

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Claude Code executor test project ${Date.now()}` },
    });
  });

  afterEach(() => {
    setModelProviderForTesting(null);
  });

  afterAll(async () => {
    await db.agentExecution.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.$disconnect();
  });

  it("all three agents receive the same Observations, objective, and task, but each their own real system prompt — and each is persisted as CLAUDE_CODE / claude-code / $0", async () => {
    setModelProviderForTesting(
      createClaudeCodeScriptedProvider([
        plannerPlanResponse,
        noFindingOutput("new-user"),
        noFindingOutput("qa-agent"),
        noFindingOutput("ux-agent"),
      ]),
    );

    const result = await runMissionEvaluation(mission, project);

    expect(result.evaluations.every((e) => e.status === "SUCCESS")).toBe(true);
    expect(result.evaluations.map((e) => e.agentId)).toEqual(["new-user", "qa-agent", "ux-agent"]);

    const rows = await Promise.all(
      ["new-user", "qa-agent", "ux-agent"].map(async (slug) => {
        const agentRow = await db.agent.findUnique({ where: { slug } });
        return db.agentExecution.findFirst({ where: { projectId: project.id, agentId: agentRow?.id } });
      }),
    );
    // Identity: every one of the three real executions is recorded as
    // Claude Code, at zero cost, never MOCK.
    for (const execution of rows) {
      expect(execution?.provider).toBe("CLAUDE_CODE");
      expect(execution?.model).toBe("claude-code");
      expect(execution?.estimatedCost).toBe(0);
      expect(execution?.status).toBe("SUCCESS");
    }

    // Same input: identical Observations, objective, and task text reached
    // all three prompts (buildTaskWithEvidence + mission.objective).
    const prompts = rows.map((e) => (e?.input as { prompt?: string })?.prompt ?? "");
    expect(new Set(prompts).size).toBe(1); // byte-for-byte identical across all three
    expect(prompts[0]).toContain(`Objective: ${mission.objective}`);
    expect(prompts[0]).toContain("Ready."); // the real, observed page content

    // Different prompts: each agent's own real systemPrompt, not a shared
    // or generic one — copied from agents/experience/new-user.ts,
    // agents/qa/qa-agent.ts, agents/ux/ux-agent.ts verbatim, never
    // paraphrased here.
    const systems = rows.map((e) => (e?.input as { system?: string })?.system ?? "");
    expect(systems[0]).toContain("You are simulating someone using this product for the very first time");
    expect(systems[1]).toContain("You are a QA engineer reviewing this product's actual functional behavior");
    expect(systems[2]).toContain("You are a UX specialist judging the quality of an experience");
    expect(new Set(systems).size).toBe(3); // all three genuinely distinct
  });

  it("when one agent's reasoning fails, the other two are unaffected and the failed one is never presented as evaluated", async () => {
    setModelProviderForTesting(
      createClaudeCodeScriptedProvider([
        plannerPlanResponse,
        noFindingOutput("new-user"),
        // qa-agent: no scripted response provided — the provider throws
        // explicitly instead of a human forgetting to author one.
      ]),
    );

    const result = await runMissionEvaluation(
      evaluationMissionSchema.parse({ ...mission, id: "mission-claude-code-executor-partial-failure" }),
      project,
    );

    const newUser = result.evaluations.find((e) => e.agentId === "new-user");
    const qa = result.evaluations.find((e) => e.agentId === "qa-agent");
    const ux = result.evaluations.find((e) => e.agentId === "ux-agent");

    expect(newUser?.status).toBe("SUCCESS");
    // ux-agent was requested after qa-agent, whose call is what exhausts the
    // scripted responses — both never got a real answer, so both FAIL,
    // never a silent NO_FINDING pretending they were evaluated.
    expect(qa?.status).toBe("FAILED");
    expect(qa?.output).toBeNull();
    expect(qa?.error).toContain("scripted");
    expect(ux?.status).toBe("FAILED");
    expect(ux?.output).toBeNull();

    // Coverage still lists all three — a failure is preserved, never hidden.
    expect(result.report.coverage).toHaveLength(3);
  });
});

/**
 * createAndRunMissionEvaluation is the one new piece this phase added: it
 * gives a Mission's config and outcome a durable identity (EvaluationMissionRun)
 * so /test-lab/missions/[id] can show it after the fact — but it must never
 * change what runMissionEvaluation() itself already does. These two tests
 * cover only the NEW behavior no existing test exercises: the mission-level
 * status derivation (BLOCKED / FAILED) that gets persisted alongside the
 * report.
 */
describe("createAndRunMissionEvaluation", () => {
  let project: Project;

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `createAndRunMissionEvaluation test project ${Date.now()}` },
    });
  });

  afterEach(() => {
    setModelProviderForTesting(null);
  });

  afterAll(async () => {
    await db.project.delete({ where: { id: project.id } });
    await db.$disconnect();
  });

  it("persists status BLOCKED when the Planner never produces a Plan — no requested agent reaches SUCCESS", async () => {
    setModelProviderForTesting(
      createClaudeCodeScriptedProvider([{ actions: [] }]), // the Planner explicitly gives up
    );

    const record = await createAndRunMissionEvaluation(
      {
        target: { url: "http://localhost:3000" },
        objective: "Objective",
        task: "Organize minha reunião de amanhã.", // not a browser task
        requestedAgents: ["qa-agent"],
      },
      project,
    );

    expect(record.status).toBe("BLOCKED");
    expect(record.error).toBeNull();
    expect(record.report?.findings).toEqual([]);

    const row = await db.evaluationMissionRun.findUnique({ where: { id: record.id } });
    expect(row?.status).toBe("BLOCKED");
    expect(row?.report).not.toBeNull();
  });

  it("persists status FAILED, with the error message, when the orchestration itself throws", async () => {
    setModelProviderForTesting({
      name: "throws-on-planner-call",
      completeStructured: async () => {
        throw new Error("simulated transport error");
      },
    });

    const record = await createAndRunMissionEvaluation(
      {
        target: { url: "http://localhost:3000" },
        objective: "Objective",
        task: "Abra o sistema e verifique se existe o botão Continuar.",
        requestedAgents: ["qa-agent"],
      },
      project,
    );

    expect(record.status).toBe("FAILED");
    expect(record.error).toContain("simulated transport error");
    expect(record.report).toBeNull();

    const row = await db.evaluationMissionRun.findUnique({ where: { id: record.id } });
    expect(row?.status).toBe("FAILED");
    expect(row?.error).toContain("simulated transport error");
  });

  it("records the executor identity at creation time for a normal (non-Claude-Code) provider — provider = GEMINI, model resolved from the representative requested agent's tier", async () => {
    setModelProviderForTesting({
      name: "gemini",
      completeStructured: async <T>() => ({
        data: { actions: [] } as T, // Planner gives up — this test only cares about the Run's own identity fields, not the report content
        rawText: "{}",
        inputTokens: 0,
        outputTokens: 0,
        stopReason: "end_turn",
      }),
    });

    const qaAgent = await AgentRegistry.getBySlug("qa-agent");
    const record = await createAndRunMissionEvaluation(
      {
        target: { url: "http://localhost:3000" },
        objective: "Objective",
        task: "Organize minha reunião de amanhã.",
        requestedAgents: ["qa-agent"],
      },
      project,
    );

    expect(record.provider).toBe("GEMINI");
    expect(record.model).toBe(MODEL_TIER_TO_ID[qaAgent!.modelTier]);

    const row = await db.evaluationMissionRun.findUnique({ where: { id: record.id } });
    expect(row?.provider).toBe("GEMINI");
    expect(row?.model).toBe(MODEL_TIER_TO_ID[qaAgent!.modelTier]);
  });

  it("records provider = CLAUDE_CODE, model = claude-code when the active provider is the Claude Code scripted one — the same flow scripts/run-claude-code-mission.ts's PASS=evaluate uses", async () => {
    setModelProviderForTesting(
      createClaudeCodeScriptedProvider([
        { actions: [] }, // Planner gives up — only the Run's own identity fields matter here
      ]),
    );

    const record = await createAndRunMissionEvaluation(
      {
        target: { url: "http://localhost:3000" },
        objective: "Objective",
        task: "Organize minha reunião de amanhã.",
        requestedAgents: ["qa-agent"],
      },
      project,
    );

    expect(record.provider).toBe("CLAUDE_CODE");
    expect(record.model).toBe("claude-code");

    const row = await db.evaluationMissionRun.findUnique({ where: { id: record.id } });
    expect(row?.provider).toBe("CLAUDE_CODE");
    expect(row?.model).toBe("claude-code");
  });

  it("an EvaluationMissionRun with no provider/model (a legacy row, created before these fields existed) still loads safely", async () => {
    setModelProviderForTesting(
      createClaudeCodeScriptedProvider([{ actions: [] }]),
    );
    const record = await createAndRunMissionEvaluation(
      {
        target: { url: "http://localhost:3000" },
        objective: "Objective",
        task: "Organize minha reunião de amanhã.",
        requestedAgents: ["qa-agent"],
      },
      project,
    );

    // Simulates a pre-existing row from before this task's migration —
    // never backfilled with a guessed value, just genuinely unknown.
    await db.evaluationMissionRun.update({ where: { id: record.id }, data: { provider: null, model: null } });

    const row = await db.evaluationMissionRun.findUnique({ where: { id: record.id } });
    expect(row).not.toBeNull();
    expect(row?.provider).toBeNull();
    expect(row?.model).toBeNull();
    expect(row?.report).not.toBeNull(); // the rest of the row is untouched
  });

  it("persists a Head synthesis and creates one PENDING Recommendation per consolidated finding", async () => {
    const targetUrl = 'data:text/html,<button id="entrar">Entrar</button>';
    const plannerPlanResponse = {
      actions: [
        { action: "navigate", target: targetUrl },
        { action: "find", target: "botão Entrar" },
      ],
    };

    setModelProviderForTesting(sequentialProvider([plannerPlanResponse, UX_OUTPUT]));

    const record = await createAndRunMissionEvaluation(
      { target: { url: targetUrl }, objective: "Objective", task: "Task", requestedAgents: ["ux-agent"] },
      project,
    );

    expect(record.status).toBe("COMPLETED");
    expect(record.headReport).not.toBeNull();
    expect(record.headReport?.totalFindings).toBe(1);
    expect(record.headReport?.problems).toBe(1); // classification "UX" isn't OPPORTUNITY/FUTURE_RISK
    expect(record.headReport?.hasConvergence).toBe(false);
    expect(record.headReport?.mainRecommendation).toBe(UX_OUTPUT.recommendation);

    const row = await db.evaluationMissionRun.findUnique({ where: { id: record.id } });
    expect(row?.headReport).not.toBeNull();

    const recommendations = await db.recommendation.findMany({ where: { missionRunId: record.id } });
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].status).toBe("PENDING");
    expect(recommendations[0].findingIndex).toBe(0);
    expect(recommendations[0].recommendedAction).toBe(UX_OUTPUT.recommendation);
    expect(recommendations[0].impact).toBe(UX_OUTPUT.impact);
    expect(recommendations[0].confidence).toBe(UX_OUTPUT.confidence);
  });

  it("creates no Recommendation rows when the run produces no findings", async () => {
    setModelProviderForTesting(sequentialProvider([{ actions: [] }])); // Planner gives up -> BLOCKED, no findings

    const record = await createAndRunMissionEvaluation(
      { target: { url: "http://localhost:3000" }, objective: "Objective", task: "Organize minha reunião de amanhã.", requestedAgents: ["qa-agent"] },
      project,
    );

    expect(record.status).toBe("BLOCKED");
    expect(record.headReport?.totalFindings).toBe(0);

    const recommendations = await db.recommendation.findMany({ where: { missionRunId: record.id } });
    expect(recommendations).toHaveLength(0);
  });
});
