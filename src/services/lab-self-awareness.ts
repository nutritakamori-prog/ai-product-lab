import { analyzeTeamIntelligence } from "@/services/team-intelligence-report";
import { getRunningMissionRun, getLatestMissionRunForProject, getLatestFailedMissionRunForProject, toMissionLifecycle } from "@/services/evaluation-mission-runs";
import { listAccessibleRepos } from "@/services/github-intelligence";
import { buildLabSelfAwarenessReport, type LabSelfAwarenessReport, type LabLatestMissionSnapshot, type LabGithubStatus } from "@/core/lab-self-awareness/lab-self-awareness";
import type { EvaluationMissionInput } from "@/domain/evaluation-mission";

/**
 * FASE 13 — LAB Self-Awareness. The database-access half: loads
 * analyzeTeamIntelligence(projectId) (FASE 10C/12A) exactly as it already
 * exists, plus the few real facts about the LAB's current operational
 * state that Team Intelligence doesn't carry — a RUNNING mission (if this
 * project has one), the most recent mission relevant to this project, and
 * whether GitHub is configured — using only already-existing services
 * (getRunningMissionRun, toMissionLifecycle, listAccessibleRepos) plus two
 * small, project-scoped sibling queries added to evaluation-mission-runs.ts
 * this same phase (see that file's own doc comments). No second analysis
 * engine, no new business rule: this file only gathers and hands off to
 * buildLabSelfAwarenessReport (lab-self-awareness.ts, core), which is pure.
 *
 * Read-only, like every function in this file's dependency chain.
 */

function targetLabel(input: unknown): string | null {
  const parsed = input as EvaluationMissionInput | null;
  if (!parsed?.target) return null;
  return parsed.target.name ?? parsed.target.url ?? null;
}

export async function analyzeLabSelfAwareness(projectId: string): Promise<LabSelfAwarenessReport> {
  const [team, runningGlobal, latestRun, latestFailed, github] = await Promise.all([
    analyzeTeamIntelligence(projectId),
    getRunningMissionRun(),
    getLatestMissionRunForProject(projectId),
    getLatestFailedMissionRunForProject(projectId),
    listAccessibleRepos(),
  ]);

  // getRunningMissionRun() is global (see its own doc comment) — only ever
  // treated as THIS project's running mission when it genuinely belongs to it.
  const runningForProject = runningGlobal && runningGlobal.projectId === projectId ? runningGlobal : null;
  const runningMission = runningForProject ? toMissionLifecycle(runningForProject) : null;

  const latestMissionRun: LabLatestMissionSnapshot | null = latestRun
    ? { missionRunId: latestRun.id, status: latestRun.status, createdAt: latestRun.createdAt.toISOString(), target: targetLabel(latestRun.input) }
    : null;

  const githubStatus: LabGithubStatus = !github.configured
    ? { configured: false, ok: null, repoCount: null }
    : { configured: true, ok: github.ok, repoCount: github.ok ? github.repos.length : null };

  return buildLabSelfAwarenessReport({
    team,
    runningMission,
    latestMissionRun,
    github: githubStatus,
    recentFailureSample: latestFailed?.error ?? null,
    now: new Date(),
  });
}
