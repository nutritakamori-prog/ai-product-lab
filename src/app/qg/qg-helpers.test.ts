import { describe, expect, it } from "vitest";
import {
  agentsWithPendingDecision,
  buildWeeklyReport,
  deriveAgentQgState,
  deriveGlobalStatus,
} from "./qg-helpers";
import type { AgentEvaluationOutcome } from "@/services/evaluation-orchestrator";

function outcome(overrides: Partial<AgentEvaluationOutcome> = {}): AgentEvaluationOutcome {
  return {
    agentId: "new-user",
    status: "SUCCESS",
    output: {
      agent: "new-user",
      status: "NO_FINDING",
      finding: null,
      evidence: null,
      impact: null,
      recommendation: null,
      confidence: "HIGH",
      classification: null,
      needsOtherAgent: null,
    },
    error: null,
    ...overrides,
  };
}

describe("deriveAgentQgState", () => {
  it("is IDLE when no run has ever completed", () => {
    const state = deriveAgentQgState({
      agentId: "new-user",
      latestRunStatus: null,
      requestedAgents: [],
      coverageEntry: undefined,
      hasPendingRecommendation: false,
    });
    expect(state).toBe("IDLE");
  });

  it("is WORKING for every requested agent while the latest run is RUNNING", () => {
    const state = deriveAgentQgState({
      agentId: "qa-agent",
      latestRunStatus: "RUNNING",
      requestedAgents: ["new-user", "qa-agent"],
      coverageEntry: undefined,
      hasPendingRecommendation: false,
    });
    expect(state).toBe("WORKING");
  });

  it("is NOT_IN_LATEST_RUN for an agent not requested while the latest run is RUNNING", () => {
    const state = deriveAgentQgState({
      agentId: "security-agent",
      latestRunStatus: "RUNNING",
      requestedAgents: ["new-user"],
      coverageEntry: undefined,
      hasPendingRecommendation: false,
    });
    expect(state).toBe("NOT_IN_LATEST_RUN");
  });

  it("is NOT_IN_LATEST_RUN when the latest run completed without this agent", () => {
    const state = deriveAgentQgState({
      agentId: "security-agent",
      latestRunStatus: "COMPLETED",
      requestedAgents: ["new-user"],
      coverageEntry: undefined,
      hasPendingRecommendation: false,
    });
    expect(state).toBe("NOT_IN_LATEST_RUN");
  });

  it("reflects BLOCKED/FAILED coverage verbatim", () => {
    expect(
      deriveAgentQgState({
        agentId: "new-user",
        latestRunStatus: "BLOCKED",
        requestedAgents: ["new-user"],
        coverageEntry: outcome({ status: "BLOCKED", output: null }),
        hasPendingRecommendation: false,
      }),
    ).toBe("BLOCKED");

    expect(
      deriveAgentQgState({
        agentId: "new-user",
        latestRunStatus: "COMPLETED",
        requestedAgents: ["new-user"],
        coverageEntry: outcome({ status: "FAILED", output: null }),
        hasPendingRecommendation: false,
      }),
    ).toBe("FAILED");
  });

  it("is NO_FINDING/UNCONFIRMED straight from the agent's own output status", () => {
    expect(
      deriveAgentQgState({
        agentId: "new-user",
        latestRunStatus: "COMPLETED",
        requestedAgents: ["new-user"],
        coverageEntry: outcome(),
        hasPendingRecommendation: false,
      }),
    ).toBe("NO_FINDING");

    expect(
      deriveAgentQgState({
        agentId: "new-user",
        latestRunStatus: "COMPLETED",
        requestedAgents: ["new-user"],
        coverageEntry: outcome({ output: { ...outcome().output!, status: "UNCONFIRMED" } }),
        hasPendingRecommendation: false,
      }),
    ).toBe("UNCONFIRMED");
  });

  it("distinguishes PENDING_DECISION from HAS_FINDING using the Recommendation's own status", () => {
    const findingOutcome = outcome({ output: { ...outcome().output!, status: "FINDING", finding: "x", evidence: "x" } });

    expect(
      deriveAgentQgState({
        agentId: "new-user",
        latestRunStatus: "COMPLETED",
        requestedAgents: ["new-user"],
        coverageEntry: findingOutcome,
        hasPendingRecommendation: true,
      }),
    ).toBe("PENDING_DECISION");

    expect(
      deriveAgentQgState({
        agentId: "new-user",
        latestRunStatus: "COMPLETED",
        requestedAgents: ["new-user"],
        coverageEntry: findingOutcome,
        hasPendingRecommendation: false,
      }),
    ).toBe("HAS_FINDING");
  });
});

describe("deriveGlobalStatus", () => {
  it("is ACTION_REQUIRED whenever any Recommendation is PENDING, regardless of run status", () => {
    expect(deriveGlobalStatus({ pendingRecommendationsCount: 2, latestRunStatus: "COMPLETED" })).toBe("ACTION_REQUIRED");
  });

  it("is NEEDS_ATTENTION when nothing is pending but the latest run failed or was blocked", () => {
    expect(deriveGlobalStatus({ pendingRecommendationsCount: 0, latestRunStatus: "FAILED" })).toBe("NEEDS_ATTENTION");
    expect(deriveGlobalStatus({ pendingRecommendationsCount: 0, latestRunStatus: "BLOCKED" })).toBe("NEEDS_ATTENTION");
  });

  it("is HEALTHY otherwise", () => {
    expect(deriveGlobalStatus({ pendingRecommendationsCount: 0, latestRunStatus: "COMPLETED" })).toBe("HEALTHY");
    expect(deriveGlobalStatus({ pendingRecommendationsCount: 0, latestRunStatus: null })).toBe("HEALTHY");
  });
});

describe("buildWeeklyReport", () => {
  const now = new Date("2026-09-30T00:00:00.000Z");
  const withinWeek = new Date("2026-09-28T00:00:00.000Z");
  const beforeWeek = new Date("2026-09-01T00:00:00.000Z");

  it("counts only runs/decisions within the last 7 days, and current pending regardless of when", () => {
    const report = buildWeeklyReport(
      [
        { createdAt: withinWeek, report: { findings: [{}, {}] } },
        { createdAt: beforeWeek, report: { findings: [{}, {}, {}] } },
      ],
      [
        { status: "APPROVED", updatedAt: withinWeek },
        { status: "APPROVED", updatedAt: beforeWeek },
        { status: "IGNORED", updatedAt: withinWeek },
        { status: "PENDING", updatedAt: beforeWeek },
      ],
      now,
    );

    expect(report).toEqual({
      periodDays: 7,
      evaluationsRun: 1,
      findingsRaised: 2,
      decisionsApproved: 1,
      decisionsIgnored: 1,
      decisionsPending: 1,
    });
  });

  it("is deterministic for the same input", () => {
    const a = buildWeeklyReport([{ createdAt: withinWeek, report: null }], [], now);
    const b = buildWeeklyReport([{ createdAt: withinWeek, report: null }], [], now);
    expect(a).toEqual(b);
  });
});

describe("agentsWithPendingDecision", () => {
  it("only includes agents whose finding still has a PENDING recommendation", () => {
    const result = agentsWithPendingDecision(
      [
        { findingIndex: 0, agentIds: ["new-user"] },
        { findingIndex: 1, agentIds: ["ux-agent", "qa-agent"] },
      ],
      [
        { findingIndex: 0, status: "APPROVED" },
        { findingIndex: 1, status: "PENDING" },
      ],
    );
    expect(result).toEqual(new Set(["ux-agent", "qa-agent"]));
  });
});
