# LAP Specification

A LAP ("Lab Analysis Pass") is one execution of an analysis — the unit of
work the whole system revolves around.

## Fields

```
project      Project
objective    string
mode         INTERNAL | PRODUCT | HYBRID
version      int
scenarios    Json         // what will be exercised
agents       (via AgentExecution[])
status       DRAFT | RUNNING | COMPLETED | FAILED
findings     Finding[]
decisions    (via Finding -> Decision)
tasks        (via Finding/Decision -> Task)
cost         (derived: sum of TokenUsage.estimatedCost across executions)
duration     (derived: completedAt - createdAt)
result       Json         // final consolidated summary
```

See `prisma/schema.prisma` for the authoritative field-level definition —
this file is the narrative version.

## Flow

```
CREATE LAP
 → OBJECTIVE
 → SCENARIOS
 → SMART ROUTER
 → AGENTS
 → FINDINGS
 → DEDUPLICATION
 → ORCHESTRATOR
 → DECISION
 → TASK
 → IMPLEMENTATION
 → RETEST
```

## Retest Engine (Phase 8)

After an implementation lands, the same scenario runs again. BEFORE vs
AFTER is compared and classified as one of:

- `RESOLVED`
- `PARTIALLY_RESOLVED`
- `NOT_RESOLVED`
- `REGRESSION`

This is what separates a lab from a report generator: it verifies its own
recommendations actually worked.
