import newUserCreatesFirstProject from "./new-user-creates-first-project";
import newUserCreatesProjectAndReturnsToList from "./new-user-creates-project-and-returns-to-list";
import newUserDiscoversAndCreatesFirstProject from "./new-user-discovers-and-creates-first-project";
import newUserExploresAgentsArea from "./new-user-explores-agents-area";
import newUserExploresSettings from "./new-user-explores-settings";
import newUserSubmitsEmptyProjectName from "./new-user-submits-empty-project-name";
import qaAgentValidatesEmptyProjectNameSubmission from "./qa-agent-validates-empty-project-name-submission";
import qaAgentVerifiesProjectPersistenceAfterCreation from "./qa-agent-verifies-project-persistence-after-creation";
import type { TestScenario } from "./test-protocol";

/**
 * The scenario library's table of contents — same pattern as
 * agents/index.ts, for the same reason (a bundled Next.js app can't
 * reliably scan the filesystem at runtime; see docs/DECISIONS.md). Adding a
 * scenario means adding a file here plus one array entry.
 */
export const TEST_SCENARIOS: TestScenario[] = [
  newUserCreatesFirstProject,
  newUserDiscoversAndCreatesFirstProject,
  newUserExploresAgentsArea,
  newUserExploresSettings,
  newUserSubmitsEmptyProjectName,
  newUserCreatesProjectAndReturnsToList,
  qaAgentValidatesEmptyProjectNameSubmission,
  qaAgentVerifiesProjectPersistenceAfterCreation,
];
