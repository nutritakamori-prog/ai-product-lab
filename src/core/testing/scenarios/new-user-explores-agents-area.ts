import { testScenarioSchema, type TestScenario } from "./test-protocol";

/**
 * Distinct from the two project-creation scenarios: this one doesn't
 * create or mutate anything. It evaluates whether a new user can reach the
 * Agents area and minimally understand what it offers — a read-only
 * exploration/comprehension check, not a task-completion check. See
 * src/core/testing/runner/test-runner.ts's step executor for this scenario.
 */
const newUserExploresAgentsArea: TestScenario = {
  id: "new-user-explores-agents-area",
  name: "Novo usuário explora a área de Agents",
  description:
    "A first-time user, with no guidance beyond the app's own interface, navigates to the Agents area and looks at what it shows.",
  objective:
    "Assess whether a new user can reach the Agents area and minimally understand what it offers.",
  preconditions: ["The app offers no tutorial or guided tour of the Agents area beyond its own static UI."],
  steps: [
    "Open the application.",
    "Locate and navigate to the Agents area.",
    "Observe what the Agents page shows.",
    "Assess whether the purpose of the Agents area is minimally understandable from that content.",
  ],
  expectedOutcome:
    "The user reaches the Agents page and can tell, from what's actually shown, roughly what this area is for.",
  priority: "MEDIUM",
  category: "agents",
  agent: "new-user",
  enabled: true,
};

export default testScenarioSchema.parse(newUserExploresAgentsArea);
