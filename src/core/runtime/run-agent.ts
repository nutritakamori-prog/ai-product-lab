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
 * "anthropic" and "gemini" map to their own real providers; "claude-code" is
 * this project's own manual executor (a ModelProvider object injected only
 * via setModelProviderForTesting() for a deliberate, interactive run — never
 * selected automatically by getModelProvider(), never a ClaudeCodeModelProvider
 * class). Anything else (the real MockModelProvider's "mock", or an
 * unrecognized test double's own name) maps to MOCK — a real, reasoned run
 * (Gemini, or Claude Code itself) must never be recorded as if it were faked.
 */
export function toProviderKind(name: string): ModelProviderKind {
  if (name === "anthropic") return "ANTHROPIC";
  if (name === "gemini") return "GEMINI";
  if (name === "claude-code") return "CLAUDE_CODE";
  return "MOCK";
}

/**
 * Deterministic fallback for `needsOtherAgent` — cheap, evidence-based, and
 * never an extra model/LLM call. The model's own decision always wins; this
 * only fills the slot in when the model left it null. Rule: a real,
 * evidenced FINDING from an agent whose job isn't functional verification
 * (i.e., not a QA-category agent) is exactly the case worth an automatic
 * qa-agent double-check — never for NO_FINDING/UNCONFIRMED (nothing to
 * verify), and never when a QA-category agent itself reports the finding
 * (it already is the functional check, so this can never chain into a
 * second request on its own).
 */
function deriveNeedsOtherAgent(agent: ResolvedAgent, output: AgentOutput): string | null {
  if (output.needsOtherAgent) return output.needsOtherAgent;
  if (output.status === "FINDING" && agent.category !== "QA") return "qa-agent";
  return null;
}

export interface RunAgentInput {
  agent: ResolvedAgent;
  project: Pick<Project, "id">;
  task: string;
  context?: Record<string, unknown>;
  executionConfig?: { maxRetries?: number };
  /**
   * Optional. When given, and the effective output (the model's own
   * `needsOtherAgent`, or the deterministic fallback — see
   * deriveNeedsOtherAgent below) names another agent's slug, a
   * REVIEW_REQUEST is sent to it — nothing else changes. Omitted (every
   * existing caller's current behavior), the message-sending never runs;
   * the deterministic fallback itself still applies either way (it's part
   * of the output, not the messaging).
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

  // Resolved before creating the execution row so which provider actually
  // answered is recorded from the start, not patched in afterward.
  const provider = getModelProvider();
  // Claude Code (this project's own manual executor) has no tier mapping of
  // its own — it's a single, fixed identity, not a family of concrete model
  // ids to pick between. Every other provider (Anthropic, Gemini, Mock)
  // keeps using the existing tier table unchanged.
  const model = provider.name === "claude-code" ? "claude-code" : MODEL_TIER_TO_ID[agent.modelTier];

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

    // The effective output: the model's own needsOtherAgent when it set
    // one, otherwise the deterministic fallback above — persisted and
    // returned as-is, so it's exactly what the Coordinator (and anything
    // else reading this AgentExecution) sees. Every other field is
    // untouched, byte-for-byte the model's own output.
    const effectiveOutput: AgentOutput = {
      ...validation.data,
      needsOtherAgent: deriveNeedsOtherAgent(agent, validation.data),
    };

    await db.agentExecution.update({
      where: { id: execution.id },
      data: {
        status: "SUCCESS",
        output: effectiveOutput as Prisma.InputJsonValue,
        inputTokens,
        outputTokens,
        estimatedCost: cost,
        durationMs,
      },
    });

    // Only when a bus was actually given and the (possibly derived) output
    // names a real recipient — never invents a recipient beyond the rule
    // above, never calls it automatically beyond sending this one message,
    // never makes another model call. A malformed slug (not this agent's
    // job to validate) fails the message's own schema, not this otherwise-
    // successful run — see agentMessageSchema's toAgent format.
    if (input.messageBus && effectiveOutput.needsOtherAgent) {
      try {
        input.messageBus.send({
          id: `${execution.id}-review-request`,
          fromAgent: agent.id,
          toAgent: effectiveOutput.needsOtherAgent,
          type: "REVIEW_REQUEST",
          payload: {
            reason: effectiveOutput.finding ?? "Agent requested input from another agent.",
            evidence: effectiveOutput.evidence,
          },
          createdAt: new Date(),
        });
      } catch {
        // Best-effort, same reasoning as elsewhere in the Test Lab: a
        // messaging problem is never a reason to treat an otherwise-valid,
        // already-persisted agent run as failed.
      }
    }

    return { executionId: execution.id, status: "SUCCESS", output: effectiveOutput, error: null };
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
