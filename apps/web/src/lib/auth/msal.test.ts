import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const instance = {
    initialize: vi.fn(async () => {}),
    handleRedirectPromise: vi.fn(async () => null as unknown),
    getAllAccounts: vi.fn(() => [] as unknown[]),
    setActiveAccount: vi.fn(),
    loginRedirect: vi.fn(async () => {}),
    acquireTokenSilent: vi.fn(async () => ({ accessToken: "at-1" })),
    acquireTokenRedirect: vi.fn(async () => {}),
    logoutRedirect: vi.fn(async () => {}),
  };
  class InteractionRequiredAuthError extends Error {}
  return { instance, InteractionRequiredAuthError };
});

vi.mock("@azure/msal-browser", () => ({
  PublicClientApplication: vi.fn(() => mocks.instance),
  InteractionRequiredAuthError: mocks.InteractionRequiredAuthError,
}));

const CONFIG = { authEnabled: true, tenantId: "tenant-1", clientId: "client-1" };
const ACCOUNT = {
  username: "ada@example.com",
  idTokenClaims: { name: "Ada Lovelace", roles: ["developer", "not-a-role"] },
};

beforeEach(() => {
  vi.clearAllMocks();
  // vi.resetModules() forces a fresh module graph on the next dynamic import,
  // so ./msal and ./token below are re-evaluated together (and get fresh
  // module-scoped state) rather than reusing a stale instance from a prior
  // test. A static top-level `import { getAccessToken } from "./token"`
  // would NOT observe this reset — it stays bound to whichever instance was
  // live when this file was first collected — so getAccessToken is imported
  // dynamically per-test below instead, from the same fresh graph as ./msal.
  vi.resetModules();
});

describe("initAuth", () => {
  it("redirects to sign-in when no account exists and returns null", async () => {
    const { initAuth } = await import("./msal");
    mocks.instance.getAllAccounts.mockReturnValue([]);
    const account = await initAuth(CONFIG);
    expect(account).toBeNull();
    expect(mocks.instance.loginRedirect).toHaveBeenCalledWith({
      scopes: ["api://client-1/access"],
    });
  });

  it("returns name and known roles, dropping unknown role strings", async () => {
    const { initAuth } = await import("./msal");
    mocks.instance.getAllAccounts.mockReturnValue([ACCOUNT]);
    const account = await initAuth(CONFIG);
    expect(account).toEqual({ name: "Ada Lovelace", roles: ["developer"] });
    expect(mocks.instance.setActiveAccount).toHaveBeenCalledWith(ACCOUNT);
  });

  it("registers a token getter that acquires silently", async () => {
    const { initAuth } = await import("./msal");
    const { getAccessToken } = await import("./token");
    mocks.instance.getAllAccounts.mockReturnValue([ACCOUNT]);
    await initAuth(CONFIG);
    await expect(getAccessToken()).resolves.toBe("at-1");
    expect(mocks.instance.acquireTokenSilent).toHaveBeenCalledWith({
      scopes: ["api://client-1/access"],
    });
  });

  it("falls back to acquireTokenRedirect when silent acquisition needs interaction", async () => {
    const { initAuth } = await import("./msal");
    const { getAccessToken } = await import("./token");
    mocks.instance.getAllAccounts.mockReturnValue([ACCOUNT]);
    mocks.instance.acquireTokenSilent.mockRejectedValueOnce(
      new mocks.InteractionRequiredAuthError("interaction_required"),
    );
    await initAuth(CONFIG);
    await expect(getAccessToken()).resolves.toBeNull();
    expect(mocks.instance.acquireTokenRedirect).toHaveBeenCalled();
  });
});
