import { afterAll, afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { setModelProviderForTesting, type ModelProvider } from "@/core/models/provider";
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
});
