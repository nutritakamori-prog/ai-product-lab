import type { Project, TestRunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { AgentRegistry, type ResolvedAgent } from "@/core/agents/registry";
import type { AgentOutput } from "@/domain/agent-output";
import { ScenarioRegistry } from "../scenarios/registry";
import type { TestScenario } from "../scenarios/test-protocol";
import { runTestScenario } from "./test-runner";

const LAB_SELF_TEST_PROJECT_NAME = "AI Product Lab (self-test)";

/**
 * The LAB tests itself now (see docs/DECISIONS.md's "Test Lab: the LAB
 * tests itself" entry) — but TestRun/AgentExecution still require a real
 * Project row (a foreign key). Rather than a throwaway project per round,
 * every round reuses the same fixed, persistent one — same lazy-bootstrap
 * shape as services/organizations.ts's getDefaultOrganization().
 */
async function getOrCreateLabProject(): Promise<Pick<Project, "id">> {
  const organization = await getDefaultOrganization();
  const existing = await db.project.findFirst({
    where: { organizationId: organization.id, name: LAB_SELF_TEST_PROJECT_NAME },
  });
  if (existing) return existing;

  return db.project.create({
    data: {
      organizationId: organization.id,
      name: LAB_SELF_TEST_PROJECT_NAME,
      description:
        "Not a real product — the fixed project TestRuns are scoped to when agents test the LAB itself.",
      mode: "INTERNAL",
    },
  });
}

export interface RoundEntry {
  testRunId: string;
  scenario: TestScenario;
  agent: ResolvedAgent;
  status: TestRunStatus;
  /** The one finding/suspicion this run produced, or null if there was nothing to report. */
  finding: AgentOutput | null;
  /** Set when this run failed for infrastructure reasons, never a product finding. See test-runner.ts. */
  infrastructureError: string | null;
}

export interface SkippedScenario {
  scenario: TestScenario;
  reason: string;
}

export interface TestRoundResult {
  startedAt: Date;
  finishedAt: Date;
  entries: RoundEntry[];
  skipped: SkippedScenario[];
}

/**
 * Runs every enabled scenario once, each with the agent it declares
 * (`scenario.agent`), and collects the results. Reuses `runTestScenario` —
 * and everything it already reuses (the Test Runner's step executors, the
 * real BrowserAdapter, the Agent Runtime) — for every individual run; this
 * function only adds the loop and the shared project. Which agent runs
 * which scenario is fixed by the scenario file, decided by its author, not
 * chosen at runtime — this is not a Smart Router.
 */
export async function runTestRound(): Promise<TestRoundResult> {
  const startedAt = new Date();
  const project = await getOrCreateLabProject();
  const scenarios = ScenarioRegistry.listEnabled();

  const entries: RoundEntry[] = [];
  const skipped: SkippedScenario[] = [];

  for (const scenario of scenarios) {
    // One scenario's failure must never stop the round — every remaining
    // scenario still gets attempted. runTestScenario() itself already
    // guarantees it won't throw once a TestRun exists (see its own
    // try/catch); this outer try/catch is defense in depth for anything
    // that could fail even before that point (e.g. resolving the agent) —
    // it's not the primary mechanism, just a second layer.
    try {
      const agent = await AgentRegistry.getBySlug(scenario.agent);
      if (!agent) {
        skipped.push({ scenario, reason: `No agent named "${scenario.agent}" exists in the agent library.` });
        continue;
      }
      if (!agent.enabled) {
        skipped.push({ scenario, reason: `Agent "${scenario.agent}" exists but is disabled.` });
        continue;
      }

      const result = await runTestScenario({ scenario, agent, project });
      entries.push({
        testRunId: result.testRunId,
        scenario,
        agent,
        status: result.status,
        finding: result.findings[0] ?? null,
        infrastructureError: result.infrastructureError,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      skipped.push({
        scenario,
        reason: `Infrastructure error before a TestRun could be recorded: ${message}`,
      });
    }
  }

  return { startedAt, finishedAt: new Date(), entries, skipped };
}
