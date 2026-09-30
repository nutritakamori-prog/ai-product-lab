import type { Project } from "@/generated/prisma/client";
import { routeTask, chooseInitialAgentId, type RouteTaskResult } from "@/core/orchestrator/smart-router";
import type { AgentOutput } from "@/domain/agent-output";
import type { Observation } from "@/core/testing/runner/test-runner";
import { recognizeIntents, hasUnsupportedComposition, executeIntent } from "@/services/task-intents";
import { executePlan } from "@/services/plan-executor";
import { planTask } from "@/services/task-planner";
import type { EvaluationMission } from "@/domain/evaluation-mission";
import { buildEvaluationAgentInput } from "@/domain/evaluation-agent-input";

/**
 * The smallest real "task in, result out" capability for the LAB. Not a new
 * layer: it hands the task straight to the existing Smart Router
 * (routeTask), which already picks the agent, selects the model
 * deterministically, runs the Coordinator/Runtime, and handles any real
 * needsOtherAgent collaboration — nothing about that pipeline is
 * reimplemented or wrapped here. The only new thing is the synthesis: a
 * plain, deterministic one-line summary of whichever agent's output ends
 * up being the final word (the specialist's, if a review round actually
 * happened; the initial agent's otherwise) — no LLM call to produce it, no
 * memory, no planning, no retry.
 */
export interface LabTaskResult {
  task: string;
  /** The agent the Smart Router chose, or null if no rule matched. */
  agentUsed: string | null;
  status: RouteTaskResult["status"];
  /** Every agent actually executed, in order — length 1 for an ordinary task, 2 only when collaboration was genuinely needed. */
  agentsCalled: string[];
  collaborated: boolean;
  finding: string | null;
  evidence: string | null;
  recommendation: string | null;
  /** Plain-text synthesis of the final result — simple by design (see docs/DECISIONS.md's Test Lab entries for the same evidence-first spirit). */
  summary: string;
  /**
   * True when the task's intent was deterministically recognized (see
   * src/services/task-intents.ts) and executed for real via the
   * BrowserAdapter before the agent ran — never inferred, never invented
   * for an unrecognized task.
   */
  browserExecuted: boolean;
}

function formatObservations(observations: Observation[]): string {
  return observations
    .map(
      (o, i) => `${i + 1}. ACTION: ${o.action}\n   EXPECTED: ${o.expected}\n   OBSERVED: ${o.observed}\n   EVIDENCE: ${o.evidence}`,
    )
    .join("\n\n");
}

/**
 * Same evidence-first shape the Test Lab's own buildScenarioTask already
 * uses (src/core/testing/runner/test-runner.ts) — real observations,
 * appended to the task, never replacing it. Exported so
 * evaluation-orchestrator.ts can reuse the exact same formatting for each
 * requested agent's own task text, rather than a second implementation.
 *
 * `objective`, when given, is prepended as its own readable line. Without
 * it (runLabTask's own plain tasks have no separate objective), behavior is
 * byte-for-byte unchanged. Added because an EvaluationMission's objective
 * was reaching the agent's prompt only inside a raw JSON blob under
 * "Context: evaluationInput: {...}" — never in the readable task text next
 * to the actual instruction the agent reasons from (found during an
 * integration audit tracing exactly what an agent receives).
 */
export function buildTaskWithEvidence(task: string, observations: Observation[], objective?: string): string {
  return [
    ...(objective ? [`Objective: ${objective}`, ""] : []),
    task,
    "",
    "The following real observations were gathered by actually performing this task in the application:",
    "",
    formatObservations(observations),
    "",
    'Based ONLY on the observations above, report status "FINDING" if there is a real, evidenced problem, "NO_FINDING" if everything worked as expected, or "UNCONFIRMED" if unsure.',
  ].join("\n");
}

function finalOutput(routed: RouteTaskResult): AgentOutput | null {
  if (!routed.coordination) return null;
  return routed.coordination.reviewResult?.output ?? routed.coordination.initialResult.output;
}

function buildSummary(routed: RouteTaskResult, output: AgentOutput | null): string {
  if (!routed.coordination) {
    return routed.reason;
  }
  if (!output) {
    return `${routed.chosenAgent ?? "The agent"} did not produce a usable result: ${routed.coordination.initialResult.error ?? routed.coordination.blockedReason ?? "unknown error"}.`;
  }
  if (output.status === "FINDING") {
    return output.finding ?? "A problem was found.";
  }
  if (output.status === "UNCONFIRMED") {
    return output.finding ?? "The evidence was not sufficient to confirm a problem.";
  }
  return "No problem was found.";
}

// The create-project / verify-project-exists Smart Router rules exist
// specifically to pair with real browser evidence from task-intents.ts.
// Found during the 4-task limits diagnosis: a task can match one of these
// two rules (e.g. "Tente criar um projeto sem preencher o nome...") while
// recognizeIntents() has no executable intent for it — which used to still
// let an agent run and come back as a normal-looking COMPLETED result with
// no real evidence behind it. chooseInitialAgentId is a pure, side-effect
// free preview (see smart-router.ts) — checking it here costs nothing and
// avoids spending an agent call at all when this specific mismatch applies.
function looksLikeEvidenceBackedProjectAction(task: string): boolean {
  const choice = chooseInitialAgentId(task);
  return choice != null && (choice.reason.includes("(project creation)") || choice.reason.includes("(project verification)"));
}

// A second, narrower reason to skip the agent entirely: a composed task
// whose second half reads like an attempted (but unsupported) action — e.g.
// "...e depois abra o projeto para verificar a tela." Found during the
// 5-task follow-up diagnosis: such a task can slip past
// looksLikeEvidenceBackedProjectAction above (a different, unrelated Router
// rule — e.g. the general QA rule matching on "verificar" — can win first)
// and still reach a real agent call with the bare, uninterpreted task text.
// hasUnsupportedComposition reuses the exact same clause analysis
// recognizeIntents() already does (see task-intents.ts) — no duplicated
// pattern logic here.
function isBlockedComposedTask(task: string): boolean {
  return looksLikeEvidenceBackedProjectAction(task) || hasUnsupportedComposition(task);
}

/**
 * The shared shape for "NOT EXECUTED must never look like EXECUTED SEM
 * PROBLEMA" — reuses the existing COORDINATION_BLOCKED status (already part
 * of RouteTaskResult["status"]) rather than inventing a new one. No agent
 * is ever called, no finding/evidence is ever produced, for either reason
 * this is used: an unsupported composed intent, or the Task Planner
 * genuinely being asked and returning null.
 */
function blockedResult(task: string, summary: string): LabTaskResult {
  return {
    task,
    agentUsed: null,
    status: "COORDINATION_BLOCKED",
    agentsCalled: [],
    collaborated: false,
    finding: null,
    evidence: null,
    recommendation: null,
    summary,
    browserExecuted: false,
  };
}

// The cheapest, most honest signal that a task is worth spending a real
// Task Planner call on: does it actually contain a URL? planTask() itself
// refuses to invent one (see task-planner.ts) — so without one already
// written in the task (or supplied separately via an EvaluationMission's
// target.url, see RunLabTaskContext below), the Planner is structurally
// unable to produce anything but null, no matter how "interface-y" the
// rest of the wording sounds. Deliberately not a keyword list: a task's
// WORDING is exactly what the Planner exists to interpret, not something
// this gate should attempt.
const URL_LIKE_PATTERN = /https?:\/\/|www\./i;

function looksLikeBrowserTaskCandidate(task: string): boolean {
  return URL_LIKE_PATTERN.test(task);
}

/**
 * The connection point for an EvaluationMission (see
 * src/domain/evaluation-mission.ts) reaching runLabTask(). `targetUrl`
 * flows through to both planTask()'s own `context.url` and executePlan()'s
 * own `baseUrl` param — both already existed and already accepted exactly
 * this. `requestedAgents`/`mission` (below) are additive, later steps —
 * every field here stays optional so the legacy 2-argument call is
 * completely unaffected.
 */
export interface RunLabTaskContext {
  targetUrl?: string;
  /**
   * An EvaluationMission's own field of that name: which agent(s) the
   * mission explicitly wants involved, rather than leaving that decision
   * entirely to the Smart Router's keyword rules. Only the first id is used
   * for now — routing a Mission to more than one agent (consensus, review
   * ordering) is a later step's concern. Passed straight through as
   * routeTask()'s own `requestedAgentId` (see smart-router.ts) — never a
   * second, duplicated agent-resolution path.
   */
  requestedAgents?: string[];
  /**
   * The rest of an EvaluationMission's own static fields (see
   * src/domain/evaluation-mission.ts) — everything an EvaluationAgentInput
   * (src/domain/evaluation-agent-input.ts) needs besides the real
   * Observations this function already gathers itself. A direct slice of the
   * real Mission the caller already has, never a second shape: `target`
   * doubles as this call's targetUrl source too (see effectiveTargetUrl
   * below) when `targetUrl` above isn't given separately. Only present for a
   * genuine Mission-based evaluation — the legacy 2-argument call never sets
   * this, and runLabTask() never requires it.
   */
  mission?: Pick<EvaluationMission, "id" | "target" | "objective">;
}

export async function runLabTask(
  task: string,
  project: Pick<Project, "id">,
  context?: RunLabTaskContext,
): Promise<LabTaskResult> {
  // Deterministic only — never an LLM call to decide this (see
  // task-intents.ts). An unrecognized task falls through to exactly the
  // same behavior as before this existed: the bare task text, no browser
  // evidence — unless it also looks like a project create/verify action the
  // Router would otherwise pick up with zero real evidence (see below).
  const intents = recognizeIntents(task);
  let effectiveTask = task;
  let browserExecuted = false;
  // Lifted out of each branch below (rather than staying branch-local) so
  // it's available afterward to build an EvaluationAgentInput for a
  // Mission-based evaluation (see context.mission below) — the exact same
  // Observations already gathered for the agent's own prompt, never a
  // second, separately-produced copy.
  let observations: Observation[] = [];
  // An EvaluationMission's target.url, when given, is just as valid a
  // source for it as the standalone targetUrl field (see RunLabTaskContext
  // above) — the caller shouldn't have to repeat the same URL in two places.
  const effectiveTargetUrl = context?.targetUrl ?? context?.mission?.target.url;

  if (intents.length > 0) {
    for (const intent of intents) {
      observations.push(...(await executeIntent(intent)));
    }
    effectiveTask = buildTaskWithEvidence(task, observations);
    browserExecuted = true;
  } else if (isBlockedComposedTask(task)) {
    // NOT EXECUTED must never look like EXECUTED SEM PROBLEMA: this task
    // reads like a project create/verify action (or a composed task whose
    // second step isn't supported), but task-intents.ts couldn't turn it
    // into a real one, so no agent runs at all here.
    return blockedResult(
      task,
      "This task looks like a project creation/verification action, but no executable intent could be recognized from it — no agent was run, to avoid a result with no real evidence behind it.",
    );
  } else if (looksLikeBrowserTaskCandidate(task) || Boolean(effectiveTargetUrl)) {
    // Only reached once no intent matched and the task wasn't already
    // blocked above — recognizeIntents() keeps first priority exactly as
    // before. planTask() (src/services/task-planner.ts) is a real,
    // costed model call — the gate exists purely to avoid spending it on
    // tasks that obviously have nothing to do with a browser (e.g.
    // "Organize minha reunião de amanhã."). An explicit target URL (an
    // EvaluationMission's target, whether given as context.targetUrl or
    // context.mission.target.url) is just as valid a reason to ask as a
    // URL written in the task text — the caller already knows this is a
    // real browser task, it just doesn't need to say so in the sentence.
    // Interpretation itself is still entirely the Planner's job — this gate
    // never tries to interpret the task, only to notice whether it's worth
    // asking at all.
    const plan = await planTask(task, effectiveTargetUrl ? { url: effectiveTargetUrl } : undefined);
    if (!plan) {
      // The Planner was genuinely asked and couldn't produce an executable
      // Plan — falling through to routeTask() with the bare task text would
      // let the Smart Router's own keyword rules (e.g. the "abra + verifique
      // + exist" element-check rule) still match and call an agent with zero
      // real evidence, exactly the gap found testing the 3-step sequence.
      // Blocked here instead, before routeTask() ever runs.
      return blockedResult(
        task,
        "This task looked like a browser task, but the Task Planner could not produce an executable Plan for it — no agent was run, to avoid a result with no real evidence behind it.",
      );
    }
    // The Plan's own "navigate" step already carries the real target
    // (whatever the Planner produced it as) — passing the target URL here
    // too is the authoritative source for launching the browser context,
    // matching the mission's declared target regardless of what the Plan
    // happened to put in its first step.
    observations = await executePlan(plan, effectiveTargetUrl);
    effectiveTask = buildTaskWithEvidence(task, observations);
    browserExecuted = true;
  }
  // else: not a browser-task candidate — falls through unchanged, exactly
  // like an unrecognized task always has, with zero model calls spent.

  // Only for a genuine Mission-based evaluation (context.mission given) —
  // the legacy 2-argument call and a plain context.targetUrl-only call never
  // set this, so routeTask()'s own context stays exactly what it always was
  // (undefined) for them. Reuses the same `context: Record<string, unknown>`
  // mechanism runAgent()/coordinateAgentTask() already pass through
  // untouched (see evidence-sharing.ts's sharedEvidence for the same
  // pattern) — no new plumbing added to the Runtime.
  const routeContext = context?.mission
    ? {
        evaluationInput: buildEvaluationAgentInput(
          { id: context.mission.id, target: context.mission.target, objective: context.mission.objective, task },
          observations,
        ),
      }
    : undefined;

  // Whichever branch above ran (intent, plan, or neither), the agent is
  // reached through this single routeTask() call — never once per path.
  const routed = await routeTask({
    task: effectiveTask,
    project,
    requestedAgentId: context?.requestedAgents?.[0],
    context: routeContext,
  });
  const output = finalOutput(routed);

  return {
    task,
    agentUsed: routed.chosenAgent,
    status: routed.status,
    agentsCalled: routed.agentsCalled,
    collaborated: routed.agentsCalled.length > 1,
    finding: output?.finding ?? null,
    evidence: output?.evidence ?? null,
    recommendation: output?.recommendation ?? null,
    summary: buildSummary(routed, output),
    browserExecuted,
  };
}
