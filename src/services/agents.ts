import { AgentRegistry } from "@/core/agents/registry";

/**
 * Thin pass-through to the Registry, which merges each library definition
 * with its operational state. Kept as a service (not called directly from
 * pages) so the UI never imports core/agents directly.
 */
export function listAgents() {
  return AgentRegistry.list();
}
