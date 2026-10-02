import { describe, expect, it } from "vitest";
import {
  buildTeamIntelligence,
  type TeamIntelligenceAgentInput,
  type TeamIntelligenceMissionRunInput,
  type TeamIntelligenceRecommendationInput,
} from "./team-intelligence";
import { buildFindingHistory, type FindingHistoryRunInput } from "@/core/findings/finding-history";
import type { ConsolidatedFinding } from "@/core/findings/mission-evaluation-report";
import type { EvaluationTarget } from "@/domain/evaluation-mission";

const TARGET: EvaluationTarget = { url: "http://localhost:3000/qg" };

function agent(overrides: Partial<TeamIntelligenceAgentInput> = {}): TeamIntelligenceAgentInput {
  return {
    agentId: "agent-qa",
    slug: "qa-agent",
    name: "QA Agent",
    category: "QA",
    enabled: true,
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

function findingSource(agentId: string, overrides: Partial<ConsolidatedFinding["sources"][number]> = {}): ConsolidatedFinding["sources"][number] {
  return {
    agentId,
    evidence: `evidence from ${agentId}`,
    impact: "MEDIUM",
    recommendation: "fix it",
    confidence: "HIGH",
    classification: "BUG",
    ...overrides,
  };
}

function finding(text: string, sources: ConsolidatedFinding["sources"]): ConsolidatedFinding {
  return { status: "FINDING", finding: text, duplicated: sources.length > 1, sources };
}

/** One fixture, two views: TeamIntelligenceMissionRunInput (fed to buildTeamIntelligence directly) and FindingHistoryRunInput (fed to the REAL buildFindingHistory(), never a hand-crafted history). */
interface RunFixture {
  id: string;
  target: EvaluationTarget;
  createdAt: Date;
  findings: ConsolidatedFinding[];
}

function run(id: string, findings: ConsolidatedFinding[], createdAt: string, target: EvaluationTarget = TARGET): RunFixture {
  return { id, target, createdAt: new Date(createdAt), findings };
}

function toMissionRuns(runs: RunFixture[]): TeamIntelligenceMissionRunInput[] {
  return runs.map((r) => ({ id: r.id, target: r.target, findings: r.findings }));
}

function toFindingHistories(runs: RunFixture[]) {
  const inputs: FindingHistoryRunInput[] = runs.map((r) => ({ runId: r.id, target: r.target, createdAt: r.createdAt, findings: r.findings }));
  return buildFindingHistory(inputs);
}

function recommendation(overrides: Partial<TeamIntelligenceRecommendationInput> = {}): TeamIntelligenceRecommendationInput {
  return { id: "rec-1", missionRunId: "run-1", findingIndex: 0, status: "PENDING", implementation: null, ...overrides };
}

describe("buildTeamIntelligence", () => {
  it("never accesses a database — pure in-memory input/output", () => {
    const result = buildTeamIntelligence([agent()], [], [], []);
    expect(result.activity.totalAgents).toBe(1);
  });

  // Case 1 — team with no activity at all
  it("describes a team with zero activity: all counts zero, the agent still appears as a gap", () => {
    const result = buildTeamIntelligence([agent({ executionCount: 0 })], [], [], []);
    expect(result.activity).toMatchObject({ totalAgents: 1, enabledAgents: 1, activeAgents: 0 });
    expect(result.coverage[0]).toMatchObject({ participated: false, producedFinding: false, producedNoFinding: false });
    expect(result.findingPatterns.targets).toEqual([]);
    expect(result.evidenceGaps.agentsWithoutActivity).toEqual([{ agentId: "agent-qa", slug: "qa-agent", name: "QA Agent" }]);
  });

  // Case 2 — team with multiple agents
  it("includes every agent given, in the same order, for a multi-agent team", () => {
    const ux = agent({ agentId: "agent-ux", slug: "ux-agent", name: "UX Agent", category: "DESIGN" });
    const result = buildTeamIntelligence([agent(), ux], [], [], []);
    expect(result.activity.totalAgents).toBe(2);
    expect(result.activity.perAgent.map((a) => a.slug)).toEqual(["qa-agent", "ux-agent"]);
  });

  // Case 3 — one agent without execution among others with activity
  it("distinguishes an inactive agent from an active one in the same team", () => {
    const active = agent({ agentId: "agent-active", slug: "active-agent", executionCount: 5 });
    const inactive = agent({ agentId: "agent-inactive", slug: "inactive-agent", executionCount: 0 });
    const result = buildTeamIntelligence([active, inactive], [], [], []);
    expect(result.activity.activeAgents).toBe(1);
    expect(result.evidenceGaps.agentsWithoutActivity).toEqual([{ agentId: "agent-inactive", slug: "inactive-agent", name: "QA Agent" }]);
  });

  // Case 4 — agents with different finding classifications
  it("reflects each agent's own observed classifications independently", () => {
    const a11y = agent({ agentId: "agent-a11y", slug: "accessibility-agent", classificationCounts: { ACCESSIBILITY: 2 } });
    const perf = agent({ agentId: "agent-perf", slug: "performance-agent", classificationCounts: { PERFORMANCE: 1 } });
    const result = buildTeamIntelligence([a11y, perf], [], [], []);
    expect(result.agentProblemCoverage.find((e) => e.slug === "accessibility-agent")?.classifications).toEqual(["ACCESSIBILITY"]);
    expect(result.agentProblemCoverage.find((e) => e.slug === "performance-agent")?.classifications).toEqual(["PERFORMANCE"]);
  });

  // Case 5 — NO_FINDING
  it("marks an agent that only produced NO_FINDING as participated, but never producedFinding", () => {
    const noFinding = agent({ missionParticipationCount: 2, statusCounts: { FINDING: 0, NO_FINDING: 2, UNCONFIRMED: 0, FAILED: 0, RUNNING: 0, BLOCKED: 0 } });
    const result = buildTeamIntelligence([noFinding], [], [], []);
    expect(result.coverage[0]).toMatchObject({ participated: true, producedFinding: false, producedNoFinding: true });
  });

  // Case 6 — persistent findings
  it("counts a finding whose latest status is PERSISTENT", () => {
    const runs = [run("r1", [finding("A", [findingSource("qa-agent")])], "2026-01-01"), run("r2", [finding("A", [findingSource("qa-agent")])], "2026-01-02")];
    const result = buildTeamIntelligence([agent()], toFindingHistories(runs), toMissionRuns(runs), []);
    expect(result.findingPatterns.targets[0]).toMatchObject({ totalFindings: 1, persistent: 1, firstObserved: 0, new: 0, reappeared: 0, notReproduced: 0 });
  });

  // Case 7 — reappeared findings
  it("counts a finding whose latest status is REAPPEARED", () => {
    const runs = [
      run("r1", [finding("A", [findingSource("qa-agent")])], "2026-01-01"),
      run("r2", [], "2026-01-02"),
      run("r3", [finding("A", [findingSource("qa-agent")])], "2026-01-03"),
    ];
    const result = buildTeamIntelligence([agent()], toFindingHistories(runs), toMissionRuns(runs), []);
    expect(result.findingPatterns.targets[0]).toMatchObject({ totalFindings: 1, reappeared: 1 });
  });

  // Case 8 — convergence between agents
  it("lists a multi-source finding as convergence, with every agent that reported it", () => {
    const runs = [run("r1", [finding("A", [findingSource("qa-agent"), findingSource("ux-agent")])], "2026-01-01")];
    const result = buildTeamIntelligence([agent()], toFindingHistories(runs), toMissionRuns(runs), []);
    expect(result.convergence).toEqual([
      { missionRunId: "r1", targetUrl: TARGET.url, targetName: undefined, finding: "A", agentIds: ["qa-agent", "ux-agent"], classifications: ["BUG"] },
    ]);
  });

  it("never reports a single-source finding as convergence", () => {
    const runs = [run("r1", [finding("A", [findingSource("qa-agent")])], "2026-01-01")];
    const result = buildTeamIntelligence([agent()], toFindingHistories(runs), toMissionRuns(runs), []);
    expect(result.convergence).toEqual([]);
  });

  // Case 9 — agent <-> problem type coverage
  it("maps each agent to the problem classifications it has been associated with", () => {
    const result = buildTeamIntelligence([agent({ classificationCounts: { BUG: 3, UX: 1 } })], [], [], []);
    expect(result.agentProblemCoverage[0]?.classifications.sort()).toEqual(["BUG", "UX"]);
  });

  // Case 10 — PENDING recommendations
  it("counts PENDING recommendations", () => {
    const result = buildTeamIntelligence([], [], [], [recommendation({ status: "PENDING" })]);
    expect(result.recommendationLifecycle.byStatus).toEqual({ PENDING: 1, APPROVED: 0, IGNORED: 0 });
  });

  // Case 11 — APPROVED recommendations
  it("counts APPROVED recommendations, split by whether they have an Implementation", () => {
    const approvedWithImpl = recommendation({
      id: "rec-a",
      status: "APPROVED",
      implementation: { id: "impl-1", status: "COMPLETED", validations: [] },
    });
    const approvedNoImpl = recommendation({ id: "rec-b", status: "APPROVED" });
    const result = buildTeamIntelligence([], [], [], [approvedWithImpl, approvedNoImpl]);
    expect(result.recommendationLifecycle.byStatus.APPROVED).toBe(2);
    expect(result.recommendationLifecycle.withImplementation).toBe(1);
    expect(result.recommendationLifecycle.withoutImplementation).toBe(1);
  });

  // Case 12 — IGNORED recommendations
  it("counts IGNORED recommendations", () => {
    const result = buildTeamIntelligence([], [], [], [recommendation({ status: "IGNORED" })]);
    expect(result.recommendationLifecycle.byStatus.IGNORED).toBe(1);
  });

  // Case 13 — Recommendation without Implementation
  it("flags an APPROVED Recommendation without an Implementation as an evidence gap", () => {
    const rec = recommendation({ id: "rec-gap", status: "APPROVED" });
    const result = buildTeamIntelligence([], [], [], [rec]);
    expect(result.evidenceGaps.approvedRecommendationsWithoutImplementation).toEqual([{ recommendationId: "rec-gap" }]);
  });

  it("never flags a PENDING or IGNORED Recommendation without Implementation as a gap", () => {
    const result = buildTeamIntelligence([], [], [], [recommendation({ status: "PENDING" }), recommendation({ id: "rec-2", status: "IGNORED" })]);
    expect(result.evidenceGaps.approvedRecommendationsWithoutImplementation).toEqual([]);
  });

  // Case 14 — Implementation without Validation
  it("flags an Implementation with zero Validations as an evidence gap", () => {
    const rec = recommendation({ id: "rec-x", status: "APPROVED", implementation: { id: "impl-x", status: "IN_PROGRESS", validations: [] } });
    const result = buildTeamIntelligence([], [], [], [rec]);
    expect(result.recommendationLifecycle.withoutValidation).toBe(1);
    expect(result.evidenceGaps.implementationsWithoutValidation).toEqual([{ implementationId: "impl-x", recommendationId: "rec-x" }]);
  });

  // Case 15 — an existing Validation
  it("counts an existing Validation by its status, and never flags its Implementation as missing validation", () => {
    const rec = recommendation({
      id: "rec-y",
      status: "APPROVED",
      implementation: {
        id: "impl-y",
        status: "COMPLETED",
        validations: [{ id: "val-1", status: "PASSED", retestMissionRunId: "run-2", retestTestRunId: null }],
      },
    });
    const result = buildTeamIntelligence([], [], [], [rec]);
    expect(result.recommendationLifecycle.validationsByStatus.PASSED).toBe(1);
    expect(result.recommendationLifecycle.withValidation).toBe(1);
    expect(result.evidenceGaps.implementationsWithoutValidation).toEqual([]);
    expect(result.evidenceGaps.validationsWithoutRetestReference).toEqual([]);
  });

  it("flags a Validation with no retest reference at all as an evidence gap", () => {
    const rec = recommendation({
      id: "rec-z",
      status: "APPROVED",
      implementation: { id: "impl-z", status: "COMPLETED", validations: [{ id: "val-2", status: "PASSED", retestMissionRunId: null, retestTestRunId: null }] },
    });
    const result = buildTeamIntelligence([], [], [], [rec]);
    expect(result.evidenceGaps.validationsWithoutRetestReference).toEqual([{ validationId: "val-2", implementationId: "impl-z" }]);
  });

  // Case 16 — evidence gaps, combined
  it("reports a finding with no matching Recommendation as an evidence gap, and lists classifications never observed", () => {
    const runs = [run("r1", [finding("Orphan finding", [findingSource("qa-agent", { classification: "BUG" })])], "2026-01-01")];
    const result = buildTeamIntelligence([agent()], toFindingHistories(runs), toMissionRuns(runs), []);
    expect(result.evidenceGaps.findingsWithoutRecommendation).toEqual([{ missionRunId: "r1", findingIndex: 0, finding: "Orphan finding" }]);
    expect(result.evidenceGaps.classificationsNeverObserved).toContain("PERFORMANCE");
    expect(result.evidenceGaps.classificationsNeverObserved).not.toContain("BUG");
  });

  it("never reports a gap for a finding that already has a matching Recommendation", () => {
    const runs = [run("r1", [finding("Covered finding", [findingSource("qa-agent")])], "2026-01-01")];
    const rec = recommendation({ id: "rec-covered", missionRunId: "r1", findingIndex: 0, status: "PENDING" });
    const result = buildTeamIntelligence([agent()], toFindingHistories(runs), toMissionRuns(runs), [rec]);
    expect(result.evidenceGaps.findingsWithoutRecommendation).toEqual([]);
  });

  // Case 18 — multiple sources never duplicate the finding/convergence entry
  it("counts a finding with three sources as exactly one convergence entry, never duplicated", () => {
    const runs = [run("r1", [finding("A", [findingSource("qa-agent"), findingSource("ux-agent"), findingSource("accessibility-agent")])], "2026-01-01")];
    const result = buildTeamIntelligence([agent()], toFindingHistories(runs), toMissionRuns(runs), []);
    expect(result.convergence).toHaveLength(1);
    expect(result.convergence[0]?.agentIds).toEqual(["qa-agent", "ux-agent", "accessibility-agent"]);
  });
});
