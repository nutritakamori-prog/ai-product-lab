import { testScenarioSchema, type TestScenario } from "./test-protocol";

/**
 * Distinct from `new-user-creates-first-project`: that one exercises the
 * mechanics of the flow (does creation work at all). This one evaluates
 * discoverability — whether a first-time user could find their way there
 * unassisted — by treating a successful click/fill as evidence the target
 * was actually visible and actionable (Playwright only succeeds those when
 * the element truly is), not just evidence the flow works end to end. See
 * src/core/testing/runner/test-runner.ts's step executor for this scenario.
 */
const newUserDiscoversAndCreatesFirstProject: TestScenario = {
  id: "new-user-discovers-and-creates-first-project",
  name: "Novo usuário encontra e cria seu primeiro projeto sem ajuda",
  description:
    "A first-time user, with no guidance beyond the app's own interface, tries to discover how to reach the project-creation flow and complete it on their own.",
  objective:
    "Assess whether a new user can discover and execute the project-creation flow using only the interface, without being told where to click.",
  preconditions: [
    "No project exists yet for this organization.",
    "The app offers no tutorial, tooltip, or onboarding guidance beyond its own static UI.",
  ],
  steps: [
    "Open the application.",
    "Observe the initial screen.",
    "Discover where to access Projects.",
    "Locate the action to create a project.",
    "Create the project.",
    "Confirm the result.",
  ],
  expectedOutcome:
    "The user reaches the project-creation form and successfully creates a visible project using only what the interface itself exposes.",
  priority: "HIGH",
  category: "onboarding",
  agent: "new-user",
  enabled: true,
};

export default testScenarioSchema.parse(newUserDiscoversAndCreatesFirstProject);
