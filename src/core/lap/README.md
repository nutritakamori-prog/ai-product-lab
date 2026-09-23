# LAP Engine

**Responsibility:** a LAP is one analysis run: objective → scenarios → smart router
→ agents → findings → deduplication → orchestrator → decision → task →
implementation → retest. This module owns the LAP lifecycle (create, advance
status, attach findings/decisions/tasks, compute cost/duration, finalize result).

**Not this module's job:** the actual agent execution (`core/runtime`) or finding
deduplication logic itself (`core/findings`) — LAP just sequences them.

_(Empty until Phase 6 — LAP Engine.)_
