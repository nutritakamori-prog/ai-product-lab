import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { setModelProviderForTesting, type ModelProvider, type StructuredCompletionParams } from "@/core/models/provider";
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

/**
 * Same idea as sequentialProvider, but also records each call's params
 * (notably the fully-built prompt, which includes the Context section
 * runAgent() builds from `context` — see buildUserPrompt/buildContextBlock)
 * so a test can inspect exactly what each agent actually received.
 */
function capturingProvider(outputs: unknown[]) {
  const calls: StructuredCompletionParams<unknown>[] = [];
  let callIndex = 0;
  const provider: ModelProvider = {
    name: "coordinator-test-provider",
    completeStructured: async <T>(params: StructuredCompletionParams<T>) => {
      calls.push(params as StructuredCompletionParams<unknown>);
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
  return { provider, calls };
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

describe("coordinateAgentTask — evidence sharing", () => {
  let project: Project;
  const executionIds: string[] = [];

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Coordinator evidence-sharing test project ${Date.now()}` },
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

  const NEW_USER_WITH_EVIDENCE = {
    agent: "new-user",
    status: "FINDING" as const,
    finding: "The project name did not persist correctly.",
    evidence: 'ACTION: submitted "Full Name". EXPECTED: persisted as-is. OBSERVED: persisted as "Ful".',
    impact: "HIGH" as const,
    recommendation: "Investigate the truncation.",
    confidence: "HIGH" as const,
    classification: "BUG" as const,
    needsOtherAgent: "qa-agent" as string | null,
  };

  it("1. agente A produz evidência -> agente B recebe a mesma evidência (via context)", async () => {
    const { newUser } = await agents();
    const { provider, calls } = capturingProvider([NEW_USER_WITH_EVIDENCE, QA_AGENT_OUTPUT]);
    setModelProviderForTesting(provider);

    const result = await coordinateAgentTask({ initialAgent: newUser, project, task: "Review something" });
    trackExecutions(result);

    expect(result.sharedEvidence).toHaveLength(1);
    expect(result.sharedEvidence[0].evidence).toBe(NEW_USER_WITH_EVIDENCE.evidence);

    // What qa-agent (the second call) actually received includes the exact
    // evidence text, via the Context section runAgent() already builds.
    // (The prompt JSON-escapes the string, so check for a distinctive
    // unescaped fragment rather than the raw evidence text verbatim.)
    expect(calls).toHaveLength(2);
    expect(calls[1].prompt).toContain("persisted as-is");
    expect(calls[1].prompt).toContain("sharedEvidence");
  });

  it("2. origem da evidência é preservada (fromAgent)", async () => {
    const { newUser } = await agents();
    setModelProviderForTesting(sequentialProvider([NEW_USER_WITH_EVIDENCE, QA_AGENT_OUTPUT]));

    const result = await coordinateAgentTask({ initialAgent: newUser, project, task: "Review something" });
    trackExecutions(result);

    expect(result.sharedEvidence[0].fromAgent).toBe("new-user");
  });

  it("3. finding e evidence são preservados quando existirem", async () => {
    const { newUser } = await agents();
    setModelProviderForTesting(sequentialProvider([NEW_USER_WITH_EVIDENCE, QA_AGENT_OUTPUT]));

    const result = await coordinateAgentTask({ initialAgent: newUser, project, task: "Review something" });
    trackExecutions(result);

    expect(result.sharedEvidence[0].evidence).toBe(NEW_USER_WITH_EVIDENCE.evidence);
    expect(result.sharedEvidence[0].finding).toBe(NEW_USER_WITH_EVIDENCE.finding);
  });

  it("4. ausência de evidence não quebra o fluxo", async () => {
    const { newUser } = await agents();
    // NO_FINDING (not FINDING) with evidence: null — a FINDING with null
    // evidence would fail the pre-existing output-validator business rule
    // and trigger a retry, which isn't what this test is about.
    const { provider, calls } = capturingProvider([{ ...NEW_USER_OUTPUT, needsOtherAgent: "qa-agent" }, QA_AGENT_OUTPUT]);
    setModelProviderForTesting(provider);

    const result = await coordinateAgentTask({ initialAgent: newUser, project, task: "Review something" });
    trackExecutions(result);

    expect(result.status).toBe("COMPLETED");
    expect(result.sharedEvidence).toEqual([]);
    expect(result.agentsCalled).toEqual(["new-user", "qa-agent"]);
    // No context object was actually built/injected — same as before this
    // feature existed (buildUserPrompt's own fallback text for "no context").
    expect(calls[1].prompt).toContain("No additional context was provided for this task.");
  });

  it("6. o fluxo existente de new-user -> qa-agent continua funcionando", async () => {
    const { newUser, qaAgent } = await agents();
    setModelProviderForTesting(sequentialProvider([NEW_USER_WITH_EVIDENCE, QA_AGENT_OUTPUT]));

    const result = await coordinateAgentTask({ initialAgent: newUser, project, task: "Review something" });
    trackExecutions(result);

    expect(result.status).toBe("COMPLETED");
    expect(result.reviewResult?.output?.agent).toBe(qaAgent.id);
    expect(result.agentsCalled).toEqual(["new-user", "qa-agent"]);
  });

  it("7. limite máximo de 2 chamadas continua funcionando mesmo com evidência compartilhada", async () => {
    const { newUser } = await agents();
    setModelProviderForTesting(
      sequentialProvider([NEW_USER_WITH_EVIDENCE, { ...QA_AGENT_OUTPUT, needsOtherAgent: "new-user" }]),
    );

    const result = await coordinateAgentTask({ initialAgent: newUser, project, task: "Review something" });
    trackExecutions(result);

    expect(result.agentsCalled.length).toBeLessThanOrEqual(2);
    expect(result.agentsCalled).toEqual(["new-user", "qa-agent"]);
  });

  it("8. nenhuma chamada adicional é criada apenas para compartilhar evidência", async () => {
    const { newUser } = await agents();
    const { provider, calls } = capturingProvider([NEW_USER_WITH_EVIDENCE, QA_AGENT_OUTPUT]);
    setModelProviderForTesting(provider);

    await coordinateAgentTask({ initialAgent: newUser, project, task: "Review something" }).then(trackExecutions);

    // Exactly the two calls the flow already made without evidence sharing
    // (initial agent + specialist) — sharing rides the existing specialist
    // call, it never adds a call of its own.
    expect(calls).toHaveLength(2);
  });

  it("no needsOtherAgent -> exactly one call total, evidence sharing adds nothing", async () => {
    const { newUser } = await agents();
    const { provider, calls } = capturingProvider([{ ...NEW_USER_WITH_EVIDENCE, needsOtherAgent: null }]);
    setModelProviderForTesting(provider);

    const result = await coordinateAgentTask({ initialAgent: newUser, project, task: "Review something" });
    trackExecutions(result);

    expect(calls).toHaveLength(1);
    // Evidence was still captured and reported, even with no specialist to hand it to.
    expect(result.sharedEvidence).toHaveLength(1);
  });
});
