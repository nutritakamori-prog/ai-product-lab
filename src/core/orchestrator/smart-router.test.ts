import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { setModelProviderForTesting, type ModelProvider } from "@/core/models/provider";
import { routeTask } from "./smart-router";
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

/** Returns outputs[callIndex] (last one repeats past the end) — no real LLM call. */
function sequentialProvider(outputs: unknown[]): ModelProvider {
  let callIndex = 0;
  return {
    name: "router-test-provider",
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

describe("routeTask", () => {
  let project: Project;
  const executionIds: string[] = [];

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Smart Router test project ${Date.now()}` },
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

  function trackExecutions(result: {
    coordination: { initialResult: { executionId: string }; reviewResult: { executionId: string } | null } | null;
  }) {
    if (!result.coordination) return;
    executionIds.push(result.coordination.initialResult.executionId);
    if (result.coordination.reviewResult) executionIds.push(result.coordination.reviewResult.executionId);
  }

  it("1. tarefa de onboarding -> escolhe new-user", async () => {
    setModelProviderForTesting(sequentialProvider([NEW_USER_OUTPUT]));

    const result = await routeTask({ task: "Avalie o onboarding de um novo usuário no app.", project });
    trackExecutions(result);

    expect(result.chosenAgent).toBe("new-user");
    expect(result.status).toBe("COMPLETED");
  });

  it("2. tarefa de QA -> escolhe qa-agent", async () => {
    setModelProviderForTesting(sequentialProvider([QA_AGENT_OUTPUT]));

    const result = await routeTask({ task: "Faça a validação e verificação da evidência deste bug.", project });
    trackExecutions(result);

    expect(result.chosenAgent).toBe("qa-agent");
    expect(result.status).toBe("COMPLETED");
  });

  it("3. tarefa ambígua -> COORDINATION_BLOCKED", async () => {
    // A provider that throws if ever invoked — proves routing stops before
    // calling any model at all when no rule matches (never a real LLM call,
    // never a fallback guess).
    setModelProviderForTesting({
      name: "must-not-be-called",
      completeStructured: async () => {
        throw new Error("routeTask must not call the model provider for an ambiguous task.");
      },
    });

    const result = await routeTask({ task: "Organize a reunião de amanhã às 10h.", project });

    expect(result.status).toBe("COORDINATION_BLOCKED");
    expect(result.chosenAgent).toBeNull();
    expect(result.coordination).toBeNull();
    expect(result.agentsCalled).toEqual([]);
  });

  it("4. router realmente executa o agente escolhido", async () => {
    setModelProviderForTesting(sequentialProvider([NEW_USER_OUTPUT]));

    const result = await routeTask({ task: "Verifique o processo de onboarding.", project });
    trackExecutions(result);

    expect(result.coordination).not.toBeNull();
    const executionId = result.coordination?.initialResult.executionId;
    expect(executionId).toBeTruthy();

    const execution = await db.agentExecution.findUniqueOrThrow({ where: { id: executionId! } });
    expect(execution.status).toBe("SUCCESS");
    expect(execution.output).not.toBeNull();
  });

  it("5. router respeita o limite máximo de 2 chamadas", async () => {
    setModelProviderForTesting(
      sequentialProvider([
        { ...NEW_USER_OUTPUT, needsOtherAgent: "qa-agent" },
        // qa-agent itself asks for another agent — must never be chased.
        { ...QA_AGENT_OUTPUT, needsOtherAgent: "new-user" },
      ]),
    );

    const result = await routeTask({ task: "Onboarding do novo usuário precisa de revisão de QA.", project });
    trackExecutions(result);

    expect(result.status).toBe("COMPLETED");
    expect(result.agentsCalled).toHaveLength(2);
    expect(result.agentsCalled).toEqual(["new-user", "qa-agent"]);
  });

  it("6. router não cria loop", async () => {
    setModelProviderForTesting(
      sequentialProvider([
        { ...NEW_USER_OUTPUT, needsOtherAgent: "qa-agent" },
        { ...QA_AGENT_OUTPUT, needsOtherAgent: "new-user" },
      ]),
    );

    const start = Date.now();
    const result = await routeTask({ task: "Onboarding do novo usuário precisa de revisão de QA.", project });
    trackExecutions(result);
    const elapsedMs = Date.now() - start;

    expect(result.agentsCalled).toHaveLength(2);
    expect(elapsedMs).toBeLessThan(5_000);
  });

  it("7. router não chama agente inexistente", async () => {
    setModelProviderForTesting(
      sequentialProvider([{ ...NEW_USER_OUTPUT, needsOtherAgent: "agent-that-does-not-exist" }]),
    );

    const result = await routeTask({ task: "Avalie o onboarding do novo usuário.", project });
    trackExecutions(result);

    expect(result.status).toBe("COORDINATION_BLOCKED");
    // Only the real, chosen initial agent was ever executed.
    expect(result.agentsCalled).toEqual(["new-user"]);
    expect(result.coordination?.blockedReason).toMatch(/does not exist/i);
  });

  describe("model selection integration (src/core/models/task-complexity.ts)", () => {
    it("6. an ordinary task keeps the agent's current tier — the model that actually reaches the Provider is unchanged", async () => {
      setModelProviderForTesting(sequentialProvider([NEW_USER_OUTPUT]));

      const result = await routeTask({ task: "Verifique o onboarding de um novo usuário.", project });
      trackExecutions(result);

      // new-user is configured LOW_COST by default (agents/experience/new-user.ts)
      // and this task gives no reason to escalate — same tier, same model id.
      expect(result.selectedModelTier).toBe("LOW_COST");
      const execution = await db.agentExecution.findUniqueOrThrow({
        where: { id: result.coordination!.initialResult.executionId },
      });
      expect(execution.model).toBe("claude-haiku-4-5");
    });

    it("escalates the concrete model actually used when the task text clearly demands it", async () => {
      setModelProviderForTesting(sequentialProvider([NEW_USER_OUTPUT]));

      const result = await routeTask({
        task: "Verifique o onboarding, mas isso exige uma análise profunda do fluxo completo.",
        project,
      });
      trackExecutions(result);

      expect(result.selectedModelTier).toBe("HIGH_REASONING");
      const execution = await db.agentExecution.findUniqueOrThrow({
        where: { id: result.coordination!.initialResult.executionId },
      });
      // MODEL_TIER_TO_ID (src/core/models/provider.ts, untouched) is what
      // actually turns the selected tier into the concrete model id sent
      // to the Provider.
      expect(execution.model).toBe("claude-opus-5");
    });

    it("selectedModelTier is null when routing never picks an agent at all", async () => {
      setModelProviderForTesting({
        name: "must-not-be-called",
        completeStructured: async () => {
          throw new Error("routeTask must not call the model provider for an ambiguous task.");
        },
      });

      const result = await routeTask({ task: "Organize a reunião de amanhã às 10h.", project });
      expect(result.selectedModelTier).toBeNull();
    });
  });
});

describe("routeTask — ux-agent rule", () => {
  let project: Project;
  const executionIds: string[] = [];

  const UX_AGENT_OUTPUT = {
    agent: "ux-agent",
    status: "NO_FINDING" as const,
    finding: null,
    evidence: null,
    impact: null,
    recommendation: null,
    confidence: "MEDIUM" as const,
    classification: null,
    needsOtherAgent: null as string | null,
  };

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Smart Router ux-agent test project ${Date.now()}` },
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

  function trackExecutions(result: { coordination: { initialResult: { executionId: string } } | null }) {
    if (result.coordination) executionIds.push(result.coordination.initialResult.executionId);
  }

  it("2. tarefa explícita de UX -> Router escolhe ux-agent", async () => {
    setModelProviderForTesting(sequentialProvider([UX_AGENT_OUTPUT]));

    const result = await routeTask({
      task: "Avalie a clareza do fluxo e a fricção na experiência do usuário ao criar um projeto.",
      project,
    });
    trackExecutions(result);

    expect(result.chosenAgent).toBe("ux-agent");
    expect(result.status).toBe("COMPLETED");
  });

  it("7. fluxo existente de new-user (onboarding) continua funcionando após adicionar a regra do ux-agent", async () => {
    setModelProviderForTesting(sequentialProvider([NEW_USER_OUTPUT]));

    const result = await routeTask({ task: "Avalie o onboarding de um novo usuário no app.", project });
    trackExecutions(result);

    expect(result.chosenAgent).toBe("new-user");
    expect(result.status).toBe("COMPLETED");
  });

  it("8. fluxo existente de qa-agent continua funcionando após adicionar a regra do ux-agent", async () => {
    setModelProviderForTesting(sequentialProvider([QA_AGENT_OUTPUT]));

    const result = await routeTask({ task: "Faça a validação e verificação da evidência deste bug.", project });
    trackExecutions(result);

    expect(result.chosenAgent).toBe("qa-agent");
    expect(result.status).toBe("COMPLETED");
  });

  it("9. adicionar a regra do ux-agent não gera nenhuma chamada extra em uma tarefa de onboarding comum", async () => {
    let callCount = 0;
    setModelProviderForTesting({
      name: "call-counting-provider",
      completeStructured: async <T>() => {
        callCount += 1;
        return {
          data: NEW_USER_OUTPUT as T,
          rawText: JSON.stringify(NEW_USER_OUTPUT),
          inputTokens: 10,
          outputTokens: 10,
          stopReason: "end_turn",
        };
      },
    });

    const result = await routeTask({ task: "Avalie o onboarding de um novo usuário no app.", project });
    trackExecutions(result);

    expect(callCount).toBe(1);
  });
});
