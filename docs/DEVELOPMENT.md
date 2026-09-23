# Development

## Prerequisites

- Node.js 20+ and npm.
- A local PostgreSQL 16 (either via Docker or a native install — see below).
- An Anthropic API key (https://console.anthropic.com/settings/keys) — the
  Agent Runtime (Phase 2) needs it to actually call Claude. Without it, the
  app still builds and runs fine (nothing on any page calls the Runtime
  yet); you'll only hit the "ANTHROPIC_API_KEY is not set" error if you
  call `runAgent()` yourself. The test suite never needs a real key — the
  Runtime's own tests inject a fake `ModelProvider`.

## First-time setup

```bash
npm install
cp .env.example .env      # then fill in DATABASE_URL and ANTHROPIC_API_KEY
```

### Database — option A: Docker (recommended on your own machine)

```bash
docker compose up -d
npx prisma migrate dev
```

### Database — option B: native Postgres (used in this sandbox, Docker's
daemon wasn't reachable here)

```bash
sudo service postgresql start
sudo -u postgres psql -c "CREATE ROLE ai_product_lab LOGIN PASSWORD 'ai_product_lab' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE ai_product_lab OWNER ai_product_lab;"
npx prisma migrate dev
```

(The `CREATEDB` privilege is needed because `prisma migrate dev` creates a
temporary "shadow database" to compute each migration safely.)

## Running the app

```bash
npm run dev        # http://localhost:3000
```

## Before considering any phase done

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

All four must pass clean — this is a hard gate per phase, not a suggestion.

## Phase plan & Approval Gates

| Phase | What | Gate |
|---|---|---|
| 0 | Architecture & planning | **GATE 0** ✅ approved |
| 1 | Foundation | **GATE 1** ✅ approved |
| 2 | Agent Runtime (this) | **GATE 2** |
| 3 | Context Engine | — |
| 4 | Master Orchestrator | — |
| 5 | First working agents | **GATE 3** |
| 6 | LAP Engine | **GATE 4** |
| 7 | Findings / Decisions / Tasks | — |
| 8 | Retest Engine | — |
| 9 | Design Lab | **GATE 5** |
| 10 | Design Blueprint | — |
| 11 | Memory | **GATE 6** |
| 12 | Product Strategy / CEO | **GATE 7** |
| 13 | Observability & token economy | — |
| 14 | SaaS preparation | **GATE 8** |

We do not move to the next phase without an explicit go-ahead at each gate.
