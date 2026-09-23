/**
 * Placeholder for Phase 7 (Findings / Decisions). No Decision entity exists
 * yet — the Lap/Finding/Decision/Task tables were deliberately removed in
 * an earlier pass (see docs/DECISIONS.md) and come back, redesigned, when
 * that phase starts. Nothing here is enforced by the Runtime today.
 *
 * Documented now so agent authors already know the separation their
 * systemPrompt should respect once Decisions exist: facts (evidence-backed
 * observations), interpretation (analysis), and recommendation (what to
 * do) must stay visibly distinct — never blended into one paragraph.
 */
export const DECISION_FRAMEWORK_NOTE =
  "Keep facts, interpretation, and recommendation visibly separate. Not enforced yet — Phase 7 (Findings/Decisions) will.";
