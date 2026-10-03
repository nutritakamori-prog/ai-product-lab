/**
 * BrainState's own tiny, dependency-free module — split out of
 * operational-brain.ts specifically so the QG's client component
 * (command-center.tsx) can import this plain type/constant without pulling
 * in operational-brain.ts's server-only graph (Prisma, the Agent Runtime,
 * the Evaluation Orchestrator) into the browser bundle. No logic lives
 * here, only the shape both sides agree on.
 */
export interface BrainState {
  projectId: string | null;
  projectName: string | null;
  missionRunId: string | null;
  lastRecommendationId: string | null;
}

export const INITIAL_BRAIN_STATE: BrainState = {
  projectId: null,
  projectName: null,
  missionRunId: null,
  lastRecommendationId: null,
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
}

export const EMPTY_BRAIN_SIGNAL: BrainActivitySignal = { agentIds: [], missionStatus: null, github: null };
