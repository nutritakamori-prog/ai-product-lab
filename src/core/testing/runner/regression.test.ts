import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { AgentRegistry, type ResolvedAgent } from "@/core/agents/registry";
import type { Project, TestRunStatus } from "@/generated/prisma/client";
import { compareWithPreviousRun } from "./regression";

describe("compareWithPreviousRun", () => {
  let project: Project;
  let agent: ResolvedAgent;
  const testRunIds: string[] = [];
  let uniqueSuffix = 0;

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Regression fixture ${Date.now()}` },
    });

    const resolved = await AgentRegistry.getBySlug("new-user");
    if (!resolved) throw new Error("new-user agent must exist for this test");
    agent = resolved;
  });

  afterAll(async () => {
    if (testRunIds.length) {
      await db.testRun.deleteMany({ where: { id: { in: testRunIds } } });
    }
    await db.project.delete({ where: { id: project.id } });
    await db.$disconnect();
  });

  // Unique per call so tests never see each other's rows for "the same
  // scenario" — compareWithPreviousRun's whole job is scoped by scenarioId.
  function nextScenarioId(): string {
    uniqueSuffix += 1;
    return `regression-fixture-scenario-${Date.now()}-${uniqueSuffix}`;
  }

  async function createTestRun(scenarioId: string, status: TestRunStatus, createdAt: Date): Promise<string> {
    const testRun = await db.testRun.create({
      data: { scenarioId, agentId: agent.dbId, projectId: project.id, status, createdAt },
    });
    testRunIds.push(testRun.id);
    return testRun.id;
  }

  it("is not a regression when there is no previous run for the scenario", async () => {
    const scenarioId = nextScenarioId();
    const currentRunId = await createTestRun(scenarioId, "PASSED", new Date("2026-01-01T00:00:00Z"));

    const result = await compareWithPreviousRun({ scenarioId, currentRunId, currentStatus: "PASSED" });

    expect(result.isRegression).toBe(false);
    expect(result.previousRunId).toBeNull();
    expect(result.previousStatus).toBeNull();
    expect(result.currentStatus).toBe("PASSED");
  });

  it("is not a regression for PASSED -> PASSED", async () => {
    const scenarioId = nextScenarioId();
    await createTestRun(scenarioId, "PASSED", new Date("2026-01-01T00:00:00Z"));
    const currentRunId = await createTestRun(scenarioId, "PASSED", new Date("2026-01-02T00:00:00Z"));

    const result = await compareWithPreviousRun({ scenarioId, currentRunId, currentStatus: "PASSED" });

    expect(result.isRegression).toBe(false);
    expect(result.previousStatus).toBe("PASSED");
  });

  it("IS a regression for PASSED -> FAILED", async () => {
    const scenarioId = nextScenarioId();
    const previousRunId = await createTestRun(scenarioId, "PASSED", new Date("2026-01-01T00:00:00Z"));
    const currentRunId = await createTestRun(scenarioId, "FAILED", new Date("2026-01-02T00:00:00Z"));

    const result = await compareWithPreviousRun({ scenarioId, currentRunId, currentStatus: "FAILED" });

    expect(result.isRegression).toBe(true);
    expect(result.previousRunId).toBe(previousRunId);
    expect(result.previousStatus).toBe("PASSED");
    expect(result.currentStatus).toBe("FAILED");
  });

  it("is not a regression for FAILED -> PASSED", async () => {
    const scenarioId = nextScenarioId();
    await createTestRun(scenarioId, "FAILED", new Date("2026-01-01T00:00:00Z"));
    const currentRunId = await createTestRun(scenarioId, "PASSED", new Date("2026-01-02T00:00:00Z"));

    const result = await compareWithPreviousRun({ scenarioId, currentRunId, currentStatus: "PASSED" });

    expect(result.isRegression).toBe(false);
    expect(result.previousStatus).toBe("FAILED");
  });

  it("is not a regression for FAILED -> FAILED", async () => {
    const scenarioId = nextScenarioId();
    await createTestRun(scenarioId, "FAILED", new Date("2026-01-01T00:00:00Z"));
    const currentRunId = await createTestRun(scenarioId, "FAILED", new Date("2026-01-02T00:00:00Z"));

    const result = await compareWithPreviousRun({ scenarioId, currentRunId, currentStatus: "FAILED" });

    expect(result.isRegression).toBe(false);
    expect(result.previousStatus).toBe("FAILED");
  });

  it("with more than one previous execution, uses only the one immediately before the current run", async () => {
    const scenarioId = nextScenarioId();
    // Oldest is FAILED — if the query picked this one instead of the
    // immediately-previous row, the transition would wrongly read as
    // FAILED -> FAILED (not a regression) instead of PASSED -> FAILED.
    await createTestRun(scenarioId, "FAILED", new Date("2026-01-01T00:00:00Z"));
    const immediatelyPreviousRunId = await createTestRun(scenarioId, "PASSED", new Date("2026-01-02T00:00:00Z"));
    const currentRunId = await createTestRun(scenarioId, "FAILED", new Date("2026-01-03T00:00:00Z"));

    const result = await compareWithPreviousRun({ scenarioId, currentRunId, currentStatus: "FAILED" });

    expect(result.previousRunId).toBe(immediatelyPreviousRunId);
    expect(result.previousStatus).toBe("PASSED");
    expect(result.isRegression).toBe(true);
  });
});
