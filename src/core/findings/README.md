# Findings / Decisions / Tasks

**Responsibility:** the evidence-first pipeline. Findings must follow
ACTION → EXPECTED → OBSERVED → EVIDENCE; nothing is stated as fact without
evidence (unconfirmed things are marked UNCONFIRMED, not asserted). Owns
deduplication (when multiple agents surface the same problem, consolidate
instead of creating duplicate findings), and the Finding → Decision → Task
promotion flow. Decisions must keep facts, interpretation, and recommendation
visibly separate — never blended into one paragraph.

**Not this module's job:** running agents or the retest comparison itself
(that's `core/lap`'s Retest Engine, added in Phase 8).

_(Empty until Phase 7 — Findings / Decisions / Tasks.)_
