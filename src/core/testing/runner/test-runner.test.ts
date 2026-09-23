import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { setModelProviderForTesting, type ModelProvider } from "@/core/models/provider";
import { AgentRegistry, type ResolvedAgent } from "@/core/agents/registry";
import type { AgentOutput } from "@/domain/agent-output";
import type { Project } from "@/generated/prisma/client";
import { ScenarioRegistry } from "../scenarios/registry";
import type { TestScenario } from "../scenarios/test-protocol";
import { runTestScenario } from "./test-runner";

function fakeProviderReturning(output: AgentOutput): ModelProvider {
  return {
    completeStructured: async <T>() => ({
      data: output as T,
      rawText: JSON.stringify(output),
      inputTokens: 100,
      outputTokens: 50,
      stopReason: "end_turn",
    }),
  };
}

const noFindingOutput: AgentOutput = {
  agent: "new-user",
  status: "NO_FINDING",
  finding: null,
  evidence: null,
  impact: null,
  recommendation: null,
  confidence: "HIGH",
  needsOtherAgent: null,
};

const findingOutput: AgentOutput = {
  agent: "new-user",
  status: "FINDING",
  finding: "Project creation silently failed",
  evidence: "ACTION: created project. EXPECTED: it appears in the list. OBSERVED: it does not.",
  impact: "HIGH",
  recommendation: "Investigate the create-project service.",
  confidence: "HIGH",
  needsOtherAgent: null,
};

const unconfirmedOutput: AgentOutput = {
  agent: "new-user",
  status: "UNCONFIRMED",
  finding: "Could not verify whether the Projects page is actually reachable.",
  evidence: null,
  impact: null,
  recommendation: null,
  confidence: "LOW",
  needsOtherAgent: null,
};

describe("runTestScenario", () => {
  let project: Project;
  let agent: ResolvedAgent;
  let scenario: TestScenario;
  const testRunIds: string[] = [];

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Test runner fixture ${Date.now()}` },
    });

    const resolved = await AgentRegistry.getBySlug("new-user");
    if (!resolved) throw new Error("new-user agent must exist for this test");
    agent = resolved;

    const found = ScenarioRegistry.getById("new-user-creates-first-project");
    if (!found) throw new Error("new-user-creates-first-project scenario must exist for this test");
    scenario = found;
  });

  afterEach(() => {
    setModelProviderForTesting(null);
  });

  afterAll(async () => {
    if (testRunIds.length) {
      await db.testRun.deleteMany({ where: { id: { in: testRunIds } } });
    }
    await db.agentExecution.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.$disconnect();
  });

  // These three drive a real Next.js server + real Chromium (see
  // ../runner/app-server.ts and browser-adapter.ts) for the scenario's step
  // executor, so they're genuinely slower than an in-process unit test —
  // given a real default timeout instead of Vitest's 5s default. They
  // require a production build to already exist (`npm run build`).

  it(
    "records a PASSED run, its association, duration, and token usage via the linked execution",
    async () => {
      setModelProviderForTesting(fakeProviderReturning(noFindingOutput));

      const result = await runTestScenario({ scenario, agent, project });
      testRunIds.push(result.testRunId);

      expect(result.status).toBe("PASSED");
      expect(result.findings).toEqual([]);

      const testRun = await db.testRun.findUniqueOrThrow({ where: { id: result.testRunId } });
      expect(testRun.scenarioId).toBe(scenario.id);
      expect(testRun.agentId).toBe(agent.dbId);
      expect(testRun.projectId).toBe(project.id);
      expect(testRun.status).toBe("PASSED");
      expect(testRun.startedAt).not.toBeNull();
      expect(testRun.finishedAt).not.toBeNull();
      expect(testRun.durationMs).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(testRun.observations)).toBe(true);
      expect((testRun.observations as unknown[]).length).toBeGreaterThan(0);

      // Token usage is deliberately not duplicated onto TestRun — it's read
      // from the AgentExecution the run produced.
      expect(testRun.executionId).not.toBeNull();
      const execution = await db.agentExecution.findUniqueOrThrow({ where: { id: testRun.executionId! } });
      expect(execution.inputTokens).toBe(100);
      expect(execution.outputTokens).toBe(50);
    },
    60_000,
  );

  it(
    "records a FAILED run with findings when the agent reports a real, evidenced problem",
    async () => {
      setModelProviderForTesting(fakeProviderReturning(findingOutput));

      const result = await runTestScenario({ scenario, agent, project });
      testRunIds.push(result.testRunId);

      expect(result.status).toBe("FAILED");
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].finding).toBe(findingOutput.finding);

      const testRun = await db.testRun.findUniqueOrThrow({ where: { id: result.testRunId } });
      expect(testRun.status).toBe("FAILED");
      expect((testRun.findings as unknown[]).length).toBe(1);
    },
    60_000,
  );

  it(
    "records NEEDS_REVIEW when the agent cannot confirm a suspicion (insufficient evidence)",
    async () => {
      setModelProviderForTesting(fakeProviderReturning(unconfirmedOutput));

      const result = await runTestScenario({ scenario, agent, project });
      testRunIds.push(result.testRunId);

      expect(result.status).toBe("NEEDS_REVIEW");

      const testRun = await db.testRun.findUniqueOrThrow({ where: { id: result.testRunId } });
      expect(testRun.status).toBe("NEEDS_REVIEW");
    },
    60_000,
  );

  it("records BLOCKED without calling the agent when no step executor exists for the scenario", async () => {
    const unexecutableScenario: TestScenario = {
      ...scenario,
      id: "no-executor-for-this-scenario",
    };

    // No fake provider set — if the runner tried to call the model, this
    // would throw (no real ANTHROPIC_API_KEY in tests), proving it didn't.
    const result = await runTestScenario({ scenario: unexecutableScenario, agent, project });
    testRunIds.push(result.testRunId);

    expect(result.status).toBe("BLOCKED");
    expect(result.findings).toEqual([]);

    const testRun = await db.testRun.findUniqueOrThrow({ where: { id: result.testRunId } });
    expect(testRun.status).toBe("BLOCKED");
    expect(testRun.executionId).toBeNull();
  });
});
