import { AgentRegistry } from "@/core/agents/registry";
import { db } from "@/lib/db";

/**
 * Thin pass-through to the Registry, which merges each library definition
 * with its operational state. Kept as a service (not called directly from
 * pages) so the UI never imports core/agents directly.
 */
export function listAgents() {
  return AgentRegistry.list();
}

/**
 * The actual "has an agent run" signal: AgentExecution (src/core/runtime/
 * run-agent.ts) is the one row-per-run audit trail every real agent
 * invocation produces, regardless of which path triggered it (a Test Lab
 * scenario, an Evaluation Mission, or an ad-hoc runLabTask call) — so this
 * is the single source of truth for that question, not a guess derived from
 * any one downstream table (TestRun/EvaluationMissionRun are themselves
 * built on top of it). Scoped to the given project ids the same way
 * listProjects() already scopes by organization, so this never counts
 * another organization's activity once multi-tenancy is real.
 */
export function countAgentExecutions(projectIds: string[]): Promise<number> {
  if (projectIds.length === 0) return Promise.resolve(0);
  return db.agentExecution.count({ where: { projectId: { in: projectIds } } });
}
