import type { EvaluationTarget } from "@/domain/evaluation-mission";
import type { ConsolidatedFinding } from "./mission-evaluation-report";
import { isEquivalentFinding } from "./mission-evaluation-report";

/**
 * FASE 10, Etapa 1 — "Finding → Retest Intelligence".
 *
 * Turns something the LAB has only ever done manually in this project's own
 * history (comparing an Evaluation Mission's findings against an earlier run
 * of the same target, one mission at a time, by eye) into a deterministic,
 * pure, testable function — reusing the exact same equivalence rule
 * `consolidateMissionEvaluation()` already uses WITHIN one run
 * (`isEquivalentFinding` — finding text AND evidence text, trimmed and
 * case-folded, never semantic/fuzzy matching), now applied ACROSS runs.
 *
 * No database access, no Prisma types, no new table, no new service, no
 * cache, no NLP/embeddings. Callers (a future service layer) are expected to
 * already have loaded the relevant `EvaluationMissionRun` rows and extracted
 * their `report.findings` before calling this — exactly the same shape
 * `FinalEvaluationReport.findings` already has.
 *
 * ── The one thing this module deliberately never claims ──────────────────
 * A finding's text not reappearing in a later run of the same target is
 * evidence that it was not reproduced/confirmed in that later evaluation —
 * it is NOT proof that the underlying problem was fixed, implemented, or
 * resolved. The absence of a match could equally mean the area wasn't
 * re-evaluated, the wording changed, or the same specialists weren't
 * requested again. Every status name and every doc comment below reflects
 * this on purpose ("NOT_REPRODUCED", never "RESOLVED"/"FIXED") — see
 * docs/DECISIONS.md-style reasoning inline where it matters.
 */

/** The minimal, Prisma-free shape this module needs from an already-loaded EvaluationMissionRun. */
export interface FindingHistoryRunInput {
  runId: string;
  target: EvaluationTarget;
  createdAt: Date;
  /** Exactly `FinalEvaluationReport.findings` for this run — already deduplicated WITHIN the run by consolidateMissionEvaluation(). */
  findings: ConsolidatedFinding[];
}

/**
 * What happened to one finding's text in one run, relative to the run
 * immediately before it in this same comparison (never relative to the
 * whole history at once — see the per-status doc comments below).
 */
export type FindingOccurrenceStatus =
  /**
   * This run is the earliest one in the comparison window, so there is no
   * earlier run to compare against. Deliberately distinct from "NEW": this
   * project genuinely has no data before this window started, so calling it
   * "new" would overclaim what's actually knowable — see Etapa 1's own rule
   * "uma única run deve produzir resultado válido sem inventar uma
   * comparação".
   */
  | "FIRST_OBSERVED"
  /** Present in this run AND in the run immediately before it. */
  | "PERSISTENT"
  /**
   * Absent in this run. The finding WAS observed at some earlier point in
   * this comparison (otherwise it wouldn't have a timeline entry at all).
   * This is a factual absence-of-reproduction signal only — see this
   * module's own top-level doc comment for why it is never "RESOLVED".
   */
  | "NOT_REPRODUCED"
  /**
   * Present in this run, absent in the run immediately before it, and never
   * observed in any run before that either — this is its first appearance
   * in the comparison window, and the window already had at least one
   * earlier run that didn't have it (unlike FIRST_OBSERVED).
   */
  | "NEW"
  /**
   * Present in this run, absent in the run immediately before it, but it WAS
   * observed in some earlier run before that — a genuine recurrence, not a
   * first appearance.
   */
  | "REAPPEARED";

export interface FindingOccurrencePoint {
  runId: string;
  createdAt: Date;
  present: boolean;
  status: FindingOccurrenceStatus;
}

/** One finding's full presence/absence history across every run of one target's comparison window, in chronological order — never collapsed to only its latest state. */
export interface FindingTimeline {
  /** Verbatim finding text, exactly as reported — the same text used for equivalence, never rewritten. */
  finding: string;
  /** Verbatim evidence text of this finding's first occurrence — part of the same equivalence key as `finding` (see isEquivalentFinding), kept here only for readability/traceability, never re-derived. */
  evidence: string;
  points: FindingOccurrencePoint[];
}

/** The result for one target: every run considered (chronological) and every distinct finding's timeline across them. */
export interface TargetFindingHistory {
  target: EvaluationTarget;
  /** Chronologically ordered run ids actually included in this target's comparison. */
  runIds: string[];
  timelines: FindingTimeline[];
}

/**
 * What "same target" means here, and nowhere else: `target.url`, trimmed —
 * the one field `evaluationTargetSchema` (src/domain/evaluation-mission.ts)
 * requires and never treats as just a display label. `target.name` is
 * optional and used everywhere else in this codebase purely for display
 * (`target.name ?? target.url`, e.g. product-intelligence/page.tsx,
 * implementation-task.ts) — never as an identity key — so it is
 * deliberately excluded here too, for the same reason: two runs can
 * legitimately have the same url with a name added/changed later, and that
 * must never split them into two different targets. No new identifier is
 * invented; this reuses the one field the domain schema already treats as
 * required identity.
 */
function targetKey(target: EvaluationTarget): string {
  return target.url.trim();
}

/**
 * Groups already-loaded runs by target (see targetKey above), so callers
 * can never accidentally compare runs of different targets against each
 * other — that guarantee lives here, not in caller discipline. Within each
 * group, runs are sorted chronologically by createdAt regardless of the
 * order they were passed in.
 */
function groupRunsByTarget(runs: FindingHistoryRunInput[]): { target: EvaluationTarget; runs: FindingHistoryRunInput[] }[] {
  const order: string[] = [];
  const groups = new Map<string, { target: EvaluationTarget; runs: FindingHistoryRunInput[] }>();

  for (const run of runs) {
    const key = targetKey(run.target);
    const existing = groups.get(key);
    if (existing) {
      existing.runs.push(run);
    } else {
      groups.set(key, { target: run.target, runs: [run] });
      order.push(key);
    }
  }

  for (const group of groups.values()) {
    group.runs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  return order.map((key) => groups.get(key)!);
}

/**
 * Builds one target's finding timelines from its own chronologically sorted
 * runs. Every finding-identity's timeline starts at the run where it was
 * first observed in this window (never padded with entries from before
 * that), and continues through the window's last run — so a finding that
 * disappears and reappears multiple times keeps every transition, never
 * collapsed to its latest state (Etapa 1's own requirement).
 */
function buildTimelinesForTarget(target: EvaluationTarget, sortedRuns: FindingHistoryRunInput[]): TargetFindingHistory {
  // Every distinct finding identity ever seen in this window, keyed the same
  // way isEquivalentFinding compares (finding text + evidence text) — first
  // occurrence's own text is what every timeline entry displays.
  const identities: { finding: string; evidence: string }[] = [];

  function identityIndexFor(candidate: { finding: string; evidence: string }): number {
    const index = identities.findIndex((existing) => isEquivalentFinding(existing, candidate));
    if (index !== -1) return index;
    identities.push(candidate);
    return identities.length - 1;
  }

  // presenceByIdentity[i][j] = whether identities[i] was present in sortedRuns[j].
  const presenceByIdentity: boolean[][] = [];

  sortedRuns.forEach((run, runIndex) => {
    for (const finding of run.findings) {
      const identityIndex = identityIndexFor({ finding: finding.finding, evidence: finding.sources[0]?.evidence ?? "" });
      const row = (presenceByIdentity[identityIndex] ??= new Array(sortedRuns.length).fill(false));
      row[runIndex] = true;
    }
  });

  const timelines: FindingTimeline[] = identities.map((identity, identityIndex) => {
    const presence = presenceByIdentity[identityIndex] ?? new Array(sortedRuns.length).fill(false);
    const firstRunIndex = presence.indexOf(true);

    const points: FindingOccurrencePoint[] = [];
    for (let runIndex = firstRunIndex; runIndex < sortedRuns.length; runIndex++) {
      const run = sortedRuns[runIndex];
      const present = presence[runIndex];
      let status: FindingOccurrenceStatus;

      if (runIndex === firstRunIndex) {
        status = firstRunIndex === 0 ? "FIRST_OBSERVED" : "NEW";
      } else if (present) {
        status = presence[runIndex - 1] ? "PERSISTENT" : "REAPPEARED";
      } else {
        status = "NOT_REPRODUCED";
      }

      points.push({ runId: run.runId, createdAt: run.createdAt, present, status });
    }

    return { finding: identity.finding, evidence: identity.evidence, points };
  });

  return { target, runIds: sortedRuns.map((r) => r.runId), timelines };
}

/**
 * The one entry point. Pure, synchronous, in-memory — no database access.
 * Groups the given (already-loaded) runs by target, sorts each group
 * chronologically, and builds a per-finding timeline for each target
 * independently. Runs of different targets are never compared against each
 * other (see groupRunsByTarget). A single run for a target produces a valid
 * result (every finding in it simply gets FIRST_OBSERVED) — never an
 * invented comparison.
 */
export function buildFindingHistory(runs: FindingHistoryRunInput[]): TargetFindingHistory[] {
  return groupRunsByTarget(runs).map(({ target, runs: sortedRuns }) => buildTimelinesForTarget(target, sortedRuns));
}
