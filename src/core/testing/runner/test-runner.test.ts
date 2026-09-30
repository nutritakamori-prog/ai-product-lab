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

describe("runTestScenario — real collaboration via Smart Router + Agent Coordinator", () => {
  let project: Project;
  let newUserAgent: ResolvedAgent;
  let scenario: TestScenario;
  const testRunIds: string[] = [];
  const executionIds: string[] = [];

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Collaboration fixture ${Date.now()}` },
    });

    const resolved = await AgentRegistry.getBySlug("new-user");
    if (!resolved) throw new Error("new-user agent must exist for this test");
    newUserAgent = resolved;

    const qa = await AgentRegistry.getBySlug("qa-agent");
    if (!qa) throw new Error("qa-agent must exist for this test");

    const found = ScenarioRegistry.getById("new-user-creates-first-project");
    if (!found) throw new Error("new-user-creates-first-project scenario must exist for this test");
    scenario = found;
  });

  afterEach(() => {
    setModelProviderForTesting(null);
  });

  afterAll(async () => {
    if (testRunIds.length) await db.testRun.deleteMany({ where: { id: { in: testRunIds } } });
    if (executionIds.length) await db.agentExecution.deleteMany({ where: { id: { in: executionIds } } });
    await db.project.delete({ where: { id: project.id } }).catch(() => {});
    await db.$disconnect();
  });

  /** Returns outputs[callIndex] (last one repeats past the end) — no wrapper, no forced field, no real LLM call. */
  function sequentialFakeProvider(outputs: AgentOutput[]): ModelProvider {
    let callIndex = 0;
    return {
      name: "fake-test-provider",
      completeStructured: async <T>() => {
        const data = outputs[Math.min(callIndex, outputs.length - 1)];
        callIndex += 1;
        return {
          data: data as T,
          rawText: JSON.stringify(data),
          inputTokens: 100,
          outputTokens: 50,
          stopReason: "end_turn",
        };
      },
    };
  }

  it("no finding -> exactly one agent call, no collaboration (existing behavior unchanged)", async () => {
    setModelProviderForTesting(sequentialFakeProvider([noFindingOutput]));

    const result = await runTestScenario({ scenario, agent: newUserAgent, project, useSmartRouter: true });
    testRunIds.push(result.testRunId);
    if (result.coordination) executionIds.push(result.coordination.initialResult.executionId);

    expect(result.coordination).not.toBeNull();
    expect(result.coordination?.agentsCalled).toEqual(["new-user"]);
    expect(result.coordination?.messages).toEqual([]);
    expect(result.coordination?.initialResult.output?.needsOtherAgent).toBeNull();
    expect(result.status).toBe("PASSED");
  });

  it(
    "a real FINDING deterministically triggers collaboration — no artificial wrapper: new-user -> REVIEW_REQUEST -> qa-agent -> REVIEW_RESPONSE via the real AgentMessageBus, exactly two agent calls",
    async () => {
      // Plain fake providers, exactly like every other test in this file —
      // no wrapper, no field forced onto the output. The model/Mock still
      // never sets needsOtherAgent itself (findingOutput leaves it null,
      // same as it's defined at the top of this file); run-agent.ts's own
      // deterministic rule (deriveNeedsOtherAgent) is what fills it in from
      // the FINDING itself. The second call (qa-agent's own review) reports
      // no further problem, so nothing chains beyond this one round.
      setModelProviderForTesting(sequentialFakeProvider([findingOutput, noFindingOutput]));

      const result = await runTestScenario({ scenario, agent: newUserAgent, project, useSmartRouter: true });
      testRunIds.push(result.testRunId);
      if (result.coordination) {
        executionIds.push(result.coordination.initialResult.executionId);
        if (result.coordination.reviewResult) executionIds.push(result.coordination.reviewResult.executionId);
      }

      // Exactly one review round, exactly two agent calls total.
      expect(result.coordination).not.toBeNull();
      expect(result.coordination?.agentsCalled).toEqual(["new-user", "qa-agent"]);

      // The initial agent's own effective output now reflects the
      // deterministic decision — derived from its FINDING, never set by a
      // test wrapper and never a model/LLM call to decide it.
      expect(result.coordination?.initialResult.output?.needsOtherAgent).toBe("qa-agent");

      // REVIEW_REQUEST and REVIEW_RESPONSE were both actually exchanged via
      // the real AgentMessageBus — not merely two independent agent calls
      // that happen to have run one after another.
      expect(result.coordination?.messages).toHaveLength(2);
      const [request, response] = result.coordination?.messages ?? [];
      expect(request?.type).toBe("REVIEW_REQUEST");
      expect(request?.fromAgent).toBe("new-user");
      expect(request?.toAgent).toBe("qa-agent");
      expect(response?.type).toBe("REVIEW_RESPONSE");
      expect(response?.fromAgent).toBe("qa-agent");
      expect(response?.toAgent).toBe("new-user");

      // The scenario's own status is still computed normally from the
      // initial agent's own result, and the TestRun row is closed exactly
      // as it always is.
      expect(result.status).toBe("FAILED");
      const testRun = await db.testRun.findUniqueOrThrow({ where: { id: result.testRunId } });
      expect(testRun.status).toBe("FAILED");
      expect(testRun.executionId).toBe(result.coordination?.initialResult.executionId);
    },
    60_000,
  );
});

describe("runTestScenario — UX Agent real integration via Smart Router", () => {
  let project: Project;
  let uxAgent: ResolvedAgent;
  let scenario: TestScenario;
  const testRunIds: string[] = [];
  const executionIds: string[] = [];

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `UX scenario fixture ${Date.now()}` },
    });

    const resolved = await AgentRegistry.getBySlug("ux-agent");
    if (!resolved) throw new Error("ux-agent must exist for this test");
    uxAgent = resolved;

    const found = ScenarioRegistry.getById("ux-agent-evaluates-project-creation-flow-clarity");
    if (!found) throw new Error("ux-agent-evaluates-project-creation-flow-clarity scenario must exist for this test");
    scenario = found;
  });

  afterEach(() => {
    setModelProviderForTesting(null);
  });

  afterAll(async () => {
    if (testRunIds.length) await db.testRun.deleteMany({ where: { id: { in: testRunIds } } });
    if (executionIds.length) await db.agentExecution.deleteMany({ where: { id: { in: executionIds } } });
    await db.project.delete({ where: { id: project.id } }).catch(() => {});
    await db.$disconnect();
  });

  it(
    "runs the real UX scenario through Smart Router -> Agent Coordinator -> Agent Runtime -> ux-agent, with real BrowserAdapter evidence",
    async () => {
      // No fake, no wrapper — the real, automatic Mock Provider (Model
      // Provider is untouched; ANTHROPIC_API_KEY is empty in this
      // environment, so getModelProvider() picks Mock on its own).
      setModelProviderForTesting(null);

      const result = await runTestScenario({ scenario, agent: uxAgent, project, useSmartRouter: true });
      testRunIds.push(result.testRunId);
      if (result.coordination) executionIds.push(result.coordination.initialResult.executionId);

      // The Smart Router really chose ux-agent from this scenario's own
      // task text — never a different agent silently substituted.
      expect(result.coordination).not.toBeNull();
      expect(result.coordination?.agentsCalled[0]).toBe("ux-agent");

      const execution = await db.agentExecution.findUniqueOrThrow({
        where: { id: result.coordination!.initialResult.executionId },
      });
      expect(execution.agentId).toBe(uxAgent.dbId);
      expect(execution.status).toBe("SUCCESS");

      // Automatic model selection (src/core/models/task-complexity.ts) is
      // already wired into this exact real path — see smart-router.ts's
      // routeTask(), which every useSmartRouter=true scenario goes through.
      // This scenario's own real task text has no complexity trigger, so
      // the selected tier is ux-agent's own default (LOW_COST) — the
      // persisted model id confirms the selection genuinely drove what was
      // actually sent to the Provider, not bypassed.
      expect(execution.model).toBe("claude-haiku-4-5");

      const testRun = await db.testRun.findUniqueOrThrow({ where: { id: result.testRunId } });
      expect(testRun.agentId).toBe(uxAgent.dbId);
      expect(["PASSED", "FAILED", "NEEDS_REVIEW"]).toContain(testRun.status);
      expect(testRun.status).toBe(result.status);

      // Real evidence actually gathered by the real BrowserAdapter — never
      // fabricated observations.
      const observations = testRun.observations as { action: string; observed: string; evidence: string }[];
      expect(observations.length).toBeGreaterThan(0);
      expect(observations.some((o) => o.evidence.includes("page.goto"))).toBe(true);
      expect(observations.some((o) => o.evidence.includes("getText"))).toBe(true);
    },
    60_000,
  );
});
