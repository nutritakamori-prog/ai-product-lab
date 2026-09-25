import { testScenarioSchema, type TestScenario } from "./test-protocol";

/**
 * The QA counterpart of new-user-submits-empty-project-name.ts — same real
 * interaction (submit the create-project form with the name field empty),
 * evaluated as a functional-correctness check (was the submission actually
 * blocked, was no invalid data created) rather than an onboarding/UX
 * assessment (was the feedback clear to a first-time user). Deliberately a
 * separate scenario, not a rewrite of the existing one — see
 * src/core/testing/runner/test-runner.ts's step executor for what this adds
 * on top of the new-user version: a real database check for whether an
 * empty-name project actually got created, not just a page-text check.
 */
const qaAgentValidatesEmptyProjectNameSubmission: TestScenario = {
  id: "qa-agent-validates-empty-project-name-submission",
  name: "QA verifica bloqueio de submissão de projeto sem nome",
  description:
    "A QA check of the create-project form: leave the required name field empty, submit it for real, and verify — functionally, not experientially — that the submission is blocked and no invalid project is created.",
  objective:
    "Verify, as a functional QA check, that submitting the create-project form with an empty required name field is blocked and that no project is created as a result. This is not an assessment of how clear the feedback is to a new user — that is new-user-submits-empty-project-name's job.",
  preconditions: ["The project name field is marked as required in the interface."],
  steps: [
    "Open the application.",
    "Access Projects via the real navigation.",
    "Confirm the name field is actually empty before submitting.",
    "Attempt to submit the form with the name field empty.",
    "Verify whether the submission was blocked.",
    "Query the database directly to verify whether an invalid project was created.",
    "Observe the field's state after the attempt.",
    "Collect evidence of the result.",
  ],
  expectedOutcome:
    "The submission is blocked, the user remains on the create-project form, and no project is created in the database as a result of the attempt — verified functionally and at the data level, independent of how the feedback reads to a user.",
  priority: "HIGH",
  category: "functional",
  agent: "qa-agent",
  enabled: true,
};

export default testScenarioSchema.parse(qaAgentValidatesEmptyProjectNameSubmission);
