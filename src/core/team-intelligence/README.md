# Team Intelligence

**Responsibility:** a read-only, team-wide cross-reference of what the LAB
already knows — Agent Intelligence (10B.1), Finding History (10B.2), and the
Recommendation → Implementation → Validation cycle (10B.3). Describes
observed activity, coverage, convergence, and evidence gaps. Built entirely
from those existing modules' own outputs; no new comparison logic, no new
table.

`team-intelligence.ts` is pure (no database, no Prisma types) and does the
composition; `src/services/team-intelligence.ts` loads the data (scoped to
one project) and calls it.

**Not this module's job:** scoring, ranking, or judging an agent's quality,
efficiency, or performance, and no decision about creating, removing, or
changing an agent. That interpretation is FASE 10D — Team Architect's job,
which does not exist yet.
