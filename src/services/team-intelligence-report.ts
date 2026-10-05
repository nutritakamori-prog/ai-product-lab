import { db } from "@/lib/db";
import { getTeamIntelligence } from "@/services/team-intelligence";
import { getTeamArchitectReport } from "@/services/team-architect";
import { buildTeamIntelligenceReport, type TeamIntelligenceReport } from "@/core/team-intelligence/team-intelligence-report";

/**
 * FASE 12A — Team Intelligence Report. The database-access half: loads
 * getTeamIntelligence(projectId) (FASE 10C) and getTeamArchitectReport(projectId)
 * (FASE 10D) exactly as they already exist — no second computation of
 * anything either already does — plus one additional, lightweight query
 * this phase genuinely needs and neither of those exposes: real mission
 * counts by status (TeamIntelligenceSummary only ever loads COMPLETED runs,
 * by design). Three total queries' worth of work (the two existing reports'
 * own batched queries, plus this one), never N+1.
 *
 * Read-only, like every function in this file's dependency chain: nothing
 * here creates, disables, removes, or modifies an Agent, Recommendation, or
 * Implementation.
 */
export async function analyzeTeamIntelligence(projectId: string): Promise<TeamIntelligenceReport> {
  const [team, architect, missionRows] = await Promise.all([
    getTeamIntelligence(projectId),
    getTeamArchitectReport(projectId),
    db.evaluationMissionRun.findMany({ where: { projectId }, select: { status: true } }),
  ]);

  const missionCountsByStatus = {
    completed: missionRows.filter((r) => r.status === "COMPLETED").length,
    failed: missionRows.filter((r) => r.status === "FAILED").length,
    blocked: missionRows.filter((r) => r.status === "BLOCKED").length,
    running: missionRows.filter((r) => r.status === "RUNNING").length,
  };

  return buildTeamIntelligenceReport(team, architect, missionCountsByStatus, new Date());
}
