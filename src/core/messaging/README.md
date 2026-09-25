# Agent Messaging

**Responsibility:** the smallest possible in-memory capability for one agent
to hand a structured message to another — `send(message)` / `receive(agentId)`
/ `clear()`, validated against `agentMessageSchema`
(`src/domain/agent-message.ts`) before being stored. No persistence, no
queue, no delivery guarantees beyond the current process, no retry, no
events. `receive` never removes a message — this is a shared log an agent
can query, not a consumable queue.

**Not this module's job:** deciding who should message whom (a future Smart
Router/Orchestrator's job, not built yet — see `core/orchestrator`), running
an agent (`core/runtime`), or storing a message anywhere durable.

_(Independent capability — not wired into the Runtime, Registry, or any
agent yet. Connecting it to real agent execution is a separate decision.)_
