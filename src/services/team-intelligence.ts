import { db } from "@/lib/db";
import { listAgents } from "@/services/agents";
import { getAgentIntelligence } from "@/services/agent-intelligence";
import { getFindingHistory } from "@/services/finding-history";
import type { FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";
import {
  buildTeamIntelligence,
  type TeamIntelligenceAgentInput,
  type TeamIntelligenceMissionRunInput,
  type TeamIntelligenceRecommendationInput,
  type TeamIntelligenceSummary,
} from "@/core/team-intelligence/team-intelligence";

/**
 * FASE 10C — Team Intelligence. The database-access half: loads the exact
 * outputs of the existing Agent Intelligence (10B.1) and Finding History
 * (10B.2) services as-is, plus one project-scoped batch read each of
 * EvaluationMissionRun and Recommendation (with their Implementation/
 * Validation) for the parts those two services don't expose (convergence,
 * team-wide classification/finding-index bookkeeping, and the
 * Recommendation → Implementation → Validation cycle) — then hands
 * everything to the pure buildTeamIntelligence(). No second finding-history
 * or agent-activity computation, no N+1 (five queries/calls total,
 * regardless of how many agents/runs/recommendations exist).
 *
 * Only COMPLETED EvaluationMissionRuns are read for findings — same
 * precedent finding-history.ts's own toFindingHistoryRunInput already
 * established: a BLOCKED run's empty findings never real evidence, a FAILED/
 * RUNNING run has no report at all.
 */
export async function getTeamIntelligence(projectId: string): Promise<TeamIntelligenceSummary> {
  const [agentSummaries, resolvedAgents, findingHistories, missionRunRows, recommendationRows] = await Promise.all([
    getAgentIntelligence(projectId),
    listAgents(),
    getFindingHistory(projectId),
    db.evaluationMissionRun.findMany({
      where: { projectId, status: "COMPLETED" },
      select: { id: true, report: true },
    }),
    db.recommendation.findMany({
      where: { missionRun: { projectId } },
      select: {
        id: true,
        missionRunId: true,
        findingIndex: true,
        status: true,
        implementation: {
          select: {
            id: true,
            status: true,
            validations: { select: { id: true, status: true, retestMissionRunId: true, retestTestRunId: true } },
          },
        },
      },
    }),
  ]);

  const enabledBySlug = new Map(resolvedAgents.map((agent) => [agent.id, agent.enabled]));
  const agents: TeamIntelligenceAgentInput[] = agentSummaries.map((summary) => ({
    ...summary,
    enabled: enabledBySlug.get(summary.slug) ?? false,
  }));

  const missionRuns: TeamIntelligenceMissionRunInput[] = missionRunRows
    .map((run) => {
      const report = run.report as unknown as FinalEvaluationReport | null;
      if (!report) return null;
      return { id: run.id, target: report.mission.target, findings: report.findings };
    })
    .filter((run): run is TeamIntelligenceMissionRunInput => run !== null);

  const recommendations: TeamIntelligenceRecommendationInput[] = recommendationRows.map((recommendation) => ({
    id: recommendation.id,
    missionRunId: recommendation.missionRunId,
    findingIndex: recommendation.findingIndex,
    status: recommendation.status,
    implementation: recommendation.implementation
      ? {
          id: recommendation.implementation.id,
          status: recommendation.implementation.status,
          validations: recommendation.implementation.validations.map((validation) => ({
            id: validation.id,
            status: validation.status,
            retestMissionRunId: validation.retestMissionRunId,
            retestTestRunId: validation.retestTestRunId,
          })),
        }
      : null,
  }));

  return buildTeamIntelligence(agents, findingHistories, missionRuns, recommendations);
}
