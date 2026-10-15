# @ai-product-lab/agent-library

Standalone copy of the 7 evaluation-agent definitions originally built inside
`ai-product-lab` (`agents/`), packaged so they can be reused in another
project without depending on this app's database or Next.js runtime.

## What this is

Each agent is a plain, Zod-validated object: `role`, `objective`,
`responsibilities`, `constraints`, `whenNotToCall`, `systemPrompt`,
`tokenBudget`, `modelTier`. That's it — **prompt-engineering configuration
data**, not executable code. The only dependency is `zod`.

```ts
import { AGENT_DEFINITIONS, qaAgent, agentOutputSchema } from "@ai-product-lab/agent-library";
```

- `AGENT_DEFINITIONS` — array of all 7 agents.
- Each agent is also exported individually (`newUser`, `qaAgent`, `uxAgent`,
  `accessibilityAgent`, `productAgent`, `performanceAgent`, `securityAgent`).
- `agentDefinitionSchema` / `AgentDefinition` — the contract every agent
  definition satisfies.
- `agentOutputSchema` / `AgentOutput` — the structured result shape every
  agent is expected to produce (`FINDING` / `NO_FINDING` / `UNCONFIRMED`,
  evidence-first, never inventing an observation).

## What this is NOT

This package does **not** call Claude, does not run a browser, does not
read/write a database, and does not orchestrate agents against each other.
To actually run one of these agents, the receiving project still needs to
write its own:

- a loop that sends `systemPrompt` + real observations to a model,
- validation of the model's reply against `agentOutputSchema`,
- whatever routing/orchestration decides which agent(s) to call.

In `ai-product-lab` itself, that execution layer lives in
`src/core/testing/runner/`, `src/core/runtime/`, and `src/core/agents/registry.ts`
— all tightly coupled to this app's Prisma schema and deliberately **not**
duplicated here.

## The 7 agents

| id | category | job |
|---|---|---|
| `new-user` | EXPERIENCE | first-time-user impression / onboarding friction |
| `qa-agent` | QA | functional correctness, regressions |
| `ux-agent` | DESIGN | flow clarity, friction, consistency |
| `accessibility-agent` | ACCESSIBILITY | observable accessibility (no code-level audit) |
| `product-agent` | PRODUCT | product/flow coherence |
| `performance-agent` | PERFORMANCE | perceived performance (no profiling) |
| `security-agent` | SECURITY | defensive-only, observation-based security findings |

All are evidence-first by design: each one is instructed to report
`NO_FINDING` or `UNCONFIRMED` rather than assert a problem it has no
concrete evidence for.

## Using it elsewhere

This package is intentionally **not installed into any project yet** — it's
prepared so it's ready to drop into another codebase later:

- Copy the `packages/agent-library` folder into the target repo (or publish
  it to a private registry), run `npm install` + `npm run build`, and import
  from `dist/`.
- Or just copy `src/` directly if the target project prefers consuming the
  TypeScript sources as-is.

## Verification

Carried over from the source files: `tsc --noEmit` and `eslint` are clean
across this package (no test suite — there's no logic to unit test, only
Zod-validated data).
