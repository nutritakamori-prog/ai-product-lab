# UX agents

`ux-agent` — judges the quality of an experience already observed: clarity
of flow, ease of finding the intended action, unnecessary friction,
consistency, clarity of messages/states, and concrete UX improvement
opportunities. Never a first impression (`agents/experience/new-user.ts`'s
job) and never a functional correctness check (`agents/qa/qa-agent.ts`'s
job) — complements both, reusing their evidence (via the existing
shared-evidence context, `src/core/coordination/evidence-sharing.ts`)
instead of re-investigating. Uses `UNCONFIRMED` when the evidence doesn't
clearly show a UX problem, and never turns a personal stylistic preference
into a finding. Same pattern as `agents/experience/new-user.ts` — see that
file's own comments for the reasoning behind the shape.

Distinct from the future Design Lab roster in `agents/design/` (UX
Architect, UI Designer, Visual Designer, ...), which is a separate,
still-unbuilt phase.
