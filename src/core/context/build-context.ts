/**
 * Minimal context serialization for the Runtime. This is NOT the Context
 * Engine (Phase 3) — it doesn't select what's relevant, it just turns
 * whatever context object it's handed into readable text. Phase 3 replaces
 * the *caller* of this (deciding what goes in the object), not this function.
 */
export function buildContextBlock(context?: Record<string, unknown>): string {
  if (!context || Object.keys(context).length === 0) {
    return "No additional context was provided for this task.";
  }
  return Object.entries(context)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n");
}
