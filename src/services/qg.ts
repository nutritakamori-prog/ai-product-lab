import { listAgents } from "@/services/agents";
import { getLatestMissionRun, listMissionRuns } from "@/services/evaluation-mission-runs";
import { listRecommendations } from "@/services/recommendations";
import type { FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";
import type { HeadReport } from "@/core/findings/head-report";
import type { EvaluationMissionInput } from "@/domain/evaluation-mission";

/**
 * The QG is a presentation layer over the exact same data Product
 * Intelligence and the Mission pages already read — this composes those
 * same service calls (listAgents/getLatestMissionRun/listMissionRuns/
 * listRecommendations) once for the office's own use. No new query beyond
 * what those already do, no new table, no second source of truth.
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

  return { agents, latestRun, latestInput, latestReport, latestHead, missionRuns, recommendations };
}

export type QgSnapshot = Awaited<ReturnType<typeof getQgSnapshot>>;
