import { describe, expect, it } from "vitest";
import {
  aggregateAgentActivity,
  type AgentExecutionInput,
  type AgentIdentityInput,
  type MissionRunInput,
} from "./agent-activity";
import type { AgentOutput } from "@/domain/agent-output";
import type { AgentEvaluationOutcome } from "@/services/evaluation-orchestrator";
import type { ConsolidatedFinding, FinalEvaluationReport } from "@/core/findings/mission-evaluation-report";

const QA: AgentIdentityInput = { dbId: "agent-qa", slug: "qa-agent", name: "QA Agent", category: "QA" };
const UX: AgentIdentityInput = { dbId: "agent-ux", slug: "ux-agent", name: "UX Agent", category: "DESIGN" };
const NEW_USER: AgentIdentityInput = { dbId: "agent-new-user", slug: "new-user", name: "New User", category: "EXPERIENCE" };

function output(overrides: Partial<AgentOutput> = {}): AgentOutput {
  return {
    agent: "qa-agent",
    status: "NO_FINDING",
    finding: null,
    evidence: null,
    impact: null,
    recommendation: null,
    confidence: "MEDIUM",
    classification: null,
    needsOtherAgent: null,
    ...overrides,
  };
}

function execution(overrides: Partial<AgentExecutionInput> = {}): AgentExecutionInput {
  return { agentId: QA.dbId, status: "SUCCESS", output: output(), createdAt: new Date("2026-01-01T00:00:00Z"), ...overrides };
}

function findingSource(agentId: string, overrides: Partial<ConsolidatedFinding["sources"][number]> = {}): ConsolidatedFinding["sources"][number] {
  return {
    agentId,
    evidence: `evidence from ${agentId}`,
    impact: "MEDIUM",
    recommendation: "Fix it",
    confidence: "HIGH",
    classification: "BUG",
    ...overrides,
  };
}

function consolidatedFinding(text: string, sources: ConsolidatedFinding["sources"]): ConsolidatedFinding {
  return { status: "FINDING", finding: text, duplicated: sources.length > 1, sources };
}

function coverage(agentId: string, overrides: Partial<AgentEvaluationOutcome> = {}): AgentEvaluationOutcome {
  return { agentId, status: "SUCCESS", output: output(), error: null, ...overrides };
}

function missionRun(id: string, findings: ConsolidatedFinding[], coverageEntries: AgentEvaluationOutcome[]): MissionRunInput {
  const report: FinalEvaluationReport = {
    missionId: id,
    mission: { target: { url: "http://localhost:3000/qg" }, objective: "test", task: "test" },
    findings,
    coverage: coverageEntries,
  };
  return { id, report };
}

describe("aggregateAgentActivity", () => {
  it("never accesses a database — pure in-memory input/output", () => {
    const result = aggregateAgentActivity([QA], [], []);
    expect(result).toHaveLength(1);
  });

  // Case 1 — agent with no executions
  it("includes an agent with no execution/mission history at all, all zeros", () => {
    const [summary] = aggregateAgentActivity([QA], [], []);
    expect(summary).toMatchObject({
      agentId: QA.dbId,
      slug: QA.slug,
      executionCount: 0,
      firstExecutionAt: null,
      lastExecutionAt: null,
      missionParticipationCount: 0,
      findingCount: 0,
      convergenceCount: 0,
    });
    expect(summary.statusCounts).toEqual({ FINDING: 0, NO_FINDING: 0, UNCONFIRMED: 0, FAILED: 0, RUNNING: 0, BLOCKED: 0 });
  });

  // Case 2 — agent with multiple executions
  it("counts multiple executions and tracks first/last execution dates", () => {
    const executions = [
      execution({ createdAt: new Date("2026-01-05T00:00:00Z") }),
      execution({ createdAt: new Date("2026-01-01T00:00:00Z") }),
      execution({ createdAt: new Date("2026-01-10T00:00:00Z") }),
    ];
    const [summary] = aggregateAgentActivity([QA], executions, []);
    expect(summary.executionCount).toBe(3);
    expect(summary.firstExecutionAt).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(summary.lastExecutionAt).toEqual(new Date("2026-01-10T00:00:00Z"));
  });

  // Case 3 — executions in different statuses
  it("buckets executions by their real outcome status, including FAILED and RUNNING", () => {
    const executions: AgentExecutionInput[] = [
      execution({ status: "SUCCESS", output: output({ status: "FINDING" }) }),
      execution({ status: "SUCCESS", output: output({ status: "NO_FINDING" }) }),
      execution({ status: "SUCCESS", output: output({ status: "NO_FINDING" }) }),
      execution({ status: "SUCCESS", output: output({ status: "UNCONFIRMED" }) }),
      execution({ status: "FAILED", output: null }),
      execution({ status: "RUNNING", output: null }),
    ];
    const [summary] = aggregateAgentActivity([QA], executions, []);
    expect(summary.executionCount).toBe(6);
    expect(summary.statusCounts).toEqual({ FINDING: 1, NO_FINDING: 2, UNCONFIRMED: 1, FAILED: 1, RUNNING: 1, BLOCKED: 0 });
  });

  // Case 4 — agent participating in an Evaluation Mission, including a BLOCKED outcome
  it("counts mission participation from report.coverage, independent of AgentExecution, and attributes BLOCKED only from coverage", () => {
    const runs = [
      missionRun("run-1", [], [coverage(QA.slug, { status: "SUCCESS" }), coverage(UX.slug, { status: "BLOCKED", output: null })]),
    ];
    const [qaSummary, uxSummary] = aggregateAgentActivity([QA, UX], [], runs);
    expect(qaSummary.missionParticipationCount).toBe(1);
    expect(qaSummary.statusCounts.BLOCKED).toBe(0);
    expect(uxSummary.missionParticipationCount).toBe(1);
    expect(uxSummary.statusCounts.BLOCKED).toBe(1);
    // BLOCKED means no AgentExecution row exists — executionCount stays 0.
    expect(uxSummary.executionCount).toBe(0);
  });

  // Case 5 — finding with a single source
  it("counts a single-source finding once, and never as convergence", () => {
    const runs = [missionRun("run-1", [consolidatedFinding("A", [findingSource(QA.slug)])], [coverage(QA.slug)])];
    const [summary] = aggregateAgentActivity([QA], [], runs);
    expect(summary.findingCount).toBe(1);
    expect(summary.convergenceCount).toBe(0);
    expect(summary.classificationCounts).toEqual({ BUG: 1 });
  });

  // Case 6 — finding with multiple sources/agents (convergence)
  it("marks a multi-source finding as convergence for every agent that reported it", () => {
    const runs = [
      missionRun(
        "run-1",
        [consolidatedFinding("A", [findingSource(QA.slug), findingSource(UX.slug)])],
        [coverage(QA.slug), coverage(UX.slug)],
      ),
    ];
    const [qaSummary, uxSummary] = aggregateAgentActivity([QA, UX], [], runs);
    expect(qaSummary.findingCount).toBe(1);
    expect(qaSummary.convergenceCount).toBe(1);
    expect(uxSummary.findingCount).toBe(1);
    expect(uxSummary.convergenceCount).toBe(1);
  });

  // Case 7 — same agent appearing in multiple findings
  it("counts the same agent's contribution across multiple distinct findings in the same run", () => {
    const runs = [
      missionRun(
        "run-1",
        [
          consolidatedFinding("A", [findingSource(QA.slug, { classification: "BUG" })]),
          consolidatedFinding("B", [findingSource(QA.slug, { classification: "ACCESSIBILITY" })]),
        ],
        [coverage(QA.slug)],
      ),
    ];
    const [summary] = aggregateAgentActivity([QA], [], runs);
    expect(summary.findingCount).toBe(2);
    expect(summary.classificationCounts).toEqual({ BUG: 1, ACCESSIBILITY: 1 });
  });

  // Case 9 — historical data across multiple Missions
  it("accumulates findings, classifications, and participation across multiple mission runs", () => {
    const runs = [
      missionRun("run-1", [consolidatedFinding("A", [findingSource(QA.slug, { classification: "BUG" })])], [coverage(QA.slug)]),
      missionRun(
        "run-2",
        [consolidatedFinding("B", [findingSource(QA.slug, { classification: "PERFORMANCE" })])],
        [coverage(QA.slug)],
      ),
    ];
    const [summary] = aggregateAgentActivity([QA], [], runs);
    expect(summary.missionParticipationCount).toBe(2);
    expect(summary.findingCount).toBe(2);
    expect(summary.classificationCounts).toEqual({ BUG: 1, PERFORMANCE: 1 });
  });

  it("never counts the same finding twice for one agent even if sources listed it more than once", () => {
    const finding = consolidatedFinding("A", [findingSource(QA.slug), findingSource(QA.slug)]);
    const runs = [missionRun("run-1", [finding], [coverage(QA.slug)])];
    const [summary] = aggregateAgentActivity([QA], [], runs);
    expect(summary.findingCount).toBe(1);
  });

  it("ignores execution and coverage data for agent ids/slugs outside the known identities list", () => {
    const executions = [execution({ agentId: "unknown-db-id" })];
    const runs = [missionRun("run-1", [], [coverage("unknown-slug")])];
    const [summary] = aggregateAgentActivity([QA], executions, runs);
    expect(summary.executionCount).toBe(0);
    expect(summary.missionParticipationCount).toBe(0);
  });

  it("returns one summary per identity, in the same order, for a mixed set of agents", () => {
    const result = aggregateAgentActivity([QA, UX, NEW_USER], [], []);
    expect(result.map((s) => s.slug)).toEqual([QA.slug, UX.slug, NEW_USER.slug]);
  });
});
