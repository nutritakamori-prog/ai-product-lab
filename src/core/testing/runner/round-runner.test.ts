import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resetEnvCacheForTesting } from "@/lib/env";
import { getDefaultOrganization } from "@/services/organizations";
import { setModelProviderForTesting, type ModelProvider } from "@/core/models/provider";
import { AgentRegistry } from "@/core/agents/registry";
import type { AgentOutput } from "@/domain/agent-output";
import { runTestRound } from "./round-runner";

const LAB_SELF_TEST_PROJECT_NAME = "AI Product Lab (self-test)";

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

function fakeProviderReturning(output: AgentOutput): ModelProvider {
  return {
    name: "fake-test-provider",
    completeStructured: async <T>() => ({
      data: output as T,
      rawText: JSON.stringify(output),
      inputTokens: 80,
      outputTokens: 40,
      stopReason: "end_turn",
    }),
  };
}

/**
 * Real browser + real server (see app-server.ts/browser-adapter.ts) for
 * both enabled scenarios in sequence, so this is genuinely slower than an
 * in-process unit test — given a real timeout instead of Vitest's 5s
 * default. Requires a production build to already exist ("npm run build").
 */
describe("runTestRound", () => {
  afterEach(() => {
    setModelProviderForTesting(null);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    const organization = await getDefaultOrganization();
    const project = await db.project.findFirst({
      where: { organizationId: organization.id, name: LAB_SELF_TEST_PROJECT_NAME },
    });
    if (project) {
      await db.testRun.deleteMany({ where: { projectId: project.id } });
      await db.agentExecution.deleteMany({ where: { projectId: project.id } });
      await db.project.delete({ where: { id: project.id } });
    }
    await db.$disconnect();
  });

  it(
    "runs every enabled scenario once, each with the agent it declares, and reports nothing skipped",
    async () => {
      setModelProviderForTesting(fakeProviderReturning(noFindingOutput));

      const result = await runTestRound();

      expect(result.skipped).toEqual([]);
      expect(result.entries.length).toBeGreaterThanOrEqual(2);
      expect(result.entries.map((entry) => entry.scenario.id)).toEqual(
        expect.arrayContaining(["new-user-creates-first-project", "new-user-discovers-and-creates-first-project"]),
      );
      for (const entry of result.entries) {
        expect(entry.agent.id).toBe(entry.scenario.agent);
        expect(entry.status).toBe("PASSED");
        expect(entry.finding).toBeNull();
      }

      // Every entry's TestRun is really persisted, scoped to the shared LAB project.
      const organization = await getDefaultOrganization();
      const project = await db.project.findFirstOrThrow({
        where: { organizationId: organization.id, name: LAB_SELF_TEST_PROJECT_NAME },
      });
      for (const entry of result.entries) {
        const testRun = await db.testRun.findUniqueOrThrow({ where: { id: entry.testRunId } });
        expect(testRun.projectId).toBe(project.id);
      }
    },
    90_000,
  );

  it(
    "continues to the next scenario when one scenario fails before a TestRun exists, instead of aborting the round",
    async () => {
      setModelProviderForTesting(fakeProviderReturning(noFindingOutput));

      // Simulates an infrastructure error while resolving the FIRST
      // scenario's agent (e.g. a transient DB hiccup) — a real, reachable
      // failure point in runTestRound()'s own loop, upstream of
      // runTestScenario(). The second call falls through to the real
      // AgentRegistry so the next scenario still runs normally.
      const originalGetBySlug = AgentRegistry.getBySlug.bind(AgentRegistry);
      let calls = 0;
      vi.spyOn(AgentRegistry, "getBySlug").mockImplementation(async (slug: string) => {
        calls += 1;
        if (calls === 1) {
          throw new Error("Simulated infrastructure error while resolving the agent.");
        }
        return originalGetBySlug(slug);
      });

      const result = await runTestRound();

      // The round did not abort: it recorded the first scenario's failure
      // and still attempted every remaining one.
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toMatch(/infrastructure error/i);
      expect(result.skipped[0].reason).toMatch(/simulated/i);

      expect(result.entries.length).toBeGreaterThanOrEqual(2);
      for (const entry of result.entries) {
        expect(entry.status).toBe("PASSED");
        expect(entry.infrastructureError).toBeNull();

        const testRun = await db.testRun.findUniqueOrThrow({ where: { id: entry.testRunId } });
        expect(testRun.status).toBe("PASSED");
        expect(testRun.finishedAt).not.toBeNull();
      }

      // Together, the skipped scenario and the completed ones are all the
      // real enabled scenarios — nothing was silently dropped.
      const allScenarioIds = [result.skipped[0].scenario.id, ...result.entries.map((e) => e.scenario.id)];
      expect(allScenarioIds).toEqual(
        expect.arrayContaining([
          "new-user-creates-first-project",
          "new-user-discovers-and-creates-first-project",
          "new-user-explores-agents-area",
        ]),
      );
    },
    90_000,
  );

  it(
    "keeps working end to end with the real Mock provider (no ANTHROPIC_API_KEY, no fake injected)",
    async () => {
      const originalKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      resetEnvCacheForTesting();
      setModelProviderForTesting(null); // no test fake — this is the real, automatic Mock fallback

      try {
        const result = await runTestRound();

        expect(result.skipped).toEqual([]);
        expect(result.entries.length).toBeGreaterThanOrEqual(2);
        for (const entry of result.entries) {
          // Never stuck, never an unhandled crash — every entry reached a
          // real, closed status.
          expect(["PASSED", "FAILED", "NEEDS_REVIEW"]).toContain(entry.status);

          const testRun = await db.testRun.findUniqueOrThrow({ where: { id: entry.testRunId } });
          expect(testRun.finishedAt).not.toBeNull();
          expect(testRun.executionId).not.toBeNull();

          const execution = await db.agentExecution.findUniqueOrThrow({ where: { id: testRun.executionId! } });
          expect(execution.provider).toBe("MOCK");
        }
      } finally {
        if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = originalKey;
        resetEnvCacheForTesting();
      }
    },
    90_000,
  );
});
