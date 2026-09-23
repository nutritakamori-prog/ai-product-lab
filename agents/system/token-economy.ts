/**
 * Re-exports the existing token/cost logic — nothing here is reimplemented.
 * Model tier -> concrete model id mapping and USD cost estimation both
 * already live in src/core/models/provider.ts (Phase 2); this file just
 * gives the agent library a documented import path to the same source.
 *
 * Actual budget ENFORCEMENT (agent.tokenBudget as a hard max_tokens cap)
 * happens in src/core/runtime/run-agent.ts, not here.
 */
export { MODEL_TIER_TO_ID, estimateCost } from "@/core/models/provider";
