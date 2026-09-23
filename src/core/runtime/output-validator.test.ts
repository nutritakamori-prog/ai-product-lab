import { describe, expect, it } from "vitest";
import { validateAgentOutput } from "./output-validator";

const baseNoFinding = {
  agent: "new-user",
  status: "NO_FINDING" as const,
  finding: null,
  evidence: null,
  impact: null,
  recommendation: null,
  confidence: "MEDIUM" as const,
  classification: null,
  needsOtherAgent: null,
};

const baseFinding = {
  agent: "new-user",
  status: "FINDING" as const,
  finding: "Onboarding has no progress indicator",
  evidence: "ACTION: opened onboarding. EXPECTED: a step indicator. OBSERVED: none present.",
  impact: "MEDIUM" as const,
  recommendation: "Add a step indicator to the onboarding flow.",
  confidence: "HIGH" as const,
  classification: "UX" as const,
  needsOtherAgent: null,
};

describe("validateAgentOutput", () => {
  it("accepts a valid NO_FINDING result", () => {
    const result = validateAgentOutput(baseNoFinding);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.status).toBe("NO_FINDING");
    }
  });

  it("accepts a valid FINDING result with all required fields", () => {
    const result = validateAgentOutput(baseFinding);
    expect(result.valid).toBe(true);
  });

  it("rejects a FINDING result missing evidence", () => {
    const result = validateAgentOutput({ ...baseFinding, evidence: null });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/evidence/i);
    }
  });

  it("rejects a FINDING result missing impact", () => {
    const result = validateAgentOutput({ ...baseFinding, impact: null });
    expect(result.valid).toBe(false);
  });

  it("rejects a FINDING result missing recommendation", () => {
    const result = validateAgentOutput({ ...baseFinding, recommendation: null });
    expect(result.valid).toBe(false);
  });

  it("rejects a FINDING result missing classification", () => {
    const result = validateAgentOutput({ ...baseFinding, classification: null });
    expect(result.valid).toBe(false);
  });

  it("rejects an unknown status value", () => {
    const result = validateAgentOutput({ ...baseNoFinding, status: "MAYBE" });
    expect(result.valid).toBe(false);
  });

  it("rejects a completely malformed payload", () => {
    const result = validateAgentOutput({ not: "even close" });
    expect(result.valid).toBe(false);
  });

  it("never returns data alongside an error, or vice versa", () => {
    const ok = validateAgentOutput(baseNoFinding);
    const bad = validateAgentOutput({});
    expect(ok.valid && ok.error === null).toBe(true);
    expect(!bad.valid && bad.data === null).toBe(true);
  });
});
