import { TEST_SCENARIOS } from "./index";
import { testScenarioSchema, type TestScenario } from "./test-protocol";

/**
 * Deliberately simpler than the agent Registry (src/core/agents/registry.ts):
 * a scenario has no operational state that needs a database row (no
 * per-operator token budget/model tier to override) — see
 * src/core/testing/scenarios/README.md. If that need shows up later, this
 * is the file to extend, not to rewrite around.
 */
export const ScenarioRegistry = {
  discoverIds(): string[] {
    return TEST_SCENARIOS.map((scenario) => scenario.id);
  },

  getById(id: string): TestScenario | null {
    const found = TEST_SCENARIOS.find((scenario) => scenario.id === id);
    if (!found) return null;
    // Re-validate defensively, same reasoning as AgentRegistry.loadDefinition.
    return testScenarioSchema.parse(found);
  },

  listEnabled(): TestScenario[] {
    return TEST_SCENARIOS.filter((scenario) => scenario.enabled);
  },

  list(): TestScenario[] {
    return [...TEST_SCENARIOS];
  },
};
