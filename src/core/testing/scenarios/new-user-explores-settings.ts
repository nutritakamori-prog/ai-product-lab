import { testScenarioSchema, type TestScenario } from "./test-protocol";

/**
 * Same read-only exploration/comprehension pattern as
 * `new-user-explores-agents-area`, applied to Settings: it doesn't create
 * or mutate anything. See
 * src/core/testing/runner/test-runner.ts's step executor for this scenario.
 */
const newUserExploresSettings: TestScenario = {
  id: "new-user-explores-settings",
  name: "Novo usuário explora a área de Settings",
  description:
    "A first-time user, with no guidance beyond the app's own interface, navigates to the Settings area and looks at what it shows.",
  objective: "Assess whether a new user can find the Settings area and minimally understand what it's for.",
  preconditions: ["The app offers no tutorial or guided tour of the Settings area beyond its own static UI."],
  steps: [
    "Open the application.",
    "Locate and navigate to the Settings area.",
    "Observe what the Settings page shows.",
    "Assess whether the purpose of the Settings area is minimally understandable from that content.",
  ],
  expectedOutcome:
    "The user reaches the Settings page and can tell, from what's actually shown, roughly what this area is for.",
  priority: "MEDIUM",
  category: "settings",
  agent: "new-user",
  enabled: true,
};

export default testScenarioSchema.parse(newUserExploresSettings);
