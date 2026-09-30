import type { AgentOutput } from "@/domain/agent-output";
import type { EvaluationTarget } from "@/domain/evaluation-mission";
import type { AgentEvaluationOutcome, MissionEvaluationResult } from "@/services/evaluation-orchestrator";

/**
 * Turns a MissionEvaluationResult into a Final Evaluation Report — the same
 * evidence-first discipline the rest of the LAB already applies, just at
 * the mission level instead of a single agent's own output (see this
 * folder's README: "owns deduplication... consolidate instead of creating
 * duplicate findings"). Pure, deterministic, synchronous: no Playwright, no
 * BrowserAdapter, no database, no AgentRegistry, no model call. It never
 * invents evidence, never changes what an agent actually said, never
 * promotes UNCONFIRMED to FINDING, and never merges two findings just
 * because they disagree or seem topically related — only when their own
 * finding+evidence text is (after trimming/case-folding) the same.
 */

export interface FindingSource {
  agentId: string;
  /** Never merged or rewritten across sources — exactly what this one agent reported. */
  evidence: string;
  impact: AgentOutput["impact"];
  recommendation: string | null;
  confidence: AgentOutput["confidence"];
  classification: AgentOutput["classification"];
}

export interface ConsolidatedFinding {
  status: "FINDING";
  /**
   * The representative finding text. When `duplicated` is true, every
   * source's own finding text was judged equivalent to this one (see the
   * dedup rule below) — never a rewritten or merged summary of them.
   */
  finding: string;
  /** True only when 2+ agents independently reported an equivalent finding — never set from mere topical similarity or from agents disagreeing. */
  duplicated: boolean;
  /**
   * Every agent that reported this finding, each with its own unaltered
   * impact/recommendation/confidence/classification. These are never
   * merged into one shared value here — two agents can legitimately assign
   * different impact or confidence to the same underlying problem, and
   * inventing a single "winning" value would misrepresent one of them.
   */
  sources: FindingSource[];
}

export interface FinalEvaluationReport {
  missionId: string;
  /** The mission's own basic, unaltered identity — not the whole EvaluationMission (requestedAgents is a routing concern, not report content). */
  mission: { target: EvaluationTarget; objective: string; task: string };
  /** Only entries whose status was genuinely "FINDING" — NO_FINDING/UNCONFIRMED are never promoted into one. */
  findings: ConsolidatedFinding[];
  /**
   * Every requested agent's own outcome, completely unaltered — including
   * NO_FINDING, UNCONFIRMED, FAILED, and BLOCKED entries. This is the only
   * place those statuses are preserved; `findings` above deliberately
   * omits them, so "existem resultados inconclusivos?" is answered by
   * reading this list, not by guessing from `findings`.
   */
  coverage: AgentEvaluationOutcome[];
}

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The simple, deterministic, deliberately conservative equivalence rule:
 * two findings consolidate only when BOTH their finding text AND their
 * evidence text are the same after trimming and case-folding — no semantic
 * matching, no partial/fuzzy comparison. When in doubt, this returns
 * false — duplicating a finding across two entries is preferred over
 * merging two genuinely different problems into one.
 */
/**
 * Exported so other pure consolidation logic (e.g. FASE 10's finding-history.ts,
 * which compares findings ACROSS Evaluation Mission Runs of the same target)
 * reuses this exact rule instead of a second, parallel implementation.
 * Behavior is unchanged — this is the same function, just no longer private
 * to this module.
 */
export function isEquivalentFinding(a: { finding: string; evidence: string }, b: { finding: string; evidence: string }): boolean {
  return normalize(a.finding) === normalize(b.finding) && normalize(a.evidence) === normalize(b.evidence);
}

export function consolidateMissionEvaluation(
  result: Pick<MissionEvaluationResult, "missionId" | "mission" | "evaluations">,
): FinalEvaluationReport {
  const findings: ConsolidatedFinding[] = [];

  for (const evaluation of result.evaluations) {
    const output = evaluation.status === "SUCCESS" ? evaluation.output : null;
    // Only a genuine, schema-valid FINDING (agentOutputSchema's own refine
    // already guarantees finding/evidence are non-null whenever status is
    // "FINDING" — the extra check here is just safe narrowing, not a new
    // rule). NO_FINDING, UNCONFIRMED, FAILED and BLOCKED never reach this
    // branch — they stay visible only in `coverage`.
    if (!output || output.status !== "FINDING" || !output.finding || !output.evidence) continue;

    const candidate = { finding: output.finding, evidence: output.evidence };
    const source: FindingSource = {
      agentId: evaluation.agentId,
      evidence: output.evidence,
      impact: output.impact,
      recommendation: output.recommendation,
      confidence: output.confidence,
      classification: output.classification,
    };

    const group = findings.find((existing) =>
      isEquivalentFinding({ finding: existing.finding, evidence: existing.sources[0].evidence }, candidate),
    );
    if (group) {
      group.sources.push(source);
      group.duplicated = true;
    } else {
      findings.push({ status: "FINDING", finding: output.finding, duplicated: false, sources: [source] });
    }
  }

  return {
    missionId: result.missionId,
    mission: result.mission,
    findings,
    coverage: result.evaluations,
  };
}
