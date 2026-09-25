import { describe, expect, it } from "vitest";
import { addSharedEvidence, buildSharedEvidenceContext, extractSharedEvidence } from "./evidence-sharing";
import type { AgentOutput } from "@/domain/agent-output";

function output(overrides: Partial<AgentOutput> = {}): AgentOutput {
  return {
    agent: "new-user",
    status: "NO_FINDING",
    finding: null,
    evidence: null,
    impact: null,
    recommendation: null,
    confidence: "MEDIUM",
    classification: null,
    needsOtherAgent: null,
    ...overrides,
  };
}

describe("extractSharedEvidence", () => {
  it("extracts only fromAgent/evidence/finding — nothing else from the output", () => {
    const entry = extractSharedEvidence(
      "new-user",
      output({
        status: "FINDING",
        finding: "The project name did not persist.",
        evidence: 'ACTION: submitted "Full Name". OBSERVED: persisted as "Ful".',
        impact: "HIGH",
        recommendation: "Investigate truncation.",
        confidence: "HIGH",
        classification: "BUG",
      }),
    );

    expect(entry).toEqual({
      fromAgent: "new-user",
      evidence: 'ACTION: submitted "Full Name". OBSERVED: persisted as "Ful".',
      finding: "The project name did not persist.",
    });
  });

  it("returns null when there is no evidence — never invents one", () => {
    expect(extractSharedEvidence("new-user", output({ evidence: null }))).toBeNull();
  });

  it("returns null when there is no output at all", () => {
    expect(extractSharedEvidence("new-user", null)).toBeNull();
  });
});

describe("addSharedEvidence", () => {
  it("adds a new entry", () => {
    const entry = { fromAgent: "new-user", evidence: "OBSERVED: X", finding: null };
    expect(addSharedEvidence([], entry)).toEqual([entry]);
  });

  it("is a no-op for a null entry", () => {
    expect(addSharedEvidence([], null)).toEqual([]);
  });

  it("does not add the same evidence twice (same fromAgent + same evidence text)", () => {
    const entry = { fromAgent: "new-user", evidence: "OBSERVED: X", finding: null };
    const once = addSharedEvidence([], entry);
    const twice = addSharedEvidence(once, entry);

    expect(twice).toHaveLength(1);
    expect(twice).toEqual([entry]);
  });

  it("adds distinct evidence from a different agent even if the text is identical", () => {
    const fromA = { fromAgent: "new-user", evidence: "OBSERVED: X", finding: null };
    const fromB = { fromAgent: "qa-agent", evidence: "OBSERVED: X", finding: null };

    const result = addSharedEvidence(addSharedEvidence([], fromA), fromB);

    expect(result).toHaveLength(2);
  });
});

describe("buildSharedEvidenceContext", () => {
  it("returns undefined for an empty list — no Context section is injected at all", () => {
    expect(buildSharedEvidenceContext([])).toBeUndefined();
  });

  it("wraps the list under a single 'sharedEvidence' key", () => {
    const entries = [{ fromAgent: "new-user", evidence: "OBSERVED: X", finding: "Something's off" }];
    expect(buildSharedEvidenceContext(entries)).toEqual({ sharedEvidence: entries });
  });
});
