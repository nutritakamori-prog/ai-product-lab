import { z } from "zod";
import { agentOutputBaseSchema } from "./agent-output";

/**
 * The first layer of agent-to-agent communication — one agent handing a
 * structured analysis to another. Deliberately minimal: no delivery, no
 * queue, no persistence, no routing logic here — this file is only the
 * envelope's shape. Reuses `agentOutputBaseSchema` wherever a message
 * carries the same kind of analysis an AgentExecution already produces
 * (FINDING, REVIEW_RESPONSE), rather than inventing a second, competing
 * shape for evidence/finding/impact/recommendation/confidence — see
 * src/domain/agent-output.ts.
 */

export const AGENT_MESSAGE_TYPES = ["FINDING", "EVIDENCE", "REVIEW_REQUEST", "REVIEW_RESPONSE"] as const;
export type AgentMessageType = (typeof AGENT_MESSAGE_TYPES)[number];

// Same slug shape as AgentDefinition.id / TestScenario.agent — a message's
// sender/recipient is a real agent library slug, not a free-text name.
const agentSlug = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-z0-9-]+$/, "must be a lowercase kebab-case agent slug, e.g. 'new-user'");

/**
 * FINDING / REVIEW_RESPONSE payload: the existing AgentOutput contract,
 * minus `agent` — the envelope's own `fromAgent` already carries who this
 * is from, so the payload doesn't repeat it.
 */
const findingPayloadSchema = agentOutputBaseSchema.omit({ agent: true });

/** EVIDENCE payload: just the evidence text — nothing to interpret yet. */
const evidencePayloadSchema = z.object({
  evidence: z.string().trim().min(1),
});

/** REVIEW_REQUEST payload: why review is being asked for, with whatever evidence already exists. */
const reviewRequestPayloadSchema = z.object({
  reason: z.string().trim().min(1),
  evidence: z.string().trim().min(1).nullable(),
});

function messageSchema<Type extends string, Payload extends z.ZodTypeAny>(type: Type, payload: Payload) {
  return z.object({
    id: z.string().trim().min(1),
    fromAgent: agentSlug,
    toAgent: agentSlug,
    type: z.literal(type),
    payload,
    createdAt: z.date(),
  });
}

export const agentMessageSchema = z.discriminatedUnion("type", [
  messageSchema("FINDING", findingPayloadSchema),
  messageSchema("EVIDENCE", evidencePayloadSchema),
  messageSchema("REVIEW_REQUEST", reviewRequestPayloadSchema),
  messageSchema("REVIEW_RESPONSE", findingPayloadSchema),
]);

export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type FindingMessagePayload = z.infer<typeof findingPayloadSchema>;
export type EvidenceMessagePayload = z.infer<typeof evidencePayloadSchema>;
export type ReviewRequestMessagePayload = z.infer<typeof reviewRequestPayloadSchema>;
