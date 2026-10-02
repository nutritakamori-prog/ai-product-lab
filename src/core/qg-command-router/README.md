# QG Command Router

**Responsibility:** pure, deterministic mapping from a typed command string
to one of the five known `QgCommandId`s this phase supports. No database
access, no LLM, no business logic — just text normalization and a lookup
against `QG_COMMANDS`' own known phrases.

**Not this module's job:** actually running a command. That's
`src/services/qg-command-router.ts`, which calls the real, existing LAB
services (`getAgentIntelligence`, `getFindingHistory`,
`listRecommendationsForRun`/`listRecommendations`, `getTeamArchitectReport`)
and shapes their output for the QG — never a second implementation of any
of them.
