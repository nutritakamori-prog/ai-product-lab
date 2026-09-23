# AI Product Lab

A platform where AI agents observe, understand, diagnose, propose,
implement, test, and learn about a digital product — for real, not as a
demo. See `docs/PRODUCT_VISION.md` for what that means concretely.

## Status

Phase 1 (Foundation) — just the app + database skeleton exist. No agents
run yet. See `docs/DEVELOPMENT.md` for the full phase plan and where we are.

## Quick start

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL and ANTHROPIC_API_KEY
npx prisma migrate dev
npm run dev
```

Full setup instructions (including local Postgres options): `docs/DEVELOPMENT.md`.

## Docs

| File | What's in it |
|---|---|
| `docs/PRODUCT_VISION.md` | What we're building and why |
| `docs/SYSTEM_ARCHITECTURE.md` | Stack, orchestration flow, module map |
| `docs/AGENT_ARCHITECTURE.md` | How agents work, communicate, resolve conflicts |
| `docs/AGENT_SPECIFICATION.md` | Per-agent spec (filled in as agents are built) |
| `docs/LAP_SPECIFICATION.md` | The LAP lifecycle and Retest Engine |
| `docs/DESIGN_SYSTEM.md` | Design direction + tokens (Phase 9/10) |
| `docs/DATABASE.md` | Schema and the reasoning behind it |
| `docs/DEVELOPMENT.md` | Setup, commands, phase plan, approval gates |
| `docs/DECISIONS.md` | Running log of non-obvious decisions and why |
