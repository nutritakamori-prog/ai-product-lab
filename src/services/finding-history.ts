import type { EvaluationMissionRunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";
import {
  buildFindingHistory,
  type FindingHistoryRunInput,
  type TargetFindingHistory,
} from "@/core/findings/finding-history";

/**
 * FASE 10B.2 — Finding History. The database-access half: loads persisted
 * EvaluationMissionRun rows for one project and hands them, mapped to
 * buildFindingHistory()'s own existing input shape (src/core/findings/
 * finding-history.ts), to that already-tested pure function — no second
 * finding-comparison implementation, no new deduplication rule.
 */

/** The minimal, Prisma-free shape toFindingHistoryRunInput needs from an already-loaded EvaluationMissionRun row. */
export interface MissionRunRecord {
  id: string;
  status: EvaluationMissionRunStatus;
  report: unknown;
  createdAt: Date;
}

/**
 * Maps one persisted run to buildFindingHistory()'s input shape, or null
 * when this run contributes no real evidence to the comparison window.
 *
 * Only COMPLETED runs are included:
 * - RUNNING and FAILED never have a `report` at all (see
 *   createAndRunMissionEvaluation in evaluation-orchestrator.ts — a FAILED
 *   run's `report` column is left null, since the orchestration itself
 *   threw before ever producing one), so they carry nothing to compare.
 * - BLOCKED runs DO get a `report` (coverage showing every requested agent
 *   either failed or was never resolved in the Registry), but its
 *   `findings` array being empty would mean "no requested agent ever
 *   actually evaluated this target" — not "evaluated, confirmed nothing".
 *   Treating a BLOCKED run's absence of findings as real evidence would
 *   wrongly turn an earlier PERSISTENT finding into NOT_REPRODUCED just
 *   because the orchestration never gathered evidence — exactly the kind of
 *   overclaiming finding-history.ts's own doc comment warns against for
 *   NOT_REPRODUCED in general. BLOCKED runs are therefore deliberately
 *   excluded from the comparison window, not treated as a data point.
 */
export function toFindingHistoryRunInput(run: MissionRunRecord): FindingHistoryRunInput | null {
  if (run.status !== "COMPLETED") return null;

  const report = run.report as unknown as FinalEvaluationReport | null;
  if (!report) return null;

  return { runId: run.id, target: report.mission.target, createdAt: run.createdAt, findings: report.findings };
}

/**
 * Loads every COMPLETED EvaluationMissionRun for one project (never mixed
 * with another project's runs — projectId is required) and builds each of
 * its targets' finding timelines via the existing buildFindingHistory().
 * One batched query, no N+1. Optionally narrowed to a single target by its
 * URL — the same identity key finding-history.ts already uses internally
 * (target.name is display-only, never part of a target's identity).
 */
export async function getFindingHistory(projectId: string, target?: string): Promise<TargetFindingHistory[]> {
  const runs = await db.evaluationMissionRun.findMany({
    where: { projectId },
    select: { id: true, status: true, report: true, createdAt: true },
  });

  const inputs = runs
    .map((run) => toFindingHistoryRunInput(run))
    .filter((input): input is FindingHistoryRunInput => input !== null);

  const histories = buildFindingHistory(inputs);
  if (target === undefined) return histories;

  const normalizedTarget = target.trim();
  return histories.filter((history) => history.target.url.trim() === normalizedTarget);
}
