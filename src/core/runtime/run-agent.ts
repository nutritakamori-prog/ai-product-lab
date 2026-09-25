import type { ModelProviderKind, Project, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getModelProvider, MODEL_TIER_TO_ID, estimateCost } from "@/core/models/provider";
import { buildSystemPrompt, buildUserPrompt } from "@/core/runtime/build-prompt";
import { validateAgentOutput } from "@/core/runtime/output-validator";
import { agentOutputBaseSchema, type AgentOutput } from "@/domain/agent-output";
import type { ResolvedAgent } from "@/core/agents/registry";
import type { AgentMessageBus } from "@/core/messaging/agent-message-bus";

/**
 * ModelProvider.name -> the Prisma enum value recorded on AgentExecution.
 * Only "anthropic" maps to the real provider; anything else (the real
 * MockModelProvider's "mock", or a test double's own name) maps to MOCK —
 * the DB column has no third "other" value, and "not the real Anthropic
 * provider" is the honest classification for a test fake either way.
 */
function toProviderKind(name: string): ModelProviderKind {
  return name === "anthropic" ? "ANTHROPIC" : "MOCK";
}

export interface RunAgentInput {
  agent: ResolvedAgent;
  project: Pick<Project, "id">;
  task: string;
  context?: Record<string, unknown>;
  executionConfig?: { maxRetries?: number };
  /**
   * Optional. When given, and the validated output sets `needsOtherAgent`
   * to another agent's slug, a REVIEW_REQUEST is sent to it — nothing else
   * changes. Omitted (every existing caller's current behavior), this
   * never runs: runAgent's own return value and persistence are byte-for-
   * byte identical either way. Never auto-discovers a recipient — the
   * destination is only ever the slug the model itself already put in
   * `needsOtherAgent`.
   */
  messageBus?: AgentMessageBus;
}

export interface RunAgentResult {
  executionId: string;
  status: "SUCCESS" | "FAILED";
  output: AgentOutput | null;
  error: string | null;
}

const DEFAULT_MAX_RETRIES = 2;

/**
 * The Agent Runtime. Flow: load agent (done by the caller via AgentRegistry,
 * passed in as `agent`) -> load model (tier -> concrete id) -> build context
 * -> build prompt -> execute model -> validate output -> register tokens/cost
 * -> save execution -> return result. Retries on invalid output (not on
 * transport errors — the Anthropic SDK already retries those). Never saves
 * an invalid response as a successful result.
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const { agent, project, task, context } = input;
  const maxRetries = input.executionConfig?.maxRetries ?? DEFAULT_MAX_RETRIES;

  if (!agent.enabled) {
    throw new Error(`Agent "${agent.id}" is disabled and cannot be executed.`);
  }

  const model = MODEL_TIER_TO_ID[agent.modelTier];
  // Resolved before creating the execution row so which provider actually
  // answered is recorded from the start, not patched in afterward.
  const provider = getModelProvider();

  const system = buildSystemPrompt(agent);
  const prompt = buildUserPrompt(task, context);

  const execution = await db.agentExecution.create({
    data: {
      projectId: project.id,
      agentId: agent.dbId,
      task,
      status: "RUNNING",
      model,
      provider: toProviderKind(provider.name),
      input: { system, prompt, context: context ?? {} } as Prisma.InputJsonValue,
    },
  });

  const startedAt = Date.now();

  let lastError: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptPrompt: string =
      attempt === 0
        ? prompt
        : `${prompt}\n\nYour previous response was invalid: ${lastError}. Respond again, following the required format exactly.`;

    let completion;
    try {
      // Token budget enforcement: agent.tokenBudget hard-caps the response
      // via max_tokens — the API itself refuses to generate past it.
      completion = await provider.completeStructured({
        model,
        system,
        prompt: attemptPrompt,
        maxTokens: agent.tokenBudget,
        schema: agentOutputBaseSchema,
      });
    } catch (err) {
      // Transport/API errors (network, rate limit, auth) are not retried
      // here — the SDK already retries transient ones internally.
      lastError = err instanceof Error ? err.message : String(err);
      break;
    }

    inputTokens += completion.inputTokens;
    outputTokens += completion.outputTokens;

    if (!completion.data) {
      lastError = `Model did not return output matching the required schema (stop_reason: ${completion.stopReason}).`;
      continue;
    }

    const validation = validateAgentOutput(completion.data);
    if (!validation.valid) {
      lastError = validation.error;
      continue;
    }

    const durationMs = Date.now() - startedAt;
    const cost = estimateCost(model, inputTokens, outputTokens);

    await db.agentExecution.update({
      where: { id: execution.id },
      data: {
        status: "SUCCESS",
        output: validation.data as Prisma.InputJsonValue,
        inputTokens,
        outputTokens,
        estimatedCost: cost,
        durationMs,
      },
    });

    // Only when a bus was actually given and the output names a real
    // recipient — never invents one, never calls it automatically, never
    // makes another model call. A malformed slug (not this agent's job to
    // validate) fails the message's own schema, not this otherwise-
    // successful run — see agentMessageSchema's toAgent format.
    if (input.messageBus && validation.data.needsOtherAgent) {
      try {
        input.messageBus.send({
          id: `${execution.id}-review-request`,
          fromAgent: agent.id,
          toAgent: validation.data.needsOtherAgent,
          type: "REVIEW_REQUEST",
          payload: {
            reason: validation.data.finding ?? "Agent requested input from another agent.",
            evidence: validation.data.evidence,
          },
          createdAt: new Date(),
        });
      } catch {
        // Best-effort, same reasoning as elsewhere in the Test Lab: a
        // messaging problem is never a reason to treat an otherwise-valid,
        // already-persisted agent run as failed.
      }
    }

    return { executionId: execution.id, status: "SUCCESS", output: validation.data, error: null };
  }

  const durationMs = Date.now() - startedAt;
  const cost = estimateCost(model, inputTokens, outputTokens);

  await db.agentExecution.update({
    where: { id: execution.id },
    data: {
      status: "FAILED",
      error: lastError,
      inputTokens,
      outputTokens,
      estimatedCost: cost,
      durationMs,
    },
  });

  return { executionId: execution.id, status: "FAILED", output: null, error: lastError };
}
