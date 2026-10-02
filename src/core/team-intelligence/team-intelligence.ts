import type { AgentCategory } from "@agents/system/agent-protocol";
import { FINDING_CLASSIFICATIONS, type FindingClassification } from "@/domain/agent-output";
import type { EvaluationTarget } from "@/domain/evaluation-mission";
import type { ConsolidatedFinding } from "@/core/findings/mission-evaluation-report";
import type { TargetFindingHistory } from "@/core/findings/finding-history";
import type { AgentActivitySummary } from "@/core/agent-intelligence/agent-activity";

/**
 * FASE 10C — Team Intelligence.
 *
 * Pure, deterministic composition of what the LAB already knows about its
 * agents (10B.1), its findings' history (10B.2), and the Recommendation →
 * Implementation → Validation cycle (10B.3) into one team-wide, read-only
 * picture. No database access, no Prisma types, no new comparison logic:
 * every non-trivial computation here (finding equivalence, history status,
 * per-agent counts) is already done by those existing modules — this file
 * only reshapes and cross-references their outputs.
 *
 * Team Intelligence describes observed behavior. It never scores, ranks, or
 * judges an agent — see the deliberate absence of any "best/worst",
 * "efficiency", or "quality" field anywhere below. That interpretation is
 * FASE 10D — Team Architect's job, not this one.
 */

// Re-declared as plain literal unions, not imported from the generated
// Prisma client, so this module stays free of any Prisma dependency — same
// discipline as core/agent-intelligence/agent-activity.ts and
// core/findings/finding-history.ts.
export type TeamRecommendationStatus = "PENDING" | "APPROVED" | "IGNORED";
export type TeamImplementationStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED";
export type TeamValidationStatus = "PENDING" | "PASSED" | "FAILED" | "INCONCLUSIVE";

/** AgentActivitySummary (10B.1) plus the one operational fact it deliberately excludes — whether the agent is currently enabled — needed here for Team Activity's "enabled" count. */
export interface TeamIntelligenceAgentInput extends AgentActivitySummary {
  enabled: boolean;
}

/** The minimal, Prisma-free shape this module needs from an already-loaded, COMPLETED EvaluationMissionRun — used only for convergence and team-wide classification/finding-index bookkeeping that AgentActivitySummary/TargetFindingHistory don't carry. */
export interface TeamIntelligenceMissionRunInput {
  id: string;
  target: EvaluationTarget;
  /** Exactly `FinalEvaluationReport.findings` for this run. */
  findings: ConsolidatedFinding[];
}

export interface TeamIntelligenceValidationInput {
  id: string;
  status: TeamValidationStatus;
  retestMissionRunId: string | null;
  retestTestRunId: string | null;
}

export interface TeamIntelligenceImplementationInput {
  id: string;
  status: TeamImplementationStatus;
  validations: TeamIntelligenceValidationInput[];
}

export interface TeamIntelligenceRecommendationInput {
  id: string;
  missionRunId: string;
  findingIndex: number;
  status: TeamRecommendationStatus;
  /** Null when this Recommendation has no Implementation yet — a valid state (see FASE 10B.3). */
  implementation: TeamIntelligenceImplementationInput | null;
}

// ── Output ────────────────────────────────────────────────────────────────

export interface TeamActivityPerAgent {
  agentId: string;
  slug: string;
  name: string;
  category: AgentCategory;
  executionCount: number;
  missionParticipationCount: number;
  firstExecutionAt: Date | null;
  lastExecutionAt: Date | null;
}

/** Team Activity — how the team is being used. Never a ranking: perAgent is in the same order agents were given (AgentRegistry's own alphabetical order), never sorted by any count. */
export interface TeamActivitySummary {
  totalAgents: number;
  enabledAgents: number;
  /** Agents with at least one AgentExecution — "used", not "good". */
  activeAgents: number;
  perAgent: TeamActivityPerAgent[];
}

/** One agent's observed participation. `participated`/`producedFinding`/`producedNoFinding` are independent facts — a low producedFinding count is never treated as "didn't participate" (FASE 10C's explicit rule). */
export interface TeamCoverageEntry {
  agentId: string;
  slug: string;
  name: string;
  participated: boolean;
  producedFinding: boolean;
  producedNoFinding: boolean;
  classifications: FindingClassification[];
}

export interface FindingPatternsTargetSummary {
  url: string;
  name?: string;
  /** Distinct findings ever observed for this target within the comparison window. */
  totalFindings: number;
  /** Counts below are each finding's MOST RECENT status in its own timeline — the current picture, not every historical transition (see finding-history.ts for the full transition-by-transition record). */
  firstObserved: number;
  persistent: number;
  new: number;
  reappeared: number;
  notReproduced: number;
}

export interface FindingPatternsSummary {
  targets: FindingPatternsTargetSummary[];
  /** Every classification actually observed across the whole project's findings — a purely descriptive list, never a severity ranking. */
  classificationsObserved: FindingClassification[];
}

/** One agent's observed association with problem types — cobertura observada, never "especialização formal" (FASE 10C's explicit rule). */
export interface AgentProblemCoverageEntry {
  agentId: string;
  slug: string;
  name: string;
  classifications: FindingClassification[];
}

/** One ConsolidatedFinding that 2+ agents independently reported — never a score, never "which agent was right". */
export interface ConvergenceEntry {
  missionRunId: string;
  targetUrl: string;
  targetName?: string;
  finding: string;
  agentIds: string[];
  classifications: FindingClassification[];
}

export interface RecommendationLifecycleSummary {
  totalRecommendations: number;
  byStatus: Record<TeamRecommendationStatus, number>;
  withImplementation: number;
  withoutImplementation: number;
  implementationsByStatus: Record<TeamImplementationStatus, number>;
  /** Implementations with at least one Validation. */
  withValidation: number;
  /** Implementations with zero Validations. */
  withoutValidation: number;
  validationsByStatus: Record<TeamValidationStatus, number>;
}

export interface EvidenceGapsSummary {
  agentsWithoutActivity: { agentId: string; slug: string; name: string }[];
  findingsWithoutRecommendation: { missionRunId: string; findingIndex: number; finding: string }[];
  approvedRecommendationsWithoutImplementation: { recommendationId: string }[];
  implementationsWithoutValidation: { implementationId: string; recommendationId: string }[];
  validationsWithoutRetestReference: { validationId: string; implementationId: string }[];
  /** From the domain's own fixed FINDING_CLASSIFICATIONS list — never invented — minus whatever findingPatterns.classificationsObserved actually contains. */
  classificationsNeverObserved: FindingClassification[];
}

export interface TeamIntelligenceSummary {
  activity: TeamActivitySummary;
  coverage: TeamCoverageEntry[];
  findingPatterns: FindingPatternsSummary;
  agentProblemCoverage: AgentProblemCoverageEntry[];
  convergence: ConvergenceEntry[];
  recommendationLifecycle: RecommendationLifecycleSummary;
  evidenceGaps: EvidenceGapsSummary;
}

// ── Block builders (small, pure, individually reasoned about) ──────────────

function buildActivity(agents: TeamIntelligenceAgentInput[]): TeamActivitySummary {
  return {
    totalAgents: agents.length,
    enabledAgents: agents.filter((agent) => agent.enabled).length,
    activeAgents: agents.filter((agent) => agent.executionCount > 0).length,
    perAgent: agents.map((agent) => ({
      agentId: agent.agentId,
      slug: agent.slug,
      name: agent.name,
      category: agent.category,
      executionCount: agent.executionCount,
      missionParticipationCount: agent.missionParticipationCount,
      firstExecutionAt: agent.firstExecutionAt,
      lastExecutionAt: agent.lastExecutionAt,
    })),
  };
}

function buildCoverage(agents: TeamIntelligenceAgentInput[]): TeamCoverageEntry[] {
  return agents.map((agent) => ({
    agentId: agent.agentId,
    slug: agent.slug,
    name: agent.name,
    participated: agent.missionParticipationCount > 0,
    producedFinding: agent.statusCounts.FINDING > 0,
    producedNoFinding: agent.statusCounts.NO_FINDING > 0,
    classifications: Object.keys(agent.classificationCounts) as FindingClassification[],
  }));
}

function observedClassifications(missionRuns: TeamIntelligenceMissionRunInput[]): FindingClassification[] {
  const set = new Set<FindingClassification>();
  for (const run of missionRuns) {
    for (const finding of run.findings) {
      for (const source of finding.sources) {
        if (source.classification) set.add(source.classification);
      }
    }
  }
  return Array.from(set);
}

function buildFindingPatterns(findingHistories: TargetFindingHistory[], missionRuns: TeamIntelligenceMissionRunInput[]): FindingPatternsSummary {
  const targets = findingHistories.map((history) => {
    const counts = { firstObserved: 0, persistent: 0, new: 0, reappeared: 0, notReproduced: 0 };
    for (const timeline of history.timelines) {
      const latest = timeline.points[timeline.points.length - 1];
      if (!latest) continue;
      switch (latest.status) {
        case "FIRST_OBSERVED":
          counts.firstObserved++;
          break;
        case "PERSISTENT":
          counts.persistent++;
          break;
        case "NEW":
          counts.new++;
          break;
        case "REAPPEARED":
          counts.reappeared++;
          break;
        case "NOT_REPRODUCED":
          counts.notReproduced++;
          break;
      }
    }
    return { url: history.target.url, name: history.target.name, totalFindings: history.timelines.length, ...counts };
  });

  return { targets, classificationsObserved: observedClassifications(missionRuns) };
}

function buildAgentProblemCoverage(agents: TeamIntelligenceAgentInput[]): AgentProblemCoverageEntry[] {
  return agents.map((agent) => ({
    agentId: agent.agentId,
    slug: agent.slug,
    name: agent.name,
    classifications: Object.keys(agent.classificationCounts) as FindingClassification[],
  }));
}

function buildConvergence(missionRuns: TeamIntelligenceMissionRunInput[]): ConvergenceEntry[] {
  const entries: ConvergenceEntry[] = [];
  for (const run of missionRuns) {
    for (const finding of run.findings) {
      if (!finding.duplicated) continue;
      const agentIds = Array.from(new Set(finding.sources.map((source) => source.agentId)));
      const classifications = Array.from(
        new Set(finding.sources.map((source) => source.classification).filter((c): c is FindingClassification => c !== null)),
      );
      entries.push({ missionRunId: run.id, targetUrl: run.target.url, targetName: run.target.name, finding: finding.finding, agentIds, classifications });
    }
  }
  return entries;
}

function buildRecommendationLifecycle(recommendations: TeamIntelligenceRecommendationInput[]): RecommendationLifecycleSummary {
  const byStatus: Record<TeamRecommendationStatus, number> = { PENDING: 0, APPROVED: 0, IGNORED: 0 };
  const implementationsByStatus: Record<TeamImplementationStatus, number> = { PENDING: 0, IN_PROGRESS: 0, COMPLETED: 0 };
  const validationsByStatus: Record<TeamValidationStatus, number> = { PENDING: 0, PASSED: 0, FAILED: 0, INCONCLUSIVE: 0 };
  let withImplementation = 0;
  let withValidation = 0;

  for (const recommendation of recommendations) {
    byStatus[recommendation.status] += 1;
    if (recommendation.implementation) {
      withImplementation += 1;
      implementationsByStatus[recommendation.implementation.status] += 1;
      if (recommendation.implementation.validations.length > 0) withValidation += 1;
      for (const validation of recommendation.implementation.validations) {
        validationsByStatus[validation.status] += 1;
      }
    }
  }

  return {
    totalRecommendations: recommendations.length,
    byStatus,
    withImplementation,
    withoutImplementation: recommendations.length - withImplementation,
    implementationsByStatus,
    withValidation,
    withoutValidation: withImplementation - withValidation,
    validationsByStatus,
  };
}

function buildEvidenceGaps(
  agents: TeamIntelligenceAgentInput[],
  missionRuns: TeamIntelligenceMissionRunInput[],
  recommendations: TeamIntelligenceRecommendationInput[],
  classificationsObserved: FindingClassification[],
): EvidenceGapsSummary {
  const agentsWithoutActivity = agents
    .filter((agent) => agent.executionCount === 0)
    .map((agent) => ({ agentId: agent.agentId, slug: agent.slug, name: agent.name }));

  const recommendationKeys = new Set(recommendations.map((r) => `${r.missionRunId}:${r.findingIndex}`));
  const findingsWithoutRecommendation: EvidenceGapsSummary["findingsWithoutRecommendation"] = [];
  for (const run of missionRuns) {
    run.findings.forEach((finding, findingIndex) => {
      if (!recommendationKeys.has(`${run.id}:${findingIndex}`)) {
        findingsWithoutRecommendation.push({ missionRunId: run.id, findingIndex, finding: finding.finding });
      }
    });
  }

  const approvedRecommendationsWithoutImplementation = recommendations
    .filter((r) => r.status === "APPROVED" && !r.implementation)
    .map((r) => ({ recommendationId: r.id }));

  const implementationsWithoutValidation = recommendations
    .filter((r) => r.implementation && r.implementation.validations.length === 0)
    .map((r) => ({ implementationId: r.implementation!.id, recommendationId: r.id }));

  const validationsWithoutRetestReference = recommendations.flatMap((r) =>
    (r.implementation?.validations ?? [])
      .filter((v) => !v.retestMissionRunId && !v.retestTestRunId)
      .map((v) => ({ validationId: v.id, implementationId: r.implementation!.id })),
  );

  const classificationsNeverObserved = FINDING_CLASSIFICATIONS.filter((c) => !classificationsObserved.includes(c));

  return {
    agentsWithoutActivity,
    findingsWithoutRecommendation,
    approvedRecommendationsWithoutImplementation,
    implementationsWithoutValidation,
    validationsWithoutRetestReference,
    classificationsNeverObserved,
  };
}

/**
 * The one entry point. Pure, synchronous, in-memory. Every input is already
 * loaded and already scoped to a single project by the caller (see
 * getTeamIntelligence in src/services/team-intelligence.ts) — this function
 * never filters by projectId itself and never re-derives anything
 * AgentActivitySummary/TargetFindingHistory already computed.
 */
export function buildTeamIntelligence(
  agents: TeamIntelligenceAgentInput[],
  findingHistories: TargetFindingHistory[],
  missionRuns: TeamIntelligenceMissionRunInput[],
  recommendations: TeamIntelligenceRecommendationInput[],
): TeamIntelligenceSummary {
  const findingPatterns = buildFindingPatterns(findingHistories, missionRuns);

  return {
    activity: buildActivity(agents),
    coverage: buildCoverage(agents),
    findingPatterns,
    agentProblemCoverage: buildAgentProblemCoverage(agents),
    convergence: buildConvergence(missionRuns),
    recommendationLifecycle: buildRecommendationLifecycle(recommendations),
    evidenceGaps: buildEvidenceGaps(agents, missionRuns, recommendations, findingPatterns.classificationsObserved),
  };
}
