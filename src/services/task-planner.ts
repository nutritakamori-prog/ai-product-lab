import { z } from "zod";
import { getModelProvider, MODEL_TIER_TO_ID } from "@/core/models/provider";
import { TASK_PLANNER_SYSTEM_MARKER } from "@/core/models/mock-provider";
import type { Plan, PlanAction } from "@/services/plan-executor";

/**
 * The first real Task Planner: turns natural-language text into a Plan
 * using the same completeStructured() mechanism runAgent() already uses for
 * agents (src/core/runtime/run-agent.ts) — but this is NOT an agent. It has
 * no AgentDefinition, is never registered in the AgentRegistry, and never
 * appears in agentsCalled/collaboration. It's a plain service function, same
 * spirit as recognizeIntents()/recognizePlan() — just backed by a model
 * instead of a regex, for the interpretation step alone. Everything after
 * interpretation (validation, execution, evidence) stays exactly as
 * deterministic as it already was.
 */

const PLAN_ACTION_SCHEMA = z.discriminatedUnion("action", [
  z.object({ action: z.literal("navigate"), target: z.string().min(1) }).strict(),
  z.object({ action: z.literal("find"), target: z.string().min(1) }).strict(),
  z.object({ action: z.literal("click"), target: z.string().min(1) }).strict(),
  z.object({ action: z.literal("fill"), target: z.string().min(1), value: z.string() }).strict(),
  z.object({ action: z.literal("getText"), target: z.string().min(1) }).strict(),
]);

const PLANNER_RESPONSE_SCHEMA = z.object({
  actions: z.array(PLAN_ACTION_SCHEMA),
});

export type PlannerValidationResult =
  | { valid: true; data: { actions: PlanAction[] }; error: null }
  | { valid: false; data: null; error: string };

/**
 * Same shape and purpose as src/core/runtime/output-validator.ts's
 * validateAgentOutput — a schema gate an invalid result can never pass
 * through, testable on its own without a model call. An action outside the
 * five known types, or one missing a required field, fails here.
 */
export function validatePlannerOutput(raw: unknown): PlannerValidationResult {
  const result = PLANNER_RESPONSE_SCHEMA.safeParse(raw);
  if (result.success) {
    return { valid: true, data: result.data, error: null };
  }
  const error = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  return { valid: false, data: null, error };
}

const SYSTEM_PROMPT = [
  TASK_PLANNER_SYSTEM_MARKER,
  "",
  'You convert one task written in natural language into a short, ordered list of browser actions — nothing else. You may only use these five action types: "navigate" (target: a URL), "find" (target: a free-form description of an element to look for), "click" (target: a real CSS or role selector), "fill" (target: a real selector, value: the text to enter), "getText" (target: a real selector). Never invent an action type outside this list.',
  "If the task doesn't clearly describe a URL and a check you can confidently represent with these five actions, return an empty actions list — never guess a URL or an element that isn't actually stated in the task.",
].join("\n");

const TOKEN_BUDGET = 400;

function buildUserPrompt(task: string, context?: { url?: string }): string {
  const lines = [`Task: ${task}`];
  if (context?.url) {
    lines.push(
      "",
      `A URL is also available separately: ${context.url}`,
      'If the task above already states its own URL, use that one as the "navigate" target instead — only use this separate URL when the task itself doesn\'t name one.',
    );
  }
  return lines.join("\n");
}

/**
 * Returns the Plan the model produced, or null when it explicitly couldn't
 * represent the task (an empty actions list) — never a guess. A real
 * provider failure (network error) or an invalid/unparseable response
 * propagates as an exception instead, exactly like runAgent()'s own
 * transport-error handling — "couldn't understand this task" and "the
 * provider broke" are different facts, and the second one must never be
 * reported as the first.
 */
export async function planTask(task: string, context?: { url?: string }): Promise<Plan | null> {
  const provider = getModelProvider();
  const result = await provider.completeStructured({
    model: MODEL_TIER_TO_ID.LOW_COST,
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt(task, context),
    maxTokens: TOKEN_BUDGET,
    schema: PLANNER_RESPONSE_SCHEMA,
  });

  if (!result.data) {
    throw new Error(`Task Planner did not return output matching the required schema (stop_reason: ${result.stopReason}).`);
  }

  const validation = validatePlannerOutput(result.data);
  if (!validation.valid) {
    throw new Error(`Task Planner returned an invalid Plan: ${validation.error}`);
  }

  return validation.data.actions.length > 0 ? (validation.data.actions as Plan) : null;
}

export interface TaskPlanner {
  plan(task: string, context?: { url?: string }): Promise<Plan | null>;
}

/** Programmatic-interface form of planTask, for callers that want to depend on the TaskPlanner contract rather than the function directly. */
export const modelTaskPlanner: TaskPlanner = { plan: planTask };
