import { getQgSnapshot } from "@/services/qg";
import {
  agentsWithPendingDecision,
  buildWeeklyReport,
  deriveAgentQgState,
  deriveGlobalStatus,
  AGENT_STATE_LABEL,
  GLOBAL_STATUS_LABEL,
} from "./qg-helpers";
import { LivingLabRoom, type AgentStationData, type QgOfficeData, type CycleStep } from "./living-lab-room";
import type { FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";

export const dynamic = "force-dynamic";

export default async function QgPage() {
  const { agents, latestRun, latestInput, latestReport, latestHead, missionRuns, recommendations, implementations } = await getQgSnapshot();

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

  /** FASE 18 — the real, latest Validation for a recommendation's Implementation, if any (the data model keeps full history; the QG's state derivation shows only the current/latest one). */
  function latestValidationStatusFor(recommendationId: string): "PENDING" | "PASSED" | "FAILED" | "INCONCLUSIVE" | null {
    const implementation = implementations.get(recommendationId);
    if (!implementation || implementation.validations.length === 0) return null;
    return implementation.validations[implementation.validations.length - 1].status;
  }

  const stations: AgentStationData[] = agents.map((agent) => {
    const coverageEntry = latestReport?.coverage.find((c) => c.agentId === agent.id);
    const agentFindingRecommendation = recommendationsForLatestRun.find((r) =>
      (latestReport?.findings[r.findingIndex]?.sources ?? []).some((s) => s.agentId === agent.id),
    );
    const implementationForAgent = agentFindingRecommendation ? implementations.get(agentFindingRecommendation.id) : null;

    const state = deriveAgentQgState({
      agentId: agent.id,
      latestRunStatus: latestRun?.status ?? null,
      requestedAgents: latestInput?.requestedAgents ?? [],
      coverageEntry,
      hasPendingRecommendation: pendingAgentIds.has(agent.id),
      recommendationStatus: agentFindingRecommendation?.status ?? null,
      implementationStatus: implementationForAgent?.status ?? null,
      latestValidationStatus: agentFindingRecommendation ? latestValidationStatusFor(agentFindingRecommendation.id) : null,
    });

    const findingsForAgent = (latestReport?.findings ?? [])
      .map((finding, findingIndex) => ({ finding, findingIndex }))
      .filter(({ finding }) => finding.sources.some((s) => s.agentId === agent.id))
      .map(({ finding, findingIndex }) => {
        const recommendation = recommendationsForLatestRun.find((r) => r.findingIndex === findingIndex);
        const implementation = recommendation ? implementations.get(recommendation.id) : null;
        return {
          text: finding.finding,
          recommendationId: recommendation?.id ?? null,
          recommendationStatus: recommendation?.status ?? null,
          implementationId: implementation?.id ?? null,
          implementationStatus: implementation?.status ?? null,
          validationStatus: recommendation ? latestValidationStatusFor(recommendation.id) : null,
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

  /**
   * FASE 18 — Timeline. Focuses on one real recommendation (preferring a
   * PENDING one — the most actionable — else the most recently touched one
   * from the latest run) and reads its own real chain of
   * Recommendation/Implementation/Validation status straight off the data
   * already fetched above. "skipped" only ever applies after an IGNORED
   * decision — Implementation/Validation genuinely never happen then, so
   * showing them as "upcoming" would be dishonest.
   */
  function buildCycle(): CycleStep[] | null {
    // Picked from ALL real recommendations, not just the latest mission's
    // own — a human decision (and its real Implementation/Validation) can
    // legitimately continue across missions (e.g. a later retest mission),
    // and the Timeline should follow that real, still-open cycle rather
    // than silently losing it the moment a newer, unrelated mission runs.
    const focus =
      recommendations.find((r) => r.status === "PENDING") ??
      recommendations.find((r) => implementations.get(r.id)) ??
      recommendations[0] ??
      null;
    if (!latestRun && !focus) return null;

    const focusMissionRun = focus?.missionRun ?? latestRun;
    if (!focusMissionRun) return null;
    const missionDone = focusMissionRun.status !== "RUNNING";
    const focusReport = focusMissionRun.report as unknown as FinalEvaluationReport | null;
    const hasFindings = (focusReport?.findings.length ?? 0) > 0;
    const implementation = focus ? implementations.get(focus.id) : null;
    const validationStatus = focus ? latestValidationStatusFor(focus.id) : null;
    const ignored = focus?.status === "IGNORED";

    const steps: CycleStep[] = [
      { label: "Mission", status: missionDone ? "done" : "current" },
      { label: "Agents", status: missionDone ? "done" : "current" },
      { label: "Findings", status: !missionDone ? "pending" : hasFindings ? "done" : "pending" },
    ];
    if (!focus) {
      steps.push({ label: "Recommendation", status: "pending" }, { label: "Approval", status: "pending" }, { label: "Implementation", status: "pending" }, { label: "Validation", status: "pending" });
      return steps;
    }
    steps.push({ label: "Recommendation", status: "done" });
    steps.push({ label: "Approval", status: focus.status === "PENDING" ? "current" : "done" });
    if (ignored) {
      steps.push({ label: "Implementation", status: "skipped" }, { label: "Validation", status: "skipped" });
      return steps;
    }
    steps.push({
      label: "Implementation",
      status: implementation?.status === "COMPLETED" ? "done" : implementation ? "current" : "pending",
    });
    steps.push({
      label: "Validation",
      status: validationStatus === "PASSED" || validationStatus === "FAILED" ? "done" : validationStatus ? "current" : "pending",
    });
    return steps;
  }

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
    pendingRecommendations: pending.map((r) => ({ id: r.id, title: r.title, summary: r.summary, impact: r.impact, confidence: r.confidence })),
    cycle: buildCycle(),
  };

  return <LivingLabRoom data={data} />;
}
