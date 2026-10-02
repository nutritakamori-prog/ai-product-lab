import { listAgents } from "@/services/agents";
import { getAgentIntelligence } from "@/services/agent-intelligence";
import { getTeamIntelligence } from "@/services/team-intelligence";
import {
  buildTeamArchitectReport,
  type TeamArchitectAgentInput,
  type TeamArchitectReport,
} from "@/core/team-architect/team-architect";

/**
 * FASE 10D — Team Architect. The database-access half: loads
 * getTeamIntelligence(projectId) (10C) as its primary evidence source,
 * plus exactly two additional, already-existing calls for the small amount
 * of per-agent detail Team Intelligence's own summary deliberately omits —
 * getAgentIntelligence(projectId) (10B.1, for exact classificationCounts)
 * and listAgents() (the Registry, for enabled/responsibilities/
 * whenNotToCall) — then hands everything to the pure
 * buildTeamArchitectReport(). No new query, no second Agent Intelligence or
 * Team Intelligence computation.
 *
 * This function, and every function in this file, ONLY PRODUCES A REPORT.
 * There is no createAgentFromRecommendation, disableAgent,
 * deleteAgentFromRecommendation, modifyAgent, or any function that acts on
 * an Agent, Recommendation, or Implementation row anywhere in this phase —
 * every ArchitecturalRecommendation this returns is for a human to read and
 * decide on, never something this code (or any caller of it) can execute
 * automatically.
 */
export async function getTeamArchitectReport(projectId: string): Promise<TeamArchitectReport> {
  const [teamIntelligence, agentSummaries, resolvedAgents] = await Promise.all([
    getTeamIntelligence(projectId),
    getAgentIntelligence(projectId),
    listAgents(),
  ]);

  const definitionBySlug = new Map(resolvedAgents.map((agent) => [agent.id, agent]));
  const agents: TeamArchitectAgentInput[] = agentSummaries.map((summary) => {
    const definition = definitionBySlug.get(summary.slug);
    return {
      ...summary,
      enabled: definition?.enabled ?? false,
      responsibilities: definition?.responsibilities ?? [],
      whenNotToCall: definition?.whenNotToCall ?? "",
    };
  });

  return buildTeamArchitectReport(teamIntelligence, agents);
}
