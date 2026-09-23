import { describe, expect, it } from "vitest";
import type { ResolvedAgent } from "@/core/agents/registry";
import type { AgentOutput } from "@/domain/agent-output";
import type { TestScenario } from "../scenarios/test-protocol";
import { formatRoundReport } from "./round-report";
import type { RoundEntry, TestRoundResult } from "./round-runner";

function makeScenario(overrides: Partial<TestScenario> = {}): TestScenario {
  return {
    id: "example-scenario",
    name: "Example scenario",
    description: "Does something.",
    objective: "Verify something.",
    preconditions: ["Nothing exists yet."],
    steps: ["Do the thing."],
    expectedOutcome: "The thing happened.",
    priority: "MEDIUM",
    category: "functional",
    agent: "new-user",
    enabled: true,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<ResolvedAgent> = {}): ResolvedAgent {
  return {
    id: "new-user",
    dbId: "db-id-1",
    name: "New User",
    category: "EXPERIENCE",
    role: "A first-time user.",
    objective: "Find friction.",
    responsibilities: ["Judge first impression."],
    constraints: ["Nothing outside a first session."],
    whenNotToCall: "Not for functional bugs alone.",
    systemPrompt: "You are a new user.",
    tokenBudget: 800,
    modelTier: "LOW_COST",
    enabled: true,
    ...overrides,
  };
}

const bugFinding: AgentOutput = {
  agent: "new-user",
  status: "FINDING",
  finding: "Create button does nothing",
  evidence: "ACTION: clicked submit. EXPECTED: the project is created. OBSERVED: no response.",
  impact: "CRITICAL",
  recommendation: "Fix the submit handler.",
  confidence: "HIGH",
  classification: "BUG",
  needsOtherAgent: null,
};

function makeResult(overrides: Partial<TestRoundResult> = {}): TestRoundResult {
  return {
    startedAt: new Date("2026-01-01T00:00:00Z"),
    finishedAt: new Date("2026-01-01T00:00:05Z"),
    entries: [],
    skipped: [],
    ...overrides,
  };
}

describe("formatRoundReport", () => {
  it("groups a finding under its classification type, with the exact requested fields", () => {
    const entry: RoundEntry = {
      testRunId: "run-1",
      scenario: makeScenario(),
      agent: makeAgent(),
      status: "FAILED",
      finding: bugFinding,
    };

    const report = formatRoundReport(makeResult({ entries: [entry] }));

    expect(report).toContain("[BUG] (1)");
    expect(report).toContain("Scenario: Example scenario");
    expect(report).toContain("Agent: New User");
    expect(report).toContain("Type: BUG");
    expect(report).toContain("Impact: CRITICAL");
    expect(report).toContain(
      "Evidence: ACTION: clicked submit. EXPECTED: the project is created. OBSERVED: no response.",
    );
    expect(report).toContain("Recommendation: Fix the submit handler.");
    expect(report).toContain("Confidence: HIGH");
    // Other classification types are still listed, empty.
    expect(report).toContain("[UX] (0)");
    expect(report).toContain("[ACCESSIBILITY] (0)");
  });

  it("lists a recommendation in DIRETRIZES PARA PRÓXIMA ITERAÇÃO without executing anything", () => {
    const entry: RoundEntry = {
      testRunId: "run-1",
      scenario: makeScenario(),
      agent: makeAgent(),
      status: "FAILED",
      finding: bugFinding,
    };

    const report = formatRoundReport(makeResult({ entries: [entry] }));
    const guidelinesSection = report.split("--- DIRETRIZES PARA PRÓXIMA ITERAÇÃO ---")[1];

    expect(guidelinesSection).toBeDefined();
    expect(guidelinesSection).toContain("[BUG · CRITICAL] Fix the submit handler.");
    expect(guidelinesSection).toContain("nenhuma alteração foi executada");
  });

  it("says explicitly when there is nothing to recommend", () => {
    const entry: RoundEntry = {
      testRunId: "run-1",
      scenario: makeScenario(),
      agent: makeAgent(),
      status: "PASSED",
      finding: null,
    };

    const report = formatRoundReport(makeResult({ entries: [entry] }));

    expect(report).toContain("Nenhuma recomendação nesta rodada");
  });

  it("lists skipped scenarios with their reason", () => {
    const report = formatRoundReport(
      makeResult({
        skipped: [{ scenario: makeScenario({ id: "no-agent-scenario" }), reason: 'No agent named "ghost" exists.' }],
      }),
    );

    expect(report).toContain("SKIPPED");
    expect(report).toContain('No agent named "ghost" exists.');
  });
});
