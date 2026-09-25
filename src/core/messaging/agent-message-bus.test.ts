import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@/domain/agent-message";
import { AgentMessageBus } from "./agent-message-bus";

function reviewRequest(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: "msg-1",
    fromAgent: "new-user",
    toAgent: "qa-agent",
    type: "REVIEW_REQUEST",
    payload: {
      reason: "I saw the created project not appear right away — can you confirm functionally?",
      evidence: "OBSERVED: the page did not show the new project name within the wait window.",
    },
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as AgentMessage;
}

describe("AgentMessageBus", () => {
  it("delivers a message from A to B", () => {
    const bus = new AgentMessageBus();
    bus.send(reviewRequest());

    const received = bus.receive("qa-agent");
    expect(received).toHaveLength(1);
    expect(received[0].fromAgent).toBe("new-user");
    expect(received[0].toAgent).toBe("qa-agent");
  });

  it("does not deliver a message addressed to someone else", () => {
    const bus = new AgentMessageBus();
    bus.send(reviewRequest());

    expect(bus.receive("some-other-agent")).toEqual([]);
  });

  it("rejects an invalid message and never stores it", () => {
    const bus = new AgentMessageBus();

    expect(() => bus.send({ id: "bad", fromAgent: "new-user" } as unknown as AgentMessage)).toThrow();
    expect(bus.receive("qa-agent")).toEqual([]);
  });

  it("preserves id, fromAgent, toAgent, type, and payload (including evidence) exactly", () => {
    const bus = new AgentMessageBus();
    const message = reviewRequest();
    bus.send(message);

    const [received] = bus.receive("qa-agent");
    expect(received.id).toBe(message.id);
    expect(received.fromAgent).toBe(message.fromAgent);
    expect(received.toAgent).toBe(message.toAgent);
    expect(received.type).toBe(message.type);
    expect(received.payload).toEqual(message.payload);
    if (received.type === "REVIEW_REQUEST") {
      expect(received.payload.evidence).toBe(
        "OBSERVED: the page did not show the new project name within the wait window.",
      );
    }
  });

  it("does not duplicate a message sent twice with the same id", () => {
    const bus = new AgentMessageBus();
    bus.send(reviewRequest());
    bus.send(reviewRequest()); // same id — should be a no-op, not a second entry

    expect(bus.receive("qa-agent")).toHaveLength(1);
  });

  it("clear() empties the bus", () => {
    const bus = new AgentMessageBus();
    bus.send(reviewRequest());
    expect(bus.receive("qa-agent")).toHaveLength(1);

    bus.clear();

    expect(bus.receive("qa-agent")).toEqual([]);
  });

  describe("integration: new-user -> REVIEW_REQUEST -> qa-agent -> REVIEW_RESPONSE", () => {
    it("carries a controlled review round-trip with no LLM involved", () => {
      const bus = new AgentMessageBus();

      // new-user noticed something and asks qa-agent to confirm it functionally.
      const request: AgentMessage = {
        id: "req-1",
        fromAgent: "new-user",
        toAgent: "qa-agent",
        type: "REVIEW_REQUEST",
        payload: {
          reason: "The project name didn't show up right after creating it — is this a real bug?",
          evidence: "OBSERVED: page text did not contain the submitted project name after 3s.",
        },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      };
      bus.send(request);

      // qa-agent reads its inbox — a controlled object, not a real model call.
      const qaInbox = bus.receive("qa-agent");
      expect(qaInbox).toHaveLength(1);
      expect(qaInbox[0].type).toBe("REVIEW_REQUEST");

      // qa-agent verified it functionally (e.g. a direct DB check, already
      // done elsewhere in the Test Lab) and replies with its own structured
      // finding — again, a controlled object standing in for a real
      // AgentOutput, not a real model call.
      const response: AgentMessage = {
        id: "res-1",
        fromAgent: "qa-agent",
        toAgent: "new-user",
        type: "REVIEW_RESPONSE",
        payload: {
          status: "FINDING",
          finding: "Confirmed: the submitted name does not match the persisted name.",
          evidence: 'db.project.findFirst(...) -> name = "Ful", expected the full submitted name.',
          impact: "HIGH",
          recommendation: "Investigate why the persisted name differs from the submitted one.",
          confidence: "HIGH",
          classification: "BUG",
          needsOtherAgent: null,
        },
        createdAt: new Date("2026-01-01T00:00:05Z"),
      };
      bus.send(response);

      const newUserInbox = bus.receive("new-user");
      expect(newUserInbox).toHaveLength(1);
      expect(newUserInbox[0].type).toBe("REVIEW_RESPONSE");
      expect(newUserInbox[0].fromAgent).toBe("qa-agent");
      if (newUserInbox[0].type === "REVIEW_RESPONSE") {
        expect(newUserInbox[0].payload.status).toBe("FINDING");
        expect(newUserInbox[0].payload.evidence).toContain('name = "Ful"');
      }

      // Each agent only ever saw what was actually addressed to it.
      expect(bus.receive("qa-agent")).toHaveLength(1);
      expect(bus.receive("new-user")).toHaveLength(1);
    });
  });
});
