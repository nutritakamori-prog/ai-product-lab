import { db } from "@/lib/db";
import type { TestRunStatus } from "@/generated/prisma/client";
import type { RoundEntry } from "./round-runner";

export interface RegressionCheck {
  scenarioId: string;
  isRegression: boolean;
  previousRunId: string | null;
  previousStatus: TestRunStatus | null;
  currentStatus: TestRunStatus;
}

/**
 * The minimal regression signal this project can support without a new
 * table or Git integration: PASSED -> FAILED between a TestRun and the one
 * immediately before it for the same scenario. Reuses TestRun exactly as it
 * already is — scenarioId, status, and createdAt are already persisted for
 * every run; this only reads them.
 *
 * Any other transition (no previous run, PASSED -> PASSED, FAILED ->
 * anything) is deliberately NOT a regression in this first version — see
 * docs/DECISIONS.md if that's ever revisited.
 */
export async function compareWithPreviousRun(params: {
  scenarioId: string;
  currentRunId: string;
  currentStatus: TestRunStatus;
}): Promise<RegressionCheck> {
  const { scenarioId, currentRunId, currentStatus } = params;

  const previous = await db.testRun.findFirst({
    where: { scenarioId, id: { not: currentRunId } },
    orderBy: { createdAt: "desc" },
  });

  const previousStatus = previous?.status ?? null;

  return {
    scenarioId,
    isRegression: previousStatus === "PASSED" && currentStatus === "FAILED",
    previousRunId: previous?.id ?? null,
    previousStatus,
    currentStatus,
  };
}

/** Runs `compareWithPreviousRun` for every entry of a finished round. */
export async function checkRoundForRegressions(entries: RoundEntry[]): Promise<RegressionCheck[]> {
  return Promise.all(
    entries.map((entry) =>
      compareWithPreviousRun({
        scenarioId: entry.scenario.id,
        currentRunId: entry.testRunId,
        currentStatus: entry.status,
      }),
    ),
  );
}
