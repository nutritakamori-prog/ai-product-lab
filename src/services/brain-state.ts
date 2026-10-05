/**
 * BrainState's own tiny, dependency-free module — split out of
 * operational-brain.ts specifically so the QG's client component
 * (command-center.tsx) can import this plain type/constant without pulling
 * in operational-brain.ts's server-only graph (Prisma, the Agent Runtime,
 * the Evaluation Orchestrator) into the browser bundle. No logic lives
 * here, only the shape both sides agree on.
 *
 * `ProductConcept` is imported as a type only — product-understanding.ts is
 * itself dependency-free (no DB, no provider), so this stays a plain,
 * browser-safe module.
 */
import type { ProductConcept } from "@/core/product-understanding/product-understanding";

export interface BrainState {
  projectId: string | null;
  projectName: string | null;
  missionRunId: string | null;
  lastRecommendationId: string | null;
  /**
   * FASE 16A — the Product Understanding concept the Brain's PREVIOUS reply
   * answered, if any. Exists only so a weak, pronoun-dependent follow-up
   * ("E os agentes?", "Então me resume tudo.") can be read as a continuation
   * of that same conceptual conversation — see
   * classifyProductConceptContinuation() in operational-brain.ts. reply()
   * clears this to null on every reply that ISN'T itself a Product
   * Understanding answer, so the window is exactly one turn: never assumed
   * from "any earlier message", only the immediately preceding one (FASE
   * 16A's own safety rule).
   */
  lastProductConcept: ProductConcept | null;
  /**
   * FASE 19 — Team Architect. Which Team Intelligence/Architect question
   * the Brain's PREVIOUS reply answered, if any — exists only so a weak,
   * pronoun-dependent follow-up ("Qual seria?" right after "Precisamos de
   * algum agente novo?") can be read as "tell me more about that", the
   * same continuation discipline lastProductConcept already established.
   * reply() clears this on every reply that isn't itself a Team
   * Intelligence/Architect answer — never assumed from any earlier
   * message, only the immediately preceding one.
   */
  lastTeamIntelligenceIntent: "OVERVIEW" | "UNDERUSED" | "REMOVE" | "DISABLE" | "ADD" | "GAP" | "OVERLAP" | "EVOLUTION" | null;
}

export const INITIAL_BRAIN_STATE: BrainState = {
  projectId: null,
  projectName: null,
  missionRunId: null,
  lastRecommendationId: null,
  lastProductConcept: null,
  lastTeamIntelligenceIntent: null,
};

/**
 * Living Lab — the one real fact-sheet the Brain hands back alongside its
 * conversational text, for the QG's visual layer (living-lab-room.tsx) to
 * choreograph off of. Every field here is something the Brain already knows
 * for certain by the time it replies (which real agents it selected, the
 * real status a mission actually ended with, whether it actually queried
 * GitHub and what came back) — never a prediction, never an in-progress
 * guess. Always present on a Brain reply (even as `{agentIds: [], ...}` for
 * a reply that triggered no mission), so the visual layer can tell "this is
 * a real-time Brain event, trust it" apart from an exact-command result
 * (command-center.tsx never sets this field for those, which still use the
 * page's own last-known-state heuristic, unchanged).
 */
export interface BrainActivitySignal {
  /** The real agent ids the Brain actually selected for a mission it just triggered — empty when this reply triggered no mission. */
  agentIds: string[];
  /** The real EvaluationMissionRun status the triggered mission actually ended with — null when no mission was triggered this turn. */
  missionStatus: "COMPLETED" | "BLOCKED" | "FAILED" | null;
  /** Set only when this reply actually queried GitHub this turn — null otherwise. `repoCount` is null when not configured or the API call itself failed (never a guessed count). */
  github: { configured: boolean; repoCount: number | null } | null;
  /**
   * FASE 11 — Mission Lifecycle. The real per-agent breakdown of the mission
   * this reply just reported on (from EvaluationMissionRun.progress/report —
   * never a guess), whether that mission just finished or is still RUNNING.
   * Empty arrays whenever `missionStatus` is null (no mission in this reply)
   * or no agent has actually completed/failed yet.
   */
  completedAgentIds: string[];
  failedAgentIds: string[];
}

export const EMPTY_BRAIN_SIGNAL: BrainActivitySignal = { agentIds: [], missionStatus: null, github: null, completedAgentIds: [], failedAgentIds: [] };
