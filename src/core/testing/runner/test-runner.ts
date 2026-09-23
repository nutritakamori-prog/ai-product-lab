import type { Project, Prisma, TestRunStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import type { ResolvedAgent } from "@/core/agents/registry";
import { runAgent } from "@/core/runtime/run-agent";
import type { AgentOutput } from "@/domain/agent-output";
import type { TestScenario } from "../scenarios/test-protocol";
import { startAppServer } from "./app-server";
import { launchBrowserAdapter, type PlaywrightBrowserAdapter } from "./browser-adapter";

/**
 * One real, evidenced observation gathered while attempting a scenario step
 * — never a claim about something that wasn't actually done. See the
 * fundamental rule in src/core/testing/README.md.
 */
export interface Observation {
  action: string;
  expected: string;
  observed: string;
  evidence: string;
}

interface StepExecutionResult {
  observations: Observation[];
}

/**
 * Polls `read()` until its result satisfies `matches`, or gives up. Used
 * after a real browser interaction (a click/submit) to wait for the
 * resulting DOM state instead of trusting that the action itself
 * completing means the page already reflects it.
 */
export async function pollUntil(
  read: () => Promise<string>,
  matches: (text: string) => boolean,
  { attempts = 10, delayMs = 300 }: { attempts?: number; delayMs?: number } = {},
): Promise<{ found: boolean; lastText: string }> {
  let lastText = "";
  for (let i = 0; i < attempts; i++) {
    lastText = await read();
    if (matches(lastText)) return { found: true, lastText };
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return { found: false, lastText };
}

/** Best-effort test-data cleanup — never affects the run's own result. */
async function cleanupTestProject(name: string): Promise<void> {
  try {
    const organization = await getDefaultOrganization();
    const created = await db.project.findFirst({ where: { organizationId: organization.id, name } });
    if (created) await db.project.delete({ where: { id: created.id } });
  } catch {
    // best-effort
  }
}

/**
 * Scenario-specific step execution: a small, honest mapping from "what this
 * scenario's steps mean" to "what code actually runs to find out" — one
 * entry per scenario that can be exercised for real today. Deliberately not
 * a generic step-interpreter: with a single scenario, that would be solving
 * a problem we don't have yet. Add an entry here alongside each new
 * scenario file, not a framework ahead of need.
 */
const STEP_EXECUTORS: Record<string, () => Promise<StepExecutionResult>> = {
  "new-user-creates-first-project": async () => {
    const observations: Observation[] = [];
    const name = `Test scenario project ${Date.now()}`;
    let server: Awaited<ReturnType<typeof startAppServer>> | null = null;
    let adapter: PlaywrightBrowserAdapter | null = null;

    try {
      server = await startAppServer();
      adapter = await launchBrowserAdapter(server.baseUrl);

      const home = await adapter.navigate("/");
      observations.push({
        action: "Open the AI Product Lab application in a real browser (Playwright + Chromium).",
        expected: "The application responds and renders a real page.",
        observed: `Loaded ${home.url} — page.content() returned ${home.html.length} bytes of real HTML.`,
        evidence: `page.goto("${home.url}") resolved without error.`,
      });

      await adapter.click('a[href="/projects"]');
      const nav = await pollUntil(() => adapter!.getText("body"), (text) => text.includes("New project"));
      observations.push({
        action: 'Click the "Projects" link in the app\'s real navigation.',
        expected: 'The Projects page loads and shows a "New project" form.',
        observed: nav.found
          ? 'The page now contains "New project" — the Projects page loaded.'
          : `After clicking, the page did not contain "New project" within the wait window (3s). Page text sample: "${nav.lastText.slice(0, 200)}"`,
        evidence: `getText("body") after the click ${nav.found ? "contains" : "does not contain"} "New project".`,
      });

      const formText = await adapter.getText("form");
      const formHasCreateAction = formText.includes("Create project");
      observations.push({
        action: "Read the create-project form actually rendered on the Projects page.",
        expected: 'A form with a "Create project" action is present.',
        observed: formHasCreateAction
          ? 'A form containing "Create project" was found in the DOM.'
          : `No "Create project" text found in the form. Form text: "${formText.slice(0, 200)}"`,
        evidence: `getText("form") = "${formText.slice(0, 200)}"`,
      });

      await adapter.fill("#name", name);
      const filledValue = await adapter.getText("#name");
      observations.push({
        action: `Fill the project name field with "${name}".`,
        expected: "The name field holds exactly the entered value.",
        observed:
          filledValue === name
            ? `The name field now reads "${filledValue}".`
            : `The name field reads "${filledValue}", not the entered value.`,
        evidence: `getText("#name") (the field's real inputValue) = "${filledValue}".`,
      });

      await adapter.click('button[type="submit"]');
      const submit = await pollUntil(() => adapter!.getText("body"), (text) => text.includes(name));
      observations.push({
        action: "Submit the form to create the project.",
        expected: "The new project subsequently appears in the project list.",
        observed: submit.found
          ? `The project name "${name}" is present on the page after submitting.`
          : `The project name "${name}" was NOT found on the page after submitting (waited ~3s). Page text sample: "${submit.lastText.slice(0, 300)}"`,
        evidence: `getText("body") after submit ${submit.found ? "contains" : "does not contain"} "${name}".`,
      });
    } catch (err) {
      observations.push({
        action: "Drive the real browser through the project-creation flow.",
        expected: "Every step above completes and produces real DOM evidence.",
        observed: `Browser automation failed before completing: ${err instanceof Error ? err.message : String(err)}`,
        evidence:
          "An exception was thrown by the browser/server automation itself — this is an infrastructure failure, not evidence about the application's own behavior.",
      });
    } finally {
      if (adapter) await adapter.close().catch(() => {});
      if (server) await server.close().catch(() => {});
      await cleanupTestProject(name);
    }

    return { observations };
  },
};

function buildScenarioTask(scenario: TestScenario, observations: Observation[]): string {
  const observationsText = observations
    .map(
      (o, i) =>
        `${i + 1}. ACTION: ${o.action}\n   EXPECTED: ${o.expected}\n   OBSERVED: ${o.observed}\n   EVIDENCE: ${o.evidence}`,
    )
    .join("\n\n");

  return [
    `You are analyzing a test run of the scenario "${scenario.name}".`,
    `Objective: ${scenario.objective}`,
    `Preconditions: ${scenario.preconditions.join("; ")}`,
    `Scenario steps: ${scenario.steps.join(" -> ")}`,
    `Expected outcome: ${scenario.expectedOutcome}`,
    "",
    "The following observations were actually gathered while attempting this scenario. Some steps could not be automated yet and are explicitly marked as such — treat those as having no evidence at all, not as a sign of a problem, and never claim to have observed something beyond what is listed here.",
    "",
    observationsText,
    "",
    'Based ONLY on the observations above, report status "FINDING" if there is a real, evidenced problem, "NO_FINDING" if everything that was actually checked worked as expected, or "UNCONFIRMED" if there is a suspicion you cannot back with evidence (for example because a step was not automated).',
  ].join("\n");
}

export interface RunTestScenarioInput {
  scenario: TestScenario;
  agent: ResolvedAgent;
  project: Pick<Project, "id">;
}

export interface RunTestScenarioResult {
  testRunId: string;
  status: TestRunStatus;
  findings: AgentOutput[];
}

/**
 * Orchestrates one attempt at a scenario: open a TestRun, run the
 * scenario's step executor to gather real observations, hand those to the
 * agent (via the existing Runtime — never reimplemented here) for analysis,
 * and close the TestRun with the resulting status/findings.
 */
export async function runTestScenario(input: RunTestScenarioInput): Promise<RunTestScenarioResult> {
  const { scenario, agent, project } = input;
  const startedAt = new Date();

  const testRun = await db.testRun.create({
    data: {
      scenarioId: scenario.id,
      agentId: agent.dbId,
      projectId: project.id,
      status: "RUNNING",
      startedAt,
    },
  });

  const executor = STEP_EXECUTORS[scenario.id];
  if (!executor) {
    await db.testRun.update({
      where: { id: testRun.id },
      data: {
        status: "BLOCKED",
        observedOutcome: `No step executor is registered for scenario "${scenario.id}" — nothing was actually run.`,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
      },
    });
    return { testRunId: testRun.id, status: "BLOCKED", findings: [] };
  }

  const { observations } = await executor();
  const task = buildScenarioTask(scenario, observations);
  const runResult = await runAgent({ agent, project, task });

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();

  let status: TestRunStatus;
  let findings: AgentOutput[] = [];

  if (runResult.status === "FAILED" || !runResult.output) {
    // The agent execution itself failed (model/validation error) — this is
    // not a verdict on the scenario, it needs a human to look.
    status = "NEEDS_REVIEW";
  } else if (runResult.output.status === "FINDING") {
    status = "FAILED";
    findings = [runResult.output];
  } else if (runResult.output.status === "UNCONFIRMED") {
    status = "NEEDS_REVIEW";
    findings = [runResult.output];
  } else {
    status = "PASSED";
  }

  await db.testRun.update({
    where: { id: testRun.id },
    data: {
      status,
      executionId: runResult.executionId,
      observations: observations as unknown as Prisma.InputJsonValue,
      observedOutcome: observations[observations.length - 1]?.observed ?? null,
      findings: findings as unknown as Prisma.InputJsonValue,
      finishedAt,
      durationMs,
    },
  });

  return { testRunId: testRun.id, status, findings };
}
