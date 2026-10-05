import { db } from "@/lib/db";
import type { EvaluationMissionInput } from "@/domain/evaluation-mission";

/**
 * Pure read-only queries over EvaluationMissionRun, split out of
 * evaluation-orchestrator.ts so a caller that only needs to read mission
 * history (the QG Runtime, in particular) doesn't pull in that file's real
 * browser-automation dependencies (plan-executor.ts/lab-task.ts, and
 * transitively Playwright) into its bundle. evaluation-orchestrator.ts
 * re-exports these three for existing callers that need both.
 */

export function getMissionRun(id: string) {
  return db.evaluationMissionRun.findUnique({ where: { id } });
}

export function listMissionRuns() {
  return db.evaluationMissionRun.findMany({ orderBy: { createdAt: "desc" } });
}

/** The single most recent Mission run, regardless of status — what the Command Center's header/Head Report block reads from. */
export function getLatestMissionRun() {
  return db.evaluationMissionRun.findFirst({ orderBy: { createdAt: "desc" } });
}

/**
 * FASE 11 — Mission Lifecycle. The one real, global fact a client can poll
 * for without already knowing a mission's id: is there a Run RUNNING right
 * now at all? Deliberately kept in this Playwright-free file (not
 * evaluation-orchestrator.ts) since this is the query a frequently-polled,
 * client-facing Server Action calls — it must stay cheap.
 */
export function getRunningMissionRun() {
  return db.evaluationMissionRun.findFirst({ where: { status: "RUNNING" }, orderBy: { createdAt: "desc" } });
}

/**
 * FASE 13 — LAB Self-Awareness. getLatestMissionRun()'s own project-scoped
 * sibling — that function is deliberately global (the QG has no project
 * selector, see qg-command-router.ts's own resolveActiveProjectId doc
 * comment), but a per-project "what's the most recent relevant evaluation"
 * fact is exactly what this phase's own self-awareness snapshot needs and
 * nothing existing already exposes. Same shape, same file, same style —
 * not a second query engine.
 */
export function getLatestMissionRunForProject(projectId: string) {
  return db.evaluationMissionRun.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } });
}

/**
 * FASE 13 — LAB Self-Awareness. The most recent top-level FAILED run for one
 * project — selected narrowly (just `error`/`createdAt`) since this exists
 * only to ground a "the provider has failed recently" limitation in one
 * real, traceable sample, never the raw payload itself (the caller is
 * expected to humanize it the same way operational-brain.ts already does
 * for a single mission's own error).
 */
export function getLatestFailedMissionRunForProject(projectId: string) {
  return db.evaluationMissionRun.findFirst({
    where: { projectId, status: "FAILED" },
    orderBy: { createdAt: "desc" },
    select: { error: true, createdAt: true },
  });
}

/** FASE 11 — Mission Lifecycle. The real, interpreted shape the QG/Brain reasons about — never a guess about work still to happen. */
export interface MissionLifecycle {
  missionRunId: string;
  projectId: string;
  status: string;
  requestedAgentIds: string[];
  completedAgentIds: string[];
  failedAgentIds: string[];
  runningAgentId: string | null;
  pendingAgentIds: string[];
}

/**
 * Shapes a raw EvaluationMissionRun row (its `input.requestedAgents` — set
 * once, at creation — and its `progress` column — see evaluation-
 * orchestrator.ts's own onProgress, written as each agent actually
 * starts/finishes) into the lifecycle view above. `pendingAgentIds` is
 * everything requested that progress hasn't accounted for yet — never a
 * separate query, purely the complement of what's real and already known.
 */
export function toMissionLifecycle(run: { id: string; projectId: string; status: string; input: unknown; progress: unknown }): MissionLifecycle {
  const input = run.input as Pick<EvaluationMissionInput, "requestedAgents"> | null;
  const requestedAgentIds = input?.requestedAgents ?? [];
  const progress = run.progress as { completedAgentIds?: string[]; failedAgentIds?: string[]; runningAgentId?: string | null } | null;
  const completedAgentIds = progress?.completedAgentIds ?? [];
  const failedAgentIds = progress?.failedAgentIds ?? [];
  const runningAgentId = progress?.runningAgentId ?? null;
  const accountedFor = new Set([...completedAgentIds, ...failedAgentIds, ...(runningAgentId ? [runningAgentId] : [])]);
  const pendingAgentIds = requestedAgentIds.filter((id) => !accountedFor.has(id));
  return { missionRunId: run.id, projectId: run.projectId, status: run.status, requestedAgentIds, completedAgentIds, failedAgentIds, runningAgentId, pendingAgentIds };
}
