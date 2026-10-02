import { db } from "@/lib/db";
import type { ImplementationStatus, RecommendationStatus, ValidationStatus } from "@/generated/prisma/client";
import type { EvaluationMissionInput } from "@/domain/evaluation-mission";
import type { FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";
import { getFindingHistory } from "@/services/finding-history";
import type { TargetFindingHistory } from "@/core/findings/finding-history";

/**
 * FASE 10B.3 — the read-only composed view answering the question this
 * phase exists for: for one Recommendation, what implementation happened,
 * what validation followed, and how does that relate to the target's real
 * finding history? Reuses getFindingHistory() (src/services/finding-
 * history.ts) exactly as it is — never recomputes or copies
 * buildFindingHistory()'s own comparison logic.
 */

export interface RecommendationLifecycleImplementation {
  id: string;
  status: ImplementationStatus;
  summary: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface RecommendationLifecycleValidation {
  id: string;
  status: ValidationStatus;
  retestMissionRunId: string | null;
  retestTestRunId: string | null;
  notes: string | null;
  createdAt: Date;
}

export interface RecommendationLifecycle {
  recommendationId: string;
  recommendationStatus: RecommendationStatus;
  target: { url: string; name?: string };
  /** The original finding text this Recommendation was framed from (report.findings[findingIndex].finding) — null only if the run's report is missing/malformed, never fabricated. */
  finding: string | null;
  /** Null when this Recommendation has no Implementation yet — a valid state, never an error (see FASE 10B.3 §8, case 10). */
  implementation: RecommendationLifecycleImplementation | null;
  /** Chronological, every attempt kept — empty when the Implementation (if any) has never been validated yet (case 11). */
  validations: RecommendationLifecycleValidation[];
  /** This target's full finding timeline, from getFindingHistory() — null only if the project has no COMPLETED mission run history for this target at all. */
  findingHistory: TargetFindingHistory | null;
}

/**
 * Loads a Recommendation's full lifecycle: itself, its Implementation (if
 * any), that Implementation's Validations (if any), and its target's real
 * Finding History (via the existing getFindingHistory(), scoped to the same
 * project this Recommendation's own EvaluationMissionRun belongs to — never
 * a different project's history). Returns null when the Recommendation
 * itself doesn't exist.
 */
export async function getRecommendationLifecycle(recommendationId: string): Promise<RecommendationLifecycle | null> {
  const recommendation = await db.recommendation.findUnique({
    where: { id: recommendationId },
    include: {
      missionRun: true,
      implementation: { include: { validations: { orderBy: { createdAt: "asc" } } } },
    },
  });
  if (!recommendation) return null;

  const input = recommendation.missionRun.input as unknown as EvaluationMissionInput;
  const report = recommendation.missionRun.report as unknown as FinalEvaluationReport | null;
  const finding = report?.findings[recommendation.findingIndex]?.finding ?? null;

  const histories = await getFindingHistory(recommendation.missionRun.projectId, input.target.url);
  const findingHistory = histories[0] ?? null;

  return {
    recommendationId: recommendation.id,
    recommendationStatus: recommendation.status,
    target: input.target,
    finding,
    implementation: recommendation.implementation
      ? {
          id: recommendation.implementation.id,
          status: recommendation.implementation.status,
          summary: recommendation.implementation.summary,
          createdAt: recommendation.implementation.createdAt,
          completedAt: recommendation.implementation.completedAt,
        }
      : null,
    validations:
      recommendation.implementation?.validations.map((validation) => ({
        id: validation.id,
        status: validation.status,
        retestMissionRunId: validation.retestMissionRunId,
        retestTestRunId: validation.retestTestRunId,
        notes: validation.notes,
        createdAt: validation.createdAt,
      })) ?? [],
    findingHistory,
  };
}
