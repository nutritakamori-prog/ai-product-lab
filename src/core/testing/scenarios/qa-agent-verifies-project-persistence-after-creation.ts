import { testScenarioSchema, type TestScenario } from "./test-protocol";

/**
 * The QA counterpart of new-user-creates-project-and-returns-to-list.ts —
 * same real flow (create a project, navigate away, come back), evaluated as
 * a functional persistence check rather than a "does the flow feel
 * continuable" UX assessment. Adds a direct database confirmation on top of
 * the page-text check the new-user version already does — see
 * src/core/testing/runner/test-runner.ts's step executor.
 */
const qaAgentVerifiesProjectPersistenceAfterCreation: TestScenario = {
  id: "qa-agent-verifies-project-persistence-after-creation",
  name: "QA verifica persistência de projeto após criação",
  description:
    "A QA check of project creation: create a project with a unique name, navigate away from Projects and back through the real interface, and verify — in the interface and directly in the database — that the project genuinely persisted rather than only appearing in the immediate post-submit render.",
  objective:
    "Validate functionally that a project created through the real interface is actually persisted and remains available after leaving and returning to the Projects list — not an assessment of how smooth the flow feels, that is new-user-creates-project-and-returns-to-list's job.",
  preconditions: [
    "The Projects page reflects the current state of the database on every real page load (no stale caching).",
  ],
  steps: [
    "Open Projects via the real navigation.",
    "Create a project with a unique test name.",
    "Confirm the creation happened.",
    "Navigate away from Projects and back using a real interface interaction.",
    "Confirm the same project is still present, both in the interface and directly in the database.",
    "Collect real evidence of each step.",
    "Clean up the test project.",
  ],
  expectedOutcome:
    "The project is created, and after navigating away and back through the real interface, the same project is still present in the list AND still exists as a real row in the database — confirmed at the data level, not just by what the page renders.",
  priority: "HIGH",
  category: "project-management",
  agent: "qa-agent",
  enabled: true,
};

export default testScenarioSchema.parse(qaAgentVerifiesProjectPersistenceAfterCreation);
