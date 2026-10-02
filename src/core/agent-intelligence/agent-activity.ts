import type { AgentCategory } from "@agents/system/agent-protocol";
import type { AgentOutput, FindingClassification } from "@/domain/agent-output";
import type { FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";

/**
 * FASE 10B.1 — Agent Intelligence.
 *
 * Pure, deterministic aggregation of what each known agent has actually
 * done — built only from data the LAB already persists (AgentExecution rows
 * and EvaluationMissionRun reports, per the FASE 10A audit). No database
 * access, no Prisma types, no score, no ranking, no inferred quality: this
 * module only counts and classifies what already happened. See
 * src/services/agent-intelligence.ts for the database-access layer that
 * loads this module's inputs.
 *
 * Deliberately NOT here: turning any of these counts into a score, a
 * ranking, an efficiency measure, or a judgment of quality. A high
 * findingCount means "this agent reported many findings", nothing else —
 * see FASE 10A's audit on why "confidence"/"impact" are self-reported by
 * the agent, not a measure of real quality.
 */

/**
 * FINDING/NO_FINDING/UNCONFIRMED mirror AGENT_OUTPUT_STATUSES
 * (src/domain/agent-output.ts) exactly. FAILED and RUNNING mirror
 * AgentExecutionStatus (prisma/schema.prisma) — re-declared here as a plain
 * literal union, not imported from the generated Prisma client, so this
 * module stays free of any Prisma dependency (same discipline as
 * core/findings/finding-history.ts). BLOCKED mirrors AgentEvaluationOutcome's
 * own addition (src/services/evaluation-orchestrator.ts): a mission
 * requested this agent but it was never actually run, so it has no
 * AgentExecution row at all — counted separately, never invented from
 * AgentExecution data.
 */
export type AgentExecutionOutcomeStatus = "FINDING" | "NO_FINDING" | "UNCONFIRMED" | "FAILED" | "RUNNING" | "BLOCKED";

export interface AgentIdentityInput {
  /** Agent.id — the real FK recorded on AgentExecution.agentId. */
  dbId: string;
  /** Agent.slug / the file definition's `id` — what report.coverage and finding sources key by. */
  slug: string;
  name: string;
  category: AgentCategory;
}

/** The minimal, Prisma-free shape this module needs from an already-loaded AgentExecution row. */
export interface AgentExecutionInput {
  /** Matches AgentIdentityInput.dbId. */
  agentId: string;
  status: "RUNNING" | "SUCCESS" | "FAILED";
  output: AgentOutput | null;
  createdAt: Date;
}

/** The minimal, Prisma-free shape this module needs from an already-loaded EvaluationMissionRun row. */
export interface MissionRunInput {
  id: string;
  report: FinalEvaluationReport | null;
}

export interface AgentActivitySummary {
  agentId: string;
  slug: string;
  name: string;
  category: AgentCategory;

  /** Total AgentExecution rows for this agent, any status, any origin (Mission or ad-hoc/Test Lab). */
  executionCount: number;
  firstExecutionAt: Date | null;
  lastExecutionAt: Date | null;

  /**
   * Distinct Evaluation Missions this agent was actually requested and
   * evaluated in (report.coverage), whatever the outcome — never inferred
   * from AgentExecution alone, since an execution can exist outside of any
   * Mission (see the module doc comment above).
   */
  missionParticipationCount: number;

  statusCounts: Record<AgentExecutionOutcomeStatus, number>;

  /** Distinct ConsolidatedFindings this agent contributed to, across every mission run — never double-counted per finding (see aggregateAgentActivity). */
  findingCount: number;
  classificationCounts: Partial<Record<FindingClassification, number>>;
  /** Of findingCount, how many were findings 2+ agents independently reported (ConsolidatedFinding.duplicated). Not a quality signal — see module doc comment. */
  convergenceCount: number;
}

function emptyStatusCounts(): Record<AgentExecutionOutcomeStatus, number> {
  return { FINDING: 0, NO_FINDING: 0, UNCONFIRMED: 0, FAILED: 0, RUNNING: 0, BLOCKED: 0 };
}

function emptySummary(identity: AgentIdentityInput): AgentActivitySummary {
  return {
    agentId: identity.dbId,
    slug: identity.slug,
    name: identity.name,
    category: identity.category,
    executionCount: 0,
    firstExecutionAt: null,
    lastExecutionAt: null,
    missionParticipationCount: 0,
    statusCounts: emptyStatusCounts(),
    findingCount: 0,
    classificationCounts: {},
    convergenceCount: 0,
  };
}

/**
 * Builds one AgentActivitySummary per known agent identity, regardless of
 * whether that agent has any execution/mission data — an agent with none
 * still appears, all zeros (FASE 10B.1 §6: never hide an agent just because
 * it has no history yet).
 *
 * `executions` and `missionRuns` are expected to already be scoped to a
 * single project — this function never filters by projectId itself; that
 * isolation is the caller's responsibility (see getAgentIntelligence in
 * src/services/agent-intelligence.ts, the only place projectId is enforced).
 */
export function aggregateAgentActivity(
  identities: AgentIdentityInput[],
  executions: AgentExecutionInput[],
  missionRuns: MissionRunInput[],
): AgentActivitySummary[] {
  const bySlug = new Map(identities.map((identity) => [identity.slug, identity]));
  const summaries = new Map(identities.map((identity) => [identity.dbId, emptySummary(identity)]));

  // AgentExecution is the source of truth for execution counts, first/last
  // dates, and FINDING/NO_FINDING/UNCONFIRMED/FAILED/RUNNING. BLOCKED never
  // appears here — a blocked agent was never actually run, so it has no
  // AgentExecution row at all (see the coverage loop below).
  for (const execution of executions) {
    const summary = summaries.get(execution.agentId);
    if (!summary) continue; // execution belongs to an agent id not in this project's known-agent identities

    summary.executionCount += 1;
    if (!summary.firstExecutionAt || execution.createdAt < summary.firstExecutionAt) {
      summary.firstExecutionAt = execution.createdAt;
    }
    if (!summary.lastExecutionAt || execution.createdAt > summary.lastExecutionAt) {
      summary.lastExecutionAt = execution.createdAt;
    }

    if (execution.status === "SUCCESS" && execution.output) {
      summary.statusCounts[execution.output.status] += 1;
    } else if (execution.status === "FAILED") {
      summary.statusCounts.FAILED += 1;
    } else {
      // execution.status === "RUNNING", or (defensively) a SUCCESS row with
      // no output — the runtime always sets both together, so this is only
      // reachable from a genuinely still-running or interrupted execution.
      summary.statusCounts.RUNNING += 1;
    }
  }

  // EvaluationMissionRun.report supplies what AgentExecution alone cannot:
  // mission participation (coverage is keyed by agent slug — see
  // AgentEvaluationOutcome in evaluation-orchestrator.ts), BLOCKED outcomes
  // (no AgentExecution row exists for these), and findings/classifications/
  // convergence (report.findings[].sources[].agentId).
  for (const run of missionRuns) {
    if (!run.report) continue;

    for (const outcome of run.report.coverage) {
      const identity = bySlug.get(outcome.agentId);
      if (!identity) continue; // unknown/removed agent slug from an old mission
      const summary = summaries.get(identity.dbId);
      if (!summary) continue;

      summary.missionParticipationCount += 1;
      if (outcome.status === "BLOCKED") {
        summary.statusCounts.BLOCKED += 1;
      }
      // SUCCESS/FAILED outcomes are already reflected via AgentExecution
      // above — never double-counted here.
    }

    for (const finding of run.report.findings) {
      // A Set, not the raw sources array: sources[].agentId is already
      // unique per finding within one mission (each agent evaluates a
      // mission at most once — see runMissionEvaluation), but this stays
      // correct even if that ever changed, per FASE 10B.1 §3's explicit
      // rule to never count the same finding twice for the same agent just
      // because it has multiple evidence entries.
      const agentSlugsInThisFinding = new Set(finding.sources.map((source) => source.agentId));
      for (const slug of agentSlugsInThisFinding) {
        const identity = bySlug.get(slug);
        if (!identity) continue;
        const summary = summaries.get(identity.dbId);
        if (!summary) continue;

        summary.findingCount += 1;
        if (finding.duplicated) summary.convergenceCount += 1;

        const classification = finding.sources.find((source) => source.agentId === slug)?.classification;
        if (classification) {
          summary.classificationCounts[classification] = (summary.classificationCounts[classification] ?? 0) + 1;
        }
      }
    }
  }

  return identities.map((identity) => summaries.get(identity.dbId)!);
}
