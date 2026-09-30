import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getDefaultOrganization } from "@/services/organizations";
import { setModelProviderForTesting, type ModelProvider } from "@/core/models/provider";
import { MockModelProvider } from "@/core/models/mock-provider";
import { launchBrowserAdapter } from "@/core/testing/runner/browser-adapter";
import { runLabTask, buildTaskWithEvidence } from "./lab-task";
import type { Observation } from "@/core/testing/runner/test-runner";
import * as taskIntents from "./task-intents";
import * as planExecutor from "./plan-executor";
import { executePlan, type Plan } from "./plan-executor";
import * as taskPlanner from "./task-planner";
import { planTask } from "./task-planner";
import { evaluationMissionSchema, type EvaluationMission } from "@/domain/evaluation-mission";
import { AGENT_OUTPUT_STATUSES, type AgentOutput } from "@/domain/agent-output";
import { chooseInitialAgentId } from "@/core/orchestrator/smart-router";
import type { Project } from "@/generated/prisma/client";

const NO_FINDING_OUTPUT = {
  agent: "new-user",
  status: "NO_FINDING" as const,
  finding: null,
  evidence: null,
  impact: null,
  recommendation: null,
  confidence: "MEDIUM" as const,
  classification: null,
  needsOtherAgent: null as string | null,
};

const FINDING_OUTPUT = {
  agent: "new-user",
  status: "FINDING" as const,
  finding: "The create-project action is hard to find from the home screen.",
  evidence: "ACTION: looked for it. EXPECTED: visible. OBSERVED: not visible without extra navigation.",
  impact: "MEDIUM" as const,
  recommendation: "Surface it directly on the home screen.",
  confidence: "MEDIUM" as const,
  classification: "UX" as const,
  needsOtherAgent: null as string | null, // left null on purpose — run-agent.ts's own rule derives the handoff
};

const QA_CONFIRMS_OUTPUT = {
  agent: "qa-agent",
  status: "FINDING" as const,
  finding: "Confirmed: the create-project action requires an extra navigation step.",
  evidence: "ACTION: reviewed. EXPECTED: one step. OBSERVED: two steps required.",
  impact: "MEDIUM" as const,
  recommendation: "Add a shortcut from the home screen.",
  confidence: "HIGH" as const,
  classification: "BUG" as const,
  needsOtherAgent: null as string | null,
};

const QA_NO_FINDING_OUTPUT = {
  agent: "qa-agent",
  status: "NO_FINDING" as const,
  finding: null,
  evidence: null,
  impact: null,
  recommendation: null,
  confidence: "MEDIUM" as const,
  classification: null,
  needsOtherAgent: null as string | null,
};

// Grounded ONLY in what the real Observations below actually show (the
// Continuar button never appeared after the click) — never a claim about
// WHY (e.g. "the backend is broken"), which the Observations don't
// demonstrate. See this step's "IMPORTANTE SOBRE EVIDÊNCIA" rule: "o fluxo
// não apresentou mudança observável" is allowed; a guessed technical cause
// is not.
const QA_FINDING_GROUNDED_OUTPUT = {
  agent: "qa-agent",
  status: "FINDING" as const,
  finding: "The flow did not show the Continuar button after clicking Entrar — no observable change was found.",
  evidence: 'No element matching "botão Continuar" was found on the page. exists("role=button[name=/Continuar/i]") -> false.',
  impact: "MEDIUM" as const,
  recommendation: "Investigate why clicking Entrar produced no observable UI change.",
  confidence: "MEDIUM" as const,
  classification: "UI" as const,
  needsOtherAgent: null as string | null,
};

const QA_UNCONFIRMED_OUTPUT = {
  agent: "qa-agent",
  status: "UNCONFIRMED" as const,
  finding: "The gathered observations aren't enough to confirm whether the flow works as intended.",
  evidence: null,
  impact: null,
  recommendation: null,
  confidence: "LOW" as const,
  classification: null,
  needsOtherAgent: null as string | null,
};

/** Returns outputs[callIndex] (last one repeats past the end) — no real LLM call. */
function sequentialProvider(outputs: unknown[]): ModelProvider {
  let callIndex = 0;
  return {
    name: "lab-task-test-provider",
    completeStructured: async <T>() => {
      const data = outputs[Math.min(callIndex, outputs.length - 1)];
      callIndex += 1;
      return {
        data: data as T,
        rawText: JSON.stringify(data),
        inputTokens: 10,
        outputTokens: 10,
        stopReason: "end_turn",
      };
    },
  };
}

describe("runLabTask", () => {
  let project: Project;

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Lab task test project ${Date.now()}` },
    });
  });

  afterEach(() => {
    setModelProviderForTesting(null);
  });

  afterAll(async () => {
    await db.agentExecution.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.$disconnect();
  });

  it("a simple task with no real problem costs exactly one agent call and produces a plain summary", async () => {
    // No URL in this task — looksLikeBrowserTaskCandidate() (lab-task.ts)
    // skips the Task Planner entirely here, so the only model call at all
    // is the agent's own, exactly like before task-planner.ts existed.
    setModelProviderForTesting(sequentialProvider([NO_FINDING_OUTPUT]));

    const result = await runLabTask("Avalie o onboarding de um novo usuário no app.", project);

    expect(result.agentUsed).toBe("new-user");
    expect(result.status).toBe("COMPLETED");
    expect(result.agentsCalled).toEqual(["new-user"]);
    expect(result.collaborated).toBe(false);
    expect(result.summary).toBe("No problem was found.");
  });

  it("a task that genuinely finds a problem triggers real collaboration and the summary reflects the specialist's final word", async () => {
    setModelProviderForTesting(sequentialProvider([FINDING_OUTPUT, QA_CONFIRMS_OUTPUT]));

    const result = await runLabTask("Avalie a experiência do usuário ao criar um projeto.", project);

    expect(result.agentUsed).toBe("ux-agent");
    expect(result.status).toBe("COMPLETED");
    expect(result.agentsCalled).toEqual(["ux-agent", "qa-agent"]);
    expect(result.collaborated).toBe(true);
    // The final word is qa-agent's own confirmation, not ux-agent's original finding.
    expect(result.finding).toBe(QA_CONFIRMS_OUTPUT.finding);
    expect(result.recommendation).toBe(QA_CONFIRMS_OUTPUT.recommendation);
    expect(result.summary).toContain(QA_CONFIRMS_OUTPUT.finding);
  });

  it("an ambiguous, clearly out-of-scope task never calls the model provider at all", async () => {
    // Restored by looksLikeBrowserTaskCandidate(): this task has no URL, so
    // the Task Planner is never even asked — the model provider must not be
    // called for any reason, same guarantee this test protected before
    // task-planner.ts existed.
    setModelProviderForTesting({
      name: "must-not-be-called",
      completeStructured: async () => {
        throw new Error("runLabTask must not call the model provider for an out-of-scope task.");
      },
    });

    const result = await runLabTask("Organize a reunião de amanhã às 10h.", project);

    expect(result.agentUsed).toBeNull();
    expect(result.status).toBe("COORDINATION_BLOCKED");
    expect(result.agentsCalled).toEqual([]);
    expect(result.browserExecuted).toBe(false);
    expect(result.summary.length).toBeGreaterThan(0);
  });
});

describe("runLabTask — check-element-exists (URL + free-form check)", () => {
  let project: Project;

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Lab task check-element-exists test project ${Date.now()}` },
    });
  });

  afterEach(() => {
    setModelProviderForTesting(null);
  });

  afterAll(async () => {
    await db.agentExecution.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.$disconnect();
  });

  it("a page that has the element: real browser evidence reaches qa-agent and the result reflects it", async () => {
    setModelProviderForTesting(sequentialProvider([QA_NO_FINDING_OUTPUT]));

    const result = await runLabTask(
      "Abra data:text/html,<button>Cadastro</button> e verifique se existe um botão de cadastro.",
      project,
    );

    expect(result.browserExecuted).toBe(true);
    expect(result.agentUsed).toBe("qa-agent");
    expect(result.status).toBe("COMPLETED");

    // Real proof the evidence actually reached the agent's prompt, not just
    // that the pipeline "completed" — the same check used throughout this
    // project's manual validation, now a permanent assertion.
    const execution = await db.agentExecution.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
    });
    expect(execution?.task).toContain('An element matching "um botão de cadastro" was found on the page.');
    expect(execution?.task).toContain("role=button[name=/cadastro/i]");
  });

  it("a page without the element: the Observation honestly reports absence — nothing is invented", async () => {
    setModelProviderForTesting(sequentialProvider([QA_NO_FINDING_OUTPUT]));

    const result = await runLabTask(
      "Abra data:text/html,<p>NadaAqui</p> e verifique se existe um botão de cadastro.",
      project,
    );

    expect(result.browserExecuted).toBe(true);
    expect(result.agentUsed).toBe("qa-agent");

    const execution = await db.agentExecution.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
    });
    expect(execution?.task).toContain('No element matching "um botão de cadastro" was found on the page.');
    expect(execution?.task).toContain("-> false.");
  });

  it("a real navigation failure is an infrastructure error, not a false FINDING — no agent is ever called", async () => {
    setModelProviderForTesting({
      name: "must-not-be-called",
      completeStructured: async () => {
        throw new Error("runLabTask must not call the model provider when browser execution itself failed.");
      },
    });

    const executionsBefore = await db.agentExecution.count({ where: { projectId: project.id } });

    await expect(
      runLabTask("Abra http://127.0.0.1:1 e verifique se existe um botão de cadastro.", project),
    ).rejects.toThrow();

    const executionsAfter = await db.agentExecution.count({ where: { projectId: project.id } });
    expect(executionsAfter).toBe(executionsBefore);
  });
});

describe("runLabTask — recognizeIntents()/Task Planner coexistence", () => {
  let project: Project;
  const createdProjectNames: string[] = [];

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Lab task coexistence test project ${Date.now()}` },
    });
  });

  afterEach(() => {
    setModelProviderForTesting(null);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await db.agentExecution.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
    for (const name of createdProjectNames) {
      const created = await db.project.findFirst({ where: { name } });
      if (created) {
        await db.agentExecution.deleteMany({ where: { projectId: created.id } });
        await db.project.delete({ where: { id: created.id } });
      }
    }
    await db.$disconnect();
  });

  it("1. an existing create-project task still uses the intent path — the plan path is never touched", async () => {
    const executeIntentSpy = vi.spyOn(taskIntents, "executeIntent");
    const executePlanSpy = vi.spyOn(planExecutor, "executePlan");
    setModelProviderForTesting(sequentialProvider([NO_FINDING_OUTPUT]));

    const name = `Coexistence create-project ${Date.now()}`;
    createdProjectNames.push(name);
    const result = await runLabTask(`Crie um projeto chamado ${name}.`, project);

    expect(executeIntentSpy).toHaveBeenCalledTimes(1);
    expect(executePlanSpy).not.toHaveBeenCalled();
    expect(result.browserExecuted).toBe(true);
    expect(result.agentUsed).toBe("new-user");
    expect(result.agentsCalled).toEqual(["new-user"]);
  });

  it("2. check-element-exists still resolves via the existing intent path — the Task Planner never runs for it", async () => {
    const executeIntentSpy = vi.spyOn(taskIntents, "executeIntent");
    const executePlanSpy = vi.spyOn(planExecutor, "executePlan");
    setModelProviderForTesting(sequentialProvider([QA_NO_FINDING_OUTPUT]));

    const result = await runLabTask(
      "Abra data:text/html,<button>Cadastro</button> e verifique se existe um botão de cadastro.",
      project,
    );

    expect(executeIntentSpy).toHaveBeenCalledTimes(1);
    expect(executePlanSpy).not.toHaveBeenCalled();
    expect(result.browserExecuted).toBe(true);
    expect(result.agentUsed).toBe("qa-agent");
  });

  it("5-8. when recognizeIntents() finds nothing, the Task Planner's fallback executes real browser evidence and reaches the agent exactly once", async () => {
    // check-element-exists already recognizes this exact sentence (see
    // plan-executor.ts's own comment on the deliberately duplicated
    // pattern) — recognizeIntents() is mocked ONLY here, to isolate and
    // prove the fallback branch itself, since no real sentence reaches it
    // today without this intent claiming it first. The Planner's model call
    // (call #1, Plan-shaped) and the agent's own call (call #2,
    // AgentOutput-shaped) are the only two model calls in this test —
    // executePlan, BrowserAdapter and the agent call are entirely real,
    // nothing about execution is faked.
    const recognizeIntentsSpy = vi.spyOn(taskIntents, "recognizeIntents").mockReturnValueOnce([]);
    const executePlanSpy = vi.spyOn(planExecutor, "executePlan");
    const plannerPlanResponse = {
      actions: [
        { action: "navigate", target: "data:text/html,<button>Cadastro</button>" },
        { action: "find", target: "um botão de cadastro" },
      ],
    };
    let modelCallCount = 0;
    const provider = sequentialProvider([plannerPlanResponse, QA_NO_FINDING_OUTPUT]);
    setModelProviderForTesting({
      name: provider.name,
      completeStructured: async (params) => {
        modelCallCount += 1;
        return provider.completeStructured(params);
      },
    });

    // The task text uses a real https:// URL so it passes
    // looksLikeBrowserTaskCandidate() (lab-task.ts's gate) — the actual
    // navigation target below is the safe data: URI regardless, since the
    // Planner's own interpretation is mocked here, not derived from this text.
    const result = await runLabTask(
      "Abra https://exemplo.com e verifique se existe um botão de cadastro.",
      project,
    );

    expect(recognizeIntentsSpy).toHaveBeenCalled();
    expect(executePlanSpy).toHaveBeenCalledTimes(1); // 6. Plan really executed via executePlan()/BrowserAdapter
    expect(result.browserExecuted).toBe(true);
    expect(result.agentUsed).toBe("qa-agent");
    expect(result.agentsCalled).toEqual(["qa-agent"]);
    expect(result.collaborated).toBe(false);
    expect(modelCallCount).toBe(2); // 1 Planner call + 1 agent call — 8. agent called exactly once

    // 7. the Plan's real Observation reached the agent's own prompt.
    const execution = await db.agentExecution.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
    });
    expect(execution?.task).toContain('An element matching "um botão de cadastro" was found on the page.');
  });

  it("a task that is neither an intent nor a URL-bearing candidate keeps today's no-evidence behavior, with zero model calls for planning", async () => {
    const executeIntentSpy = vi.spyOn(taskIntents, "executeIntent");
    const executePlanSpy = vi.spyOn(planExecutor, "executePlan");
    const planTaskSpy = vi.spyOn(taskPlanner, "planTask");
    setModelProviderForTesting(sequentialProvider([NO_FINDING_OUTPUT]));

    const result = await runLabTask("Avalie o onboarding de um novo usuário no app.", project);

    expect(executeIntentSpy).not.toHaveBeenCalled();
    expect(planTaskSpy).not.toHaveBeenCalled();
    expect(executePlanSpy).not.toHaveBeenCalled();
    expect(result.browserExecuted).toBe(false);
    expect(result.agentUsed).toBe("new-user");
    expect(result.status).toBe("COMPLETED");
  });
});

describe("runLabTask — browser-task candidate gate before the Task Planner", () => {
  let project: Project;

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Lab task candidate-gate test project ${Date.now()}` },
    });
  });

  afterEach(() => {
    setModelProviderForTesting(null);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await db.agentExecution.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.$disconnect();
  });

  it("1. a task with a URL is a candidate — the Planner IS called", async () => {
    // recognizeIntents() is mocked empty here purely to isolate the gate
    // itself: this exact sentence is already claimed by check-element-exists
    // (test 4 below proves that path), so without this it would never reach
    // the gate at all — which would prove nothing about the gate specifically.
    vi.spyOn(taskIntents, "recognizeIntents").mockReturnValueOnce([]);
    const planTaskSpy = vi.spyOn(taskPlanner, "planTask");
    setModelProviderForTesting(
      sequentialProvider([
        { actions: [{ action: "navigate", target: "data:text/html,<button>Cadastro</button>" }, { action: "find", target: "um botão de cadastro" }] },
        QA_NO_FINDING_OUTPUT,
      ]),
    );

    await runLabTask("Abra https://exemplo.com e verifique se existe um botão de cadastro.", project);

    expect(planTaskSpy).toHaveBeenCalledTimes(1);
  });

  it("2. a task with no URL and nothing browser-related is not a candidate — the Planner is NOT called, and the model provider is never touched", async () => {
    const planTaskSpy = vi.spyOn(taskPlanner, "planTask");
    setModelProviderForTesting({
      name: "must-not-be-called",
      completeStructured: async () => {
        throw new Error("The model provider must not be called for a task with no browser-task signal.");
      },
    });

    const result = await runLabTask("Organize minha reunião de amanhã.", project);

    expect(planTaskSpy).not.toHaveBeenCalled();
    expect(result.status).toBe("COORDINATION_BLOCKED");
    expect(result.browserExecuted).toBe(false);
  });

  it("3. an existing create-project task never reaches the gate at all — the intent path already claimed it", async () => {
    const planTaskSpy = vi.spyOn(taskPlanner, "planTask");
    setModelProviderForTesting(sequentialProvider([NO_FINDING_OUTPUT]));

    const name = `Candidate gate create-project ${Date.now()}`;
    const result = await runLabTask(`Crie um projeto chamado ${name}.`, project);

    expect(planTaskSpy).not.toHaveBeenCalled();
    expect(result.browserExecuted).toBe(true);
    expect(result.agentUsed).toBe("new-user");

    await db.agentExecution.deleteMany({ where: { project: { name } } });
    await db.project.deleteMany({ where: { name } });
  });

  it("4. an existing check-element-exists task never reaches the gate — the intent path already claimed it", async () => {
    const planTaskSpy = vi.spyOn(taskPlanner, "planTask");
    setModelProviderForTesting(sequentialProvider([QA_NO_FINDING_OUTPUT]));

    const result = await runLabTask(
      "Abra data:text/html,<button>Cadastro</button> e verifique se existe um botão de cadastro.",
      project,
    );

    expect(planTaskSpy).not.toHaveBeenCalled();
    expect(result.browserExecuted).toBe(true);
    expect(result.agentUsed).toBe("qa-agent");
  });

  it("5. a known unsupported composed task is blocked before the gate — the Planner is never asked", async () => {
    const planTaskSpy = vi.spyOn(taskPlanner, "planTask");
    setModelProviderForTesting({
      name: "must-not-be-called",
      completeStructured: async () => {
        throw new Error("The model provider must not be called for an already-blocked composed task.");
      },
    });

    const result = await runLabTask(
      "Crie um projeto chamado Gamma e depois abra o projeto para verificar a tela.",
      project,
    );

    expect(planTaskSpy).not.toHaveBeenCalled();
    expect(result.status).toBe("COORDINATION_BLOCKED");
    expect(result.agentUsed).toBeNull();
  });

  it("6. an ambiguous UI-ish task with no URL stays conservative — the Planner is NOT called, since it couldn't act on it anyway", async () => {
    // "tela" (screen) and "onboarding" sound interface-related, but without
    // a URL the Planner would refuse to invent one and return null
    // regardless — the gate deliberately doesn't try to judge wording, only
    // the presence of something the Planner could actually act on. This
    // exact text also matches the Smart Router's own onboarding rule, so an
    // agent still runs afterward — same as it always would, with or
    // without the Task Planner existing — just never via the Planner.
    const planTaskSpy = vi.spyOn(taskPlanner, "planTask");
    setModelProviderForTesting(sequentialProvider([NO_FINDING_OUTPUT]));

    const result = await runLabTask("Verifique o onboarding dessa tela.", project);

    expect(planTaskSpy).not.toHaveBeenCalled();
    expect(result.browserExecuted).toBe(false);
    expect(result.agentUsed).toBe("new-user");
  });
});

/**
 * Investigates whether the current Task Planner can interpret and execute a
 * real 3-step sequence (navigate → click → find). Uses the real, unmocked
 * planTask()/executePlan() against the real (Mock-backed, no ANTHROPIC_API_KEY
 * in this environment) model provider — nothing here fakes what the Planner
 * itself produces. Findings are asserted as they actually are, not as hoped:
 * see this session's report for the precise, honest breakdown.
 */
describe("runLabTask — 3-step sequence (navigate → click → find)", () => {
  // A page with no email field until "Entrar" is clicked — real, observable
  // dynamic behavior, no network dependency.
  const DATA_URL =
    "data:text/html,<button id=\"entrar\" onclick=\"document.getElementById('slot').innerHTML='<input id=email type=email>'\">Entrar</button><div id=\"slot\"></div>";
  const TASK = `Abra ${DATA_URL} e clique no botão Entrar e verifique se existe o campo de e-mail.`;
  // Same sentence, but with an https:// URL so it passes lab-task.ts's own
  // looksLikeBrowserTaskCandidate() gate (data: doesn't match http(s)/www —
  // the same lesson from the gate's own validation two steps ago). Safe to
  // use a URL that's never really reachable: the Planner is expected to
  // return null before executePlan() ever runs, so no real navigation to it
  // ever happens in this specific test.
  const TASK_WITH_HTTPS_URL = "Abra https://exemplo.com e clique no botão Entrar e verifique se existe o campo de e-mail.";

  let project: Project;

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Lab task 3-step sequence test project ${Date.now()}` },
    });
  });

  afterEach(() => {
    setModelProviderForTesting(null);
  });

  afterAll(async () => {
    await db.agentExecution.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.$disconnect();
  });

  it("1-4. planTask() cannot represent this 3-clause sentence — it returns null, not a 3-action Plan", async () => {
    // Real call, real (Mock) provider — MockModelProvider's own
    // MOCK_PLAN_TASK_PATTERN only covers "Abra <URL> e verifique se existe
    // <elemento>" (two clauses). This sentence has a third clause ("clique
    // no botão Entrar") in between, which that pattern doesn't allow for.
    const plan = await planTask(TASK);
    expect(plan).toBeNull();
  });

  it("5,6,8. executePlan() runs all 3 hand-written steps for real — navigate and click are real and correct", async () => {
    const plan: Plan = [
      { action: "navigate", target: DATA_URL },
      { action: "click", target: "#entrar" },
      { action: "find", target: "campo de e-mail" },
    ];

    const observations = await executePlan(plan);

    expect(observations).toHaveLength(3);
    expect(observations[0].evidence).toContain("page.goto(");
    expect(observations[1].observed).toBe('Clicked "#entrar" without error.');
    // 7. find could NOT check for the email field — buildElementSelector()
    // only knows "botão"/"link" today, not "campo". This is an honest
    // report of that gap, never a guessed presence/absence.
    expect(observations[2].observed).toBe('No deterministic selector could be built for "campo de e-mail".');
  });

  it("6. independently of the find/selector gap: the click really does change the page", async () => {
    const adapter = await launchBrowserAdapter(DATA_URL);
    try {
      await adapter.navigate(DATA_URL);
      expect(await adapter.exists("#email")).toBe(false);
      await adapter.click("#entrar");
      expect(await adapter.exists("#email")).toBe(true);
    } finally {
      await adapter.close();
    }
  });

  it("9,10. runLabTask(): the Planner is asked once and correctly finds nothing — FIXED: the agent is never called, no evidence is faked", async () => {
    // recognizeIntents() and isBlockedComposedTask() are NOT mocked here —
    // this text naturally clears both on its own (confirmed: it doesn't
    // match check-element-exists's own pattern, since "clique no botão
    // Entrar" sits between "abra <url> e" and "verifique se existe", and it
    // doesn't trip hasUnsupportedComposition either) and naturally reaches
    // looksLikeBrowserTaskCandidate() for real. Before the fix in this step,
    // the Smart Router's own "abra + verifique + exist" rule still matched
    // this raw text and called qa-agent anyway, with zero real evidence —
    // that gap is exactly what this test now proves is closed.
    const provider = new MockModelProvider();
    let modelCallCount = 0;
    setModelProviderForTesting({
      name: provider.name,
      completeStructured: async (params) => {
        modelCallCount += 1;
        return provider.completeStructured(params);
      },
    });

    const executionsBefore = await db.agentExecution.count({ where: { projectId: project.id } });
    const result = await runLabTask(TASK_WITH_HTTPS_URL, project);
    const executionsAfter = await db.agentExecution.count({ where: { projectId: project.id } });

    // Exactly 1 model call: the Planner's own (returns null). The agent's
    // completeStructured is never reached at all now.
    expect(modelCallCount).toBe(1);
    expect(executionsAfter).toBe(executionsBefore); // no AgentExecution row created

    expect(result.browserExecuted).toBe(false);
    expect(result.agentUsed).toBeNull();
    expect(result.agentsCalled).toEqual([]);
    expect(result.status).toBe("COORDINATION_BLOCKED");
    expect(result.finding).toBeNull();
    expect(result.evidence).toBeNull();
    expect(result.summary).toContain("Task Planner could not produce an executable Plan");
  });
});

/**
 * The fix itself: a Planner null must never fall through to routeTask()
 * with the bare task text — that's exactly how an agent used to get called
 * with zero real evidence (see the describe block above). All 5 cases from
 * this step's spec, using the real (Mock-backed) provider throughout.
 */
describe("runLabTask — Planner null blocks before routeTask() (no agent, no fake evidence)", () => {
  let project: Project;
  const createdProjectNames: string[] = [];

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Lab task planner-null-blocks test project ${Date.now()}` },
    });
  });

  afterEach(() => {
    setModelProviderForTesting(null);
  });

  afterAll(async () => {
    await db.agentExecution.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
    for (const name of createdProjectNames) {
      const created = await db.project.findFirst({ where: { name } });
      if (created) {
        await db.agentExecution.deleteMany({ where: { projectId: created.id } });
        await db.project.delete({ where: { id: created.id } });
      }
    }
    await db.$disconnect();
  });

  it("1,2,3,4. Caso 3 — Planner returns null: no agent, no Finding, no Evidence, status is the existing COORDINATION_BLOCKED", async () => {
    const executionsBefore = await db.agentExecution.count({ where: { projectId: project.id } });

    const result = await runLabTask(
      "Abra https://exemplo.com e faça uma tarefa que o Planner atual não sabe representar.",
      project,
    );

    const executionsAfter = await db.agentExecution.count({ where: { projectId: project.id } });
    expect(executionsAfter).toBe(executionsBefore); // 1. no agent call at all

    expect(result.agentUsed).toBeNull();
    expect(result.agentsCalled).toEqual([]);
    expect(result.evidence).toBeNull(); // 2. no Evidence
    expect(result.finding).toBeNull(); // 3. no Finding
    expect(result.status).toBe("COORDINATION_BLOCKED"); // 4. existing mechanism, no new status
    expect(result.browserExecuted).toBe(false);
  });

  it("5. Caso 1 — an existing create-project intent is unaffected by this fix", async () => {
    const name = `Planner-null-fix create-project ${Date.now()}`;
    createdProjectNames.push(name);
    setModelProviderForTesting(sequentialProvider([NO_FINDING_OUTPUT]));

    const result = await runLabTask(`Crie um projeto chamado ${name}`, project);

    expect(result.browserExecuted).toBe(true);
    expect(result.agentUsed).toBe("new-user");
    expect(result.status).toBe("COMPLETED");
  });

  it("6. Caso 2 — a valid Plan is unaffected: real browser evidence still reaches the agent", async () => {
    setModelProviderForTesting(sequentialProvider([QA_NO_FINDING_OUTPUT]));

    const result = await runLabTask(
      "Abra data:text/html,<button>Cadastro</button> e verifique se existe um botão de cadastro.",
      project,
    );

    expect(result.browserExecuted).toBe(true);
    expect(result.agentUsed).toBe("qa-agent");
    expect(result.status).toBe("COMPLETED");
  });

  it("7. Caso 4 — an out-of-scope task still never reaches the Planner (gate unaffected)", async () => {
    setModelProviderForTesting({
      name: "must-not-be-called",
      completeStructured: async () => {
        throw new Error("The model provider must not be called for an out-of-scope task.");
      },
    });

    const result = await runLabTask("Organize minha reunião de amanhã.", project);

    expect(result.status).toBe("COORDINATION_BLOCKED");
    expect(result.agentUsed).toBeNull();
    expect(result.browserExecuted).toBe(false);
  });

  it("8. Caso 5 — an unsupported composed task is still blocked before the Planner (isBlockedComposedTask unaffected)", async () => {
    setModelProviderForTesting({
      name: "must-not-be-called",
      completeStructured: async () => {
        throw new Error("The model provider must not be called for an already-blocked composed task.");
      },
    });

    const result = await runLabTask(
      "Crie um projeto chamado Gamma e depois abra o projeto para verificar a tela.",
      project,
    );

    expect(result.status).toBe("COORDINATION_BLOCKED");
    expect(result.agentUsed).toBeNull();
  });
});

/**
 * 5. Full LAB flow for the new 3-step Mock shape: Planner → Plan →
 * executePlan → real evidence → routeTask → agent. The task text uses an
 * https:// URL so it clears lab-task.ts's own looksLikeBrowserTaskCandidate()
 * gate (a data: URL wouldn't — see this session's earlier gate work); the
 * Planner's own response is scripted via sequentialProvider (existing test
 * infrastructure, no architecture change) so the actual navigate target can
 * be the safe, network-free data: URL — tests 1 and 4 above already prove
 * the real MockModelProvider produces this exact Plan shape for real when
 * the URL in the sentence is itself a data: URL.
 */
describe("runLabTask — full flow for the new 3-step Mock shape", () => {
  let project: Project;

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Lab task 3-step full flow test project ${Date.now()}` },
    });
  });

  afterEach(() => {
    setModelProviderForTesting(null);
  });

  afterAll(async () => {
    await db.agentExecution.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.$disconnect();
  });

  it("5. the task reaches the agent with real 3-step browser evidence", async () => {
    const dataUrl =
      'data:text/html,<button id="entrar" onclick="document.getElementById(\'slot\').innerHTML=\'<button>Continuar</button>\'">Entrar</button><div id="slot"></div>';
    const plannerPlanResponse = {
      actions: [
        { action: "navigate", target: dataUrl },
        { action: "click", target: "#entrar" },
        { action: "find", target: "botão Continuar" },
      ],
    };

    setModelProviderForTesting(sequentialProvider([plannerPlanResponse, QA_NO_FINDING_OUTPUT]));

    const result = await runLabTask(
      "Abra https://exemplo.com e clique no botão Entrar e verifique se existe o botão Continuar.",
      project,
    );

    expect(result.browserExecuted).toBe(true);
    expect(result.agentUsed).toBe("qa-agent");
    expect(result.agentsCalled).toEqual(["qa-agent"]);
    expect(result.status).toBe("COMPLETED");

    const execution = await db.agentExecution.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
    });
    expect(execution?.task).toContain('Clicked "#entrar" without error.');
    expect(execution?.task).toContain('An element matching "botão Continuar" was found on the page.');
  });
});

/**
 * EvaluationMission.target.url connected to the Plan-based path: runLabTask()
 * now accepts an optional third context param carrying targetUrl, which
 * flows through to planTask()'s own context.url and executePlan()'s own
 * baseUrl — both already existed and already accepted exactly this (see
 * task-planner.ts / plan-executor.ts). The mission's target here represents
 * an "external system" — a page real evidence is gathered from, unrelated
 * to the LAB's own internal app.
 */
describe("runLabTask — EvaluationMission.target.url reaching the Browser", () => {
  let project: Project;

  // Spaces are percent-encoded (%20) so the URL is a single whitespace-free
  // token — MOCK_PLAN_3_STEP_PATTERN's (\S+) needs that to capture the whole
  // URL when it's embedded in the task sentence below; Chromium decodes it
  // correctly, so the real HTML/attributes are unchanged.
  const targetUrl =
    'data:text/html,<button%20id="entrar"%20onclick="document.getElementById(\'slot\').innerHTML=\'<button>Continuar</button>\'">Entrar</button><div%20id="slot"></div>';

  const mission: EvaluationMission = evaluationMissionSchema.parse({
    id: "mission-target-url-test",
    target: { url: targetUrl, name: "Sistema Externo de Teste" },
    objective: "Confirm the login flow reveals a Continuar button after clicking Entrar.",
    task: `Abra ${targetUrl} e clique no botão Entrar e verifique se existe o botão Continuar.`,
    requestedAgents: ["qa-agent"],
  });

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Lab task mission target-url test project ${Date.now()}` },
    });
  });

  afterEach(() => {
    setModelProviderForTesting(null);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await db.agentExecution.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.$disconnect();
  });

  it("1-5. mission.target.url reaches executePlan() as baseUrl, and the Browser really navigates, clicks and finds against it", async () => {
    const executePlanSpy = vi.spyOn(planExecutor, "executePlan");
    setModelProviderForTesting(new MockModelProvider());

    const result = await runLabTask(mission.task, project, { targetUrl: mission.target.url });

    // 1. the mission's target was actually used — passed through as
    // executePlan()'s baseUrl, not silently ignored.
    expect(executePlanSpy).toHaveBeenCalledTimes(1);
    expect(executePlanSpy.mock.calls[0][1]).toBe(mission.target.url);

    expect(result.browserExecuted).toBe(true);
    expect(result.agentUsed).toBe("qa-agent");
    expect(result.status).toBe("COMPLETED");

    const execution = await db.agentExecution.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
    });
    // 2-5. real Observations for navigate, click and find persisted as the
    // evidence the agent actually received.
    expect(execution?.task).toContain(`Loaded ${mission.target.url}`); // 2. Browser opened the target
    expect(execution?.task).toContain('Clicked "#entrar" without error.'); // 3. click happened
    expect(execution?.task).toContain('An element matching "botão Continuar" was found on the page.'); // 4. find happened
    expect((execution?.task.match(/ACTION:/g) ?? []).length).toBe(3); // 5. exactly 3 Observations
  });

  it("the gate accepts a task with no URL in its own text when context.targetUrl is provided (the Planner is still asked, even though this Mock can't help without the URL restated in the sentence)", async () => {
    const planTaskSpy = vi.spyOn(taskPlanner, "planTask");
    setModelProviderForTesting(new MockModelProvider());

    const result = await runLabTask("Clique no botão Entrar e verifique se existe o botão Continuar.", project, {
      targetUrl,
    });

    // The gate no longer rejects this outright just because the sentence
    // itself has no URL — it's asked, and only THEN (correctly) blocked,
    // because this Mock's own hardcoded pattern requires the URL to be
    // restated in the text (a real model with context.targetUrl might do
    // better — untested here, no Anthropic call in this environment).
    expect(planTaskSpy).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("COORDINATION_BLOCKED");
    expect(result.agentUsed).toBeNull();
  });
});

/**
 * EvaluationMission.requestedAgents connected to the agent runtime:
 * routeTask() (smart-router.ts) now accepts an optional requestedAgentId
 * that bypasses chooseInitialAgentId()'s keyword matching, resolved through
 * the exact same AgentRegistry/coordinateAgentTask() pipeline the keyword
 * path already uses. runLabTask() threads context.requestedAgents[0]
 * through as that override — the smallest connection point, same spirit as
 * the target.url step above.
 */
describe("runLabTask — EvaluationMission.requestedAgents reaching the agent runtime", () => {
  let project: Project;

  // Reuses the same working 3-step Mock shape as the target.url tests above
  // (MOCK_PLAN_3_STEP_PATTERN) — the only way to get a real, executable Plan
  // out of this environment's Mock provider, so real browser evidence
  // actually exists to hand to the agent.
  const targetUrl =
    'data:text/html,<button%20id="entrar"%20onclick="document.getElementById(\'slot\').innerHTML=\'<button>Continuar</button>\'">Entrar</button><div%20id="slot"></div>';

  // Deliberately also contains "primeira experiência" — on its own, that
  // phrase makes chooseInitialAgentId() (smart-router.ts) pick new-user, not
  // qa-agent (proven directly in test 0 below). This is what proves
  // requestedAgents genuinely overrides the Router's own keyword decision,
  // rather than merely agreeing with what it would have picked anyway.
  const mission: EvaluationMission = evaluationMissionSchema.parse({
    id: "mission-requested-agents",
    target: { url: targetUrl },
    objective: "Verificar se um novo usuário consegue completar o fluxo.",
    task: `Avalie a primeira experiência: abra ${targetUrl} e clique no botão Entrar e verifique se existe o botão Continuar.`,
    requestedAgents: ["qa-agent"],
  });

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Lab task requested-agents test project ${Date.now()}` },
    });
  });

  afterEach(() => {
    setModelProviderForTesting(null);
  });

  afterAll(async () => {
    await db.agentExecution.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.$disconnect();
  });

  it("0. sanity check: without an explicit override, the Router's own keyword rule would pick new-user, not qa-agent, for this task", () => {
    const choice = chooseInitialAgentId(mission.task);
    expect(choice?.agentId).toBe("new-user");
  });

  it("1-8. a validated Mission's requestedAgents reaches qa-agent — real evidence, no Router substitution, no extra agent", async () => {
    // 1. the Mission itself is schema-validated (evaluationMissionSchema.parse
    // above already threw if it weren't).
    setModelProviderForTesting(new MockModelProvider());

    const result = await runLabTask(mission.task, project, {
      targetUrl: mission.target.url,
      requestedAgents: mission.requestedAgents,
    });

    // 2-4. target.url still reaches the Browser and real evidence is produced.
    expect(result.browserExecuted).toBe(true);

    // 5-6. qa-agent ran — not new-user, which the Router's own keyword rule
    // would have picked for this exact task text (see test 0 above).
    expect(result.agentUsed).toBe("qa-agent");
    expect(result.status).toBe("COMPLETED");

    // 8. no additional agent was executed.
    expect(result.agentsCalled).toEqual(["qa-agent"]);
    expect(result.collaborated).toBe(false);

    // 7. the AgentExecution actually created belongs to qa-agent (compares
    // against the Agent row's real id, not just the human-readable slug).
    const qaAgentRow = await db.agent.findUnique({ where: { slug: "qa-agent" } });
    const execution = await db.agentExecution.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
    });
    expect(execution?.agentId).toBe(qaAgentRow?.id);
    expect(execution?.task).toContain('Clicked "#entrar" without error.');
    expect(execution?.task).toContain('An element matching "botão Continuar" was found on the page.');
  });

  it("9. an unregistered requested agent id blocks explicitly — no fallback to the Router or any other agent", async () => {
    setModelProviderForTesting({
      name: "must-not-be-called",
      completeStructured: async () => {
        throw new Error("runLabTask must not call the model provider when the requested agent doesn't exist.");
      },
    });

    const executionsBefore = await db.agentExecution.count({ where: { projectId: project.id } });

    const result = await runLabTask("Avalie o onboarding de um novo usuário no app.", project, {
      requestedAgents: ["agente-inexistente"],
    });

    const executionsAfter = await db.agentExecution.count({ where: { projectId: project.id } });
    expect(executionsAfter).toBe(executionsBefore); // no agent call at all, not even a fallback one

    expect(result.status).toBe("COORDINATION_BLOCKED");
    expect(result.agentsCalled).toEqual([]);
    expect(result.summary).toContain("agente-inexistente");
    expect(result.summary).toContain("not registered");
  });
});

/**
 * EvaluationAgentInput (src/domain/evaluation-agent-input.ts): the explicit
 * "this agent is evaluating this mission, based on these real observations"
 * contract. Proves the real flow of information — Mission -> Browser -> real
 * Observations -> qa-agent's own persisted AgentExecution.input.context — not
 * just that the type/schema shape is correct in isolation.
 */
describe("runLabTask — EvaluationMission reaching the agent as an explicit EvaluationAgentInput", () => {
  let project: Project;

  const targetUrl =
    'data:text/html,<button%20id="entrar"%20onclick="document.getElementById(\'slot\').innerHTML=\'<button>Continuar</button>\'">Entrar</button><div%20id="slot"></div>';

  const mission: EvaluationMission = evaluationMissionSchema.parse({
    id: "mission-evaluation-input",
    target: { url: targetUrl, name: "Sistema Externo de Teste" },
    objective: "Confirm the login flow reveals a Continuar button after clicking Entrar.",
    task: `Abra ${targetUrl} e clique no botão Entrar e verifique se existe o botão Continuar.`,
    requestedAgents: ["qa-agent"],
  });

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Lab task evaluation-input test project ${Date.now()}` },
    });
  });

  afterEach(() => {
    setModelProviderForTesting(null);
  });

  afterAll(async () => {
    await db.agentExecution.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.$disconnect();
  });

  it("Mission -> Browser -> 3 real Observations -> qa-agent -> EvaluationAgentInput carries mission.id, target.url, objective, task and exactly those Observations", async () => {
    setModelProviderForTesting(new MockModelProvider());

    const result = await runLabTask(mission.task, project, {
      requestedAgents: mission.requestedAgents,
      mission: { id: mission.id, target: mission.target, objective: mission.objective },
    });

    expect(result.browserExecuted).toBe(true);
    expect(result.agentUsed).toBe("qa-agent");
    expect(result.status).toBe("COMPLETED");

    const execution = await db.agentExecution.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
    });

    // The real, persisted input the agent actually received — not a
    // separately re-derived copy of what we think should have been sent.
    const persistedInput = execution?.input as {
      context?: { evaluationInput?: { mission: EvaluationMission; observations: unknown[] } };
    };
    const evaluationInput = persistedInput?.context?.evaluationInput;

    expect(evaluationInput?.mission.id).toBe(mission.id);
    expect(evaluationInput?.mission.target.url).toBe(mission.target.url);
    expect(evaluationInput?.mission.objective).toBe(mission.objective);
    expect(evaluationInput?.mission.task).toBe(mission.task);
    // requestedAgents is deliberately excluded from the agent's own input —
    // a routing concern, not something the agent being evaluated needs.
    expect(evaluationInput?.mission).not.toHaveProperty("requestedAgents");

    // Exactly the 3 real Observations the Browser produced for this Plan
    // (navigate, click, find) — never invented, never a subset.
    const observations = evaluationInput?.observations as { evidence: string; observed: string }[] | undefined;
    expect(observations).toHaveLength(3);
    expect(observations?.[0].evidence).toContain("page.goto(");
    expect(observations?.[1].observed).toBe('Clicked "#entrar" without error.');
    expect(observations?.[2].observed).toBe('An element matching "botão Continuar" was found on the page.');

    // The same information also actually reached the model's own prompt
    // text, not just the persisted JSON context field.
    const promptText = (persistedInput as unknown as { prompt?: string })?.prompt ?? "";
    expect(promptText).toContain("evaluationInput");
    expect(promptText).toContain(mission.id);
  });

  it("a context.targetUrl-only call (no context.mission) never builds an EvaluationAgentInput — routeTask()'s context stays undefined", async () => {
    const routeTaskModule = await import("@/core/orchestrator/smart-router");
    const routeTaskSpy = vi.spyOn(routeTaskModule, "routeTask");
    setModelProviderForTesting(new MockModelProvider());

    await runLabTask(mission.task, project, { targetUrl: mission.target.url });

    expect(routeTaskSpy).toHaveBeenCalledTimes(1);
    expect(routeTaskSpy.mock.calls[0][0].context).toBeUndefined();
    routeTaskSpy.mockRestore();
  });
});

/**
 * The output side: AgentOutput (src/domain/agent-output.ts) is already the
 * project's reusable "structured evaluation result" contract — status
 * FINDING/NO_FINDING/UNCONFIRMED, finding, evidence, impact, recommendation,
 * confidence — enforced by the existing agentOutputSchema refine (FINDING
 * requires finding+evidence+impact+recommendation+classification) and
 * already what runAgent()/coordinateAgentTask() produce and persist. No new
 * contract, no changes to runAgent/AgentRegistry/coordinateAgentTask: these
 * tests prove qa-agent produces one from a real EvaluationAgentInput,
 * through the exact same pipeline the previous two steps already wired.
 */
describe("runLabTask — QA Agent produces a structured Evaluation Result (AgentOutput) from EvaluationAgentInput", () => {
  let project: Project;

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Lab task evaluation-result test project ${Date.now()}` },
    });
  });

  afterEach(() => {
    setModelProviderForTesting(null);
  });

  afterAll(async () => {
    await db.agentExecution.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.$disconnect();
  });

  it("1,2,3,4,6. qa-agent receives the EvaluationAgentInput and produces a real FINDING grounded only in the real Observations, never an invented cause", async () => {
    // A real page where clicking "Entrar" does nothing observable — no
    // handler ever reveals "Continuar". The 3rd real Observation is
    // therefore a genuine absence, not a scripted one: find() really runs
    // exists("role=button[name=/Continuar/i]") against the real page and
    // gets false.
    const dataUrlNoChange = 'data:text/html,<button id="entrar">Entrar</button>';
    const mission: EvaluationMission = evaluationMissionSchema.parse({
      id: "mission-evaluation-result-finding",
      target: { url: dataUrlNoChange, name: "Sistema Externo de Teste" },
      objective: "Confirm the login flow reveals a Continuar button after clicking Entrar.",
      task: `Abra ${dataUrlNoChange} e clique no botão Entrar e verifique se existe o botão Continuar.`,
      requestedAgents: ["qa-agent"],
    });
    // Only the Planner's own response (call 1) is scripted, to keep the
    // real Browser/Observation-gathering path exactly as it always is; the
    // qa-agent's own evaluation (call 2) is scripted here ONLY because this
    // environment's Mock provider's keyword analysis doesn't recognize this
    // particular absence phrasing as negative (a known, pre-existing Mock
    // limitation — see mock-provider.ts's NEGATIVE_MARKERS) — the finding
    // scripted below still only ever restates what the real Observations
    // actually show, never a guessed cause (see this const's own comment).
    const plannerPlanResponse = {
      actions: [
        { action: "navigate", target: dataUrlNoChange },
        { action: "click", target: "#entrar" },
        { action: "find", target: "botão Continuar" },
      ],
    };
    setModelProviderForTesting(sequentialProvider([plannerPlanResponse, QA_FINDING_GROUNDED_OUTPUT]));

    const result = await runLabTask(mission.task, project, {
      requestedAgents: mission.requestedAgents,
      mission: { id: mission.id, target: mission.target, objective: mission.objective },
    });

    // 1. qa-agent received the EvaluationAgentInput — real observations,
    // including the genuine absence, reached its persisted input.
    const execution = await db.agentExecution.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
    });
    const persistedInput = execution?.input as { context?: { evaluationInput?: { observations: { observed: string }[] } } };
    const observations = persistedInput?.context?.evaluationInput?.observations;
    expect(observations).toHaveLength(3);
    expect(observations?.[2].observed).toBe('No element matching "botão Continuar" was found on the page.');

    // 2,3. qa-agent produced a real, persisted structured AgentOutput with a
    // valid status.
    const output = execution?.output as AgentOutput | null;
    expect(output).not.toBeNull();
    expect(AGENT_OUTPUT_STATUSES).toContain(output?.status);
    expect(output?.status).toBe("FINDING");

    // 4. a FINDING carries both finding and evidence (also enforced
    // structurally by agentOutputSchema's own refine — see output-validator.ts).
    expect(output?.finding).toBeTruthy();
    expect(output?.evidence).toBeTruthy();

    // 6. the evidence is a real quote of what the Browser actually observed
    // — never invented — and the finding never claims an unobserved
    // technical cause (e.g. "backend"/"database"/"server"), only the
    // observable absence of change, exactly the distinction this step's own
    // spec draws.
    expect(output?.evidence).toContain('No element matching "botão Continuar" was found on the page.');
    expect(output?.finding?.toLowerCase()).not.toMatch(/backend|database|server|api\b/);

    // The same structured result also surfaces through LabTaskResult, the
    // caller-facing shape — not just the raw DB row.
    expect(result.finding).toBe(QA_FINDING_GROUNDED_OUTPUT.finding);
    expect(result.evidence).toBe(QA_FINDING_GROUNDED_OUTPUT.evidence);
    expect(result.status).toBe("COMPLETED"); // coordination succeeded; FINDING is the evaluation's own verdict, not a coordination failure
  });

  it("5. qa-agent can report UNCONFIRMED through the same real pipeline when the evidence isn't enough to confirm a problem", async () => {
    const targetUrl =
      'data:text/html,<button%20id="entrar"%20onclick="document.getElementById(\'slot\').innerHTML=\'<button>Continuar</button>\'">Entrar</button><div%20id="slot"></div>';
    const mission: EvaluationMission = evaluationMissionSchema.parse({
      id: "mission-evaluation-result-unconfirmed",
      target: { url: targetUrl },
      objective: "Confirm the login flow reveals a Continuar button after clicking Entrar.",
      task: `Abra ${targetUrl} e clique no botão Entrar e verifique se existe o botão Continuar.`,
      requestedAgents: ["qa-agent"],
    });
    // Call 1: the Planner's own real Plan for this 3-step shape (a real,
    // executable Plan — the Browser really navigates, clicks and looks for
    // Continuar). Call 2: qa-agent's own evaluation, scripted here to
    // exercise the UNCONFIRMED branch directly, since this Mock's own
    // analyzePrompt() only ever derives NO_FINDING/FINDING from OBSERVED
    // text — it never produces UNCONFIRMED for a normal successful run on
    // its own.
    const plannerPlanResponse = {
      actions: [
        { action: "navigate", target: targetUrl },
        { action: "click", target: "#entrar" },
        { action: "find", target: "botão Continuar" },
      ],
    };
    setModelProviderForTesting(sequentialProvider([plannerPlanResponse, QA_UNCONFIRMED_OUTPUT]));

    const result = await runLabTask(mission.task, project, {
      requestedAgents: mission.requestedAgents,
      mission: { id: mission.id, target: mission.target, objective: mission.objective },
    });

    const execution = await db.agentExecution.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
    });
    const output = execution?.output as AgentOutput | null;

    expect(AGENT_OUTPUT_STATUSES).toContain(output?.status);
    expect(output?.status).toBe("UNCONFIRMED");
    expect(output?.evidence).toBeNull(); // UNCONFIRMED never requires evidence — only FINDING does
    expect(result.status).toBe("COMPLETED");
    expect(result.summary).toBe(QA_UNCONFIRMED_OUTPUT.finding);
  });
});

describe("runLabTask — legacy path (no context) is unaffected", () => {
  let project: Project;

  beforeAll(async () => {
    const organization = await getDefaultOrganization();
    project = await db.project.create({
      data: { organizationId: organization.id, name: `Lab task legacy no-context test project ${Date.now()}` },
    });
  });

  afterEach(() => {
    setModelProviderForTesting(null);
  });

  afterAll(async () => {
    await db.agentExecution.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.$disconnect();
  });

  it("runLabTask(task, project) — the original 2-argument call — still evaluates the LAB itself exactly as before", async () => {
    setModelProviderForTesting(sequentialProvider([NO_FINDING_OUTPUT]));

    const result = await runLabTask("Avalie o onboarding de um novo usuário no app.", project);

    expect(result.agentUsed).toBe("new-user");
    expect(result.status).toBe("COMPLETED");
    expect(result.browserExecuted).toBe(false);
  });
});

describe("buildTaskWithEvidence", () => {
  const observations: Observation[] = [
    { action: "Open the page.", expected: "It loads.", observed: "It loaded.", evidence: "page.goto() resolved." },
  ];

  it("omits the Objective line entirely when none is given — runLabTask's own plain tasks are byte-for-byte unchanged", () => {
    const task = buildTaskWithEvidence("Confirm the page loads.", observations);
    expect(task).not.toContain("Objective:");
    expect(task.startsWith("Confirm the page loads.")).toBe(true);
  });

  it("prepends a readable Objective line when one is given — found missing from an EvaluationMission agent's prompt during an integration audit (it previously reached the agent only inside a raw JSON blob)", () => {
    const task = buildTaskWithEvidence("Confirm the page loads.", observations, "Avaliar a experiência de onboarding.");
    expect(task).toContain("Objective: Avaliar a experiência de onboarding.");
    // The objective must appear before the task's own instruction, in the
    // same readable block the model actually reasons from.
    expect(task.indexOf("Objective:")).toBeLessThan(task.indexOf("Confirm the page loads."));
  });
});
