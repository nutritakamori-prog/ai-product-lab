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
   real implementation, using the Anthropic SDK's Structured Outputs
   (`messages.parse` + `zodOutputFormat`) to get schema-conformant JSON back
   directly, rather than parsing free text. Swapping providers later means
   writing a second class here, not touching `core/runtime`.

Also owns cost estimation (`estimateCost`) from published per-token pricing.

## Provider selection: Anthropic when configured, Mock otherwise

`getModelProvider()` picks automatically: `AnthropicModelProvider` when
`ANTHROPIC_API_KEY` is set, otherwise `MockModelProvider`
(`mock-provider.ts`) — no flag to set, no code to touch either way. This
means `runAgent()` (and anything built on it, like the Test Lab's
`npm run test-lab:round`) always works, with or without a real key, and a
missing key can never again surface as an uncaught exception the way it
did before this existed (see `docs/DECISIONS.md`).

`MockModelProvider` is a deterministic, offline stand-in — never a second
real analysis engine. It reads only the `OBSERVED:` text already present in
the prompt it's given (produced by whatever real evidence-gathering already
happened, e.g. the Test Lab's real browser automation) and applies simple,
explainable keyword rules: a clear negative result → `FINDING`; a step
marked not-automated or otherwise inconclusive, or no structured evidence
at all → `UNCONFIRMED`; otherwise → `NO_FINDING`. It never invents an
observation that isn't already in the prompt, and its findings are
deliberately capped at `MEDIUM` impact/confidence, saying in their own
`recommendation` text that they're a low-confidence lead to re-verify with
the real provider — not a substitute for one.

Every `ModelProvider` implementation (including test doubles) has a
`name`; `runAgent()` records it on `AgentExecution.provider` (a
Prisma enum, `ANTHROPIC` | `MOCK`) so a Mock-backed execution is never
mistaken for a real one.

**Not this module's job:** deciding what to do with the model's response —
that's `core/runtime` (execution) and `core/runtime/output-validator.ts`
(the extra business-rule check beyond plain shape validation).

**Testing:** `setModelProviderForTesting()` swaps in a fake provider so
`core/runtime` tests never call the real API, regardless of which provider
`getModelProvider()` would otherwise pick. Never used by production code.
`resetEnvCacheForTesting()` (`src/lib/env.ts`) is the matching escape hatch
for tests that need to exercise the real Anthropic-vs-Mock selection logic
itself, since `getEnv()` caches its result.
