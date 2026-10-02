import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildTeamArchitectReport, type TeamArchitectAgentInput } from "./team-architect";
import type { ConvergenceEntry, RecommendationLifecycleSummary, TeamIntelligenceSummary } from "@/core/team-intelligence/team-intelligence";

function agent(overrides: Partial<TeamArchitectAgentInput> = {}): TeamArchitectAgentInput {
  return {
    agentId: "agent-qa",
    slug: "qa-agent",
    name: "QA Agent",
    category: "QA",
    enabled: true,
    responsibilities: ["Verify core flows work end to end."],
    whenNotToCall: "When the task is purely visual.",
    executionCount: 0,
    firstExecutionAt: null,
    lastExecutionAt: null,
    missionParticipationCount: 0,
    statusCounts: { FINDING: 0, NO_FINDING: 0, UNCONFIRMED: 0, FAILED: 0, RUNNING: 0, BLOCKED: 0 },
    findingCount: 0,
    classificationCounts: {},
    convergenceCount: 0,
    ...overrides,
  };
}

const EMPTY_LIFECYCLE: RecommendationLifecycleSummary = {
  totalRecommendations: 0,
  byStatus: { PENDING: 0, APPROVED: 0, IGNORED: 0 },
  withImplementation: 0,
  withoutImplementation: 0,
  implementationsByStatus: { PENDING: 0, IN_PROGRESS: 0, COMPLETED: 0 },
  withValidation: 0,
  withoutValidation: 0,
  validationsByStatus: { PENDING: 0, PASSED: 0, FAILED: 0, INCONCLUSIVE: 0 },
};

function teamIntelligence(overrides: Partial<TeamIntelligenceSummary> = {}): TeamIntelligenceSummary {
  return {
    activity: { totalAgents: 0, enabledAgents: 0, activeAgents: 0, perAgent: [] },
    coverage: [],
    findingPatterns: { targets: [], classificationsObserved: [] },
    agentProblemCoverage: [],
    convergence: [],
    recommendationLifecycle: EMPTY_LIFECYCLE,
    evidenceGaps: {
      agentsWithoutActivity: [],
      findingsWithoutRecommendation: [],
      approvedRecommendationsWithoutImplementation: [],
      implementationsWithoutValidation: [],
      validationsWithoutRetestReference: [],
      classificationsNeverObserved: [],
    },
    ...overrides,
  };
}

function convergenceEntry(agentIds: string[], overrides: Partial<ConvergenceEntry> = {}): ConvergenceEntry {
  return { missionRunId: "run-1", targetUrl: "http://localhost:3000/qg", finding: "A", agentIds, classifications: ["BUG"], ...overrides };
}

describe("buildTeamArchitectReport", () => {
  // Case 1 — absence of evidence
  it("produces nothing from an empty team and empty Team Intelligence — never fabricates a recommendation from no data", () => {
    const report = buildTeamArchitectReport(teamIntelligence(), []);
    expect(report.recommendations).toEqual([]);
    expect(report.insufficientEvidence).toEqual([]);
  });

  // Case 2 — insufficient evidence
  it("reports INSUFFICIENT_EVIDENCE for a classification seen only once, never a recommendation", () => {
    const agents = [agent({ slug: "qa-agent", executionCount: 1, classificationCounts: { BUG: 1 } })];
    const report = buildTeamArchitectReport(teamIntelligence({ findingPatterns: { targets: [], classificationsObserved: ["BUG"] } }), agents);
    expect(report.recommendations.find((r) => r.type === "POSSIBLE_MISSING_SPECIALIZATION")).toBeUndefined();
    expect(report.insufficientEvidence).toContainEqual(
      expect.objectContaining({ area: "POSSIBLE_MISSING_SPECIALIZATION", observed: expect.stringContaining("1 time") }),
    );
  });

  // Case 3 — coverage gap
  it("flags an enabled agent with zero activity as COVERAGE_GAP", () => {
    const agents = [agent({ slug: "idle-agent", enabled: true, executionCount: 0 })];
    const report = buildTeamArchitectReport(teamIntelligence(), agents);
    const gap = report.recommendations.find((r) => r.type === "COVERAGE_GAP");
    expect(gap?.affectedAgents).toEqual(["idle-agent"]);
    expect(gap?.confidence).toBe("HIGH");
  });

  it("never flags a DISABLED agent with zero activity as COVERAGE_GAP", () => {
    const agents = [agent({ slug: "disabled-agent", enabled: false, executionCount: 0 })];
    const report = buildTeamArchitectReport(teamIntelligence(), agents);
    expect(report.recommendations.find((r) => r.type === "COVERAGE_GAP")).toBeUndefined();
  });

  // Case 4 — possible overlap
  it("flags POSSIBLE_OVERLAP when the same two agents converge on equivalent findings twice", () => {
    const convergence = [
      convergenceEntry(["qa-agent", "ux-agent"], { missionRunId: "run-1", finding: "A" }),
      convergenceEntry(["qa-agent", "ux-agent"], { missionRunId: "run-2", finding: "B" }),
    ];
    const report = buildTeamArchitectReport(teamIntelligence({ convergence }), [agent()]);
    const overlap = report.recommendations.find((r) => r.type === "POSSIBLE_OVERLAP");
    expect(overlap?.affectedAgents.sort()).toEqual(["qa-agent", "ux-agent"]);
    expect(overlap?.evidence).toHaveLength(2);
  });

  // Case 15 — single convergence is not overlap
  it("never flags a single convergence occurrence as POSSIBLE_OVERLAP", () => {
    const report = buildTeamArchitectReport(teamIntelligence({ convergence: [convergenceEntry(["qa-agent", "ux-agent"])] }), [agent()]);
    expect(report.recommendations.find((r) => r.type === "POSSIBLE_OVERLAP")).toBeUndefined();
  });

  // Case 5 — missing specialization
  it("flags POSSIBLE_MISSING_SPECIALIZATION when a recurring classification is scattered across agents with no repeat exposure", () => {
    const agents = [
      agent({ slug: "agent-a", executionCount: 1, classificationCounts: { ACCESSIBILITY: 1 } }),
      agent({ slug: "agent-b", executionCount: 1, classificationCounts: { ACCESSIBILITY: 1 } }),
      agent({ slug: "agent-c", executionCount: 1, classificationCounts: { ACCESSIBILITY: 1 } }),
    ];
    const report = buildTeamArchitectReport(teamIntelligence({ findingPatterns: { targets: [], classificationsObserved: ["ACCESSIBILITY"] } }), agents);
    const missing = report.recommendations.find((r) => r.type === "POSSIBLE_MISSING_SPECIALIZATION");
    expect(missing?.affectedCategories).toEqual(["ACCESSIBILITY"]);
    expect(missing?.affectedAgents.sort()).toEqual(["agent-a", "agent-b", "agent-c"]);
  });

  it("never flags POSSIBLE_MISSING_SPECIALIZATION when one agent already owns most of the recurrence", () => {
    const agents = [agent({ slug: "specialist", executionCount: 5, classificationCounts: { ACCESSIBILITY: 5 } })];
    const report = buildTeamArchitectReport(teamIntelligence({ findingPatterns: { targets: [], classificationsObserved: ["ACCESSIBILITY"] } }), agents);
    expect(report.recommendations.find((r) => r.type === "POSSIBLE_MISSING_SPECIALIZATION")).toBeUndefined();
  });

  // Case 14 — recurrence threshold boundary
  it("treats 2 occurrences as insufficient and 3 as enough to evaluate for missing specialization", () => {
    const two = [agent({ slug: "a", classificationCounts: { UX: 1 } }), agent({ slug: "b", classificationCounts: { UX: 1 } })];
    const twoReport = buildTeamArchitectReport(teamIntelligence({ findingPatterns: { targets: [], classificationsObserved: ["UX"] } }), two);
    expect(twoReport.recommendations.find((r) => r.type === "POSSIBLE_MISSING_SPECIALIZATION")).toBeUndefined();
    expect(twoReport.insufficientEvidence.some((e) => e.area === "POSSIBLE_MISSING_SPECIALIZATION")).toBe(true);

    const three = [...two, agent({ slug: "c", classificationCounts: { UX: 1 } })];
    const threeReport = buildTeamArchitectReport(teamIntelligence({ findingPatterns: { targets: [], classificationsObserved: ["UX"] } }), three);
    expect(threeReport.recommendations.find((r) => r.type === "POSSIBLE_MISSING_SPECIALIZATION")).toBeDefined();
  });

  // Case 6 — underused specialization
  it("flags UNDERUSED_SPECIALIZATION for an agent that ran but never produced its own named classification", () => {
    const agents = [agent({ slug: "accessibility-agent", category: "ACCESSIBILITY", executionCount: 4, classificationCounts: { BUG: 2 } })];
    const report = buildTeamArchitectReport(teamIntelligence(), agents);
    const underused = report.recommendations.find((r) => r.type === "UNDERUSED_SPECIALIZATION");
    expect(underused?.affectedAgents).toEqual(["accessibility-agent"]);
    expect(underused?.confidence).toBe("HIGH");
  });

  it("never flags UNDERUSED_SPECIALIZATION for an agent that never ran at all", () => {
    const agents = [agent({ slug: "accessibility-agent", category: "ACCESSIBILITY", executionCount: 0 })];
    const report = buildTeamArchitectReport(teamIntelligence(), agents);
    expect(report.recommendations.find((r) => r.type === "UNDERUSED_SPECIALIZATION")).toBeUndefined();
  });

  // Case 7 — ADJUST_RESPONSIBILITY
  it("pairs ADJUST_RESPONSIBILITY with every UNDERUSED_SPECIALIZATION it produces", () => {
    const agents = [agent({ slug: "performance-agent", category: "PERFORMANCE", executionCount: 3, classificationCounts: {} })];
    const report = buildTeamArchitectReport(teamIntelligence(), agents);
    expect(report.recommendations.find((r) => r.type === "UNDERUSED_SPECIALIZATION")).toBeDefined();
    const adjust = report.recommendations.find((r) => r.type === "ADJUST_RESPONSIBILITY");
    expect(adjust?.affectedAgents).toEqual(["performance-agent"]);
  });

  // Case 8 — possible new agent
  it("escalates POSSIBLE_MISSING_SPECIALIZATION to ADD_AGENT once recurrence clears the stricter bar", () => {
    const agents = Array.from({ length: 5 }, (_, i) => agent({ slug: `agent-${i}`, classificationCounts: { NAVIGATION: 1 } }));
    const report = buildTeamArchitectReport(teamIntelligence({ findingPatterns: { targets: [], classificationsObserved: ["NAVIGATION"] } }), agents);
    expect(report.recommendations.find((r) => r.type === "ADD_AGENT")).toBeDefined();
  });

  it("keeps ADD_AGENT as insufficient evidence when missing specialization fires but doesn't clear the stricter bar", () => {
    const agents = [agent({ slug: "a", classificationCounts: { NAVIGATION: 1 } }), agent({ slug: "b", classificationCounts: { NAVIGATION: 1 } }), agent({ slug: "c", classificationCounts: { NAVIGATION: 1 } })];
    const report = buildTeamArchitectReport(teamIntelligence({ findingPatterns: { targets: [], classificationsObserved: ["NAVIGATION"] } }), agents);
    expect(report.recommendations.find((r) => r.type === "ADD_AGENT")).toBeUndefined();
    expect(report.insufficientEvidence.some((e) => e.area === "ADD_AGENT")).toBe(true);
  });

  // Case 17 / 18 — Recommendation lifecycle and Validation surfaced as context evidence on ADD_AGENT
  it("includes the Recommendation lifecycle and Validation counts as context evidence on an ADD_AGENT recommendation", () => {
    const agents = Array.from({ length: 5 }, (_, i) => agent({ slug: `agent-${i}`, classificationCounts: { NAVIGATION: 1 } }));
    const lifecycle: RecommendationLifecycleSummary = {
      ...EMPTY_LIFECYCLE,
      totalRecommendations: 4,
      byStatus: { PENDING: 1, APPROVED: 3, IGNORED: 0 },
      withImplementation: 2,
      implementationsByStatus: { PENDING: 0, IN_PROGRESS: 1, COMPLETED: 1 },
      withValidation: 1,
      validationsByStatus: { PENDING: 0, PASSED: 1, FAILED: 0, INCONCLUSIVE: 0 },
    };
    const report = buildTeamArchitectReport(
      teamIntelligence({ findingPatterns: { targets: [], classificationsObserved: ["NAVIGATION"] }, recommendationLifecycle: lifecycle }),
      agents,
    );
    const addAgent = report.recommendations.find((r) => r.type === "ADD_AGENT");
    expect(addAgent?.evidence.some((e) => e.description.includes("4 total") && e.description.includes("1 passed"))).toBe(true);
  });

  // Case 9 — possible removal (always insufficient evidence)
  it("never produces a REMOVE_AGENT recommendation, only INSUFFICIENT_EVIDENCE", () => {
    const agents = [agent({ slug: "idle-agent", enabled: true, executionCount: 0 }), agent({ slug: "active-agent", enabled: true, executionCount: 5 })];
    const report = buildTeamArchitectReport(teamIntelligence(), agents);
    expect(report.recommendations.find((r) => r.type === "REMOVE_AGENT")).toBeUndefined();
    expect(report.insufficientEvidence.some((e) => e.area === "REMOVE_AGENT")).toBe(true);
  });

  // Case 10 — possible deactivation
  it("flags DISABLE_AGENT when an enabled agent is idle while the rest of the project has real activity", () => {
    const agents = [agent({ slug: "idle-agent", enabled: true, executionCount: 0 }), agent({ slug: "active-agent", enabled: true, executionCount: 5 })];
    const report = buildTeamArchitectReport(teamIntelligence(), agents);
    const disable = report.recommendations.find((r) => r.type === "DISABLE_AGENT");
    expect(disable?.affectedAgents).toEqual(["idle-agent"]);
  });

  // Case 16 — history: whole-team inactivity gives insufficient evidence instead
  it("keeps DISABLE_AGENT as insufficient evidence when no agent in the project has any activity yet", () => {
    const agents = [agent({ slug: "idle-agent", enabled: true, executionCount: 0 })];
    const report = buildTeamArchitectReport(teamIntelligence(), agents);
    expect(report.recommendations.find((r) => r.type === "DISABLE_AGENT")).toBeUndefined();
    expect(report.insufficientEvidence.some((e) => e.area === "DISABLE_AGENT")).toBe(true);
  });

  // Case 11 — merge (always insufficient evidence)
  it("never produces a MERGE_RESPONSIBILITIES recommendation when overlap is observed, only INSUFFICIENT_EVIDENCE", () => {
    const convergence = [convergenceEntry(["a", "b"], { missionRunId: "run-1" }), convergenceEntry(["a", "b"], { missionRunId: "run-2" })];
    const report = buildTeamArchitectReport(teamIntelligence({ convergence }), [agent()]);
    expect(report.recommendations.find((r) => r.type === "MERGE_RESPONSIBILITIES")).toBeUndefined();
    expect(report.insufficientEvidence.some((e) => e.area === "MERGE_RESPONSIBILITIES")).toBe(true);
  });

  // Case 12 — split (always insufficient evidence)
  it("never produces a SPLIT_RESPONSIBILITY recommendation for a broad agent, only INSUFFICIENT_EVIDENCE", () => {
    const agents = [agent({ slug: "generalist", classificationCounts: { BUG: 2, UX: 2, UI: 2, NAVIGATION: 2 } })];
    const report = buildTeamArchitectReport(teamIntelligence(), agents);
    expect(report.recommendations.find((r) => r.type === "SPLIT_RESPONSIBILITY")).toBeUndefined();
    expect(report.insufficientEvidence.some((e) => e.area === "SPLIT_RESPONSIBILITY" && e.observed.includes("generalist"))).toBe(true);
  });

  it("never raises SPLIT_RESPONSIBILITY evidence for an agent with narrow coverage", () => {
    const agents = [agent({ slug: "narrow", classificationCounts: { BUG: 5 } })];
    const report = buildTeamArchitectReport(teamIntelligence(), agents);
    expect(report.insufficientEvidence.some((e) => e.area === "SPLIT_RESPONSIBILITY")).toBe(false);
  });

  // Case 13 — multiple, independent pieces of evidence in one run
  it("produces multiple independent recommendation types from one richer fixture without interference", () => {
    const agents = [
      agent({ slug: "idle-agent", enabled: true, executionCount: 0 }),
      agent({ slug: "active-agent", enabled: true, executionCount: 5 }),
      ...["x", "y", "z"].map((s) => agent({ slug: `scatter-${s}`, executionCount: 1, classificationCounts: { DATA: 1 } })),
    ];
    const convergence = [convergenceEntry(["active-agent", "idle-agent"], { missionRunId: "r1" }), convergenceEntry(["active-agent", "idle-agent"], { missionRunId: "r2" })];
    const report = buildTeamArchitectReport(teamIntelligence({ convergence, findingPatterns: { targets: [], classificationsObserved: ["DATA"] } }), agents);

    const types = new Set(report.recommendations.map((r) => r.type));
    expect(types.has("COVERAGE_GAP")).toBe(true);
    expect(types.has("DISABLE_AGENT")).toBe(true);
    expect(types.has("POSSIBLE_OVERLAP")).toBe(true);
    expect(types.has("POSSIBLE_MISSING_SPECIALIZATION")).toBe(true);
  });

  // Case 19 — project isolation is structural: the pure function has no projectId at all,
  // so two disjoint inputs can never influence each other by construction.
  it("produces completely independent results for two disjoint inputs, proving no hidden shared/global state", () => {
    const reportA = buildTeamArchitectReport(teamIntelligence(), [agent({ slug: "only-in-a", enabled: true, executionCount: 0 })]);
    const reportB = buildTeamArchitectReport(teamIntelligence(), [agent({ slug: "only-in-b", enabled: true, executionCount: 0 })]);
    expect(reportA.recommendations.map((r) => r.affectedAgents)).toEqual([["only-in-a"]]);
    expect(reportB.recommendations.map((r) => r.affectedAgents)).toEqual([["only-in-b"]]);
  });

  // Case 20 — no automatic change to any agent, Recommendation, or Implementation
  it("never mutates its inputs and is fully deterministic — same input, same output, every time", () => {
    const agents = [agent({ slug: "qa-agent", enabled: true, executionCount: 0 })];
    const ti = teamIntelligence();
    const agentsSnapshot = JSON.parse(JSON.stringify(agents));
    const tiSnapshot = JSON.parse(JSON.stringify(ti));

    const first = buildTeamArchitectReport(ti, agents);
    const second = buildTeamArchitectReport(ti, agents);

    expect(agents).toEqual(agentsSnapshot);
    expect(ti).toEqual(tiSnapshot);
    expect(first).toEqual(second);
  });

  it("never imports or calls any function that creates, disables, removes, or modifies an Agent, Recommendation, or Implementation", () => {
    const source = readFileSync(new URL("./team-architect.ts", import.meta.url), "utf-8");
    for (const forbidden of ["createImplementation", "createValidation", "setRecommendationStatus", "updateImplementationStatus", "AgentRegistry", "db.agent", "prisma"]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
