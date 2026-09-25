import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import {
  setModelProviderForTesting,
  type ModelProvider,
  type StructuredCompletionParams,
} from "@/core/models/provider";
import { AgentRegistry } from "@/core/agents/registry";
import { runAgent } from "@/core/runtime/run-agent";
import type { Project } from "@/generated/prisma/client";

const FAKE_FINDING_OUTPUT = {
  agent: "ux-agent",
  status: "FINDING" as const,
  finding: "The create-project action is hard to find from the home screen.",
  evidence:
    "ACTION: looked for a way to create a project from the home screen. EXPECTED: a visible, discoverable action. OBSERVED: no create-project action is visible without first navigating to Projects.",
  impact: "MEDIUM" as const,
  recommendation: "Surface a create-project action directly on the home screen.",
  confidence: "MEDIUM" as const,
  classification: "UX" as const,
  needsOtherAgent: null,
};

function fakeProvider(output: unknown = FAKE_FINDING_OUTPUT): ModelProvider {
  return {
    name: "fake-test-provider",
    completeStructured: async <T>() => ({
      data: output as T,
      rawText: JSON.stringify(output),
      inputTokens: 90,
      outputTokens: 45,
      stopReason: "end_turn",
    }),
  };
}

/** Same idea as fakeProvider, but also records the fully-built prompt of each call. */
function capturingProvider(output: unknown) {
  const calls: StructuredCompletionParams<unknown>[] = [];
  const provider: ModelProvider = {
    name: "fake-test-provider",
    completeStructured: async <T>(params: StructuredCompletionParams<T>) => {
      calls.push(params as StructuredCompletionParams<unknown>);
      return {
        data: output as T,
        rawText: JSON.stringify(output),
        inputTokens: 90,
        outputTokens: 45,
        stopReason: "end_turn",
      };
    },
  };
  return { provider, calls };
}

describe("ux-agent (pipeline integration)", () => {
  let project: Project;
  const executionIds: string[] = [];

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `UX agent pipeline test ${Date.now()}` },
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

  it("1./10. está registrado corretamente no Registry, com tier inicial LOW_COST", async () => {
    const agent = await AgentRegistry.getBySlug("ux-agent");
    expect(agent).not.toBeNull();
    if (!agent) return;

    expect(agent.category).toBe("DESIGN");
    expect(agent.enabled).toBe(true);
    expect(agent.tokenBudget).toBeGreaterThan(0);
    expect(agent.modelTier).toBe("LOW_COST");
  });

  it("resolves through the Registry and runs end to end through the Runtime", async () => {
    const agent = await AgentRegistry.getBySlug("ux-agent");
    if (!agent) throw new Error("ux-agent must exist for this test");

    setModelProviderForTesting(fakeProvider());

    const result = await runAgent({ agent, project, task: "Avalie a clareza do fluxo de criação de projeto" });
    executionIds.push(result.executionId);

    expect(result.status).toBe("SUCCESS");
    expect(result.output?.finding).toBe(FAKE_FINDING_OUTPUT.finding);
    expect(result.output?.classification).toBe("UX");

    const execution = await db.agentExecution.findUniqueOrThrow({ where: { id: result.executionId } });
    expect(execution.status).toBe("SUCCESS");
    expect(execution.agentId).toBe(agent.dbId);
    expect(execution.model).toBe("claude-haiku-4-5");
  });

  it("3. usa evidência compartilhada quando disponível (via context), sem repetir a investigação", async () => {
    const agent = await AgentRegistry.getBySlug("ux-agent");
    if (!agent) throw new Error("ux-agent must exist for this test");

    const { provider, calls } = capturingProvider(FAKE_FINDING_OUTPUT);
    setModelProviderForTesting(provider);

    const sharedEvidence = [
      {
        fromAgent: "new-user",
        evidence: "OBSERVED: could not find a way to create a project from the home screen without extra navigation.",
        finding: "The create-project action is not discoverable from the home screen.",
      },
    ];

    const result = await runAgent({
      agent,
      project,
      task: "Avalie a facilidade de encontrar a ação de criar um projeto",
      context: { sharedEvidence },
    });
    executionIds.push(result.executionId);

    expect(result.status).toBe("SUCCESS");
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain("sharedEvidence");
    expect(calls[0].prompt).toContain("could not find a way to create a project from the home screen");
  });

  it("4. não inventa evidência quando não existe — evidence permanece null quando o provider não relata nenhuma", async () => {
    const agent = await AgentRegistry.getBySlug("ux-agent");
    if (!agent) throw new Error("ux-agent must exist for this test");

    const noFindingOutput = {
      agent: "ux-agent",
      status: "NO_FINDING" as const,
      finding: null,
      evidence: null,
      impact: null,
      recommendation: null,
      confidence: "MEDIUM" as const,
      classification: null,
      needsOtherAgent: null,
    };
    setModelProviderForTesting(fakeProvider(noFindingOutput));

    const result = await runAgent({ agent, project, task: "Avalie a clareza do fluxo" });
    executionIds.push(result.executionId);

    expect(result.status).toBe("SUCCESS");
    expect(result.output?.evidence).toBeNull();
    expect(result.output?.finding).toBeNull();
  });

  it("5. sem problema -> NO_FINDING", async () => {
    const agent = await AgentRegistry.getBySlug("ux-agent");
    if (!agent) throw new Error("ux-agent must exist for this test");

    const noFindingOutput = {
      agent: "ux-agent",
      status: "NO_FINDING" as const,
      finding: null,
      evidence: null,
      impact: null,
      recommendation: null,
      confidence: "MEDIUM" as const,
      classification: null,
      needsOtherAgent: null,
    };
    setModelProviderForTesting(fakeProvider(noFindingOutput));

    const result = await runAgent({ agent, project, task: "Avalie o fluxo de criação de projeto" });
    executionIds.push(result.executionId);

    expect(result.output?.status).toBe("NO_FINDING");
  });

  it("6. evidência insuficiente -> UNCONFIRMED", async () => {
    const agent = await AgentRegistry.getBySlug("ux-agent");
    if (!agent) throw new Error("ux-agent must exist for this test");

    const unconfirmedOutput = {
      agent: "ux-agent",
      status: "UNCONFIRMED" as const,
      finding: "The flow might be confusing, but this could not be confirmed from what was observed.",
      evidence: null,
      impact: null,
      recommendation: null,
      confidence: "LOW" as const,
      classification: null,
      needsOtherAgent: null,
    };
    setModelProviderForTesting(fakeProvider(unconfirmedOutput));

    const result = await runAgent({ agent, project, task: "Avalie um passo sem evidência automatizada" });
    executionIds.push(result.executionId);

    expect(result.status).toBe("SUCCESS");
    expect(result.output?.status).toBe("UNCONFIRMED");
    expect(result.output?.evidence).toBeNull();
  });

  it("9. sua existência sozinha não gera nenhuma chamada adicional (só executa quando explicitamente chamado)", async () => {
    const { provider, calls } = capturingProvider(FAKE_FINDING_OUTPUT);
    setModelProviderForTesting(provider);

    // Merely resolving the whole Registry (which now includes ux-agent)
    // never itself calls the model provider.
    const allAgents = await AgentRegistry.list();
    expect(allAgents.map((a) => a.id)).toContain("ux-agent");
    expect(calls).toHaveLength(0);
  });
});
