# Product Vision

## What this is

AI Product Lab is a platform where AI agents can genuinely
**observe → understand → diagnose → propose → implement → test → learn**
about a digital product — not a UI with agent-shaped buttons that don't
actually run anything.

When the system says an agent ran an analysis, it really called the
configured model and recorded the result. When it says it found a problem,
there is evidence attached, or it's explicitly labeled a hypothesis
(`UNCONFIRMED`) — never presented as fact without one.

## The core loop

```
User registers a product
  → LAB understands the objective
  → Master Orchestrator identifies which agents are needed
  → Agents simulate different users / analyze UX, UI, QA, content,
    responsiveness, accessibility
  → Results are consolidated; duplicate problems are merged
  → The system separates FACT / INTERPRETATION / RECOMMENDATION
  → Findings are created
  → Findings can become Decisions
  → Decisions can become Tasks
  → Design Lab can propose a solution
  → Page/Frame Creator produces a page blueprint
  → The change gets implemented
  → The LAB re-runs the same scenario
  → BEFORE vs AFTER is compared
  → The system determines whether the problem was actually resolved
```

That last step — retesting, not just diagnosing — is the point of the
whole product. A lab that only finds problems isn't a lab.

## Operating modes

Every project runs in one of three modes (see `DECISIONS.md` for why HYBRID
is the default):
- **INTERNAL** — optimize an internal operation.
- **PRODUCT** — evaluate generalization potential / SaaS readiness.
- **HYBRID** (default) — solve the internal problem *and* flag what
  turning it into something sellable would require.

## What this is not (yet)

Full multi-tenant SaaS with billing, 20 fully-tuned agents, a polished
design system — all real goals, but staged. See `docs/DEVELOPMENT.md` for
the phase plan and gates. We build the smallest version that proves the
loop above actually works end to end before adding breadth.
