import type { Project } from "@/generated/prisma/client";
import { AgentRegistry, type ResolvedAgent } from "@/core/agents/registry";
import { runAgent, type RunAgentResult } from "@/core/runtime/run-agent";
import { AgentMessageBus } from "@/core/messaging/agent-message-bus";
import type { AgentMessage } from "@/domain/agent-message";

/**
 * Explicit, hard-coded execution limits — never a token/cost budget (that's
 * runAgent's/agent.tokenBudget's job already). `maxReviewRounds` exists as a
 * named limit for when a real Smart Router (src/core/orchestrator/, still
 * empty) grows this into multiple rounds; this minimal coordinator only ever
 * runs at most one round regardless of the value, so it can never loop.
 */
export interface CoordinationLimits {
  maxAgentCallsPerTask: number;
  maxReviewRounds: number;
}

export const DEFAULT_COORDINATION_LIMITS: CoordinationLimits = {
  maxAgentCallsPerTask: 2,
  maxReviewRounds: 1,
};

export const COORDINATION_STATUSES = ["COMPLETED", "COORDINATION_BLOCKED", "LIMIT_REACHED"] as const;
export type CoordinationStatus = (typeof COORDINATION_STATUSES)[number];

export interface CoordinateAgentTaskInput {
  initialAgent: ResolvedAgent;
  project: Pick<Project, "id">;
  task: string;
  context?: Record<string, unknown>;
  limits?: Partial<CoordinationLimits>;
}

export interface CoordinationResult {
  status: CoordinationStatus;
  /** Why coordination stopped short of a review round. Null on COMPLETED. */
  blockedReason: string | null;
  initialResult: RunAgentResult;
  /** The specialist's run, or null if no review round happened at all. */
  reviewResult: RunAgentResult | null;
  /** The REVIEW_REQUEST/REVIEW_RESPONSE actually exchanged, in order. Empty if no round happened. */
  messages: AgentMessage[];
  /** Every agent id actually executed this task, in call order (never more than maxAgentCallsPerTask). */
  agentsCalled: string[];
}

function buildReviewTask(reviewRequest: Extract<AgentMessage, { type: "REVIEW_REQUEST" }>): string {
  return [
    "You are being asked by another agent to review a finding functionally, via a REVIEW_REQUEST.",
    `Reason for review: ${reviewRequest.payload.reason}`,
    "",
    "1. ACTION: Review the evidence received from the requesting agent.",
    "   EXPECTED: The evidence is usable for a functional judgment.",
    `   OBSERVED: ${reviewRequest.payload.evidence ?? "(no evidence attached)"}`,
    `   EVIDENCE: REVIEW_REQUEST payload.evidence = "${reviewRequest.payload.evidence}"`,
    "",
    'Based ONLY on the observation above, report status "FINDING" if there is a real, evidenced problem, "NO_FINDING" if everything worked as expected, or "UNCONFIRMED" if unsure.',
  ].join("\n");
}

function blocked(
  status: "COORDINATION_BLOCKED" | "LIMIT_REACHED",
  reason: string,
  initialResult: RunAgentResult,
  agentsCalled: string[],
): CoordinationResult {
  return { status, blockedReason: reason, initialResult, reviewResult: null, messages: [], agentsCalled };
}

/**
 * The smallest possible layer that decides WHETHER an agent's request for
 * another agent (`needsOtherAgent`) is actually allowed to happen, and wires
 * the round through the existing AgentMessageBus/runAgent/AgentRegistry —
 * it is not the Smart Router (src/core/orchestrator/, still empty/future):
 * no agent selection, no context building, no conflict resolution, no
 * consolidation, no persistence beyond what runAgent() already does. It runs
 * at most one review round, with at most `maxAgentCallsPerTask` agent
 * executions total, and never calls the same agent twice for one task.
 */
export async function coordinateAgentTask(input: CoordinateAgentTaskInput): Promise<CoordinationResult> {
  const limits: CoordinationLimits = { ...DEFAULT_COORDINATION_LIMITS, ...input.limits };
  const bus = new AgentMessageBus();
  const agentsCalled: string[] = [input.initialAgent.id];

  const initialResult = await runAgent({
    agent: input.initialAgent,
    project: input.project,
    task: input.task,
    context: input.context,
    messageBus: bus,
  });

  const needsOtherAgent =
    initialResult.status === "SUCCESS" ? (initialResult.output?.needsOtherAgent ?? null) : null;

  // Nothing requested (or the initial run itself didn't succeed) — normal
  // end, no coordination needed. Never a blocked/limit outcome.
  if (!needsOtherAgent) {
    return { status: "COMPLETED", blockedReason: null, initialResult, reviewResult: null, messages: [], agentsCalled };
  }

  if (limits.maxReviewRounds < 1) {
    return blocked("LIMIT_REACHED", `maxReviewRounds (${limits.maxReviewRounds}) allows no review round.`, initialResult, agentsCalled);
  }

  if (agentsCalled.length >= limits.maxAgentCallsPerTask) {
    return blocked(
      "LIMIT_REACHED",
      `maxAgentCallsPerTask (${limits.maxAgentCallsPerTask}) was already reached before a specialist could be called.`,
      initialResult,
      agentsCalled,
    );
  }

  // Cost control: the same agent cannot be called twice in one task — this
  // also naturally covers an agent asking to review itself.
  if (agentsCalled.includes(needsOtherAgent)) {
    return blocked(
      "LIMIT_REACHED",
      `Agent "${needsOtherAgent}" was already called in this task — the same agent cannot be called twice.`,
      initialResult,
      agentsCalled,
    );
  }

  // Security: never honor a request for an agent that doesn't exist —
  // never guessed or auto-discovered, only ever exactly what was named.
  const specialist = await AgentRegistry.getBySlug(needsOtherAgent);
  if (!specialist) {
    return blocked("COORDINATION_BLOCKED", `Agent "${needsOtherAgent}" does not exist in the Registry.`, initialResult, agentsCalled);
  }

  // runAgent() already sent the REVIEW_REQUEST as part of the initial run
  // (see src/core/runtime/run-agent.ts) — read it back rather than
  // reconstructing it, so what the specialist reviews is exactly what the
  // Runtime actually sent, never a re-derived copy.
  const [reviewRequest] = bus.receive(specialist.id);
  if (!reviewRequest || reviewRequest.type !== "REVIEW_REQUEST") {
    return blocked(
      "COORDINATION_BLOCKED",
      `No REVIEW_REQUEST was found addressed to "${specialist.id}" — nothing to review.`,
      initialResult,
      agentsCalled,
    );
  }

  const reviewResult = await runAgent({
    agent: specialist,
    project: input.project,
    task: buildReviewTask(reviewRequest),
  });
  agentsCalled.push(specialist.id);

  const responsePayload =
    reviewResult.status === "SUCCESS" && reviewResult.output
      ? {
          status: reviewResult.output.status,
          finding: reviewResult.output.finding,
          evidence: reviewResult.output.evidence,
          impact: reviewResult.output.impact,
          recommendation: reviewResult.output.recommendation,
          confidence: reviewResult.output.confidence,
          classification: reviewResult.output.classification,
          needsOtherAgent: null, // one round only — a further request is never chased here
        }
      : {
          status: "UNCONFIRMED" as const,
          finding: null,
          evidence: null,
          impact: null,
          recommendation: reviewResult.error,
          confidence: "LOW" as const,
          classification: null,
          needsOtherAgent: null,
        };

  bus.send({
    id: `${reviewResult.executionId}-review-response`,
    fromAgent: specialist.id,
    toAgent: input.initialAgent.id,
    type: "REVIEW_RESPONSE",
    payload: responsePayload,
    createdAt: new Date(),
  });

  const [reviewResponse] = bus.receive(input.initialAgent.id);

  return {
    status: "COMPLETED",
    blockedReason: null,
    initialResult,
    reviewResult,
    messages: [reviewRequest, reviewResponse],
    agentsCalled,
  };
}
