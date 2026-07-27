# Troubleshooting

## `pnpm install` warns about ignored build scripts
pnpm 10+ requires approving postinstall scripts. This repo allows `esbuild` in `pnpm-workspace.yaml` (`allowBuilds`). If prompted again, run `pnpm approve-builds`.

## Blank page / module errors on `pnpm dev`
Delete caches and reinstall: `rm -rf node_modules apps/*/node_modules packages/*/node_modules && pnpm install`. Node ≥ 20 required.

## Port already in use
Web uses 5173, API 4000. `lsof -ti:5173 | xargs kill` or set `API_PORT` in `.env`.

## Playwright fails with "browser not found"
`npx playwright install chromium` once, then `pnpm e2e`. The config reuses a running dev server, so a stale server with old code can cause mismatches — restart `pnpm dev` first.

## The "running" pipeline never moves
The simulator drives `run-0512` only while the app tab is open (browser timers). After completion it idles ~35s, then loops from the container-build stage. Hard-refresh resets all mock state.

## Approve/Reject buttons disabled
Expected: your simulated role lacks the permission. Hover the button for the tooltip; switch roles in the profile menu. Denied attempts appear in `/audit`.

## Terraform validate fails on provider version
Run `terraform init -upgrade -backend=false`. Modules pin azurerm `~> 4.14`; a major-5 provider on your machine will not satisfy the constraint.

## `terraform init` cannot reach the backend
The azurerm backend uses `use_azuread_auth = true`: run `az login` with an identity holding *Storage Blob Data Contributor* on the state container, or init with `-backend=false` for local validation only.

## Dark/light theme looks wrong after switching
The toggle flips the `dark` class on `<html>`. If a hard refresh shows the wrong theme, clear the tab (theme is session state by design, defaulting to dark).
