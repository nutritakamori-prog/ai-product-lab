import { describe, expect, it } from "vitest";
import { agentMessageSchema } from "./agent-message";

const finding = {
  status: "FINDING" as const,
  finding: "Empty-name submission created a project anyway",
  evidence: "ACTION: submitted with empty name. EXPECTED: blocked. OBSERVED: project created.",
  impact: "HIGH" as const,
  recommendation: "Investigate the validation bypass.",
  confidence: "HIGH" as const,
  classification: "BUG" as const,
  needsOtherAgent: null,
};

function baseMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    fromAgent: "qa-agent",
    toAgent: "new-user",
    type: "FINDING",
    payload: finding,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("agentMessageSchema", () => {
  it("accepts a well-formed FINDING message", () => {
    const result = agentMessageSchema.parse(baseMessage());
    expect(result.type).toBe("FINDING");
    if (result.type === "FINDING") {
      expect(result.payload.finding).toBe(finding.finding);
    }
  });

  it("accepts a well-formed EVIDENCE message", () => {
    const result = agentMessageSchema.parse(
      baseMessage({ type: "EVIDENCE", payload: { evidence: "OBSERVED: the page did not update." } }),
    );
    expect(result.type).toBe("EVIDENCE");
  });

  it("accepts a well-formed REVIEW_REQUEST message, with evidence optionally null", () => {
    const result = agentMessageSchema.parse(
      baseMessage({ type: "REVIEW_REQUEST", payload: { reason: "Please confirm this finding.", evidence: null } }),
    );
    expect(result.type).toBe("REVIEW_REQUEST");
  });

  it("accepts a well-formed REVIEW_RESPONSE message, reusing the AgentOutput shape", () => {
    const result = agentMessageSchema.parse(baseMessage({ type: "REVIEW_RESPONSE", payload: finding }));
    expect(result.type).toBe("REVIEW_RESPONSE");
  });

  it("rejects an unknown message type", () => {
    expect(() => agentMessageSchema.parse(baseMessage({ type: "BROADCAST" }))).toThrow();
  });

  it("rejects a fromAgent/toAgent that isn't a lowercase kebab-case slug", () => {
    expect(() => agentMessageSchema.parse(baseMessage({ fromAgent: "QA Agent" }))).toThrow();
    expect(() => agentMessageSchema.parse(baseMessage({ toAgent: "New User" }))).toThrow();
  });

  it("rejects a FINDING payload missing required AgentOutput fields", () => {
    expect(() => agentMessageSchema.parse(baseMessage({ payload: { status: "FINDING" } }))).toThrow();
  });

  it("rejects an EVIDENCE payload with empty evidence text", () => {
    expect(() =>
      agentMessageSchema.parse(baseMessage({ type: "EVIDENCE", payload: { evidence: "" } })),
    ).toThrow();
  });

  it("rejects a REVIEW_REQUEST payload missing a reason", () => {
    expect(() =>
      agentMessageSchema.parse(baseMessage({ type: "REVIEW_REQUEST", payload: { evidence: null } })),
    ).toThrow();
  });
});
