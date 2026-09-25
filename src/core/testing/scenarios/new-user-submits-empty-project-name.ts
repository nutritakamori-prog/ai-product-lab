import { testScenarioSchema, type TestScenario } from "./test-protocol";

/**
 * Distinct from the other scenarios: this one deliberately submits invalid
 * input (an empty required field) to check how the app responds — not
 * whether the happy path works. See
 * src/core/testing/runner/test-runner.ts's step executor for exactly what
 * this can and cannot observe (native browser validation UI, e.g. a
 * tooltip, isn't inspectable through the BrowserAdapter — that limit is
 * recorded honestly in the observations, not papered over).
 */
const newUserSubmitsEmptyProjectName: TestScenario = {
  id: "new-user-submits-empty-project-name",
  name: "Novo usuário tenta criar um projeto sem preencher o nome",
  description:
    "A first-time user opens the create-project form, leaves the required name field empty, and tries to submit it.",
  objective:
    "Assess how the LAB responds when a new user tries to complete project creation with the required name field empty — whether adequate feedback is given and invalid creation is correctly prevented.",
  preconditions: ["The project name field is marked as required in the interface."],
  steps: [
    "Open the application.",
    "Access Projects via the real navigation.",
    "Open the project-creation form.",
    "Leave the name field empty.",
    "Attempt to submit the form.",
    "Observe the real behavior.",
    "Collect evidence of the result.",
  ],
  expectedOutcome:
    "The invalid submission is prevented and the user remains on the create-project form, with some indication — in-app or native browser — that the name is required.",
  priority: "HIGH",
  category: "functional",
  agent: "new-user",
  enabled: true,
};

export default testScenarioSchema.parse(newUserSubmitsEmptyProjectName);
