import type { AgentOutput } from "@/domain/agent-output";

/**
 * The minimal, relevant slice of an agent's output worth handing to the
 * next agent in the same task — never the whole AgentOutput, never the
 * prompt, never execution history. Just enough for the next agent to reuse
 * what was already found instead of re-investigating it.
 */
export interface SharedEvidence {
  fromAgent: string;
  evidence: string;
  finding: string | null;
}

/**
 * Extracts what's worth sharing from an agent's own output — null when
 * there's nothing to share (no evidence at all, or the run didn't
 * succeed). Deliberately ignores every other AgentOutput field (impact,
 * recommendation, confidence, classification, needsOtherAgent, ...): those
 * are that agent's own judgment, not evidence the next agent should reuse.
 */
export function extractSharedEvidence(fromAgent: string, output: AgentOutput | null): SharedEvidence | null {
  if (!output?.evidence) return null;
  return { fromAgent, evidence: output.evidence, finding: output.finding };
}

/**
 * Appends `entry` to `existing`, unless an identical entry (same
 * `fromAgent` + same `evidence` text) is already present — the same
 * evidence is never added twice.
 */
export function addSharedEvidence(existing: SharedEvidence[], entry: SharedEvidence | null): SharedEvidence[] {
  if (!entry) return existing;
  const alreadyPresent = existing.some((e) => e.fromAgent === entry.fromAgent && e.evidence === entry.evidence);
  return alreadyPresent ? existing : [...existing, entry];
}

/**
 * The minimal `context` object to pass into runAgent() for the next agent
 * — reuses runAgent's existing `context?: Record<string, unknown>` param
 * (see src/core/context/build-context.ts) exactly as it already works,
 * nothing new added to the Runtime. Undefined (no Context section at all)
 * when there's nothing to share, so a task with no evidence behaves
 * exactly as it did before this module existed.
 */
export function buildSharedEvidenceContext(sharedEvidence: SharedEvidence[]): Record<string, unknown> | undefined {
  return sharedEvidence.length > 0 ? { sharedEvidence } : undefined;
}
