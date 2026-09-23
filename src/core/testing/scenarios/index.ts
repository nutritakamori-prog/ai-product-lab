import newUserCreatesFirstProject from "./new-user-creates-first-project";
import newUserDiscoversAndCreatesFirstProject from "./new-user-discovers-and-creates-first-project";
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
];
