import { testScenarioSchema, type TestScenario } from "./test-protocol";

/**
 * The one real scenario for this step, exercising the real project-creation
 * flow (src/services/projects.ts's createProject/listProjects) via the
 * "new-user" agent. See src/core/testing/runner/test-runner.ts for exactly
 * which of these steps are actually performed vs. not yet automated.
 */
const newUserCreatesFirstProject: TestScenario = {
  id: "new-user-creates-first-project",
  name: "Novo usuário cria seu primeiro projeto",
  description:
    "A first-time user opens the app, finds the way to create a project, fills in the minimum required data, and saves it.",
  objective:
    "Verify that a brand-new user can create their first project without confusion or errors, and that the result is correct and visible afterward.",
  preconditions: ["No project exists yet for this organization."],
  steps: [
    "Access the Projects page.",
    "Locate the action to create a new project.",
    "Fill in the project name (minimum required data).",
    "Save the project.",
    "Verify the project now appears in the project list.",
  ],
  expectedOutcome:
    "The project is created without error and appears in the project list with the name that was entered.",
  priority: "HIGH",
  category: "onboarding",
  enabled: true,
};

export default testScenarioSchema.parse(newUserCreatesFirstProject);
