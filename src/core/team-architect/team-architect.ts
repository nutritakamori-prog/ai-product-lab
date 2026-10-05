import type { AgentCategory } from "@agents/system/agent-protocol";
import { CONFIDENCE_LEVELS, type FindingClassification } from "@/domain/agent-output";
import type { AgentActivitySummary } from "@/core/agent-intelligence/agent-activity";
import type { TeamIntelligenceSummary } from "@/core/team-intelligence/team-intelligence";

/**
 * FASE 10D — Team Architect.
 *
 * Pure, deterministic, rule-based reasoning over Team Intelligence's own
 * output (FASE 10C) plus the small amount of additional per-agent evidence
 * Team Intelligence deliberately doesn't carry (exact classification
 * counts, and the agent's own declared responsibilities/whenNotToCall —
 * see TeamArchitectAgentInput below). No database access, no Prisma types,
 * no LLM call, no new comparison logic: every count/list this module reads
 * was already computed by Agent Intelligence (10B.1) or Team Intelligence
 * (10C) — this file only interprets it.
 *
 * Team Intelligence answers "what do the data show?". This module answers
 * "given that, what changes to the team's architecture are worth a human
 * considering?" — it NEVER answers "what change will be made": every
 * output here is a recommendation or an explicit admission that the
 * evidence isn't strong enough yet, never an executed action. There is no
 * function anywhere in this phase that creates, disables, removes, or
 * modifies an agent — see src/services/team-architect.ts's own doc comment
 * for the same guarantee at the service boundary.
 */

// ── Thresholds ───────────────────────────────────────────────────────────
// Every threshold below exists to stop a single anecdotal event (one finding,
// one shared mission) from producing an architectural recommendation — see
// each constant's own comment for what it specifically protects against.
// Chosen as the smallest number that distinguishes "happened once" from
// "happened again, independently" — never tuned against this project's own
// current dataset size (see team-architect.test.ts for small, synthetic
// fixtures proving each threshold's edge, not real production data).

/**
 * Minimum number of distinct occurrences before a repeated pattern counts as
 * "recurring" rather than a single/anecdotal event. Below this, the
 * Architect reports INSUFFICIENT_EVIDENCE instead of a recommendation.
 * Exported — FASE 12A's Team Intelligence Report reuses this exact bar
 * (never a second, independently-tuned number) as its own LOW/MEDIUM
 * confidence boundary, for the same reason it exists here: fewer than this
 * many missions is still anecdotal, not yet a real sample.
 */
export const RECURRENCE_MIN = 3;

/** Minimum number of INDEPENDENT convergence occurrences (the same agent group reporting equivalent findings more than once) before POSSIBLE_OVERLAP is proposed. A single shared finding is ordinary, healthy cross-checking, not a pattern — 2 is the smallest number that is no longer "once". */
const OVERLAP_MIN_OCCURRENCES = 2;

/**
 * The stricter bar ADD_AGENT must clear beyond a bare
 * POSSIBLE_MISSING_SPECIALIZATION. Proposing a brand-new agent is a bigger
 * step than flagging a gap, so it needs materially more recurrence before
 * even being considered as a recommendation rather than insufficient
 * evidence. Exported — reused by FASE 12A's Team Intelligence Report as its
 * own HIGH-confidence boundary: this is already the bar the codebase
 * considers "a genuinely rich sample", so the overall report's confidence
 * reuses it rather than inventing a second one.
 */
export const ADD_AGENT_MIN = 5;

/** Minimum number of distinct classifications one agent has real findings in before its coverage looks broad enough to even raise SPLIT_RESPONSIBILITY as a question worth asking (never a recommendation in this version — see buildSplitSignal). */
const SPLIT_CLASSIFICATION_SPAN_MIN = 4;

// ── Shared vocabulary ────────────────────────────────────────────────────

export const ARCHITECTURAL_RECOMMENDATION_TYPES = [
  "COVERAGE_GAP",
  "POSSIBLE_OVERLAP",
  "POSSIBLE_MISSING_SPECIALIZATION",
  "UNDERUSED_SPECIALIZATION",
  "ADJUST_RESPONSIBILITY",
  "ADD_AGENT",
  "REMOVE_AGENT",
  "DISABLE_AGENT",
  "MERGE_RESPONSIBILITIES",
  "SPLIT_RESPONSIBILITY",
] as const;
export type ArchitecturalRecommendationType = (typeof ARCHITECTURAL_RECOMMENDATION_TYPES)[number];

/** Reused as-is from domain/agent-output.ts — the same discrete scale every agent's own output already uses, never a new numeric score. Represents confidence in the EVIDENCE (how certain the underlying counts/patterns are), never a judgment of the agent's quality. */
export type ArchitecturalConfidence = (typeof CONFIDENCE_LEVELS)[number];

export interface RecommendationEvidence {
  /** A plain factual statement — never an interpretation (see ArchitecturalRecommendation.rationale for that). */
  description: string;
  missionRunIds?: string[];
  findings?: string[];
  agentSlugs?: string[];
  classifications?: FindingClassification[];
  count?: number;
}

/**
 * Evidence / Interpretation / Recommendation, kept as three distinct
 * fields, never blended into one paragraph (FASE 10D §7):
 *   - Evidence: `summary` (prose) + `evidence[]` (structured, traceable facts)
 *   - Interpretation: `rationale` (what the evidence may mean — "may",
 *     never "does")
 *   - Recommendation: `suggestedAction` (what a human might consider doing)
 */
export interface ArchitecturalRecommendation {
  /** Deterministic — derived from type + the specific agents/classifications involved, never random, so the same evidence always produces the same id. */
  id: string;
  type: ArchitecturalRecommendationType;
  title: string;
  summary: string;
  confidence: ArchitecturalConfidence;
  evidence: RecommendationEvidence[];
  affectedAgents: string[];
  affectedCategories: FindingClassification[];
  suggestedAction: string;
  rationale: string;
  limitations: string[];
}

/**
 * The mandatory alternative to a recommendation (FASE 10D §8) — never a
 * silently skipped check. Every area the Architect considered but could
 * not reach a recommendation for (not enough recurrence, or the action is
 * deliberately never auto-recommended in this version — see REMOVE_AGENT/
 * MERGE_RESPONSIBILITIES/SPLIT_RESPONSIBILITY below) produces one of these
 * instead of silence.
 */
export interface InsufficientEvidenceEntry {
  area: ArchitecturalRecommendationType;
  observed: string;
  missing: string;
  reason: string;
}

export interface TeamArchitectReport {
  recommendations: ArchitecturalRecommendation[];
  insufficientEvidence: InsufficientEvidenceEntry[];
}

/** AgentActivitySummary (10B.1) plus the agent-definition facts Team Intelligence deliberately omits (enabled/responsibilities/whenNotToCall) — the one, explicitly-sanctioned step beyond consuming TeamIntelligenceSummary alone (see this module's own doc comment and src/services/team-architect.ts). */
export interface TeamArchitectAgentInput extends AgentActivitySummary {
  enabled: boolean;
  responsibilities: string[];
  whenNotToCall: string;
}

function makeId(type: ArchitecturalRecommendationType, parts: string[]): string {
  return `${type}:${parts.join("|")}`;
}

// ── A. Coverage gaps ─────────────────────────────────────────────────────
// Only the one sub-case the available data can answer with certainty: an
// ENABLED agent with zero recorded activity at all. "Classification
// observed with zero covering agents" (the other sub-case FASE 10D §3A
// names) is structurally impossible with the current pipeline — every
// FindingSource always carries both a classification and the agentId that
// reported it (see mission-evaluation-report.ts), so a classification can
// never appear in classificationsObserved without at least one agent
// already being credited for it. "Áreas do produto sem cobertura" is not
// computable at all: targets are bare URLs (EvaluationTarget), there is no
// structured product-area concept anywhere in the codebase to group them
// by (confirmed by audit) — reported as a limitation, never invented.
function buildCoverageGaps(agents: TeamArchitectAgentInput[]): { recommendations: ArchitecturalRecommendation[]; disabledEligible: TeamArchitectAgentInput[] } {
  const enabledInactive = agents.filter((agent) => agent.enabled && agent.executionCount === 0);
  const recommendations: ArchitecturalRecommendation[] = enabledInactive.map((agent) => ({
    id: makeId("COVERAGE_GAP", [agent.slug]),
    type: "COVERAGE_GAP",
    title: `"${agent.name}" is enabled but has no recorded activity`,
    summary: `Agent "${agent.slug}" (${agent.category}) is enabled and has zero AgentExecution rows and zero Mission participation in this project.`,
    confidence: "HIGH",
    evidence: [{ description: "Zero AgentExecution rows and zero Mission participation for this agent in this project.", agentSlugs: [agent.slug], count: 0 }],
    affectedAgents: [agent.slug],
    affectedCategories: [],
    suggestedAction: "Consider whether this agent is actually being requested by Missions/tasks, or whether it should stay enabled.",
    rationale: "An enabled agent with no activity at all means either it's never being routed to, or the project hasn't yet exercised the area it covers — the data alone can't distinguish those two.",
    limitations: [
      "Does not know whether this agent was ever requested by a Mission that then failed before running it.",
      "A new project with little history will show this for most agents — absence of activity is not evidence of a problem by itself.",
    ],
  }));

  return { recommendations, disabledEligible: enabledInactive };
}

// ── B. Overlap ───────────────────────────────────────────────────────────
// Groups TeamIntelligence's own convergence entries by the exact set of
// agents involved — never recomputed from raw findings, never a second
// consolidation pass.
function buildOverlap(convergence: TeamIntelligenceSummary["convergence"]): ArchitecturalRecommendation[] {
  const groups = new Map<string, { agentIds: string[]; entries: typeof convergence }>();
  for (const entry of convergence) {
    const key = [...entry.agentIds].sort().join(",");
    const group = groups.get(key);
    if (group) group.entries.push(entry);
    else groups.set(key, { agentIds: entry.agentIds, entries: [entry] });
  }

  const recommendations: ArchitecturalRecommendation[] = [];
  for (const { agentIds, entries } of groups.values()) {
    if (entries.length < OVERLAP_MIN_OCCURRENCES) continue;
    const classifications = Array.from(new Set(entries.flatMap((e) => e.classifications)));
    recommendations.push({
      id: makeId("POSSIBLE_OVERLAP", [...agentIds].sort()),
      type: "POSSIBLE_OVERLAP",
      title: `Agents ${agentIds.join(" + ")} repeatedly converge on the same findings`,
      summary: `${agentIds.join(" and ")} independently reported an equivalent finding together ${entries.length} separate times.`,
      confidence: "MEDIUM",
      evidence: entries.map((e) => ({ description: e.finding, missionRunIds: [e.missionRunId], agentSlugs: e.agentIds, classifications: e.classifications })),
      affectedAgents: agentIds,
      affectedCategories: classifications,
      suggestedAction: "Consider whether this overlap is intentional cross-checking worth keeping, or whether these agents' responsibilities could be clarified to reduce duplicate coverage.",
      rationale: "Repeated convergence may mean deliberate, useful double-checking, or it may mean two agents' responsibilities aren't clearly separated — the evidence alone doesn't say which.",
      limitations: ["Convergence is never itself evidence that either agent is wrong, redundant, or lower quality than the other."],
    });
  }
  return recommendations;
}

// ── C. Missing specialization ───────────────────────────────────────────
// Reuses each agent's own classificationCounts (10B.1) to see, for every
// classification observed anywhere in the project, how concentrated its
// attribution is. A classification that recurs but where no single agent
// has ever reported it more than once looks like a recurring need nobody
// has really built repeat exposure to — not proof nobody COULD cover it.
function buildMissingSpecialization(
  agents: TeamArchitectAgentInput[],
  classificationsObserved: FindingClassification[],
): { recommendations: ArchitecturalRecommendation[]; insufficientEvidence: InsufficientEvidenceEntry[]; byClassification: Map<FindingClassification, { total: number; maxAgentCount: number; agentSlugs: string[] }> } {
  const recommendations: ArchitecturalRecommendation[] = [];
  const insufficientEvidence: InsufficientEvidenceEntry[] = [];
  const byClassification = new Map<FindingClassification, { total: number; maxAgentCount: number; agentSlugs: string[] }>();

  for (const classification of classificationsObserved) {
    const perAgentCounts = agents
      .map((agent) => ({ slug: agent.slug, count: agent.classificationCounts[classification] ?? 0 }))
      .filter((entry) => entry.count > 0);
    const total = perAgentCounts.reduce((sum, entry) => sum + entry.count, 0);
    const maxAgentCount = Math.max(0, ...perAgentCounts.map((entry) => entry.count));
    byClassification.set(classification, { total, maxAgentCount, agentSlugs: perAgentCounts.map((e) => e.slug) });

    if (total < RECURRENCE_MIN) {
      insufficientEvidence.push({
        area: "POSSIBLE_MISSING_SPECIALIZATION",
        observed: `Classification "${classification}" observed ${total} time(s) in total.`,
        missing: `At least ${RECURRENCE_MIN} occurrences before a recurring-need pattern can be distinguished from an anecdotal one.`,
        reason: "A single or near-single occurrence of a classification is not enough to tell a real recurring gap apart from a one-off event.",
      });
      continue;
    }

    // Scattered: every agent that ever reported this classification did so only once — no one has built real repeat exposure to it.
    if (maxAgentCount <= 1) {
      recommendations.push({
        id: makeId("POSSIBLE_MISSING_SPECIALIZATION", [classification]),
        type: "POSSIBLE_MISSING_SPECIALIZATION",
        title: `"${classification}" findings recur, but no agent consistently covers them`,
        summary: `"${classification}" appeared in ${total} findings, attributed across ${perAgentCounts.length} different agent(s), none of which reported it more than once.`,
        confidence: "MEDIUM",
        evidence: [{ description: `${total} total "${classification}" findings, max single-agent count ${maxAgentCount}.`, classifications: [classification], agentSlugs: perAgentCounts.map((e) => e.slug), count: total }],
        affectedAgents: perAgentCounts.map((e) => e.slug),
        affectedCategories: [classification],
        suggestedAction: "Consider whether a dedicated specialization for this classification would be worth evaluating.",
        rationale: "Recurrence without any agent building repeat exposure to a classification may indicate a gap in dedicated coverage — it may equally mean the issue is simply varied enough that no single agent naturally owns it.",
        limitations: ["Does not know whether any currently-disabled or not-yet-written agent already covers this on paper."],
      });
    }
  }

  return { recommendations, insufficientEvidence, byClassification };
}

// ── D. Underused specialization ─────────────────────────────────────────
// Deliberately narrow: only for the two agent categories whose name is
// ALSO a real FindingClassification value (ACCESSIBILITY, PERFORMANCE) —
// an exact, pre-existing correspondence between two independently-defined
// enums, never an invented mapping table. An agent in one of those
// categories that HAS run, but has zero findings of its own namesake
// classification, looks underused in its declared specialty.
function buildUnderusedSpecialization(agents: TeamArchitectAgentInput[]): ArchitecturalRecommendation[] {
  const SELF_NAMED_CATEGORIES: AgentCategory[] = ["ACCESSIBILITY", "PERFORMANCE"];

  return agents
    .filter((agent) => SELF_NAMED_CATEGORIES.includes(agent.category) && agent.executionCount > 0)
    .filter((agent) => (agent.classificationCounts[agent.category as FindingClassification] ?? 0) === 0)
    .map((agent) => ({
      id: makeId("UNDERUSED_SPECIALIZATION", [agent.slug]),
      type: "UNDERUSED_SPECIALIZATION" as const,
      title: `"${agent.name}" has run but never reported a ${agent.category} finding`,
      summary: `Agent "${agent.slug}" has ${agent.executionCount} execution(s) but zero findings classified as "${agent.category}" — its own declared category.`,
      confidence: "HIGH" as const,
      evidence: [{ description: `${agent.executionCount} execution(s), 0 findings classified "${agent.category}".`, agentSlugs: [agent.slug], classifications: [agent.category as FindingClassification], count: agent.executionCount }],
      affectedAgents: [agent.slug],
      affectedCategories: [agent.category as FindingClassification],
      suggestedAction: "Consider reviewing whether this agent's prompt/scope is reaching real issues in its own specialty, or whether that specialty is genuinely not a problem area for this project yet.",
      rationale: "Running without ever producing a finding in one's own named specialty does not mean the agent is failing — the area evaluated may genuinely have no issues of that kind yet.",
      limitations: ["Cannot distinguish 'the agent isn't finding real issues' from 'there are no real issues of this kind in what was evaluated'."],
    }));
}

// ── E. Agent evolution (ADJUST/ADD/REMOVE/DISABLE/MERGE/SPLIT) ──────────
// Every one of these is either a direct escalation of evidence already
// computed above, or — for the highest-stakes types (REMOVE_AGENT,
// MERGE_RESPONSIBILITIES, SPLIT_RESPONSIBILITY) — deliberately NEVER a
// real recommendation in this first, rule-based version: execution/finding
// history alone can never, by itself, justify an irreversible or
// highly interpretive structural change. Each still gets an explicit
// InsufficientEvidenceEntry whenever there is at least some relevant
// evidence to name, rather than silently producing nothing.

function buildAdjustResponsibility(underused: ArchitecturalRecommendation[]): ArchitecturalRecommendation[] {
  return underused.map((source) => ({
    id: makeId("ADJUST_RESPONSIBILITY", source.affectedAgents),
    type: "ADJUST_RESPONSIBILITY",
    title: `Consider reviewing responsibilities for ${source.affectedAgents.join(", ")}`,
    summary: source.summary,
    confidence: source.confidence,
    evidence: source.evidence,
    affectedAgents: source.affectedAgents,
    affectedCategories: source.affectedCategories,
    suggestedAction: "Consider reviewing this agent's declared responsibilities/whenNotToCall against what it has actually been evaluating.",
    rationale: source.rationale,
    limitations: source.limitations,
  }));
}

/**
 * Team Intelligence's own Recommendation→Implementation→Validation
 * lifecycle counts (10B.3/10C), surfaced as context evidence for
 * ADD_AGENT — the highest-stakes "grow the team" recommendation. Whether
 * the team is already acting on, implementing, and validating its
 * existing Recommendations is directly relevant to "does this gap need a
 * new agent, or is the existing pipeline simply backed up?" (FASE 10D §6:
 * "lifecycle das Recommendations; validações"). Never a new computation —
 * every count here is copied verbatim from teamIntelligence.recommendationLifecycle.
 */
function recommendationLifecycleEvidence(lifecycle: TeamIntelligenceSummary["recommendationLifecycle"]): RecommendationEvidence {
  return {
    description:
      `Team-wide Recommendation lifecycle: ${lifecycle.totalRecommendations} total ` +
      `(${lifecycle.byStatus.APPROVED} approved, ${lifecycle.byStatus.PENDING} pending, ${lifecycle.byStatus.IGNORED} ignored); ` +
      `${lifecycle.withImplementation} with an Implementation (${lifecycle.implementationsByStatus.COMPLETED} completed); ` +
      `${lifecycle.withValidation} with at least one Validation (${lifecycle.validationsByStatus.PASSED} passed, ` +
      `${lifecycle.validationsByStatus.FAILED} failed, ${lifecycle.validationsByStatus.INCONCLUSIVE} inconclusive).`,
    count: lifecycle.totalRecommendations,
  };
}

function buildAddAgent(
  missing: ArchitecturalRecommendation[],
  byClassification: Map<FindingClassification, { total: number }>,
  lifecycle: TeamIntelligenceSummary["recommendationLifecycle"],
): {
  recommendations: ArchitecturalRecommendation[];
  insufficientEvidence: InsufficientEvidenceEntry[];
} {
  const recommendations: ArchitecturalRecommendation[] = [];
  const insufficientEvidence: InsufficientEvidenceEntry[] = [];

  for (const source of missing) {
    const classification = source.affectedCategories[0];
    const total = classification ? byClassification.get(classification)?.total ?? 0 : 0;
    if (total >= ADD_AGENT_MIN) {
      recommendations.push({
        ...source,
        id: makeId("ADD_AGENT", source.affectedCategories),
        type: "ADD_AGENT",
        title: `Consider whether a dedicated agent for "${classification}" is worth evaluating`,
        evidence: [...source.evidence, recommendationLifecycleEvidence(lifecycle)],
        suggestedAction: "Consider whether a new, dedicated specialization is worth evaluating for this recurring, currently-uncovered need — this is a proposal only, no agent is created automatically.",
      });
    } else {
      insufficientEvidence.push({
        area: "ADD_AGENT",
        observed: source.summary,
        missing: `At least ${ADD_AGENT_MIN} total occurrences before proposing a new dedicated agent (currently ${total}).`,
        reason: "Adding an agent is a bigger step than flagging a gap — it needs materially more recurrence than a bare coverage/specialization gap before even being proposed.",
      });
    }
  }
  return { recommendations, insufficientEvidence };
}

function buildDisableAgent(enabledInactive: TeamArchitectAgentInput[], allAgents: TeamArchitectAgentInput[]): {
  recommendations: ArchitecturalRecommendation[];
  insufficientEvidence: InsufficientEvidenceEntry[];
} {
  const recommendations: ArchitecturalRecommendation[] = [];
  const insufficientEvidence: InsufficientEvidenceEntry[] = [];
  const projectHasRealActivity = allAgents.some((agent) => agent.executionCount > 0);

  for (const agent of enabledInactive) {
    if (projectHasRealActivity) {
      recommendations.push({
        id: makeId("DISABLE_AGENT", [agent.slug]),
        type: "DISABLE_AGENT",
        title: `Consider whether "${agent.name}" should stay enabled`,
        summary: `"${agent.slug}" has zero executions and zero Mission participation, while other agents in this project show real activity.`,
        confidence: "MEDIUM",
        evidence: [{ description: "Zero activity for this agent while other agents in the same project have real activity.", agentSlugs: [agent.slug], count: 0 }],
        affectedAgents: [agent.slug],
        affectedCategories: [],
        suggestedAction: "Consider disabling this agent (a reversible operational change, not a deletion) if it is confirmed to be unused by design.",
        rationale: "Inactivity alongside an otherwise-active project is weak evidence the agent isn't currently needed — but could equally mean it's simply never been routed to yet.",
        limitations: ["Disabling is never done automatically — this is a proposal for a human to confirm, and remains reversible if confirmed wrong."],
      });
    } else {
      insufficientEvidence.push({
        area: "DISABLE_AGENT",
        observed: `"${agent.slug}" has zero activity, but no agent in this project has any recorded activity yet.`,
        missing: "At least one other agent with real activity, to tell 'unused team-wide so far' apart from 'this agent specifically seems unneeded'.",
        reason: "A project with no activity at all for any agent gives no basis to single this one out.",
      });
    }
  }

  // REMOVE_AGENT: deliberately never a real recommendation in this version — see module doc comment.
  for (const agent of enabledInactive) {
    insufficientEvidence.push({
      area: "REMOVE_AGENT",
      observed: `"${agent.slug}" has zero activity in this project.`,
      missing: "No amount of execution/finding history can, by itself, justify deleting an agent's definition — that is an irreversible action this phase never recommends.",
      reason: "REMOVE_AGENT is deliberately never produced as a recommendation in this version; DISABLE_AGENT (reversible) is the strongest action this data can support.",
    });
  }

  return { recommendations, insufficientEvidence };
}

function buildMergeSignal(overlap: ArchitecturalRecommendation[]): InsufficientEvidenceEntry[] {
  return overlap.map((source) => ({
    area: "MERGE_RESPONSIBILITIES",
    observed: source.summary,
    missing: "Confirmation that the overlap is unintentional/wasteful rather than deliberate cross-checking, and a concrete sense of what a merged responsibility would look like.",
    reason: "MERGE_RESPONSIBILITIES is deliberately never produced as a recommendation in this version — repeated convergence alone cannot tell deliberate double-checking apart from true redundancy.",
  }));
}

function buildSplitSignal(agents: TeamArchitectAgentInput[]): InsufficientEvidenceEntry[] {
  return agents
    .filter((agent) => Object.keys(agent.classificationCounts).length >= SPLIT_CLASSIFICATION_SPAN_MIN)
    .map((agent) => ({
      area: "SPLIT_RESPONSIBILITY",
      observed: `"${agent.slug}" has real findings across ${Object.keys(agent.classificationCounts).length} different classifications: ${Object.keys(agent.classificationCounts).join(", ")}.`,
      missing: "A concrete proposal for how the responsibility would split, and evidence that the breadth is a problem rather than intended generalist coverage.",
      reason: "SPLIT_RESPONSIBILITY is deliberately never produced as a recommendation in this version — breadth of coverage alone is not evidence that a responsibility should be split.",
    }));
}

/**
 * The one entry point. Pure, synchronous, in-memory. `agents` and
 * `teamIntelligence` are expected to already be scoped to a single project
 * by the caller (see getTeamArchitectReport in src/services/team-
 * architect.ts) — this function never filters by projectId itself.
 */
export function buildTeamArchitectReport(teamIntelligence: TeamIntelligenceSummary, agents: TeamArchitectAgentInput[]): TeamArchitectReport {
  const { recommendations: coverageGapRecs, disabledEligible } = buildCoverageGaps(agents);
  const overlapRecs = buildOverlap(teamIntelligence.convergence);
  const { recommendations: missingSpecRecs, insufficientEvidence: missingSpecInsufficient, byClassification } = buildMissingSpecialization(
    agents,
    teamIntelligence.findingPatterns.classificationsObserved,
  );
  const underusedRecs = buildUnderusedSpecialization(agents);
  const adjustRecs = buildAdjustResponsibility(underusedRecs);
  const { recommendations: addAgentRecs, insufficientEvidence: addAgentInsufficient } = buildAddAgent(
    missingSpecRecs,
    byClassification,
    teamIntelligence.recommendationLifecycle,
  );
  const { recommendations: disableRecs, insufficientEvidence: disableInsufficient } = buildDisableAgent(disabledEligible, agents);
  const mergeInsufficient = buildMergeSignal(overlapRecs);
  const splitInsufficient = buildSplitSignal(agents);

  return {
    recommendations: [...coverageGapRecs, ...overlapRecs, ...missingSpecRecs, ...underusedRecs, ...adjustRecs, ...addAgentRecs, ...disableRecs],
    insufficientEvidence: [...missingSpecInsufficient, ...addAgentInsufficient, ...disableInsufficient, ...mergeInsufficient, ...splitInsufficient],
  };
}
