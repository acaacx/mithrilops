import { defineConfig } from "@playwright/test";

/**
 * HTTP-mode smoke suite: boots the FastAPI backend (uv) and the web dev
 * server with VITE_DATA_SOURCE=http, then verifies real round-trips.
 * Run: pnpm e2e:http (repo root) — stop any memory-mode dev server first,
 * the web entry refuses to reuse a server whose mode it can't verify.
 */
export default defineConfig({
  testDir: "./e2e-http",
  timeout: 45_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "uv run secureflow-api",
      cwd: "../..",
      url: "http://127.0.0.1:4000/health",
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        SIM_TICK_SECONDS: "2",
        // The API requires Postgres (docker compose up -d db locally; the
        // e2e-http service container in CI). Same default as engine.py.
        DATABASE_URL:
          process.env.DATABASE_URL ??
          "postgresql+asyncpg://postgres:postgres@localhost:5432/secureflow",
      },
    },
    {
      command: "pnpm dev",
      url: "http://localhost:5173",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_DATA_SOURCE: "http" },
    },
  ],
});
