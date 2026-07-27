# Local development

## Prerequisites

- Node.js ≥ 20 (tested on 25)
- pnpm ≥ 9 (`corepack enable pnpm`)
- [uv](https://docs.astral.sh/uv/) + Python ≥ 3.12 (only for the API scaffold; uv can install Python itself)
- Terraform ≥ 1.9 (only for infrastructure work)

## Setup

```bash
pnpm install
pnpm dev              # web on http://localhost:5173

uv sync               # one-time: creates .venv from uv.lock
pnpm dev:api          # optional API on http://localhost:4000
```

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
