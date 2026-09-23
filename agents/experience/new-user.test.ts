import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { setModelProviderForTesting, type ModelProvider } from "@/core/models/provider";
import { AgentRegistry } from "@/core/agents/registry";
import { runAgent } from "@/core/runtime/run-agent";
import type { Project } from "@/generated/prisma/client";

const FAKE_OUTPUT = {
  agent: "new-user",
  status: "FINDING" as const,
  finding: "No clear call-to-action on first screen",
  evidence: "ACTION: opened the app. EXPECTED: an obvious next step. OBSERVED: none visible.",
  impact: "MEDIUM" as const,
  recommendation: "Add a single primary action to the first screen.",
  confidence: "MEDIUM" as const,
  classification: "UX" as const,
  needsOtherAgent: null,
};

function fakeProvider(): ModelProvider {
  return {
    completeStructured: async <T>() => ({
      data: FAKE_OUTPUT as T,
      rawText: JSON.stringify(FAKE_OUTPUT),
      inputTokens: 120,
      outputTokens: 60,
      stopReason: "end_turn",
    }),
  };
}

/**
 * The pipeline smoke test the modular-agent-library step exists to prove:
 * file definition -> Registry -> Runtime -> Model Provider -> validation ->
 * AgentExecution, end to end, using the real "new-user" agent (with a fake
 * model provider, so it costs no real tokens). If this passes, the library
 * architecture works — no need for 20 real agents to prove that.
 */
describe("new-user agent (pipeline integration)", () => {
  let project: Project;
  const executionIds: string[] = [];

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `New-user pipeline test ${Date.now()}` },
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
    const agent = await AgentRegistry.getBySlug("new-user");
    expect(agent).not.toBeNull();
    if (!agent) return;

    expect(agent.enabled).toBe(true);
    expect(agent.tokenBudget).toBeGreaterThan(0);
    expect(agent.modelTier).toBe("LOW_COST");

    setModelProviderForTesting(fakeProvider());

    const result = await runAgent({ agent, project, task: "Try the product for the first time" });
    executionIds.push(result.executionId);

    expect(result.status).toBe("SUCCESS");
    expect(result.output?.finding).toBe(FAKE_OUTPUT.finding);

    const execution = await db.agentExecution.findUniqueOrThrow({ where: { id: result.executionId } });
    expect(execution.status).toBe("SUCCESS");
    expect(execution.agentId).toBe(agent.dbId);
    expect(execution.projectId).toBe(project.id);
    expect(execution.model).toBe("claude-haiku-4-5");
    expect(execution.inputTokens).toBe(120);
    expect(execution.outputTokens).toBe(60);
    expect(execution.estimatedCost).toBeGreaterThan(0);
  });
});
