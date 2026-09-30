import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { setModelProviderForTesting, type ModelProvider } from "@/core/models/provider";
import * as labTask from "@/services/lab-task";
import * as planExecutor from "@/services/plan-executor";
import { createClaudeCodeScriptedProvider } from "@/core/models/claude-code-scripted-provider";
import { createAndRunMissionEvaluation } from "@/services/evaluation-orchestrator";
import { rerunMissionAction, runEvaluationMissionAction } from "./actions";
import type { Project } from "@/generated/prisma/client";
import type { FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";

/** Returns outputs[callIndex] (last one repeats past the end) — no real LLM call. */
function sequentialProvider(outputs: unknown[]): ModelProvider {
  let callIndex = 0;
  return {
    name: "test-lab-actions-test-provider",
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
  status: "NO_FINDING" as const,
  finding: null,
  evidence: null,
  impact: null,
  recommendation: null,
  confidence: "MEDIUM" as const,
  classification: null,
  needsOtherAgent: null as string | null,
};

/**
 * Proves the real, product-facing entry point: a raw (untrusted) Mission
 * object + a projectId in, through evaluationMissionSchema validation, the
 * exact same project-resolution convention runLabTaskAction already uses
 * ({ id: projectId }), straight into runMissionEvaluation() — never
 * runLabTask(), never the Smart Router.
 */
describe("runEvaluationMissionAction", () => {
  let project: Project;

  const targetUrl =
    'data:text/html,<button id="entrar" onclick="document.getElementById(\'slot\').innerHTML=\'<button>Continuar</button>\'">Entrar</button><div id="slot"></div>';

  const rawMission = {
    target: { url: targetUrl, name: "Sistema Externo de Teste" },
    objective: "Avaliar a primeira experiência do usuário.",
    task: "Abra o sistema, clique no botão Entrar e verifique se o botão Continuar aparece.",
    requestedAgents: ["qa-agent", "ux-agent"],
  };

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
      data: { organizationId: organization.id, name: `Test Lab actions integration test project ${Date.now()}` },
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

  it("a real Mission through the action reaches the Orchestrator, is persisted as a run, both requested agents evaluate, never through runLabTask()", async () => {
    const runLabTaskSpy = vi.spyOn(labTask, "runLabTask");
    const executePlanSpy = vi.spyOn(planExecutor, "executePlan");
    setModelProviderForTesting(sequentialProvider([plannerPlanResponse, QA_OUTPUT, UX_OUTPUT]));

    const state = await runEvaluationMissionAction(rawMission, project.id);

    expect(state.error).toBeNull();
    expect(state.missionRunId).toBeTruthy();

    const run = await db.evaluationMissionRun.findUnique({ where: { id: state.missionRunId! } });
    expect(run?.status).toBe("COMPLETED");
    const report = run?.report as unknown as FinalEvaluationReport;
    // The persisted run's own id became the Mission's id.
    expect(report.missionId).toBe(state.missionRunId);

    // Browser executed exactly once for the whole mission (not once per agent).
    expect(executePlanSpy).toHaveBeenCalledTimes(1);

    // Both requested agents evaluated, in order, each with its own output —
    // no fallback to a different agent, reflected in the consolidated report.
    const coverage = report.coverage;
    expect(coverage.map((e) => e.agentId)).toEqual(["qa-agent", "ux-agent"]);
    expect(coverage.every((e) => e.status === "SUCCESS")).toBe(true);
    expect(coverage.find((e) => e.agentId === "qa-agent")?.output?.status).toBe("NO_FINDING");
    expect(coverage.find((e) => e.agentId === "ux-agent")?.output?.status).toBe("NO_FINDING");

    // Never went through the legacy single-agent pipeline.
    expect(runLabTaskSpy).not.toHaveBeenCalled();

    // Real AgentExecution rows exist for both agents under the resolved project.
    const qaAgentRow = await db.agent.findUnique({ where: { slug: "qa-agent" } });
    const uxAgentRow = await db.agent.findUnique({ where: { slug: "ux-agent" } });
    const qaExecution = await db.agentExecution.findFirst({ where: { projectId: project.id, agentId: qaAgentRow?.id } });
    const uxExecution = await db.agentExecution.findFirst({ where: { projectId: project.id, agentId: uxAgentRow?.id } });
    expect(qaExecution).not.toBeNull();
    expect(uxExecution).not.toBeNull();
  });

  it("an invalid Mission (schema validation fails) is rejected before any Browser or agent execution happens", async () => {
    const executePlanSpy = vi.spyOn(planExecutor, "executePlan");
    setModelProviderForTesting({
      name: "must-not-be-called",
      completeStructured: async () => {
        throw new Error("must not be called for an invalid Mission.");
      },
    });

    const state = await runEvaluationMissionAction({ target: { url: "" }, objective: "", task: "", requestedAgents: [] }, project.id);

    expect(state.missionRunId).toBeNull();
    expect(state.error).toBeTruthy();
    expect(executePlanSpy).not.toHaveBeenCalled();
  });

  it("a missing projectId is rejected before validation reaches the Orchestrator", async () => {
    const state = await runEvaluationMissionAction(rawMission, "");

    expect(state.missionRunId).toBeNull();
    expect(state.error).toBe("Selecione um projeto.");
  });

  it("a Mission with zero requestedAgents is rejected before the Browser ever runs — never a silent 'no problems confirmed' result", async () => {
    const executePlanSpy = vi.spyOn(planExecutor, "executePlan");
    setModelProviderForTesting({
      name: "must-not-be-called",
      completeStructured: async () => {
        throw new Error("must not be called when no agent was requested.");
      },
    });

    const state = await runEvaluationMissionAction({ ...rawMission, requestedAgents: [] }, project.id);

    expect(state.missionRunId).toBeNull();
    expect(state.error).toBe("Selecione ao menos um agente.");
    expect(executePlanSpy).not.toHaveBeenCalled();
  });
});

/**
 * "Executar novamente" through its real Server Action — proves the guard is
 * enforced from the persisted Run itself, not just in the button's own
 * client-side rendering, so a Claude-Code-executed Run can never be
 * silently rerun with whatever provider the live server happens to have
 * configured (Caso 3 of the rerun spec).
 */
describe("rerunMissionAction", () => {
  let project: Project;

  const targetUrl =
    'data:text/html,<button id="entrar" onclick="document.getElementById(\'slot\').innerHTML=\'<button>Continuar</button>\'">Entrar</button><div id="slot"></div>';

  const rawMission = {
    target: { url: targetUrl, name: "Sistema Externo de Teste" },
    objective: "Avaliar a primeira experiência do usuário.",
    task: "Abra o sistema, clique no botão Entrar e verifique se o botão Continuar aparece.",
    requestedAgents: ["qa-agent", "ux-agent"],
  };

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
      data: { organizationId: organization.id, name: `rerunMissionAction test project ${Date.now()}` },
    });
  });

  afterEach(() => {
    setModelProviderForTesting(null);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await db.evaluationMissionRun.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.$disconnect();
  });

  it("refuses to rerun a Run executed via Claude Code — never silently starts a different executor believing it reproduces it", async () => {
    setModelProviderForTesting(createClaudeCodeScriptedProvider([{ actions: [] }]));
    const original = await createAndRunMissionEvaluation(
      { target: { url: "http://localhost:3000" }, objective: "O", task: "Organize minha reunião de amanhã.", requestedAgents: ["qa-agent"] },
      project,
    );
    expect(original.provider).toBe("CLAUDE_CODE");

    // A different provider is active now (simulating the live server's own
    // configured executor) — if the guard failed, this is what would run.
    const executePlanSpy = vi.spyOn(planExecutor, "executePlan");
    setModelProviderForTesting(sequentialProvider([{ actions: [] }]));

    const state = await rerunMissionAction(original.id);

    expect(state.missionRunId).toBeNull();
    expect(state.error).toBe("Este Run foi executado externamente e não pode ser repetido pela UI.");
    expect(executePlanSpy).not.toHaveBeenCalled(); // no execution was ever attempted

    // The original Run is completely untouched.
    const originalRow = await db.evaluationMissionRun.findUnique({ where: { id: original.id } });
    expect(originalRow?.provider).toBe("CLAUDE_CODE");
    expect(originalRow?.status).toBe(original.status);
  });

  it("refuses to rerun a legacy Run with no recorded provider — treated the same conservative way as CLAUDE_CODE", async () => {
    setModelProviderForTesting(createClaudeCodeScriptedProvider([{ actions: [] }]));
    const original = await createAndRunMissionEvaluation(
      { target: { url: "http://localhost:3000" }, objective: "O", task: "Organize minha reunião de amanhã.", requestedAgents: ["qa-agent"] },
      project,
    );
    await db.evaluationMissionRun.update({ where: { id: original.id }, data: { provider: null, model: null } });

    const state = await rerunMissionAction(original.id);

    expect(state.missionRunId).toBeNull();
    expect(state.error).toBe("Este Run foi executado externamente e não pode ser repetido pela UI.");
  });

  it("reruns a Run executed with a normal provider, producing a new Run with the same executor identity — never altering the original", async () => {
    setModelProviderForTesting(sequentialProvider([plannerPlanResponse, QA_OUTPUT, UX_OUTPUT]));
    const original = await createAndRunMissionEvaluation(rawMission, project);
    expect(original.provider).not.toBeNull();
    expect(original.provider).not.toBe("CLAUDE_CODE");

    setModelProviderForTesting(sequentialProvider([plannerPlanResponse, QA_OUTPUT, UX_OUTPUT]));
    const state = await rerunMissionAction(original.id);

    expect(state.error).toBeNull();
    expect(state.missionRunId).toBeTruthy();
    expect(state.missionRunId).not.toBe(original.id); // a new Run, never the same row mutated in place

    const newRow = await db.evaluationMissionRun.findUnique({ where: { id: state.missionRunId! } });
    expect(newRow?.provider).toBe(original.provider);

    const originalRow = await db.evaluationMissionRun.findUnique({ where: { id: original.id } });
    expect(originalRow?.status).toBe(original.status); // untouched by the rerun
  });

  it("returns an error, without throwing, for a mission run id that doesn't exist", async () => {
    const state = await rerunMissionAction("does-not-exist");
    expect(state.missionRunId).toBeNull();
    expect(state.error).toBe("Run não encontrado.");
  });
});
