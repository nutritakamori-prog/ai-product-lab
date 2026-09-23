import { describe, expect, it } from "vitest";
import { testScenarioSchema } from "./test-protocol";

const validScenario = {
  id: "example-scenario",
  name: "Example scenario",
  description: "Does something.",
  objective: "Verify something works.",
  preconditions: ["Nothing exists yet."],
  steps: ["Do the thing."],
  expectedOutcome: "The thing happened.",
  priority: "MEDIUM",
  category: "functional",
  agent: "new-user",
  enabled: true,
};

describe("testScenarioSchema", () => {
  it("accepts a well-formed scenario", () => {
    const result = testScenarioSchema.safeParse(validScenario);
    expect(result.success).toBe(true);
  });

  it("rejects an id that isn't kebab-case", () => {
    const result = testScenarioSchema.safeParse({ ...validScenario, id: "Not Kebab Case" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty steps array", () => {
    const result = testScenarioSchema.safeParse({ ...validScenario, steps: [] });
    expect(result.success).toBe(false);
  });

  it("rejects an empty preconditions array", () => {
    const result = testScenarioSchema.safeParse({ ...validScenario, preconditions: [] });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown category", () => {
    const result = testScenarioSchema.safeParse({ ...validScenario, category: "not-a-real-category" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown priority", () => {
    const result = testScenarioSchema.safeParse({ ...validScenario, priority: "URGENT" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing agent", () => {
    const withoutAgent: Record<string, unknown> = { ...validScenario };
    delete withoutAgent.agent;
    const result = testScenarioSchema.safeParse(withoutAgent);
    expect(result.success).toBe(false);
  });

  it("rejects an agent slug that isn't kebab-case", () => {
    const result = testScenarioSchema.safeParse({ ...validScenario, agent: "New User" });
    expect(result.success).toBe(false);
  });
});
