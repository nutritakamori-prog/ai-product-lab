import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { listProjects } from "@/services/projects";
import { setModelProviderForTesting, type ModelProvider } from "@/core/models/provider";
import { AgentRegistry, type ResolvedAgent } from "@/core/agents/registry";
import type { AgentOutput } from "@/domain/agent-output";
import type { Project } from "@/generated/prisma/client";
import { ScenarioRegistry } from "../scenarios/registry";
import type { TestScenario } from "../scenarios/test-protocol";
import { runTestScenario } from "./test-runner";

function fakeProviderReturning(output: AgentOutput): ModelProvider {
  return {
    name: "fake-test-provider",
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
  classification: null,
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
  classification: "BUG",
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
  classification: null,
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

    // No fake provider set. If the runner reached runAgent() at all, this
    // would go through the real (Mock, since there's no ANTHROPIC_API_KEY
    // in tests) provider instead of failing loudly — so the real proof
    // that the model was never called is executionId staying null below,
    // not an exception.
    const result = await runTestScenario({ scenario: unexecutableScenario, agent, project });
    testRunIds.push(result.testRunId);

    expect(result.status).toBe("BLOCKED");
    expect(result.findings).toEqual([]);

    const testRun = await db.testRun.findUniqueOrThrow({ where: { id: result.testRunId } });
    expect(testRun.status).toBe("BLOCKED");
    expect(testRun.executionId).toBeNull();
  });

  it(
    "closes the TestRun as NEEDS_REVIEW with finishedAt set — never stuck RUNNING — when the agent runtime throws",
    async () => {
      // A disabled agent makes runAgent() throw synchronously, before it
      // ever returns a result — the exact class of failure this test
      // guards against (an uncaught exception from the Agent Runtime,
      // reached only after the TestRun row already exists). No fake
      // provider needed: runAgent() throws before calling the model at
      // all, and this agent object is never persisted — the real "new-user"
      // Agent row stays enabled throughout.
      const disabledAgent: ResolvedAgent = { ...agent, enabled: false };

      const result = await runTestScenario({ scenario, agent: disabledAgent, project });
      testRunIds.push(result.testRunId);

      expect(result.status).toBe("NEEDS_REVIEW");
      expect(result.findings).toEqual([]);
      expect(result.infrastructureError).toMatch(/disabled/i);

      const testRun = await db.testRun.findUniqueOrThrow({ where: { id: result.testRunId } });
      expect(testRun.status).toBe("NEEDS_REVIEW");
      expect(testRun.finishedAt).not.toBeNull();
      expect(testRun.durationMs).not.toBeNull();
      expect(testRun.observedOutcome).toMatch(/infrastructure error/i);
      // Never turned into a product finding.
      expect((testRun.findings as unknown[] | null) ?? []).toEqual([]);
    },
    60_000,
  );

  it(
    "closes the TestRun as NEEDS_REVIEW with finishedAt set when the Mock provider fails, never stuck RUNNING",
    async () => {
      const failingMock: ModelProvider = {
        name: "mock",
        completeStructured: async () => {
          throw new Error("Simulated Mock provider failure.");
        },
      };
      setModelProviderForTesting(failingMock);

      const result = await runTestScenario({ scenario, agent, project });
      testRunIds.push(result.testRunId);

      expect(result.status).toBe("NEEDS_REVIEW");
      expect(result.findings).toEqual([]);

      const testRun = await db.testRun.findUniqueOrThrow({ where: { id: result.testRunId } });
      expect(testRun.status).toBe("NEEDS_REVIEW");
      expect(testRun.finishedAt).not.toBeNull();
      expect(testRun.durationMs).not.toBeNull();
      expect((testRun.findings as unknown[] | null) ?? []).toEqual([]);

      const execution = await db.agentExecution.findUniqueOrThrow({ where: { id: testRun.executionId! } });
      expect(execution.provider).toBe("MOCK");
      expect(execution.status).toBe("FAILED");
      expect(execution.error).toMatch(/simulated mock provider failure/i);
    },
    60_000,
  );

  it(
    "runs the discoverability scenario end to end through the real browser and records discovery-specific observations",
    async () => {
      const discoveryScenario = ScenarioRegistry.getById("new-user-discovers-and-creates-first-project");
      if (!discoveryScenario) throw new Error("new-user-discovers-and-creates-first-project must exist");

      setModelProviderForTesting(fakeProviderReturning(noFindingOutput));

      const result = await runTestScenario({ scenario: discoveryScenario, agent, project });
      testRunIds.push(result.testRunId);

      expect(result.status).toBe("PASSED");

      const testRun = await db.testRun.findUniqueOrThrow({ where: { id: result.testRunId } });
      expect(testRun.scenarioId).toBe("new-user-discovers-and-creates-first-project");
      const observations = testRun.observations as { action: string; observed: string }[];
      expect(observations.length).toBeGreaterThan(0);
      // The discovery-specific observation: a successful click is what
      // stands in for "the Projects link was actually visible/findable".
      expect(observations.some((o) => o.action.toLowerCase().includes("discover"))).toBe(true);
    },
    60_000,
  );

  it(
    "runs the Agents-area exploration scenario end to end through the real browser and records real page content",
    async () => {
      const agentsAreaScenario = ScenarioRegistry.getById("new-user-explores-agents-area");
      if (!agentsAreaScenario) throw new Error("new-user-explores-agents-area must exist");

      setModelProviderForTesting(fakeProviderReturning(noFindingOutput));

      const result = await runTestScenario({ scenario: agentsAreaScenario, agent, project });
      testRunIds.push(result.testRunId);

      expect(result.status).toBe("PASSED");

      const testRun = await db.testRun.findUniqueOrThrow({ where: { id: result.testRunId } });
      expect(testRun.scenarioId).toBe("new-user-explores-agents-area");
      const observations = testRun.observations as { action: string; observed: string; evidence: string }[];
      expect(observations.length).toBeGreaterThan(0);
      // Real navigation happened (not simulated): a click on the real nav
      // link, confirmed by real DOM evidence afterward.
      expect(observations.some((o) => o.action.toLowerCase().includes("agents"))).toBe(true);
      // The real content of the Agents page was actually read.
      expect(observations.some((o) => o.evidence.includes('getText("main")'))).toBe(true);
    },
    60_000,
  );

  it(
    "runs the Settings-area exploration scenario end to end through the real browser and records real page content",
    async () => {
      const settingsScenario = ScenarioRegistry.getById("new-user-explores-settings");
      if (!settingsScenario) throw new Error("new-user-explores-settings must exist");

      setModelProviderForTesting(fakeProviderReturning(noFindingOutput));

      const result = await runTestScenario({ scenario: settingsScenario, agent, project });
      testRunIds.push(result.testRunId);

      expect(result.status).toBe("PASSED");

      const testRun = await db.testRun.findUniqueOrThrow({ where: { id: result.testRunId } });
      expect(testRun.scenarioId).toBe("new-user-explores-settings");
      const observations = testRun.observations as { action: string; observed: string; evidence: string }[];
      expect(observations.length).toBeGreaterThan(0);
      // Real navigation happened (not simulated): a click on the real nav
      // link, confirmed by real DOM evidence afterward.
      expect(observations.some((o) => o.action.toLowerCase().includes("settings"))).toBe(true);
      // The real content of the Settings page was actually read.
      expect(observations.some((o) => o.evidence.includes('getText("main")'))).toBe(true);
    },
    60_000,
  );

  it(
    "runs the empty-name submission scenario end to end through the real browser, gathering real evidence of the block",
    async () => {
      const emptyNameScenario = ScenarioRegistry.getById("new-user-submits-empty-project-name");
      if (!emptyNameScenario) throw new Error("new-user-submits-empty-project-name must exist");

      setModelProviderForTesting(fakeProviderReturning(noFindingOutput));

      const result = await runTestScenario({ scenario: emptyNameScenario, agent, project });
      testRunIds.push(result.testRunId);

      expect(result.status).toBe("PASSED");

      const testRun = await db.testRun.findUniqueOrThrow({ where: { id: result.testRunId } });
      expect(testRun.scenarioId).toBe("new-user-submits-empty-project-name");
      const observations = testRun.observations as { action: string; observed: string; evidence: string }[];
      expect(observations.length).toBeGreaterThan(0);

      // The name field was genuinely observed empty before submitting —
      // never assumed.
      const beforeObservation = observations.find((o) => o.action.includes("before attempting to submit"));
      expect(beforeObservation?.observed).toContain('value is ""');

      // The real invalid submission was actually attempted, and its real
      // outcome recorded either way (never assumed to have been blocked).
      const submitObservation = observations.find((o) => o.action.includes("Attempt to submit"));
      expect(submitObservation).toBeDefined();

      // The app's real behavior, as it exists today: no required project
      // was ever actually created — since both the HTML `required`
      // attribute and the server-side Zod schema reject an empty name.
      const projects = await listProjects();
      expect(projects.some((p) => p.name === "")).toBe(false);
    },
    60_000,
  );

  it(
    "runs the create-and-return-to-list scenario end to end, confirming the project persists across real navigation",
    async () => {
      const returnScenario = ScenarioRegistry.getById("new-user-creates-project-and-returns-to-list");
      if (!returnScenario) throw new Error("new-user-creates-project-and-returns-to-list must exist");

      setModelProviderForTesting(fakeProviderReturning(noFindingOutput));

      const result = await runTestScenario({ scenario: returnScenario, agent, project });
      testRunIds.push(result.testRunId);

      expect(result.status).toBe("PASSED");

      const testRun = await db.testRun.findUniqueOrThrow({ where: { id: result.testRunId } });
      expect(testRun.scenarioId).toBe("new-user-creates-project-and-returns-to-list");
      const observations = testRun.observations as { action: string; observed: string; evidence: string }[];
      expect(observations.length).toBeGreaterThan(0);

      // Real navigation away and back actually happened, not just staying
      // on the same post-submit render.
      expect(observations.some((o) => o.action.toLowerCase().includes("navigate away"))).toBe(true);
      expect(observations.some((o) => o.action.toLowerCase().includes("return to projects"))).toBe(true);

      // The final check re-confirms persistence on a fresh page load.
      const persistedObservation = observations.find((o) =>
        o.action.includes("Confirm the created project is still visible"),
      );
      expect(persistedObservation?.observed).toMatch(/is present on the Projects page after returning/);

      // Cleanup actually ran — this scenario's own project doesn't linger
      // afterward. Checked by its exact name, not the organization's total
      // project count: other test files (e.g. round-runner.test.ts) create
      // and clean up their own projects against this same shared default
      // organization, so a raw count is not isolated from them.
      const createdName = persistedObservation?.observed.match(/The project name "([^"]+)" is present/)?.[1];
      expect(createdName).toBeTruthy();
      const after = await listProjects();
      expect(after.some((p) => p.name === createdName)).toBe(false);
    },
    60_000,
  );
});
