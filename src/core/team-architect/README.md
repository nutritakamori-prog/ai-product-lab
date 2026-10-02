# Team Architect

**Responsibility:** pure, deterministic, rule-based reasoning over Team
Intelligence's own output (10C) plus the small amount of per-agent evidence
Team Intelligence deliberately omits (exact classification counts,
responsibilities/whenNotToCall). Produces `ArchitecturalRecommendation`s —
each with explicit, traceable evidence, a stated interpretation
(`rationale`), and a stated action to consider (`suggestedAction`) — and
`InsufficientEvidenceEntry`s wherever the data doesn't clear the bar for a
recommendation.

`team-architect.ts` is pure (no database, no Prisma types, no LLM call) and
does the reasoning; `src/services/team-architect.ts` loads the data (scoped
to one project) and calls it.

**Not this module's job, ever, in this version:** scoring or ranking an
agent; deciding "best/worst"; executing any change (no agent is created,
disabled, removed, or modified by this code — those stay recommendations
for a human to act on); REMOVE_AGENT, MERGE_RESPONSIBILITIES, and
SPLIT_RESPONSIBILITY are deliberately never produced as real recommendations
here, only as InsufficientEvidenceEntry — see team-architect.ts's own doc
comment for why.
