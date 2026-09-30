import { db } from "@/lib/db";
import type { RecommendationStatus } from "@/generated/prisma/client";
import type { FinalEvaluationReport, ConsolidatedFinding } from "@/core/findings/mission-evaluation-report";
import type { HeadReport } from "@/core/findings/head-report";

/**
 * One Recommendation row per consolidated finding — never a second
 * deduplication pass (report.findings is already deduplicated by
 * consolidateMissionEvaluation) and never a second findings format
 * (everything here is a direct, verbatim copy of the Head's own framing of
 * that finding, itself built only from the specialists' own fields — see
 * head-report.ts). Created once, right when the run completes, at
 * PENDING — never re-created or re-derived afterward, so a human decision
 * on one is never silently overwritten by a later read.
 */
export async function createRecommendationsForRun(
  missionRunId: string,
  report: FinalEvaluationReport,
  head: HeadReport,
): Promise<void> {
  if (report.findings.length === 0) return;

  await db.recommendation.createMany({
    data: head.items.map((item) => ({
      missionRunId,
      findingIndex: item.findingIndex,
      title: item.title.length > 90 ? `${item.title.slice(0, 89)}…` : item.title,
      summary: item.title,
      whyItMatters: item.whyItMatters,
      recommendedAction: item.recommendedAction,
      impact: item.impact,
      confidence: item.confidence,
    })),
  });
}

export function listRecommendations(status?: RecommendationStatus) {
  return db.recommendation.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    include: { missionRun: true },
  });
}

/**
 * Same Recommendation table, scoped to one run via its existing
 * missionRunId FK — this is how a Mission page learns the decision state of
 * its own findings, without a second status system or a new relation.
 */
export function listRecommendationsForRun(missionRunId: string) {
  return db.recommendation.findMany({
    where: { missionRunId },
    orderBy: { findingIndex: "asc" },
  });
}

export function getRecommendation(id: string) {
  return db.recommendation.findUnique({
    where: { id },
    include: { missionRun: true },
  });
}

export function setRecommendationStatus(id: string, status: Extract<RecommendationStatus, "APPROVED" | "IGNORED">) {
  return db.recommendation.update({ where: { id }, data: { status } });
}

/**
 * Which agents actually reported the finding this Recommendation frames —
 * read directly from its own run's already-persisted report, never
 * duplicated onto the Recommendation row itself. Empty when the run's
 * report is missing or malformed (defensive only; a Recommendation is never
 * created without a real report behind it — see createRecommendationsForRun).
 */
export function getRecommendationAgents(recommendation: { findingIndex: number; missionRun: { report: unknown } }): string[] {
  const report = recommendation.missionRun.report as unknown as FinalEvaluationReport | null;
  const finding: ConsolidatedFinding | undefined = report?.findings[recommendation.findingIndex];
  return finding?.sources.map((source) => source.agentId) ?? [];
}
