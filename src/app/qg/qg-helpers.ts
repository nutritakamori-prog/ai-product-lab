import type { AgentEvaluationOutcome } from "@/services/evaluation-orchestrator";
import type { RecommendationStatus } from "@/generated/prisma/client";

/**
 * Every state a station in the QG can show for one agent — derived only
 * from data that already exists (AgentEvaluationOutcome from the latest
 * run's own report, plus whether that finding's Recommendation is still
 * PENDING). Never a new persisted status: this is a pure view over
 * EvaluationMissionRun.report + Recommendation.status, recomputed on every
 * read.
 */
export type AgentQgState =
  | "IDLE"
  | "WORKING"
  | "NOT_IN_LATEST_RUN"
  | "BLOCKED"
  | "FAILED"
  | "NO_FINDING"
  | "UNCONFIRMED"
  | "HAS_FINDING"
  | "PENDING_DECISION";

export const AGENT_STATE_LABEL: Record<AgentQgState, string> = {
  IDLE: "Sem atividade recente",
  WORKING: "Em execução",
  NOT_IN_LATEST_RUN: "Não participou da última avaliação",
  BLOCKED: "Bloqueado",
  FAILED: "Falhou",
  NO_FINDING: "Nenhum problema encontrado",
  UNCONFIRMED: "Inconclusivo",
  HAS_FINDING: "Encontrou um problema",
  PENDING_DECISION: "Aguardando decisão",
};

/**
 * Deterministic rule, no inference:
 * - No run has ever completed -> IDLE.
 * - The latest run is still RUNNING -> WORKING for every requested agent
 *   (the orchestrator runs them strictly sequentially, but nothing partial
 *   is persisted mid-run — see evaluation-orchestrator.ts — so this is the
 *   most honest thing observable: the mission is actively working through
 *   its requested agents right now).
 * - Otherwise, read straight off this agent's own coverage entry in the
 *   latest run's report — never a guess when there isn't one.
 */
export function deriveAgentQgState(params: {
  agentId: string;
  latestRunStatus: string | null;
  requestedAgents: string[];
  coverageEntry: AgentEvaluationOutcome | undefined;
  hasPendingRecommendation: boolean;
}): AgentQgState {
  const { agentId, latestRunStatus, requestedAgents, coverageEntry, hasPendingRecommendation } = params;

  if (latestRunStatus === null) return "IDLE";
  if (latestRunStatus === "RUNNING") {
    return requestedAgents.includes(agentId) ? "WORKING" : "NOT_IN_LATEST_RUN";
  }
  if (!coverageEntry) return "NOT_IN_LATEST_RUN";
  if (coverageEntry.status === "BLOCKED") return "BLOCKED";
  if (coverageEntry.status === "FAILED") return "FAILED";

  const outputStatus = coverageEntry.output?.status;
  if (outputStatus === "NO_FINDING") return "NO_FINDING";
  if (outputStatus === "UNCONFIRMED") return "UNCONFIRMED";
  if (outputStatus === "FINDING") return hasPendingRecommendation ? "PENDING_DECISION" : "HAS_FINDING";
  return "NOT_IN_LATEST_RUN";
}

export type GlobalQgStatus = "HEALTHY" | "NEEDS_ATTENTION" | "ACTION_REQUIRED";

export const GLOBAL_STATUS_LABEL: Record<GlobalQgStatus, string> = {
  HEALTHY: "Tudo certo",
  NEEDS_ATTENTION: "Atenção recomendada",
  ACTION_REQUIRED: "Ação necessária",
};

/**
 * Deterministic, documented, never an AI judgment call:
 * - ACTION_REQUIRED: at least one Recommendation is still PENDING — a human
 *   decision is owed.
 * - NEEDS_ATTENTION: no pending decision, but the latest Mission Run ended
 *   BLOCKED or FAILED — an operational issue worth a look.
 * - HEALTHY: neither of the above.
 */
export function deriveGlobalStatus(params: { pendingRecommendationsCount: number; latestRunStatus: string | null }): GlobalQgStatus {
  if (params.pendingRecommendationsCount > 0) return "ACTION_REQUIRED";
  if (params.latestRunStatus === "BLOCKED" || params.latestRunStatus === "FAILED") return "NEEDS_ATTENTION";
  return "HEALTHY";
}

export interface WeeklyReport {
  periodDays: number;
  evaluationsRun: number;
  findingsRaised: number;
  decisionsApproved: number;
  decisionsIgnored: number;
  decisionsPending: number;
}

/**
 * Every number here is counted directly from EvaluationMissionRun/
 * Recommendation rows already fetched by the caller — no new query, no new
 * table, nothing narrated or invented. "decisionsPending" is the current
 * total (not period-scoped): there is no reliable signal in the schema for
 * exactly when a Recommendation became PENDING versus when it was created,
 * so this reports what genuinely IS pending right now rather than guessing
 * when it started being so.
 */
export function buildWeeklyReport(
  missionRuns: { createdAt: Date; report: unknown }[],
  recommendations: { status: RecommendationStatus; updatedAt: Date }[],
  now: Date = new Date(),
): WeeklyReport {
  const periodDays = 7;
  const since = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);

  const runsInPeriod = missionRuns.filter((r) => r.createdAt >= since);
  const findingsRaised = runsInPeriod.reduce((sum, r) => {
    const report = r.report as { findings?: unknown[] } | null;
    return sum + (report?.findings?.length ?? 0);
  }, 0);

  return {
    periodDays,
    evaluationsRun: runsInPeriod.length,
    findingsRaised,
    decisionsApproved: recommendations.filter((r) => r.status === "APPROVED" && r.updatedAt >= since).length,
    decisionsIgnored: recommendations.filter((r) => r.status === "IGNORED" && r.updatedAt >= since).length,
    decisionsPending: recommendations.filter((r) => r.status === "PENDING").length,
  };
}

/**
 * Which agentIds are sources of a finding whose Recommendation is still
 * PENDING, for the given run's own findings + recommendations — the same
 * findingIndex link every other page already uses. A tiny lookup, not a new
 * relation.
 */
export function agentsWithPendingDecision(
  findingsSourceAgentIds: { findingIndex: number; agentIds: string[] }[],
  recommendationsForRun: { findingIndex: number; status: RecommendationStatus }[],
): Set<string> {
  const pendingFindingIndexes = new Set(
    recommendationsForRun.filter((r) => r.status === "PENDING").map((r) => r.findingIndex),
  );
  const agentIds = new Set<string>();
  for (const f of findingsSourceAgentIds) {
    if (pendingFindingIndexes.has(f.findingIndex)) {
      for (const agentId of f.agentIds) agentIds.add(agentId);
    }
  }
  return agentIds;
}
