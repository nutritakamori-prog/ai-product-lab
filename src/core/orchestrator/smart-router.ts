import type { ModelTier, Project } from "@/generated/prisma/client";
import { AgentRegistry, type ResolvedAgent } from "@/core/agents/registry";
import { coordinateAgentTask, type CoordinationResult, type CoordinationStatus } from "@/core/coordination/agent-coordinator";
import { selectModelTier } from "@/core/models/task-complexity";

/**
 * The Smart Router's first, minimal version (see this folder's README):
 * picks the smallest possible number of agents for a task — exactly one
 * initial agent chosen by a deterministic keyword rule, handed straight to
 * the existing coordination layer. No LLM call to decide, no agent
 * discovery, no context building, no conflict resolution, no consolidation.
 * Everything about HOW an agent runs (retries, messaging, limits) already
 * lives in runAgent()/coordinateAgentTask() and is reused as-is.
 */

interface AgentMatchRule {
  agentId: string;
  pattern: RegExp;
  reason: string;
}

// Checked in order — the first pattern that matches wins. Deliberately a
// short, fixed list (not "dozens of rules"): exactly the two categories
// this phase asks for. Extending this later still never invents a slug —
// every entry here must name a real, existing agent.
const AGENT_MATCH_RULES: AgentMatchRule[] = [
  {
    agentId: "new-user",
    pattern: /\b(onboarding|primeira experi[eê]ncia|first[- ]?time|novo usu[aá]rio|new user|uso inicial|primeiro uso)\b/i,
    reason: "Task mentions onboarding/first-time use — matched the new-user rule.",
  },
  {
    agentId: "qa-agent",
    pattern: /\b(qa|valida[cç][aã]o|validar|evid[eê]ncia|verifica[cç][aã]o|verificar)\b/i,
    reason: "Task mentions QA/validation/evidence/verification — matched the qa-agent rule.",
  },
  {
    agentId: "ux-agent",
    pattern: /\b(ux|experi[eê]ncia do usu[aá]rio|user experience|fluxo|usabilidade|usability|fric[cç][aã]o|friction|clareza de interface|clareza do fluxo)\b/i,
    reason: "Task mentions UX/user experience/flow/usability/friction/interface clarity — matched the ux-agent rule.",
  },
  {
    agentId: "new-user",
    // Both "criar/crie" and "projeto" present anywhere in the task, in
    // either order — covers "Crie um projeto novo chamado X", "Criar um
    // projeto chamado X", "Quero criar um projeto", etc. new-user already
    // has a real scenario for exactly this action
    // (new-user-creates-first-project), so it's the existing agent best
    // placed to evaluate the result.
    pattern: /(?=.*\bcri(?:ar|e)\b)(?=.*\bprojeto\b)/i,
    reason: "Task mentions creating a project — matched the new-user rule (project creation).",
  },
  {
    agentId: "qa-agent",
    // A verify/confirm verb (any conjugation actually used — "verifique"
    // included, not just the infinitive "verificar" the existing qa-agent
    // rule above already covers), "projeto", and "exist[e]" present
    // anywhere in the task, in any order — covers "Verifique se o projeto
    // X existe", "Verificar se o projeto X existe", "Confira se o projeto
    // X existe". Functional existence checks are exactly qa-agent's job.
    pattern: /(?=.*\b(?:verificar|verifique|confira|confirmar|confirme)\b)(?=.*\bprojeto\b)(?=.*\bexist)/i,
    reason: "Task asks to verify a project's existence — matched the qa-agent rule (project verification).",
  },
  {
    agentId: "qa-agent",
    // "Abra <url> e verifique se existe <elemento>" — the LAB's first
    // "open an arbitrary page and check something" flow (see
    // src/services/task-intents.ts's check-element-exists intent, the only
    // producer of real evidence for this shape). A functional presence
    // check on a page is exactly qa-agent's job, same reasoning as the
    // project-verification rule above.
    pattern: /(?=.*\babra\b)(?=.*\bverifique\b)(?=.*\bexist)/i,
    reason: "Task asks to open a page and verify an element's existence — matched the qa-agent rule (element check).",
  },
];

/**
 * Exported (read-only, no side effects) so callers like
 * src/services/lab-task.ts can check which rule a task would match — or
 * that none would — without running the full routeTask()/coordination
 * pipeline. Used to detect the specific gap found during the 4-task limits
 * diagnosis: a task can match the create-project/verify-project-exists
 * rules here while src/services/task-intents.ts's own recognizer has no
 * executable intent for it, which used to still produce a normal-looking
 * COMPLETED agent run with no real browser evidence behind it.
 */
export function chooseInitialAgentId(task: string): { agentId: string; reason: string } | null {
  const rule = AGENT_MATCH_RULES.find((r) => r.pattern.test(task));
  return rule ? { agentId: rule.agentId, reason: rule.reason } : null;
}

export interface RouteTaskInput {
  task: string;
  project: Pick<Project, "id">;
  context?: Record<string, unknown>;
  /**
   * Bypasses chooseInitialAgentId()'s keyword matching entirely and uses
   * this agent id as the initial agent instead — e.g. an EvaluationMission's
   * requestedAgents (see src/services/lab-task.ts). Still resolved through
   * the exact same AgentRegistry/coordinateAgentTask() pipeline as the
   * keyword-matched path below; an id that isn't registered fails exactly
   * like an unknown keyword-matched one already does (COORDINATION_BLOCKED),
   * never a silent fallback to a keyword-matched or otherwise different agent.
   */
  requestedAgentId?: string;
}

export interface RouteTaskResult {
  /** Slug of the agent the Router picked, or null if nothing matched. */
  chosenAgent: string | null;
  /** Short, human-readable reason for the choice (or for the block). */
  reason: string;
  /** The coordination layer's own result, or null if routing never got that far. */
  coordination: CoordinationResult | null;
  /** Every agent actually executed (pass-through of coordination.agentsCalled), [] if none. */
  agentsCalled: string[];
  status: CoordinationStatus;
  /**
   * The ModelTier actually used for the initial agent's run — see
   * src/core/models/task-complexity.ts. Transparent by design: never
   * lower than the agent's own configured tier, only ever escalated when
   * the task text gives a clear reason to. Null when routing never got
   * far enough to pick a model (e.g. COORDINATION_BLOCKED before any
   * agent was chosen).
   */
  selectedModelTier: ModelTier | null;
}

/**
 * Routes a task to the smallest possible number of agents: picks exactly
 * one initial agent by a deterministic rule (never an LLM call, never a
 * guess), then hands off entirely to coordinateAgentTask() — which already
 * enforces maxAgentCallsPerTask=2, maxReviewRounds=1, no repeat calls, and
 * no loops. No correspondence -> COORDINATION_BLOCKED, same as an unknown
 * needsOtherAgent further down the flow — this Router never invents or
 * auto-discovers a substitute agent either.
 */
export async function routeTask(input: RouteTaskInput): Promise<RouteTaskResult> {
  const choice = input.requestedAgentId
    ? { agentId: input.requestedAgentId, reason: `Explicitly requested agent: "${input.requestedAgentId}".` }
    : chooseInitialAgentId(input.task);
  if (!choice) {
    return {
      chosenAgent: null,
      reason:
        "No routing rule matched this task — not onboarding/first-use, not QA/validation/evidence/verification, not UX/experience/flow/usability/friction, not project creation, not project existence verification, not a page element check.",
      coordination: null,
      agentsCalled: [],
      status: "COORDINATION_BLOCKED",
      selectedModelTier: null,
    };
  }

  const initialAgent = await AgentRegistry.getBySlug(choice.agentId);
  if (!initialAgent) {
    // Defensive only — every rule above names a real agent id, so this
    // path means that agent was removed/disabled, not a routing decision.
    // Never falls back to guessing a different agent.
    return {
      chosenAgent: choice.agentId,
      reason: `${choice.reason} (but "${choice.agentId}" is not registered)`,
      coordination: null,
      agentsCalled: [],
      status: "COORDINATION_BLOCKED",
      selectedModelTier: null,
    };
  }

  // Deterministic, LLM-free model selection (src/core/models/task-complexity.ts):
  // only ever escalates above the agent's own configured tier, never below
  // it — so an agent's existing configuration/behavior is unaffected
  // whenever the task gives no clear reason to spend more. Scoped to the
  // initial agent only: the review round's specialist (if any) keeps using
  // its own configured tier, since that decision belongs to the
  // coordination layer, left untouched here.
  const selectedModelTier = selectModelTier(input.task, initialAgent.modelTier);
  const agentForThisTask: ResolvedAgent =
    selectedModelTier === initialAgent.modelTier ? initialAgent : { ...initialAgent, modelTier: selectedModelTier };

  const coordination = await coordinateAgentTask({
    initialAgent: agentForThisTask,
    project: input.project,
    task: input.task,
    context: input.context,
  });

  return {
    chosenAgent: initialAgent.id,
    reason: choice.reason,
    coordination,
    agentsCalled: coordination.agentsCalled,
    status: coordination.status,
    selectedModelTier,
  };
}
