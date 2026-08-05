# Local development

## Prerequisites

- Node.js ≥ 20 (tested on 25)
- pnpm ≥ 9 (`corepack enable pnpm`)
- [uv](https://docs.astral.sh/uv/) + Python ≥ 3.12 (only for the API scaffold; uv can install Python itself)
- Docker (for local Postgres — the API has no in-memory fallback)
- Terraform ≥ 1.9 (only for infrastructure work)

## Setup

HTTP is the default data mode, so the SPA needs the API running to be functional.
Run both processes:

```bash
pnpm install
uv sync               # one-time: creates .venv from uv.lock

pnpm dev:api          # FastAPI on http://localhost:4000
pnpm dev              # web on http://localhost:5173
```

Want to skip the API entirely? See [Data modes](#data-modes) below for the
in-browser `memory` mode.

## Database

`docker compose up -d db` is the one required dependency — the API has no
in-memory fallback, so both `pnpm dev:api` and `pytest` need it reachable.
Data persists across restarts in a named volume; `docker compose down -v` if
you need a clean slate (the init script that creates `secureflow_test` only
runs on an empty volume).

```bash
docker compose up -d db
```

Defaults (matching `docker-compose.yml`, overridable via `.env`):

- `DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/secureflow`
- `TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/secureflow_test`

Alembic migrations and fixture seeding run automatically at API startup — no
manual migration step. `POST /api/demo/reset` restores the seeded demo state
without restarting the process, but is 404 (absent) unless `DEMO_RESET_ENABLED=1`
is set — it's disabled by default everywhere, including local dev; `.env.example`
sets it to `1` so a `.env` copied from it enables it locally. Because state now
lives in Postgres instead of an in-process dict, it survives API restarts;
reset is how you get back to a known-good demo state without touching the
database yourself.

## Everyday loops

```bash
pnpm lint             # eslint (web)
pnpm typecheck        # strict tsc across workspaces
pnpm test             # vitest (41 unit/component tests)
pnpm test:api         # pytest (28 API tests, via uv)
pnpm --filter @secureflow/web test:watch
pnpm e2e              # playwright, memory mode; first time: npx playwright install chromium
pnpm e2e:http         # playwright, http mode: boots uv API + vite dev server
pnpm build            # production build
```

## Data modes

The SPA reads `VITE_DATA_SOURCE` at build/dev time:

- **`http` (default):** providers call the FastAPI backend at `/api/*` (the
  Vite dev server proxies to `http://127.0.0.1:4000`). Realtime comes from
  the server's SSE stream (`/api/events`) — start both processes:

      pnpm dev:api   # FastAPI on :4000 (server-side simulator on)
      pnpm dev       # Vite on :5173

- **`memory`:** providers run fully in-browser against the mock dataset;
  the client-side simulator drives realtime. No API process needed:

      VITE_DATA_SOURCE=memory pnpm dev

vitest and the default Playwright suite pin `memory`; `pnpm e2e:http` boots
both servers and smoke-tests the HTTP path.

Two views still read the in-memory seed data directly instead of going through
a provider, so they show fixed seed content regardless of server state even in
`http` mode: the run-detail page's approvals panel (`pipeline-run.tsx`) and the
AI insights panel's underlying data lookups (`lib/ai/ai-service.ts`, which reads
`mockState.runs`/`findings`). Both are follow-up scope — see the Conventions
note below.

## Demo tips

- **Live pipeline:** open `/pipelines/run-0512` — the simulator advances a stage every ~7s, streams logs on the selected stage, raises a mid-run finding, and loops.
- **RBAC:** profile menu (top right) switches between the 8 roles. Try approving `/pipelines/run-1482` as Developer (denied, tooltip explains) vs Release Approver.
- **Deep links:** `/security?finding=find-cve-portal`, `/infrastructure?plan=plan-identity-0862`, `/applications/app-payments?tab=architecture`.
- **Global search:** ⌘K / Ctrl-K.
- **Theme:** sun/moon toggle in the top bar; dark is default.

## Conventions

- Strict TS everywhere; `any` is an ESLint error.
- UI primitives in `components/ui`, domain components in `components/domain`, route components in `pages/`.
- All data access via hooks in `lib/queries.ts`; components never import providers directly (the run-detail page's read of mock approvals is the one documented exception, removed when approvals get a provider).
- New privileged actions must: check `useCan()`, record an audit event, and show a toast.
