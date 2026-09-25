import { agentMessageSchema, type AgentMessage } from "@/domain/agent-message";

/**
 * The smallest possible "Agent A sends, Agent B receives" capability.
 * In-memory only, one instance = one mailbox — no persistence, no queue
 * semantics (receive never consumes/removes), no retry, no events. Every
 * message is validated against `agentMessageSchema` before being stored, so
 * nothing malformed ever sits in the bus; the payload itself is always one
 * of agent-message.ts's structured shapes (AgentOutput-derived or a small
 * dedicated shape), never free-text reasoning — there's no field for a
 * model's chain-of-thought to land in even by accident.
 */
export class AgentMessageBus {
  private readonly messages: AgentMessage[] = [];

  /**
   * Validates and stores a message. Idempotent by `id` — sending the same
   * id twice does not create a duplicate entry; the already-stored message
   * is returned unchanged.
   */
  send(message: AgentMessage): AgentMessage {
    const validated = agentMessageSchema.parse(message);
    const existing = this.messages.find((m) => m.id === validated.id);
    if (existing) return existing;

    this.messages.push(validated);
    return validated;
  }

  /** Every message addressed to this agent, in send order. Never removes them. */
  receive(agentId: string): AgentMessage[] {
    return this.messages.filter((m) => m.toAgent === agentId);
  }

  /** Empties the bus. Mainly for test isolation between scenarios/runs. */
  clear(): void {
    this.messages.length = 0;
  }
}
