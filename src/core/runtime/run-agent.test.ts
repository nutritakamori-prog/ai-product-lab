import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import {
  setModelProviderForTesting,
  type ModelProvider,
  type StructuredCompletionResult,
} from "@/core/models/provider";
import { runAgent } from "./run-agent";
import type { ResolvedAgent } from "@/core/agents/registry";
import type { Project } from "@/generated/prisma/client";

const VALID_OUTPUT = {
  agent: "test-runtime-agent",
  status: "FINDING" as const,
  finding: "Users miss the save confirmation",
  evidence: "ACTION: clicked Save. EXPECTED: a confirmation. OBSERVED: none appeared.",
  impact: "MEDIUM" as const,
  recommendation: "Show a toast on save.",
  confidence: "HIGH" as const,
  classification: "UX" as const,
  needsOtherAgent: null,
};

/**
 * Builds a ModelProvider whose completeStructured just returns `data`
 * (cast to whatever T the caller's schema implies — fine for a test double).
 */
function fakeProvider(
  handler: (callIndex: number) => unknown,
  overrides: Partial<Omit<StructuredCompletionResult<unknown>, "data">> = {},
): ModelProvider {
  let callIndex = 0;
  return {
    completeStructured: async <T>() => {
      const data = handler(callIndex++);
      return {
        data: data as T,
        rawText: data ? JSON.stringify(data) : null,
        inputTokens: 100,
        outputTokens: 50,
        stopReason: "end_turn",
        ...overrides,
      };
    },
  };
}

/**
 * A synthetic ResolvedAgent — deliberately not going through the real
 * agent library or Registry, so these tests exercise only the Runtime's
 * own generic logic (retry, persistence, budget enforcement), independent
 * of what any real agent's file happens to say.
 */
function makeTestAgent(dbId: string, overrides: Partial<ResolvedAgent> = {}): ResolvedAgent {
  return {
    id: "test-runtime-agent",
    dbId,
    name: "Test Runtime Agent",
    category: "QA",
    role: "A throwaway agent for runtime tests.",
    objective: "Nothing real.",
    responsibilities: ["Exist only for tests."],
    constraints: ["Never used outside the test suite."],
    whenNotToCall: "Never — test fixture.",
    systemPrompt: "You are a test agent.",
    tokenBudget: 500,
    modelTier: "LOW_COST",
    enabled: true,
    ...overrides,
  };
}

// Real integration test against local Postgres, with a FAKE model provider
// injected — proves the runtime's own logic (retry, persistence, token/cost
// tracking, budget enforcement) without spending real API tokens.
describe("runAgent (integration, fake provider)", () => {
  let project: Project;
  let agent: ResolvedAgent;
  const executionIds: string[] = [];

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Runtime test project ${Date.now()}` },
    });
    const row = await db.agent.create({
      data: {
        slug: `test-runtime-agent-${Date.now()}`,
        category: "QA",
        tokenBudget: 500,
        modelTier: "LOW_COST",
        enabled: true,
      },
    });
    agent = makeTestAgent(row.id);
  });

  afterEach(() => {
    setModelProviderForTesting(null);
  });

  afterAll(async () => {
    if (executionIds.length) {
      await db.agentExecution.deleteMany({ where: { id: { in: executionIds } } });
    }
    await db.agent.delete({ where: { id: agent.dbId } });
    await db.project.delete({ where: { id: project.id } });
    await db.$disconnect();
  });

  it("succeeds on the first attempt and persists tokens/cost/output", async () => {
    setModelProviderForTesting(fakeProvider(() => VALID_OUTPUT));

    const result = await runAgent({ agent, project, task: "Review the checkout flow" });
    executionIds.push(result.executionId);

    expect(result.status).toBe("SUCCESS");
    expect(result.output?.finding).toBe(VALID_OUTPUT.finding);

    const execution = await db.agentExecution.findUniqueOrThrow({ where: { id: result.executionId } });
    expect(execution.status).toBe("SUCCESS");
    expect(execution.inputTokens).toBe(100);
    expect(execution.outputTokens).toBe(50);
    expect(execution.estimatedCost).toBeGreaterThan(0);
    expect(execution.model).toBe("claude-haiku-4-5");
    expect(execution.agentId).toBe(agent.dbId);
  });

  it("retries on invalid output and succeeds on the second attempt", async () => {
    setModelProviderForTesting(
      fakeProvider((callIndex) =>
        // Missing evidence -> fails the business-rule refine, not the shape check.
        callIndex === 0 ? { ...VALID_OUTPUT, evidence: null } : VALID_OUTPUT,
      ),
    );

    const result = await runAgent({ agent, project, task: "Review the checkout flow" });
    executionIds.push(result.executionId);

    expect(result.status).toBe("SUCCESS");
  });

  it("fails after exhausting retries and records the last error", async () => {
    setModelProviderForTesting(fakeProvider(() => ({ ...VALID_OUTPUT, evidence: null })));

    const result = await runAgent({
      agent,
      project,
      task: "Review the checkout flow",
      executionConfig: { maxRetries: 1 },
    });
    executionIds.push(result.executionId);

    expect(result.status).toBe("FAILED");
    expect(result.error).toMatch(/evidence/i);

    const execution = await db.agentExecution.findUniqueOrThrow({ where: { id: result.executionId } });
    expect(execution.status).toBe("FAILED");
    expect(execution.error).toMatch(/evidence/i);
  });

  it("never saves an invalid result as a successful output", async () => {
    setModelProviderForTesting(fakeProvider(() => ({ ...VALID_OUTPUT, evidence: null })));

    const result = await runAgent({
      agent,
      project,
      task: "Review the checkout flow",
      executionConfig: { maxRetries: 0 },
    });
    executionIds.push(result.executionId);

    const execution = await db.agentExecution.findUniqueOrThrow({ where: { id: result.executionId } });
    expect(execution.output).toBeNull();
    expect(execution.status).toBe("FAILED");
  });

  it("passes the agent's tokenBudget as the model's max token cap", async () => {
    let receivedMaxTokens: number | null = null;
    const fake: ModelProvider = {
      completeStructured: async <T>(params: { maxTokens: number }) => {
        receivedMaxTokens = params.maxTokens;
        return {
          data: VALID_OUTPUT as T,
          rawText: JSON.stringify(VALID_OUTPUT),
          inputTokens: 100,
          outputTokens: 50,
          stopReason: "end_turn",
        };
      },
    };
    setModelProviderForTesting(fake);

    const result = await runAgent({ agent, project, task: "Review the checkout flow" });
    executionIds.push(result.executionId);

    expect(receivedMaxTokens).toBe(agent.tokenBudget);
  });

  it("throws without creating an execution when the agent is disabled", async () => {
    const disabledAgent = { ...agent, enabled: false };
    const before = await db.agentExecution.count({ where: { agentId: agent.dbId } });

    await expect(runAgent({ agent: disabledAgent, project, task: "x" })).rejects.toThrow(/disabled/i);

    const after = await db.agentExecution.count({ where: { agentId: agent.dbId } });
    expect(after).toBe(before);
  });
});
