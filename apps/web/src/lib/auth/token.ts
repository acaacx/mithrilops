/**
 * Token registry: the seam between MSAL and the data layer. http.ts and
 * sse-client.ts import from HERE, never from msal.ts, so the demo bundle
 * carries no MSAL code. msal.ts registers real implementations at init.
 */
type TokenGetter = () => Promise<string | null>;

let getter: TokenGetter | null = null;
let unauthorized: (() => void) | null = null;

export function registerTokenGetter(fn: TokenGetter): void {
  getter = fn;
}

export function registerUnauthorizedHandler(fn: () => void): void {
  unauthorized = fn;
}

/** Null in demo mode (nothing registered) — callers skip the Authorization header. */
export async function getAccessToken(): Promise<string | null> {
  return getter ? getter() : null;
}

/** Called on a 401 in auth mode: triggers an interactive re-auth redirect. */
export function handleUnauthorized(): void {
  unauthorized?.();
}

export function resetAuthHooks(): void {
  getter = null;
  unauthorized = null;
}
