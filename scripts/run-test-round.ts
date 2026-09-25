import "dotenv/config";
import { runTestRound } from "../src/core/testing/runner/round-runner";
import { formatRoundReport } from "../src/core/testing/runner/round-report";
import { checkRoundForRegressions } from "../src/core/testing/runner/regression";

/**
 * The CLI entry point for "faça uma rodada de testes no LAB": runs every
 * enabled scenario once (see round-runner.ts), prints the consolidated
 * report, and exits. Deliberately a script invoked on request — not a UI
 * button, not a cron/background job. It makes real Anthropic API calls
 * (through the real Agent Runtime, via runTestScenario), so it costs real
 * tokens each time it's run; that's the intended trade-off for a genuine
 * round, distinct from the automated tests, which always use a fake model
 * provider.
 *
 *   npm run test-lab:round
 *
 * Exits non-zero when a scenario actually FAILED or a regression was
 * detected — what makes this usable as a CI gate (.github/workflows/) —
 * never on NEEDS_REVIEW/BLOCKED alone, which are "needs a human", not a
 * confirmed product failure.
 */
async function main() {
  const result = await runTestRound();
  const regressions = await checkRoundForRegressions(result.entries);
  console.log(formatRoundReport(result, regressions));

  const hasFailedRun = result.entries.some((entry) => entry.status === "FAILED");
  const hasRegression = regressions.some((r) => r.isRegression);
  if (hasFailedRun || hasRegression) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("Test round failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { db } = await import("../src/lib/db");
    await db.$disconnect();
  });
