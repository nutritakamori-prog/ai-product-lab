import { describe, expect, it } from "vitest";
import { agentSchema } from "./agent";

const validAgent = {
  slug: "new-user",
  name: "New User",
  type: "EXPERIENCE" as const,
  description: "Simulates someone who has never used the product before.",
  responsibility: "Evaluate first impression, onboarding clarity, and initial friction.",
  whenNotToCall: "Do not call for a plain functional bug report with no UX dimension.",
  systemPrompt: "You are simulating a brand-new user...",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  tokenBudget: 4000,
};

describe("agentSchema", () => {
  it("accepts a minimal valid agent and fills in defaults", () => {
    const result = agentSchema.parse(validAgent);
    expect(result.priority).toBe("MEDIUM");
    expect(result.recommendedModel).toBe("BALANCED");
    expect(result.enabled).toBe(false);
    expect(result.capabilities).toEqual([]);
  });

  it("rejects a slug that isn't lowercase kebab-case", () => {
    expect(() => agentSchema.parse({ ...validAgent, slug: "New User" })).toThrow();
  });

  it("requires whenNotToCall to be non-empty", () => {
    expect(() => agentSchema.parse({ ...validAgent, whenNotToCall: "" })).toThrow();
  });

  it("rejects an unknown agent type", () => {
    expect(() => agentSchema.parse({ ...validAgent, type: "MARKETING" })).toThrow();
  });
});
