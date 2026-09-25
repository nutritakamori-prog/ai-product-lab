import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { setModelProviderForTesting, type ModelProvider } from "@/core/models/provider";
import { AgentRegistry } from "@/core/agents/registry";
import { runAgent } from "@/core/runtime/run-agent";
import type { Project } from "@/generated/prisma/client";

const FAKE_OUTPUT = {
  agent: "qa-agent",
  status: "FINDING" as const,
  finding: "Submitting the create-project form with an empty name created a project anyway",
  evidence:
    "ACTION: submitted the create-project form with the name field empty. EXPECTED: the submission is blocked and no project is created. OBSERVED: a project with an empty name now appears in the list.",
  impact: "HIGH" as const,
  recommendation: "Investigate why the empty-name validation did not block this submission.",
  confidence: "HIGH" as const,
  classification: "BUG" as const,
  needsOtherAgent: null,
};

function fakeProvider(): ModelProvider {
  return {
    name: "fake-test-provider",
    completeStructured: async <T>() => ({
      data: FAKE_OUTPUT as T,
      rawText: JSON.stringify(FAKE_OUTPUT),
      inputTokens: 110,
      outputTokens: 55,
      stopReason: "end_turn",
    }),
  };
}

/**
 * Same pipeline smoke test as agents/experience/new-user.test.ts, for the
 * LAB's second agent: file definition -> Registry -> Runtime -> Model
 * Provider -> validation -> AgentExecution, end to end, with a fake model
 * provider (no real tokens spent).
 */
describe("qa-agent (pipeline integration)", () => {
  let project: Project;
  const executionIds: string[] = [];

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `QA agent pipeline test ${Date.now()}` },
    });
  });

  afterEach(() => {
    setModelProviderForTesting(null);
  });

  afterAll(async () => {
    if (executionIds.length) {
      await db.agentExecution.deleteMany({ where: { id: { in: executionIds } } });
    }
    await db.project.delete({ where: { id: project.id } });
    await db.$disconnect();
  });

  it("resolves through the Registry and runs end to end through the Runtime", async () => {
    const agent = await AgentRegistry.getBySlug("qa-agent");
    expect(agent).not.toBeNull();
    if (!agent) return;

    expect(agent.category).toBe("QA");
    expect(agent.enabled).toBe(true);
    expect(agent.tokenBudget).toBeGreaterThan(0);
    expect(agent.modelTier).toBe("LOW_COST");

    setModelProviderForTesting(fakeProvider());

    const result = await runAgent({ agent, project, task: "Check whether the empty-name submission was blocked" });
    executionIds.push(result.executionId);

    expect(result.status).toBe("SUCCESS");
    expect(result.output?.finding).toBe(FAKE_OUTPUT.finding);
    expect(result.output?.classification).toBe("BUG");

    const execution = await db.agentExecution.findUniqueOrThrow({ where: { id: result.executionId } });
    expect(execution.status).toBe("SUCCESS");
    expect(execution.agentId).toBe(agent.dbId);
    expect(execution.projectId).toBe(project.id);
    expect(execution.model).toBe("claude-haiku-4-5");
    expect(execution.inputTokens).toBe(110);
    expect(execution.outputTokens).toBe(55);
    expect(execution.estimatedCost).toBeGreaterThan(0);
  });

  it("produces UNCONFIRMED, not a FINDING, when the evidence isn't conclusive", async () => {
    const agent = await AgentRegistry.getBySlug("qa-agent");
    if (!agent) throw new Error("qa-agent must exist for this test");

    const unconfirmedOutput = {
      agent: "qa-agent",
      status: "UNCONFIRMED" as const,
      finding: "The page may not have reflected the latest state, but this could not be confirmed.",
      evidence: null,
      impact: null,
      recommendation: null,
      confidence: "LOW" as const,
      classification: null,
      needsOtherAgent: null,
    };
    setModelProviderForTesting({
      name: "fake-test-provider",
      completeStructured: async <T>() => ({
        data: unconfirmedOutput as T,
        rawText: JSON.stringify(unconfirmedOutput),
        inputTokens: 90,
        outputTokens: 40,
        stopReason: "end_turn",
      }),
    });

    const result = await runAgent({ agent, project, task: "Check a step with no automated evidence" });
    executionIds.push(result.executionId);

    expect(result.status).toBe("SUCCESS");
    expect(result.output?.status).toBe("UNCONFIRMED");
    expect(result.output?.evidence).toBeNull();
  });
});
