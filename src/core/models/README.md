# Model Routing

**Responsibility:** pick the right model tier for a task, so we're not paying
Opus prices for deduplication. Three tiers:
- LOW COST (Haiku): classification, deduplication, simple tasks, extraction.
- BALANCED (Sonnet): analysis, UX, QA, UI.
- HIGH REASONING (Opus): complex decisions, conflicts, strategy, architecture.

Swapping the underlying provider/model per tier later should only mean editing
this module, nothing that calls it.

**Not this module's job:** calling the model (`core/runtime` does that, using
whatever this module tells it to use).

_(Empty until Phase 2 — Agent Runtime, since the Runtime needs a model to call
from day one.)_
