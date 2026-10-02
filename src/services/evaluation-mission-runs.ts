import { db } from "@/lib/db";

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
