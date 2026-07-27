# SPA → FastAPI Wiring — Design

**Date:** 2026-07-27
**Status:** Approved
**Goal:** Connect the SecureFlow SPA to the existing FastAPI backend over HTTP, replacing the in-memory-only data path while keeping in-memory as a switchable mode.

## Context

The SPA currently never calls the HTTP API: all data flows through in-memory provider implementations in `apps/web/src/lib/providers/index.ts`, and "live" behavior comes from a client-side simulator (`apps/web/src/lib/realtime/simulator.ts`) that advances run `run-0512` one stage per 7-second tick. The FastAPI backend (`apps/api`) serves read-only GET endpoints from JSON fixtures plus a heartbeat-only SSE stream at `/api/events`.

The single consumption seam is `apps/web/src/lib/queries.ts`, which imports all providers from `@/lib/providers`. Provider interfaces live in `@secureflow/types`.

## Decisions (made with user)

1. **Switchable provider mode, HTTP default.** Env flag selects HTTP or in-memory; dev/prod use HTTP, tests use in-memory.
2. **Add mutation endpoints to FastAPI.** Server holds mutable in-memory state seeded from fixtures; full round-trip realism.
3. **Server-side simulator + typed SSE.** Port the client tick loop into FastAPI; SPA subscribes to SSE in HTTP mode.

## 1. Provider seam (web)

- `lib/providers/mock/` — existing implementations moved here, unchanged (`index.ts`, `mock-state.ts`).
- `lib/providers/http/` — new fetch-based implementations of the same `@secureflow/types` interfaces. Relative `/api/*` URLs. Non-2xx responses throw an `Error` carrying the API's `detail` message so existing react-query error toasts work unchanged.
- `lib/providers/index.ts` — factory. Reads `import.meta.env.VITE_DATA_SOURCE`: `"http"` (default) or `"memory"`. Exports the same named providers (`pipelineProvider`, `securityProvider`, …) so `queries.ts` imports stay untouched.
- Vite dev server proxies `/api` → `http://127.0.0.1:4000` (no CORS in dev, no absolute URLs in code).
- Vitest and the existing Playwright project set `VITE_DATA_SOURCE=memory`, keeping the current 28 vitest and 10 e2e tests green without an API process.

## 2. API mutations + state (FastAPI)

Split `apps/api/src/secureflow_api/main.py` as it grows:

- `state.py` — mutable in-memory store seeded from the JSON fixtures in `apps/api/data` at startup, with a `reset()` used by pytest fixtures. State is per-process and resets on restart — acceptable, the whole backend is a labeled mock.
- New endpoints, mirroring the mock provider mutations, same camelCase JSON contract:
  - `POST /api/runs/{runId}/stages/{stageId}/retry`
  - `POST /api/runs/{runId}/approval` — body: decision, optional comment
  - `PATCH /api/findings/{findingId}/status` — body: status, optional reason
  - `POST /api/applications/{appId}/sync`
  - `POST /api/applications/{appId}/promote` — body: toEnvironment
  - `POST /api/applications/{appId}/rollback` — body: revision
  - `POST /api/audit` — record an audit event
- Each mutation records an audit event server-side, matching what the mock providers do today (retry, approval, finding status change, promote, rollback).
- Unknown ids return 404 with a `detail` message.

## 3. Realtime

- `simulator.py` (API) — asyncio background task started on app startup: port of the client tick loop. Advances `run-0512` one stage per 7s, idles a few ticks after completion, then resets and loops. Publishes events to an in-process broadcast queue (per-subscriber asyncio queues).
- `/api/events` SSE upgraded to emit typed events from the broadcast queue: `run-updated` (run id + summary), `notification` (title, body, kind), plus the existing `heartbeat` and `hello`.
- Web: `lib/realtime/sse-client.ts` — EventSource wrapper. `run-updated` → invalidate the relevant react-query caches; `notification` → notifications store + toast (same UX as the client simulator today).
- App wiring: memory mode starts the existing client simulator; HTTP mode starts the SSE client instead.

## 4. Out of scope

- AI service (`lib/ai/ai-service.ts`) stays a client-side mock.
- Auth untouched.
- No database; no persistence across API restarts.

## 5. Testing & verification

- **pytest:** mutation endpoint tests (happy path + 404s), simulator tick unit test (state advances/resets), state-reset fixture. Roughly 9 → ~20 tests.
- **vitest:** HTTP provider tests with stubbed `fetch` (URL, method, body, error mapping) + factory mode-selection test. Existing 28 stay green.
- **Playwright:** existing 10 e2e stay on memory mode. New `http-smoke` project: Playwright `webServer` boots both the FastAPI app (via uv) and the web app with `VITE_DATA_SOURCE=http`; ~3 assertions — overview renders data from the API, runs list loads, one mutation round-trips (e.g. finding status change persists across refetch).
- **CI:** `http-smoke` job added to `ci.yml` (uv + node already set up there).
- **Final gates:** lint, typecheck, vitest, pytest, both Playwright projects, build, manual browser check with both servers running.
