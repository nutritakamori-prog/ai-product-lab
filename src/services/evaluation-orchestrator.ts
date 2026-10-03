import type { EvaluationMissionRunStatus, ModelProviderKind, Prisma, Project } from "@/generated/prisma/client";
import { AgentRegistry } from "@/core/agents/registry";
import { runAgent, toProviderKind } from "@/core/runtime/run-agent";
import { getModelProvider, MODEL_TIER_TO_ID } from "@/core/models/provider";
import type { Observation } from "@/core/testing/runner/test-runner";
import type { AgentOutput } from "@/domain/agent-output";
import { evaluationMissionSchema, type EvaluationMission, type EvaluationMissionInput } from "@/domain/evaluation-mission";
import { buildEvaluationAgentInput, type EvaluationAgentInput } from "@/domain/evaluation-agent-input";
import { planTask } from "@/services/task-planner";
import { executePlan } from "@/services/plan-executor";
import { buildTaskWithEvidence } from "@/services/lab-task";
import { consolidateMissionEvaluation, type FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";
import { synthesizeHeadReport, type HeadReport } from "@/core/findings/head-report";
import { createRecommendationsForRun } from "@/services/recommendations";
import { db } from "@/lib/db";
export { getMissionRun, listMissionRuns, getLatestMissionRun } from "@/services/evaluation-mission-runs";

/**
 * The first, minimal Evaluation Orchestrator: runs an EvaluationMission's
 * Browser step exactly once, then hands the exact same EvaluationAgentInput
 * (the same Mission slice, the same real Observations) to every one of the
 * mission's requestedAgents, sequentially. No consensus, no review round, no
 * REVIEW_REQUEST/REVIEW_RESPONSE (runAgent() is called with no messageBus,
 * so its own needsOtherAgent handling never sends one), no parallelism yet,
 * and the Smart Router (chooseInitialAgentId/routeTask) is never consulted —
 * requestedAgents is authoritative here, resolved directly through the
 * existing AgentRegistry, exactly like routeTask()'s own requestedAgentId
 * override already does for a single agent (see smart-router.ts). Not a
 * replacement for runLabTask()/routeTask() — an additive capability for
 * EvaluationMission's own multi-agent requestedAgents field. Reuses
 * planTask()/executePlan()/buildEvaluationAgentInput()/AgentRegistry/
 * runAgent() as-is; nothing about Browser execution or the Agent Runtime is
 * reimplemented here.
 */

export interface AgentEvaluationOutcome {
  agentId: string;
  /**
   * Mirrors RunAgentResult's own "SUCCESS"/"FAILED". "BLOCKED" is this
   * Orchestrator's own addition: the agent id was never resolved in the
   * Registry, so it was never run at all — never silently replaced by a
   * different agent (same discipline routeTask() already applies for an
   * unregistered requested agent).
   */
  status: "SUCCESS" | "FAILED" | "BLOCKED";
  output: AgentOutput | null;
  error: string | null;
}

export interface MissionEvaluationResult {
  missionId: string;
  /** The mission's own basic, unaltered identity — carried through so a consumer (e.g. the consolidator below) doesn't need the original EvaluationMission separately. */
  mission: { target: EvaluationMission["target"]; objective: string; task: string };
  /** The real Observations gathered by the ONE Browser run for this mission — shared, unmodified, by every entry in `evaluations`. */
  observations: Observation[];
  /** One entry per requestedAgents id, in the same order — never fewer, never a substitute id. */
  evaluations: AgentEvaluationOutcome[];
  /**
   * The Final Evaluation Report (src/core/findings/mission-evaluation-report.ts):
   * a pure, deterministic consolidation of `evaluations` above — computed
   * once, after every requested agent has run. Never re-executes the
   * Browser or any agent; never introduces collaboration or a MessageBus.
   */
  report: FinalEvaluationReport;
}

function blockedOutcome(agentId: string, error: string): AgentEvaluationOutcome {
  return { agentId, status: "BLOCKED", output: null, error };
}

/**
 * Runs the mission's Browser step exactly once via the existing
 * planTask()/executePlan() pair — the same primitives runLabTask() already
 * uses for a Plan-based task, never reimplemented here. Returns null when
 * the Planner couldn't produce an executable Plan for this mission's task —
 * same evidence-first discipline as runLabTask(): no agent is ever run
 * without real evidence behind it.
 */
async function gatherMissionObservations(mission: EvaluationMission): Promise<Observation[] | null> {
  const plan = await planTask(mission.task, { url: mission.target.url });
  if (!plan) return null;
  return executePlan(plan, mission.target.url);
}

/**
 * Runs one already-shared EvaluationAgentInput against one requested agent
 * id — a thin wrapper over AgentRegistry.getBySlug() + the existing
 * runAgent() Runtime, never a second execution path.
 */
async function evaluateWithAgent(
  agentId: string,
  task: string,
  project: Pick<Project, "id">,
  evaluationInput: EvaluationAgentInput,
): Promise<AgentEvaluationOutcome> {
  const agent = await AgentRegistry.getBySlug(agentId);
  if (!agent) {
    return blockedOutcome(agentId, `Agent "${agentId}" does not exist in the Registry.`);
  }

  const result = await runAgent({
    agent,
    project,
    task,
    context: { evaluationInput },
  });

  return { agentId, status: result.status, output: result.output, error: result.error };
}

/** FASE 11 — Mission Lifecycle. The real, incremental shape persisted to EvaluationMissionRun.progress as each requested agent actually starts/finishes — never a simulated tick. */
export interface MissionProgress {
  completedAgentIds: string[];
  failedAgentIds: string[];
  runningAgentId: string | null;
}

function progressSoFar(evaluations: AgentEvaluationOutcome[], runningAgentId: string | null): MissionProgress {
  return {
    completedAgentIds: evaluations.filter((e) => e.status === "SUCCESS").map((e) => e.agentId),
    failedAgentIds: evaluations.filter((e) => e.status !== "SUCCESS").map((e) => e.agentId),
    runningAgentId,
  };
}

/**
 * The first minimal Evaluation Orchestrator. Browser executes once,
 * Observations are produced once, and every requestedAgents id (in
 * declaration order, sequentially — no parallelism yet) evaluates the exact
 * same EvaluationAgentInput built from them. An agent id that isn't
 * registered is reported as its own explicit BLOCKED outcome — it never
 * stops the other requested agents from running (partial execution is
 * allowed), and it is never replaced by a different agent.
 *
 * FASE 11 — `onProgress`, when given, is called with the REAL, so-far state
 * right before each agent starts and right after each agent finishes (plus
 * once more if the Planner itself never produced a Plan at all) — never a
 * timer, never an estimate. Optional and additive: every other caller of
 * this function (none currently exist outside createAndRunMissionEvaluation,
 * but the signature stays backward compatible) behaves identically without
 * it.
 */
export async function runMissionEvaluation(
  mission: EvaluationMission,
  project: Pick<Project, "id">,
  onProgress?: (progress: MissionProgress) => Promise<void> | void,
): Promise<MissionEvaluationResult> {
  const observations = await gatherMissionObservations(mission);
  const missionInfo = { target: mission.target, objective: mission.objective, task: mission.task };

  if (!observations) {
    const reason =
      "This mission's task looked like a browser task, but the Task Planner could not produce an executable Plan for it — no agent was run, to avoid a result with no real evidence behind it.";
    const evaluations = mission.requestedAgents.map((agentId) => blockedOutcome(agentId, reason));
    await onProgress?.(progressSoFar(evaluations, null));
    return {
      missionId: mission.id,
      mission: missionInfo,
      observations: [],
      evaluations,
      report: consolidateMissionEvaluation({ missionId: mission.id, mission: missionInfo, evaluations }),
    };
  }

  const evaluationInput = buildEvaluationAgentInput(
    { id: mission.id, target: mission.target, objective: mission.objective, task: mission.task },
    observations,
  );
  const task = buildTaskWithEvidence(mission.task, observations, mission.objective);

  const evaluations: AgentEvaluationOutcome[] = [];
  for (const agentId of mission.requestedAgents) {
    await onProgress?.(progressSoFar(evaluations, agentId));
    evaluations.push(await evaluateWithAgent(agentId, task, project, evaluationInput));
    await onProgress?.(progressSoFar(evaluations, null));
  }

  // The consolidator runs once, here, strictly after every requested agent
  // has already been evaluated — never re-executes the Browser or an agent,
  // never introduces a MessageBus or a collaboration round.
  const report = consolidateMissionEvaluation({ missionId: mission.id, mission: missionInfo, evaluations });

  return { missionId: mission.id, mission: missionInfo, observations, evaluations, report };
}

export interface EvaluationMissionRunRecord {
  id: string;
  status: EvaluationMissionRunStatus;
  report: FinalEvaluationReport | null;
  error: string | null;
  provider: ModelProviderKind | null;
  model: string | null;
  headReport: HeadReport | null;
}

/**
 * Resolves the executor identity for a Run BEFORE it's created — the same
 * provider.name -> ModelProviderKind mapping run-agent.ts already applies
 * per-agent (toProviderKind), and the same "claude-code has no tier of its
 * own, everything else uses MODEL_TIER_TO_ID" resolution run-agent.ts already
 * uses for `model`. Applied once here, at the mission level, to one
 * representative requested agent (the first one) — informational only; each
 * AgentExecution this mission produces still records its own authoritative
 * per-agent model. Never calls the model, never creates a second provider
 * concept: getModelProvider() is the exact same singleton run-agent.ts calls.
 */
async function resolveMissionExecutor(
  input: Pick<EvaluationMissionInput, "requestedAgents">,
): Promise<{ provider: ModelProviderKind; model: string | null }> {
  const provider = getModelProvider();
  const kind = toProviderKind(provider.name);

  if (provider.name === "claude-code") {
    return { provider: kind, model: "claude-code" };
  }

  const representativeAgentId = input.requestedAgents[0];
  const agent = representativeAgentId ? await AgentRegistry.getBySlug(representativeAgentId) : null;
  const model = agent ? MODEL_TIER_TO_ID[agent.modelTier] : null;

  return { provider: kind, model };
}

/**
 * The one integration point between a persisted EvaluationMissionRun row
 * (prisma/schema.prisma) and the already-validated runMissionEvaluation()
 * above — nothing about the Browser, the agents, or the consolidation is
 * reimplemented here. The row is created as RUNNING first (so a real crash
 * mid-execution is honestly reflected in the database, never silently
 * missing), the exact same runMissionEvaluation() production code path runs,
 * then the same row is updated with the outcome. This is the ONLY place a
 * Mission's config and report get a durable identity — the UI (and any
 * external executor, e.g. scripts/run-claude-code-mission.ts) calls this
 * instead of runMissionEvaluation() directly, so both stay backed by the
 * exact same persisted record.
 *
 * "BLOCKED" here means no requested agent reached SUCCESS at all (e.g. the
 * Task Planner never produced an executable Plan) — the same condition the
 * report's own coverage list already lets a caller compute; inlined rather
 * than imported from the app layer's evaluation-mission-helpers.ts to avoid
 * a service module depending on it.
 */
export async function createAndRunMissionEvaluation(
  input: EvaluationMissionInput,
  project: Pick<Project, "id">,
): Promise<EvaluationMissionRunRecord> {
  // Resolved BEFORE the row is created, so the Run is born with the
  // identity of the executor that will actually run it — never created with
  // a placeholder/guessed identity and corrected afterward.
  const executor = await resolveMissionExecutor(input);

  const run = await db.evaluationMissionRun.create({
    data: {
      projectId: project.id,
      status: "RUNNING",
      input: input as unknown as Prisma.InputJsonValue,
      provider: executor.provider,
      model: executor.model,
    },
  });

  const mission: EvaluationMission = evaluationMissionSchema.parse({
    id: run.id,
    target: input.target,
    objective: input.objective,
    task: input.task,
    requestedAgents: input.requestedAgents,
  });

  try {
    const result = await runMissionEvaluation(mission, project, async (progress) => {
      await db.evaluationMissionRun.update({ where: { id: run.id }, data: { progress: progress as unknown as Prisma.InputJsonValue } });
    });
    const allUnevaluated = result.evaluations.length > 0 && result.evaluations.every((e) => e.status !== "SUCCESS");
    const status: EvaluationMissionRunStatus = allUnevaluated ? "BLOCKED" : "COMPLETED";

    // The Head never re-runs anything — it's a pure synthesis of the exact
    // report just consolidated above (see head-report.ts). Computed even for
    // a BLOCKED run (an empty-findings report still produces a valid,
    // honest "nothing confirmed" summary), never for a run that threw.
    const head = synthesizeHeadReport(result.report);

    await db.evaluationMissionRun.update({
      where: { id: run.id },
      data: {
        status,
        report: result.report as unknown as Prisma.InputJsonValue,
        headReport: head as unknown as Prisma.InputJsonValue,
      },
    });

    // One Recommendation row per consolidated finding, at PENDING — the
    // human-decision surface the Command Center reads from. A no-op when
    // there are no findings.
    await createRecommendationsForRun(run.id, result.report, head);

    return {
      id: run.id,
      status,
      report: result.report,
      error: null,
      provider: executor.provider,
      model: executor.model,
      headReport: head,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.evaluationMissionRun.update({
      where: { id: run.id },
      data: { status: "FAILED", error: message },
    });
    return {
      id: run.id,
      status: "FAILED",
      report: null,
      error: message,
      provider: executor.provider,
      model: executor.model,
      headReport: null,
    };
  }
}

