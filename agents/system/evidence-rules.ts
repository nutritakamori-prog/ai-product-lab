/**
 * Canonical evidence-first policy text. This is the ONE place it's written —
 * `src/core/runtime/build-prompt.ts` imports it instead of hardcoding its own
 * copy, so the Runtime and the agent library never drift apart on this rule.
 * See docs/AGENT_ARCHITECTURE.md's "Evidence-first" section.
 */
export const EVIDENCE_FIRST_REMINDER =
  'Only report what you can back with concrete evidence (ACTION/EXPECTED/OBSERVED). If you have nothing concrete to report, respond with status "NO_FINDING" instead of inventing one. Never state something as fact without evidence.';
