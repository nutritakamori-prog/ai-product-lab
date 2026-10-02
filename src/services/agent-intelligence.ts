import { db } from "@/lib/db";
import { listAgents } from "@/services/agents";
import type { AgentOutput } from "@/domain/agent-output";
import type { FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";
import {
  aggregateAgentActivity,
  type AgentActivitySummary,
  type AgentExecutionInput,
  type AgentIdentityInput,
  type MissionRunInput,
} from "@/core/agent-intelligence/agent-activity";

/**
 * The database-access half of FASE 10B.1 — Agent Intelligence. Loads every
 * data point the FASE 10A audit identified as the LAB's real source of truth
 * for agent activity, scoped to exactly one project (never mixed across
 * projects), then hands it to the pure aggregation function above. Two
 * batched queries total — never one query per agent (no N+1).
 *
 * Reuses listAgents() (the existing Registry pass-through, src/services/
 * agents.ts) rather than querying `Agent` a second time here.
 */
export async function getAgentIntelligence(projectId: string): Promise<AgentActivitySummary[]> {
  const [resolvedAgents, executions, missionRuns] = await Promise.all([
    listAgents(),
    db.agentExecution.findMany({
      where: { projectId },
      select: { agentId: true, status: true, output: true, createdAt: true },
    }),
    db.evaluationMissionRun.findMany({
      where: { projectId },
      select: { id: true, report: true },
    }),
  ]);

  const identities: AgentIdentityInput[] = resolvedAgents.map((agent) => ({
    dbId: agent.dbId,
    slug: agent.id,
    name: agent.name,
    category: agent.category,
  }));

  const executionInputs: AgentExecutionInput[] = executions.map((execution) => ({
    agentId: execution.agentId,
    status: execution.status,
    output: execution.output as unknown as AgentOutput | null,
    createdAt: execution.createdAt,
  }));

  const missionRunInputs: MissionRunInput[] = missionRuns.map((run) => ({
    id: run.id,
    report: run.report as unknown as FinalEvaluationReport | null,
  }));

  return aggregateAgentActivity(identities, executionInputs, missionRunInputs);
}
