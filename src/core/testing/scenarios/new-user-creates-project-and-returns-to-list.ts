import { testScenarioSchema, type TestScenario } from "./test-protocol";

/**
 * Distinct from `new-user-creates-first-project`: that one confirms
 * creation worked, checked right after submitting on the same page. This
 * one adds a real navigation away (to Dashboard) and back, then re-checks
 * the list on that fresh page load — confirming the project actually
 * persisted and the flow feels continuable, not just that the immediate
 * post-submit render looked right. See
 * src/core/testing/runner/test-runner.ts's step executor for this scenario.
 */
const newUserCreatesProjectAndReturnsToList: TestScenario = {
  id: "new-user-creates-project-and-returns-to-list",
  name: "Novo usuário cria um projeto e retorna à lista de Projects",
  description:
    "A first-time user creates a project, navigates away, and returns to the Projects list to confirm the flow feels complete and the project persists.",
  objective:
    "Assess whether, after successfully creating a project, a new user can continue the flow and return to the Projects list without evident friction.",
  preconditions: ["The Projects page reflects the current state of the database on every real page load (no stale caching)."],
  steps: [
    "Open the application.",
    "Access Projects via the real navigation.",
    "Create a new project with a unique test name.",
    "Confirm the creation happened.",
    "Return to the Projects list using a real interface interaction.",
    "Confirm the created project appears in the list.",
    "Collect real evidence of each relevant step.",
  ],
  expectedOutcome:
    "The project is created successfully, and after navigating away and back to the Projects list through the real interface, the created project is still visible, with no evident friction in continuing the flow.",
  priority: "HIGH",
  category: "project-management",
  agent: "new-user",
  enabled: true,
};

export default testScenarioSchema.parse(newUserCreatesProjectAndReturnsToList);
