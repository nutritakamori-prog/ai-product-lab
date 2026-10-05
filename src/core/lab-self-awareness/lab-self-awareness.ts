import type { TeamIntelligenceReport } from "@/core/team-intelligence/team-intelligence-report";

/**
 * FASE 13 — LAB Self-Awareness.
 *
 * This is NOT a fourth analysis engine, and NOT a new consciousness model.
 * "Self-awareness" here means exactly what the brief defines it as: the
 * capacity to consult and synthesize real, already-computed facts about the
 * LAB itself — never an opinion, never a personality, never an inference
 * without evidence.
 *
 * Team Intelligence (FASE 10C/12A, analyzeTeamIntelligence) is reused
 * wholesale, unmodified, as the `team` field below — this module never
 * recomputes confidence, coverage, overlap, gaps, or recommendation
 * thresholds. The only genuinely new facts this module composes are the
 * ones Team Intelligence doesn't carry at all: whether a mission is
 * RUNNING right now, which mission was most recently relevant to this
 * project, whether GitHub is configured, and one real recent-failure
 * sample — each supplied already-fetched by the service layer
 * (src/services/lab-self-awareness.ts).
 *
 * Deliberately NOT bundling recurring findings or pending-recommendation
 * titles here: those already have their own existing, independently
 * reusable services (getRecurringFindings, listRecommendations) that the
 * Brain calls directly only for the one or two questions that actually
 * need them — keeping this snapshot small, per the brief's own "não
 * precisa ser um grande objeto."
 *
 * Pure and synchronous: no database access, no LLM call. If a number here
 * is wrong, the bug is in whatever already-existing service supplied it,
 * never in this file.
 */

/** A plain, Prisma-free echo of MissionLifecycle's own shape (evaluation-mission-runs.ts) — duplicated as a type only (never its derivation logic, which stays solely in toMissionLifecycle()) so this core module never imports from services/, the same discipline every other core/ module in this codebase already follows. */
export interface LabRunningMissionSnapshot {
  missionRunId: string;
  requestedAgentIds: string[];
  completedAgentIds: string[];
  failedAgentIds: string[];
  runningAgentId: string | null;
  pendingAgentIds: string[];
}

export interface LabLatestMissionSnapshot {
  missionRunId: string;
  status: string;
  createdAt: string;
  /** The real target name/url this run evaluated, or null when the run's own input doesn't carry one. */
  target: string | null;
}

export interface LabMissionCounts {
  total: number;
  completed: number;
  blocked: number;
  failed: number;
  /** 0 or 1 — getRunningMissionRun() is a single global row by the Brain's own concurrent-mission guard (operational-brain.ts), so at most one RUNNING mission can belong to any one project at a time under that guard. */
  running: number;
}

export interface LabGithubStatus {
  configured: boolean;
  /** null when not configured — never a guessed outcome. */
  ok: boolean | null;
  /** null when not configured or the API call itself failed — never a guessed count. */
  repoCount: number | null;
}

export interface LabSelfAwarenessReport {
  generatedAt: string;
  /** Reused wholesale from analyzeTeamIntelligence(projectId) — FASE 10C/12A, unmodified. */
  team: TeamIntelligenceReport;
  missions: LabMissionCounts;
  runningMission: LabRunningMissionSnapshot | null;
  latestMissionRun: LabLatestMissionSnapshot | null;
  github: LabGithubStatus;
  /** A real, raw error string from the most recent FAILED mission in this project — null when there is none. Left raw (never humanized) here: presentation stays the Brain's job, exactly like every other raw error in this codebase (see operational-brain.ts's own humanizeError). */
  recentFailureSample: string | null;
}

export function buildLabSelfAwarenessReport(input: {
  team: TeamIntelligenceReport;
  runningMission: LabRunningMissionSnapshot | null;
  latestMissionRun: LabLatestMissionSnapshot | null;
  github: LabGithubStatus;
  recentFailureSample: string | null;
  now: Date;
}): LabSelfAwarenessReport {
  const { team, runningMission, latestMissionRun, github, recentFailureSample, now } = input;
  const missions: LabMissionCounts = {
    total: team.evidence.missionsAnalyzed,
    completed: team.evidence.completedMissions,
    blocked: team.evidence.blockedMissions,
    failed: team.evidence.failedMissions,
    running: runningMission ? 1 : 0,
  };
  return { generatedAt: now.toISOString(), team, missions, runningMission, latestMissionRun, github, recentFailureSample };
}
