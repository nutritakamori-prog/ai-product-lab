import { getQgSnapshot } from "@/services/qg";
import {
  agentsWithPendingDecision,
  buildWeeklyReport,
  deriveAgentQgState,
  deriveGlobalStatus,
  AGENT_STATE_LABEL,
  GLOBAL_STATUS_LABEL,
} from "./qg-helpers";
import { LivingLabRoom, type AgentStationData, type QgOfficeData } from "./living-lab-room";

export const dynamic = "force-dynamic";

export default async function QgPage() {
  const { agents, latestRun, latestInput, latestReport, latestHead, missionRuns, recommendations } = await getQgSnapshot();

  const pending = recommendations.filter((r) => r.status === "PENDING");
  const approved = recommendations.filter((r) => r.status === "APPROVED");
  const ignored = recommendations.filter((r) => r.status === "IGNORED");

  const recommendationsForLatestRun = latestRun ? recommendations.filter((r) => r.missionRunId === latestRun.id) : [];

  const pendingAgentIds = agentsWithPendingDecision(
    (latestReport?.findings ?? []).map((f, findingIndex) => ({
      findingIndex,
      agentIds: f.sources.map((s) => s.agentId),
    })),
    recommendationsForLatestRun.map((r) => ({ findingIndex: r.findingIndex, status: r.status })),
  );

  const stations: AgentStationData[] = agents.map((agent) => {
    const coverageEntry = latestReport?.coverage.find((c) => c.agentId === agent.id);
    const state = deriveAgentQgState({
      agentId: agent.id,
      latestRunStatus: latestRun?.status ?? null,
      requestedAgents: latestInput?.requestedAgents ?? [],
      coverageEntry,
      hasPendingRecommendation: pendingAgentIds.has(agent.id),
    });

    const findingsForAgent = (latestReport?.findings ?? [])
      .map((finding, findingIndex) => ({ finding, findingIndex }))
      .filter(({ finding }) => finding.sources.some((s) => s.agentId === agent.id))
      .map(({ finding, findingIndex }) => {
        const recommendation = recommendationsForLatestRun.find((r) => r.findingIndex === findingIndex);
        return {
          text: finding.finding,
          recommendationId: recommendation?.id ?? null,
          recommendationStatus: recommendation?.status ?? null,
        };
      });

    return {
      id: agent.id,
      name: agent.name,
      objective: agent.objective,
      state,
      stateLabel: AGENT_STATE_LABEL[state],
      lastMissionTarget:
        latestRun && (latestInput?.requestedAgents.includes(agent.id) ?? false)
          ? (latestInput?.target.name ?? latestInput?.target.url ?? null)
          : null,
      lastMissionDate: latestRun && (latestInput?.requestedAgents.includes(agent.id) ?? false) ? latestRun.createdAt.toISOString() : null,
      findings: findingsForAgent,
    };
  });

  const globalStatus = deriveGlobalStatus({
    pendingRecommendationsCount: pending.length,
    latestRunStatus: latestRun?.status ?? null,
  });

  const weeklyReport = buildWeeklyReport(
    missionRuns.map((r) => ({ createdAt: r.createdAt, report: r.report })),
    recommendations.map((r) => ({ status: r.status, updatedAt: r.updatedAt })),
  );

  const data: QgOfficeData = {
    globalStatus,
    globalStatusLabel: GLOBAL_STATUS_LABEL[globalStatus],
    stations,
    head: {
      summary: latestHead?.summary ?? null,
      mainRecommendation: latestHead?.mainRecommendation ?? null,
      problems: latestHead?.problems ?? 0,
      opportunities: latestHead?.opportunities ?? 0,
      observations: latestHead?.observations ?? 0,
      totalFindings: latestHead?.totalFindings ?? 0,
      pendingCount: pending.length,
    },
    latestMission: latestRun
      ? {
          id: latestRun.id,
          target: latestInput?.target.name ?? latestInput?.target.url ?? "—",
          status: latestRun.status,
          createdAt: latestRun.createdAt.toISOString(),
          specialistCount: latestInput?.requestedAgents.length ?? 0,
        }
      : null,
    pendingCount: pending.length,
    approvedCount: approved.length,
    ignoredCount: ignored.length,
    missionHistoryCount: missionRuns.length,
    weeklyReport,
  };

  return <LivingLabRoom data={data} />;
}
