import { db } from "@/lib/db";
import { getLatestMissionRun } from "@/services/evaluation-mission-runs";
import { getRecommendation, listRecommendations, listRecommendationsForRun } from "@/services/recommendations";
import { getImplementation, listImplementationsAwaitingCompletion } from "@/services/implementations";
import { getAgentIntelligence } from "@/services/agent-intelligence";
import { getFindingHistory } from "@/services/finding-history";
import { getTeamIntelligence } from "@/services/team-intelligence";
import { getTeamArchitectReport } from "@/services/team-architect";
import type { QgCommandId } from "@/core/qg-command-router/qg-command-router";
import type { EvaluationMissionInput } from "@/domain/evaluation-mission";
import type { FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";

/**
 * FASE 11 — QG Runtime. The dispatcher half of the Command Router: given a
 * QgCommandId already matched by the pure core router, calls the real,
 * existing LAB service for it and shapes a small, serializable result for
 * the QG to render. Every data-producing call here is one of the five
 * already-existing services this phase was explicitly told to reuse
 * (getAgentIntelligence, getFindingHistory, listRecommendations/
 * listRecommendationsForRun, getTeamArchitectReport) — no business logic
 * is duplicated, and this file never writes to the database.
 */

// ── Project context ──────────────────────────────────────────────────────
// The QG has no project-selection mechanism at all today (confirmed by
// audit — see this phase's own report). The smallest possible mechanism
// that doesn't invent one: resolve "the active project" exactly the way
// the rest of the QG already implicitly does — the project of the most
// recent EvaluationMissionRun, the same row getQgSnapshot() already reads
// for the Head/Command Center. No new selector, no new session/cookie
// state.
export async function resolveActiveProjectId(): Promise<string | null> {
  const latestRun = await getLatestMissionRun();
  return latestRun?.projectId ?? null;
}

export interface LastCycleResult {
  type: "LAST_CYCLE";
  hasData: boolean;
  target: string | null;
  status: string | null;
  createdAt: string | null;
  agentCount: number;
  findingsCount: number;
  recommendationsCount: number;
}

export interface RecurringFindingItem {
  targetUrl: string;
  targetName?: string;
  finding: string;
  latestStatus: string;
  occurrences: number;
  classification: string | null;
  agentSlugs: string[];
}
export interface RecurringFindingsResult {
  type: "RECURRING_FINDINGS";
  items: RecurringFindingItem[];
}

export interface PendingRecommendationItem {
  id: string;
  title: string;
  summary: string;
  impact: string | null;
  confidence: string | null;
  origin: string;
  status: string;
}
export interface PendingRecommendationsResult {
  type: "PENDING_RECOMMENDATIONS";
  items: PendingRecommendationItem[];
}

export interface AgentActivityItem {
  slug: string;
  name: string;
  executionCount: number;
  missionParticipationCount: number;
  findingCount: number;
  classifications: string[];
  convergenceCount: number;
}
export interface AgentActivityResult {
  type: "AGENT_ACTIVITY";
  items: AgentActivityItem[];
}

export interface TeamArchitectRecommendationItem {
  type: string;
  title: string;
  summary: string;
  confidence: string;
  affectedAgents: string[];
  suggestedAction: string;
  limitations: string[];
}
export interface TeamArchitectInsufficientItem {
  area: string;
  observed: string;
  missing: string;
  reason: string;
}
export interface TeamArchitectResult {
  type: "TEAM_ARCHITECT";
  recommendations: TeamArchitectRecommendationItem[];
  insufficientEvidence: TeamArchitectInsufficientItem[];
}

// ── FASE 12 — action candidate identification ───────────────────────────
// Each of these identifies exactly the real, existing rows an action
// command could act on — never a new business rule. APPROVE/IGNORE reuse
// the same PENDING set GET_PENDING_RECOMMENDATIONS already reads.
// CREATE_IMPLEMENTATION/CREATE_VALIDATION reuse getTeamIntelligence()'s own
// evidenceGaps (10C) — built for a different purpose (describing gaps) but
// exactly the same real data this phase needs (which Recommendations are
// APPROVED without an Implementation; which Implementations have no
// Validation yet) — never a second "find eligible rows" query.

export interface RecommendationCandidate {
  id: string;
  title: string;
  summary: string;
  impact: string | null;
  confidence: string | null;
}

export interface ImplementationCandidate {
  recommendationId: string;
  title: string;
  summary: string;
  impact: string | null;
  confidence: string | null;
}

export interface ValidationCandidate {
  implementationId: string;
  recommendationId: string;
  recommendationTitle: string;
  implementationSummary: string | null;
}

export interface ApproveRecommendationCandidatesResult {
  type: "ACTION_CANDIDATES";
  action: "APPROVE_RECOMMENDATION";
  candidates: RecommendationCandidate[];
}
export interface IgnoreRecommendationCandidatesResult {
  type: "ACTION_CANDIDATES";
  action: "IGNORE_RECOMMENDATION";
  candidates: RecommendationCandidate[];
}
export interface CreateImplementationCandidatesResult {
  type: "ACTION_CANDIDATES";
  action: "CREATE_IMPLEMENTATION";
  candidates: ImplementationCandidate[];
}
export interface CreateValidationCandidatesResult {
  type: "ACTION_CANDIDATES";
  action: "CREATE_VALIDATION";
  candidates: ValidationCandidate[];
}

/** FASE 18 — the real gap FASE 17 found: closes it, never a new persisted status beyond what ImplementationStatus already models. */
export interface CompleteImplementationCandidate {
  implementationId: string;
  recommendationId: string;
  title: string;
  summary: string | null;
  status: string;
}
export interface CompleteImplementationCandidatesResult {
  type: "ACTION_CANDIDATES";
  action: "COMPLETE_IMPLEMENTATION";
  candidates: CompleteImplementationCandidate[];
}

/** FASE 18 — the other real gap FASE 17 found: a Validation created through the QG could never carry real retest evidence. RUN_RETEST's candidates are real Implementations that are COMPLETED but either have no Validation yet, or have one still PENDING with no retest reference (evidenceGaps.implementationsWithoutValidation / validationsWithoutRetestReference — both already existed). */
export interface RetestCandidate {
  implementationId: string;
  recommendationId: string;
  recommendationTitle: string;
  implementationSummary: string | null;
}
export interface RunRetestCandidatesResult {
  type: "ACTION_CANDIDATES";
  action: "RUN_RETEST";
  candidates: RetestCandidate[];
}

export type QgCommandResult =
  | LastCycleResult
  | RecurringFindingsResult
  | PendingRecommendationsResult
  | AgentActivityResult
  | TeamArchitectResult
  | ApproveRecommendationCandidatesResult
  | IgnoreRecommendationCandidatesResult
  | CreateImplementationCandidatesResult
  | CompleteImplementationCandidatesResult
  | RunRetestCandidatesResult
  | CreateValidationCandidatesResult
  | { type: "NO_ACTIVE_PROJECT" };

export async function getLastCycle(): Promise<LastCycleResult> {
  const latestRun = await getLatestMissionRun();
  if (!latestRun) {
    return { type: "LAST_CYCLE", hasData: false, target: null, status: null, createdAt: null, agentCount: 0, findingsCount: 0, recommendationsCount: 0 };
  }

  const input = latestRun.input as unknown as EvaluationMissionInput;
  const report = latestRun.report as unknown as FinalEvaluationReport | null;
  const recommendations = await listRecommendationsForRun(latestRun.id);

  return {
    type: "LAST_CYCLE",
    hasData: true,
    target: input.target.name ?? input.target.url,
    status: latestRun.status,
    createdAt: latestRun.createdAt.toISOString(),
    agentCount: input.requestedAgents.length,
    findingsCount: report?.findings.length ?? 0,
    recommendationsCount: recommendations.length,
  };
}

/**
 * getFindingHistory() (10B.2) deliberately doesn't carry classification or
 * source-agent detail — that's by design (see finding-history.ts's own
 * FindingTimeline shape). The one additional, batched, project-scoped
 * query below (mirroring the exact same pattern src/services/team-
 * intelligence.ts already uses for the same reason) supplies just that
 * missing enrichment — never a second finding-comparison implementation.
 */
export async function getRecurringFindings(projectId: string): Promise<RecurringFindingsResult> {
  const histories = await getFindingHistory(projectId);

  const missionRunRows = await db.evaluationMissionRun.findMany({
    where: { projectId, status: "COMPLETED" },
    select: { report: true },
  });

  const detailByFinding = new Map<string, { classification: string | null; agentSlugs: string[] }>();
  for (const row of missionRunRows) {
    const report = row.report as unknown as FinalEvaluationReport | null;
    if (!report) continue;
    for (const finding of report.findings) {
      if (detailByFinding.has(finding.finding)) continue;
      const classification = finding.sources.find((s) => s.classification)?.classification ?? null;
      detailByFinding.set(finding.finding, { classification, agentSlugs: finding.sources.map((s) => s.agentId) });
    }
  }

  const items: RecurringFindingItem[] = [];
  for (const history of histories) {
    for (const timeline of history.timelines) {
      const recurred = timeline.points.some((point) => point.status === "PERSISTENT" || point.status === "REAPPEARED");
      if (!recurred) continue;
      const detail = detailByFinding.get(timeline.finding);
      items.push({
        targetUrl: history.target.url,
        targetName: history.target.name,
        finding: timeline.finding,
        latestStatus: timeline.points[timeline.points.length - 1]?.status ?? "FIRST_OBSERVED",
        occurrences: timeline.points.filter((point) => point.present).length,
        classification: detail?.classification ?? null,
        agentSlugs: detail?.agentSlugs ?? [],
      });
    }
  }

  return { type: "RECURRING_FINDINGS", items };
}

/**
 * listRecommendations() has no projectId parameter at all — a pre-existing
 * characteristic of that service (see FASE 10A's audit), not something
 * this phase introduces or fixes. Used exactly as it already exists.
 */
export async function getPendingRecommendations(): Promise<PendingRecommendationsResult> {
  const recommendations = await listRecommendations("PENDING");
  const items: PendingRecommendationItem[] = recommendations.map((recommendation) => {
    const input = recommendation.missionRun.input as unknown as EvaluationMissionInput;
    return {
      id: recommendation.id,
      title: recommendation.title,
      summary: recommendation.summary,
      impact: recommendation.impact,
      confidence: recommendation.confidence,
      origin: input.target.name ?? input.target.url,
      status: recommendation.status,
    };
  });
  return { type: "PENDING_RECOMMENDATIONS", items };
}

export async function getAgentActivityResult(projectId: string): Promise<AgentActivityResult> {
  const summaries = await getAgentIntelligence(projectId);
  const items: AgentActivityItem[] = summaries.map((summary) => ({
    slug: summary.slug,
    name: summary.name,
    executionCount: summary.executionCount,
    missionParticipationCount: summary.missionParticipationCount,
    findingCount: summary.findingCount,
    classifications: Object.keys(summary.classificationCounts),
    convergenceCount: summary.convergenceCount,
  }));
  return { type: "AGENT_ACTIVITY", items };
}

export async function getTeamArchitectResult(projectId: string): Promise<TeamArchitectResult> {
  const report = await getTeamArchitectReport(projectId);
  return {
    type: "TEAM_ARCHITECT",
    recommendations: report.recommendations.map((recommendation) => ({
      type: recommendation.type,
      title: recommendation.title,
      summary: recommendation.summary,
      confidence: recommendation.confidence,
      affectedAgents: recommendation.affectedAgents,
      suggestedAction: recommendation.suggestedAction,
      limitations: recommendation.limitations,
    })),
    insufficientEvidence: report.insufficientEvidence.map((entry) => ({
      area: entry.area,
      observed: entry.observed,
      missing: entry.missing,
      reason: entry.reason,
    })),
  };
}

/** APPROVE_RECOMMENDATION and IGNORE_RECOMMENDATION share the exact same candidate set — every PENDING Recommendation — since both are only ever valid starting from PENDING (setRecommendationStatus's own existing rule, never re-implemented here). */
export async function getApproveOrIgnoreCandidates(): Promise<RecommendationCandidate[]> {
  const recommendations = await listRecommendations("PENDING");
  return recommendations.map((recommendation) => ({
    id: recommendation.id,
    title: recommendation.title,
    summary: recommendation.summary,
    impact: recommendation.impact,
    confidence: recommendation.confidence,
  }));
}

export async function getCreateImplementationCandidates(projectId: string): Promise<ImplementationCandidate[]> {
  const teamIntelligence = await getTeamIntelligence(projectId);
  const recommendations = await Promise.all(
    teamIntelligence.evidenceGaps.approvedRecommendationsWithoutImplementation.map((gap) => getRecommendation(gap.recommendationId)),
  );
  return recommendations
    .filter((recommendation): recommendation is NonNullable<typeof recommendation> => recommendation !== null)
    .map((recommendation) => ({
      recommendationId: recommendation.id,
      title: recommendation.title,
      summary: recommendation.summary,
      impact: recommendation.impact,
      confidence: recommendation.confidence,
    }));
}

export async function getCreateValidationCandidates(projectId: string): Promise<ValidationCandidate[]> {
  const teamIntelligence = await getTeamIntelligence(projectId);
  const candidates = await Promise.all(
    teamIntelligence.evidenceGaps.implementationsWithoutValidation.map(async (gap) => {
      const [recommendation, implementation] = await Promise.all([getRecommendation(gap.recommendationId), getImplementation(gap.implementationId)]);
      if (!recommendation || !implementation) return null;
      return {
        implementationId: implementation.id,
        recommendationId: recommendation.id,
        recommendationTitle: recommendation.title,
        implementationSummary: implementation.summary,
      };
    }),
  );
  return candidates.filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
}

/** FASE 18 — candidates for COMPLETE_IMPLEMENTATION: real Implementations still PENDING/IN_PROGRESS, scoped to the project the same way every other candidate list here already is. */
export async function getCompleteImplementationCandidates(projectId: string): Promise<CompleteImplementationCandidate[]> {
  const implementations = await listImplementationsAwaitingCompletion(projectId);
  return implementations.map((implementation) => ({
    implementationId: implementation.id,
    recommendationId: implementation.recommendationId,
    title: implementation.recommendation.title,
    summary: implementation.summary,
    status: implementation.status,
  }));
}

/**
 * FASE 18 — candidates for RUN_RETEST: a real, COMPLETED Implementation that
 * still has no retest-backed evidence — either no Validation at all
 * (evidenceGaps.implementationsWithoutValidation) or one still PENDING with
 * no retest reference (evidenceGaps.validationsWithoutRetestReference) —
 * both signals already existed (team-intelligence.ts). Deduplicated by
 * implementationId since the same Implementation could, in principle,
 * appear in both lists.
 */
export async function getRunRetestCandidates(projectId: string): Promise<RetestCandidate[]> {
  const teamIntelligence = await getTeamIntelligence(projectId);
  const implementationIds = new Set([
    ...teamIntelligence.evidenceGaps.implementationsWithoutValidation.map((gap) => gap.implementationId),
    ...teamIntelligence.evidenceGaps.validationsWithoutRetestReference.map((gap) => gap.implementationId),
  ]);

  const candidates = await Promise.all(
    Array.from(implementationIds).map(async (implementationId) => {
      const implementation = await getImplementation(implementationId);
      if (!implementation || implementation.status !== "COMPLETED") return null;
      const recommendation = await getRecommendation(implementation.recommendationId);
      if (!recommendation) return null;
      return {
        implementationId: implementation.id,
        recommendationId: recommendation.id,
        recommendationTitle: recommendation.title,
        implementationSummary: implementation.summary,
      };
    }),
  );
  return candidates.filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
}

/**
 * The one entry point the Server Action (src/app/qg/qg-command-actions.ts)
 * calls. GET_LAST_CYCLE never needs a resolved projectId (it already reads
 * the single most recent mission regardless); every other command does,
 * and gets a clean NO_ACTIVE_PROJECT result instead of an error when none
 * can be resolved (an empty LAB, not a failure). The four FASE 12 action
 * commands only ever IDENTIFY candidates here — never alter anything; the
 * actual state change happens exclusively in qg-action-executor.ts, only
 * after an explicit human confirmation in the UI.
 */
export async function executeQgCommand(commandId: QgCommandId): Promise<QgCommandResult> {
  if (commandId === "GET_LAST_CYCLE") return getLastCycle();

  const projectId = await resolveActiveProjectId();
  if (!projectId) return { type: "NO_ACTIVE_PROJECT" };

  switch (commandId) {
    case "GET_RECURRING_FINDINGS":
      return getRecurringFindings(projectId);
    case "GET_PENDING_RECOMMENDATIONS":
      return getPendingRecommendations();
    case "GET_AGENT_ACTIVITY":
      return getAgentActivityResult(projectId);
    case "GET_TEAM_ARCHITECT":
      return getTeamArchitectResult(projectId);
    case "APPROVE_RECOMMENDATION":
      return { type: "ACTION_CANDIDATES", action: "APPROVE_RECOMMENDATION", candidates: await getApproveOrIgnoreCandidates() };
    case "IGNORE_RECOMMENDATION":
      return { type: "ACTION_CANDIDATES", action: "IGNORE_RECOMMENDATION", candidates: await getApproveOrIgnoreCandidates() };
    case "CREATE_IMPLEMENTATION":
      return { type: "ACTION_CANDIDATES", action: "CREATE_IMPLEMENTATION", candidates: await getCreateImplementationCandidates(projectId) };
    case "CREATE_VALIDATION":
      return { type: "ACTION_CANDIDATES", action: "CREATE_VALIDATION", candidates: await getCreateValidationCandidates(projectId) };
    case "COMPLETE_IMPLEMENTATION":
      return { type: "ACTION_CANDIDATES", action: "COMPLETE_IMPLEMENTATION", candidates: await getCompleteImplementationCandidates(projectId) };
    case "RUN_RETEST":
      return { type: "ACTION_CANDIDATES", action: "RUN_RETEST", candidates: await getRunRetestCandidates(projectId) };
  }
}
