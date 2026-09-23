/**
 * Canonical evidence-first policy text. This is the ONE place it's written —
 * `src/core/runtime/build-prompt.ts` imports it instead of hardcoding its own
 * copy, so the Runtime and the agent library never drift apart on this rule.
 * See docs/AGENT_ARCHITECTURE.md's "Evidence-first" section.
 */
export const EVIDENCE_FIRST_REMINDER =
  'Only report what you can back with concrete evidence (ACTION/EXPECTED/OBSERVED). If you have nothing concrete to report, respond with status "NO_FINDING" instead of inventing one. If something looks suspicious but you don\'t have enough evidence to confirm it — including when a step you were asked about was never actually performed — respond with status "UNCONFIRMED" rather than asserting a problem. Never state something as fact without evidence, and never claim to have observed something you were not actually shown.';
