import { describe, expect, it } from "vitest";
import { buildLabSelfAwarenessReport, type LabGithubStatus, type LabLatestMissionSnapshot, type LabRunningMissionSnapshot } from "./lab-self-awareness";
import type { TeamIntelligenceReport } from "@/core/team-intelligence/team-intelligence-report";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function team(overrides: Partial<TeamIntelligenceReport> = {}): TeamIntelligenceReport {
  return {
    generatedAt: NOW.toISOString(),
    confidence: "INSUFFICIENT",
    summary: "s",
    evidence: { missionsAnalyzed: 0, completedMissions: 0, failedMissions: 0, blockedMissions: 0, findingsAnalyzed: 0, recommendationsAnalyzed: 0 },
    team: {
      activity: { totalAgents: 7, enabledAgents: 7, activeAgents: 0, perAgent: [] },
      coverage: [],
      findingPatterns: { targets: [], classificationsObserved: [] },
      agentProblemCoverage: [],
      convergence: [],
      recommendationLifecycle: {
        totalRecommendations: 0,
        byStatus: { PENDING: 0, APPROVED: 0, IGNORED: 0 },
        withImplementation: 0,
        withoutImplementation: 0,
        implementationsByStatus: { PENDING: 0, IN_PROGRESS: 0, COMPLETED: 0 },
        withValidation: 0,
        withoutValidation: 0,
        validationsByStatus: { PENDING: 0, PASSED: 0, FAILED: 0, INCONCLUSIVE: 0 },
      },
      evidenceGaps: {
        agentsWithoutActivity: [],
        findingsWithoutRecommendation: [],
        approvedRecommendationsWithoutImplementation: [],
        implementationsWithoutValidation: [],
        validationsWithoutRetestReference: [],
        classificationsNeverObserved: [],
      },
    },
    architect: { recommendations: [], insufficientEvidence: [] },
    ...overrides,
  };
}

const NO_GITHUB: LabGithubStatus = { configured: false, ok: null, repoCount: null };

describe("buildLabSelfAwarenessReport", () => {
  it("derives mission counts straight from the reused TeamIntelligenceReport's own evidence — never a second count", () => {
    const t = team({ evidence: { missionsAnalyzed: 37, completedMissions: 2, failedMissions: 33, blockedMissions: 2, findingsAnalyzed: 0, recommendationsAnalyzed: 0 } });
    const report = buildLabSelfAwarenessReport({ team: t, runningMission: null, latestMissionRun: null, github: NO_GITHUB, recentFailureSample: null, now: NOW });
    expect(report.missions).toEqual({ total: 37, completed: 2, blocked: 2, failed: 33, running: 0 });
  });

  it("reports running=1 only when a real running-mission snapshot is given, never guessed", () => {
    const lifecycle: LabRunningMissionSnapshot = {
      missionRunId: "r1",
      requestedAgentIds: ["qa-agent", "ux-agent"],
      completedAgentIds: ["qa-agent"],
      failedAgentIds: [],
      runningAgentId: "ux-agent",
      pendingAgentIds: [],
    };
    const report = buildLabSelfAwarenessReport({ team: team(), runningMission: lifecycle, latestMissionRun: null, github: NO_GITHUB, recentFailureSample: null, now: NOW });
    expect(report.missions.running).toBe(1);
    expect(report.runningMission).toEqual(lifecycle);
  });

  it("carries the real TeamIntelligenceReport through unmodified — never recomputes confidence or any of its fields", () => {
    const t = team({ confidence: "HIGH" });
    const report = buildLabSelfAwarenessReport({ team: t, runningMission: null, latestMissionRun: null, github: NO_GITHUB, recentFailureSample: null, now: NOW });
    expect(report.team).toEqual(t);
  });

  it("is honest about GitHub's real configuration state, never defaulting to configured", () => {
    const report = buildLabSelfAwarenessReport({ team: team(), runningMission: null, latestMissionRun: null, github: NO_GITHUB, recentFailureSample: null, now: NOW });
    expect(report.github).toEqual({ configured: false, ok: null, repoCount: null });
  });

  it("carries a real latest-mission snapshot through unmodified when one is given", () => {
    const latest: LabLatestMissionSnapshot = { missionRunId: "r2", status: "COMPLETED", createdAt: NOW.toISOString(), target: "example.com" };
    const report = buildLabSelfAwarenessReport({ team: team(), runningMission: null, latestMissionRun: latest, github: NO_GITHUB, recentFailureSample: null, now: NOW });
    expect(report.latestMissionRun).toEqual(latest);
  });

  it("carries a real recent-failure sample through raw, never humanized here (presentation stays the Brain's job)", () => {
    const raw = 'Gemini API request failed with status 429: {\n"error": {}\n}';
    const report = buildLabSelfAwarenessReport({ team: team(), runningMission: null, latestMissionRun: null, github: NO_GITHUB, recentFailureSample: raw, now: NOW });
    expect(report.recentFailureSample).toBe(raw);
  });

  it("is fully deterministic — same input, same output", () => {
    const input = { team: team(), runningMission: null, latestMissionRun: null, github: NO_GITHUB, recentFailureSample: null, now: NOW };
    expect(buildLabSelfAwarenessReport(input)).toEqual(buildLabSelfAwarenessReport(input));
  });
});
