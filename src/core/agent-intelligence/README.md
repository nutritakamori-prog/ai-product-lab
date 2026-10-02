# Agent Intelligence

**Responsibility:** read-only, historical observability over what each agent
has actually done — executions, Mission participation, findings,
classifications, convergence with other agents. Built entirely from data the
LAB already persists (`AgentExecution`, `EvaluationMissionRun.report`); no new
table, no new column, no schema change.

`agent-activity.ts` is pure (no database, no Prisma types) and does the
aggregation; `src/services/agent-intelligence.ts` loads the data (scoped to
one project) and calls it.

**Not this module's job:** scoring, ranking, quality inference, or any
decision about creating/removing/changing an agent. It answers "what did this
agent do", never "how good is this agent" — see FASE 10A/10B.1 for why.
