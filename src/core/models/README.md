# Model Provider & Routing

**Responsibility:** two things, both in `provider.ts`:

1. **Routing** — `MODEL_TIER_TO_ID` maps our three abstract tiers to a
   concrete Anthropic model id, so nothing else in the codebase hardcodes a
   model name:
   - `LOW_COST` → Haiku: classification, deduplication, simple tasks, extraction.
   - `BALANCED` → Sonnet: analysis, UX, QA, UI.
   - `HIGH_REASONING` → Opus: complex decisions, conflicts, strategy, architecture.
2. **Provider abstraction** — `ModelProvider` is the interface `core/runtime`
   actually calls (`completeStructured`); `AnthropicModelProvider` is the
   only implementation today, using the Anthropic SDK's Structured Outputs
   (`messages.parse` + `zodOutputFormat`) to get schema-conformant JSON back
   directly, rather than parsing free text. Swapping providers later means
   writing a second class here, not touching `core/runtime`.

Also owns cost estimation (`estimateCost`) from published per-token pricing.

**Not this module's job:** deciding what to do with the model's response —
that's `core/runtime` (execution) and `core/runtime/output-validator.ts`
(the extra business-rule check beyond plain shape validation).

**Testing:** `setModelProviderForTesting()` swaps in a fake provider so
`core/runtime` tests never call the real API. Never used by production code.
