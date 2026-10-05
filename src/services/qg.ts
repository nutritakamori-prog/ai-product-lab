import { listAgents } from "@/services/agents";
import { getLatestMissionRun, listMissionRuns } from "@/services/evaluation-mission-runs";
import { listRecommendations } from "@/services/recommendations";
import { getImplementationForRecommendation } from "@/services/implementations";
import type { FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";
import type { HeadReport } from "@/core/findings/head-report";
import type { EvaluationMissionInput } from "@/domain/evaluation-mission";
import type { Implementation, Validation } from "@/generated/prisma/client";

/**
 * The QG is a presentation layer over the exact same data Product
 * Intelligence and the Mission pages already read — this composes those
 * same service calls (listAgents/getLatestMissionRun/listMissionRuns/
 * listRecommendations) once for the office's own use. No new query beyond
 * what those already do, no new table, no second source of truth.
 *
 * FASE 18 — the QG previously had zero visibility past Recommendation:
 * Implementation/Validation never appeared anywhere in this snapshot, so
 * no visual layer could show them. This reuses the exact same, already-
 * existing getImplementationForRecommendation() (FASE 10B.3) per
 * recommendation — the real recommendation count in this product is small
 * (a handful), so this stays a simple per-row lookup rather than a new
 * batched query.
 */
export async function getQgSnapshot() {
  const [agents, latestRun, missionRuns, recommendations] = await Promise.all([
    listAgents(),
    getLatestMissionRun(),
    listMissionRuns(),
    listRecommendations(),
  ]);

  const latestInput = latestRun?.input as unknown as EvaluationMissionInput | undefined;
  const latestReport = latestRun?.report as unknown as FinalEvaluationReport | null | undefined;
  const latestHead = latestRun?.headReport as unknown as HeadReport | null | undefined;

  const implementations = new Map<string, (Implementation & { validations: Validation[] }) | null>(
    await Promise.all(
      recommendations.map(async (r) => [r.id, await getImplementationForRecommendation(r.id)] as const),
    ),
  );

  return { agents, latestRun, latestInput, latestReport, latestHead, missionRuns, recommendations, implementations };
}

export type QgSnapshot = Awaited<ReturnType<typeof getQgSnapshot>>;
