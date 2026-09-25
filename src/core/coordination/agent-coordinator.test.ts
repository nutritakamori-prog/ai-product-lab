import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { setModelProviderForTesting, type ModelProvider } from "@/core/models/provider";
import { AgentRegistry } from "@/core/agents/registry";
import { coordinateAgentTask } from "./agent-coordinator";
import type { Project } from "@/generated/prisma/client";

const NEW_USER_OUTPUT = {
  agent: "new-user",
  status: "NO_FINDING" as const,
  finding: null,
  evidence: null,
  impact: null,
  recommendation: null,
  confidence: "MEDIUM" as const,
  classification: null,
  needsOtherAgent: null as string | null,
};

const QA_AGENT_OUTPUT = {
  agent: "qa-agent",
  status: "FINDING" as const,
  finding: "Confirmed functionally.",
  evidence: "ACTION: reviewed. EXPECTED: works. OBSERVED: it does not.",
  impact: "MEDIUM" as const,
  recommendation: "Fix it.",
  confidence: "HIGH" as const,
  classification: "BUG" as const,
  needsOtherAgent: null as string | null,
};

/**
 * A ModelProvider whose completeStructured returns `outputs[callIndex]` (the
 * last entry repeats if called more times than provided) — no real LLM
 * call. coordinateAgentTask always calls runAgent for the initial agent
 * first and, at most, the specialist second, so a plain call-order script
 * is enough to control both without needing to parse the prompt.
 */
function sequentialProvider(outputs: unknown[]): ModelProvider {
  let callIndex = 0;
  return {
    name: "coordinator-test-provider",
    completeStructured: async <T>() => {
      const data = outputs[Math.min(callIndex, outputs.length - 1)];
      callIndex += 1;
      return {
        data: data as T,
        rawText: JSON.stringify(data),
        inputTokens: 10,
        outputTokens: 10,
        stopReason: "end_turn",
      };
    },
  };
}

describe("coordinateAgentTask", () => {
  let project: Project;
  const executionIds: string[] = [];

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Coordinator test project ${Date.now()}` },
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

  async function agents() {
    const newUser = await AgentRegistry.getBySlug("new-user");
    const qaAgent = await AgentRegistry.getBySlug("qa-agent");
    if (!newUser || !qaAgent) throw new Error("fixtures: new-user/qa-agent must exist in the Registry");
    return { newUser, qaAgent };
  }

  function trackExecutions(result: { initialResult: { executionId: string }; reviewResult: { executionId: string } | null }) {
    executionIds.push(result.initialResult.executionId);
    if (result.reviewResult) executionIds.push(result.reviewResult.executionId);
  }

  it("1. agente pede revisão -> especialista existente é chamado", async () => {
    const { newUser, qaAgent } = await agents();
    setModelProviderForTesting(
      sequentialProvider([{ ...NEW_USER_OUTPUT, needsOtherAgent: "qa-agent" }, QA_AGENT_OUTPUT]),
    );

    const result = await coordinateAgentTask({ initialAgent: newUser, project, task: "Review something" });
    trackExecutions(result);

    expect(result.status).toBe("COMPLETED");
    expect(result.reviewResult).not.toBeNull();
    expect(result.reviewResult?.output?.agent).toBe(qaAgent.id);
    expect(result.agentsCalled).toEqual(["new-user", "qa-agent"]);
  });

  it("2. especialista responde -> resposta retorna ao agente inicial", async () => {
    const { newUser } = await agents();
    setModelProviderForTesting(
      sequentialProvider([{ ...NEW_USER_OUTPUT, needsOtherAgent: "qa-agent" }, QA_AGENT_OUTPUT]),
    );

    const result = await coordinateAgentTask({ initialAgent: newUser, project, task: "Review something" });
    trackExecutions(result);

    expect(result.messages).toHaveLength(2);
    const [request, response] = result.messages;
    expect(request.type).toBe("REVIEW_REQUEST");
    expect(request.toAgent).toBe("qa-agent");
    expect(response.type).toBe("REVIEW_RESPONSE");
    expect(response.fromAgent).toBe("qa-agent");
    expect(response.toAgent).toBe("new-user");
    if (response.type === "REVIEW_RESPONSE") {
      expect(response.payload.finding).toBe(QA_AGENT_OUTPUT.finding);
      expect(response.payload.evidence).toBe(QA_AGENT_OUTPUT.evidence);
    }
  });

  it("3. agente inexistente -> bloqueado (COORDINATION_BLOCKED)", async () => {
    const { newUser } = await agents();
    setModelProviderForTesting(
      sequentialProvider([{ ...NEW_USER_OUTPUT, needsOtherAgent: "agent-that-does-not-exist" }]),
    );

    const result = await coordinateAgentTask({ initialAgent: newUser, project, task: "Review something" });
    trackExecutions(result);

    expect(result.status).toBe("COORDINATION_BLOCKED");
    expect(result.blockedReason).toMatch(/does not exist/i);
    expect(result.reviewResult).toBeNull();
    expect(result.messages).toEqual([]);
    // Only the initial agent was ever executed — no attempt to guess a substitute.
    expect(result.agentsCalled).toEqual(["new-user"]);
  });

  it("4. segunda chamada ao mesmo agente -> bloqueada", async () => {
    const { newUser } = await agents();
    // new-user asking for itself — the same agent cannot be called twice.
    setModelProviderForTesting(sequentialProvider([{ ...NEW_USER_OUTPUT, needsOtherAgent: "new-user" }]));

    const result = await coordinateAgentTask({ initialAgent: newUser, project, task: "Review something" });
    trackExecutions(result);

    expect(result.status).toBe("LIMIT_REACHED");
    expect(result.blockedReason).toMatch(/already called/i);
    expect(result.agentsCalled).toEqual(["new-user"]);
  });

  it("5. limite de 2 chamadas é respeitado (não há terceira chamada mesmo se o especialista pedir mais)", async () => {
    const { newUser } = await agents();
    setModelProviderForTesting(
      sequentialProvider([
        { ...NEW_USER_OUTPUT, needsOtherAgent: "qa-agent" },
        // qa-agent itself asks for yet another agent — must never be chased.
        { ...QA_AGENT_OUTPUT, needsOtherAgent: "new-user" },
      ]),
    );

    const result = await coordinateAgentTask({ initialAgent: newUser, project, task: "Review something" });
    trackExecutions(result);

    expect(result.status).toBe("COMPLETED");
    expect(result.agentsCalled).toHaveLength(2);
    expect(result.agentsCalled).toEqual(["new-user", "qa-agent"]);
    // The specialist's own needsOtherAgent is never honored by this layer.
    expect(result.reviewResult?.output?.needsOtherAgent).toBe("new-user");
  });

  it("6. fluxo sem needsOtherAgent -> termina normalmente", async () => {
    const { newUser } = await agents();
    setModelProviderForTesting(sequentialProvider([NEW_USER_OUTPUT]));

    const result = await coordinateAgentTask({ initialAgent: newUser, project, task: "Review something" });
    trackExecutions(result);

    expect(result.status).toBe("COMPLETED");
    expect(result.blockedReason).toBeNull();
    expect(result.reviewResult).toBeNull();
    expect(result.messages).toEqual([]);
    expect(result.agentsCalled).toEqual(["new-user"]);
  });

  it("7. nenhum loop infinito: um ciclo de ida-e-volta sempre termina, mesmo com maxReviewRounds custom", async () => {
    const { newUser } = await agents();
    setModelProviderForTesting(
      sequentialProvider([
        { ...NEW_USER_OUTPUT, needsOtherAgent: "qa-agent" },
        { ...QA_AGENT_OUTPUT, needsOtherAgent: "new-user" },
      ]),
    );

    const start = Date.now();
    const result = await coordinateAgentTask({
      initialAgent: newUser,
      project,
      task: "Review something",
      limits: { maxReviewRounds: 5, maxAgentCallsPerTask: 10 },
    });
    trackExecutions(result);
    const elapsedMs = Date.now() - start;

    // Exactly one round happened, not five — this layer hard-stops after
    // the first REVIEW_REQUEST/REVIEW_RESPONSE exchange regardless of limits.
    expect(result.agentsCalled).toHaveLength(2);
    expect(result.status).toBe("COMPLETED");
    expect(elapsedMs).toBeLessThan(5_000);
  });

  it("maxReviewRounds = 0 blocks before any review round starts", async () => {
    const { newUser } = await agents();
    setModelProviderForTesting(sequentialProvider([{ ...NEW_USER_OUTPUT, needsOtherAgent: "qa-agent" }]));

    const result = await coordinateAgentTask({
      initialAgent: newUser,
      project,
      task: "Review something",
      limits: { maxReviewRounds: 0 },
    });
    trackExecutions(result);

    expect(result.status).toBe("LIMIT_REACHED");
    expect(result.agentsCalled).toEqual(["new-user"]);
  });
});
