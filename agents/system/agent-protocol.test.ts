import { describe, expect, it } from "vitest";
import { agentDefinitionSchema } from "./agent-protocol";

const validDefinition = {
  id: "new-user",
  name: "New User",
  category: "EXPERIENCE" as const,
  role: "Someone using the product for the first time.",
  objective: "Simulate a first-time user and find obvious friction.",
  responsibilities: ["Judge first impression."],
  constraints: ["Do not evaluate features a first-time user wouldn't reach."],
  whenNotToCall: "Do not call for a plain functional bug report.",
  systemPrompt: "You are simulating a brand-new user...",
  tokenBudget: 800,
  modelTier: "LOW_COST" as const,
  enabled: true,
};

describe("agentDefinitionSchema", () => {
  it("accepts a well-formed definition", () => {
    const result = agentDefinitionSchema.parse(validDefinition);
    expect(result.id).toBe("new-user");
  });

  it("rejects an id that isn't lowercase kebab-case", () => {
    expect(() => agentDefinitionSchema.parse({ ...validDefinition, id: "New User" })).toThrow();
  });

  it("rejects an unknown category", () => {
    expect(() => agentDefinitionSchema.parse({ ...validDefinition, category: "MARKETING" })).toThrow();
  });

  it("rejects an unknown modelTier", () => {
    expect(() => agentDefinitionSchema.parse({ ...validDefinition, modelTier: "FASTEST" })).toThrow();
  });

  it("requires whenNotToCall to be non-empty", () => {
    expect(() => agentDefinitionSchema.parse({ ...validDefinition, whenNotToCall: "" })).toThrow();
  });

  it("requires at least one responsibility", () => {
    expect(() => agentDefinitionSchema.parse({ ...validDefinition, responsibilities: [] })).toThrow();
  });

  it("requires at least one constraint", () => {
    expect(() => agentDefinitionSchema.parse({ ...validDefinition, constraints: [] })).toThrow();
  });

  it("requires a positive integer tokenBudget", () => {
    expect(() => agentDefinitionSchema.parse({ ...validDefinition, tokenBudget: 0 })).toThrow();
    expect(() => agentDefinitionSchema.parse({ ...validDefinition, tokenBudget: -5 })).toThrow();
    expect(() => agentDefinitionSchema.parse({ ...validDefinition, tokenBudget: 1.5 })).toThrow();
  });

  it("allows outputSchema to be omitted (defaults to the shared contract)", () => {
    // validDefinition above never sets outputSchema — this just makes the
    // intent explicit rather than relying on that as an accident of the fixture.
    expect(() => agentDefinitionSchema.parse(validDefinition)).not.toThrow();
  });
});
