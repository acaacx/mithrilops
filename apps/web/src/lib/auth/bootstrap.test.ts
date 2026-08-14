import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSession } from "@/stores/session";

const mocks = vi.hoisted(() => ({
  fetchRuntimeConfig: vi.fn(),
  initAuth: vi.fn(),
  dataSource: "http" as "http" | "memory",
}));

vi.mock("@/lib/auth/config", () => ({
  fetchRuntimeConfig: mocks.fetchRuntimeConfig,
}));

vi.mock("@/lib/providers", () => ({
  get dataSource() {
    return mocks.dataSource;
  },
}));

vi.mock("@/lib/auth/msal", () => ({
  initAuth: mocks.initAuth,
}));

const CONFIG = { authEnabled: true, tenantId: "tenant-1", clientId: "client-1" };
const ACCOUNT = { name: "Ada Lovelace", roles: ["developer"] };

describe("bootstrap", () => {
  let renderApp: ReturnType<typeof vi.fn>;
  let renderError: ReturnType<typeof vi.fn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dataSource = "http";
    renderApp = vi.fn();
    renderError = vi.fn();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("renders the app directly in memory mode, without fetching config", async () => {
    mocks.dataSource = "memory";
    const { bootstrap } = await import("./bootstrap");
    await bootstrap({ renderApp, renderError });
    expect(renderApp).toHaveBeenCalledOnce();
    expect(mocks.fetchRuntimeConfig).not.toHaveBeenCalled();
    expect(renderError).not.toHaveBeenCalled();
  });

  it("renders an error and logs when fetchRuntimeConfig throws", async () => {
    const error = new Error("network down");
    mocks.fetchRuntimeConfig.mockRejectedValueOnce(error);
    const { bootstrap } = await import("./bootstrap");
    await bootstrap({ renderApp, renderError });
    expect(consoleErrorSpy).toHaveBeenCalledWith(error);
    expect(renderError).toHaveBeenCalledWith("Could not load runtime configuration from the API.");
    expect(renderApp).not.toHaveBeenCalled();
    expect(mocks.initAuth).not.toHaveBeenCalled();
  });

  it("renders the app directly when auth is disabled", async () => {
    mocks.fetchRuntimeConfig.mockResolvedValueOnce({ ...CONFIG, authEnabled: false });
    const { bootstrap } = await import("./bootstrap");
    await bootstrap({ renderApp, renderError });
    expect(renderApp).toHaveBeenCalledOnce();
    expect(mocks.initAuth).not.toHaveBeenCalled();
  });

  it("returns without rendering when initAuth resolves null (redirect in flight)", async () => {
    mocks.fetchRuntimeConfig.mockResolvedValueOnce(CONFIG);
    mocks.initAuth.mockResolvedValueOnce(null);
    const { bootstrap } = await import("./bootstrap");
    await bootstrap({ renderApp, renderError });
    expect(renderApp).not.toHaveBeenCalled();
    expect(renderError).not.toHaveBeenCalled();
  });

  it("sets the auth session and renders the app when initAuth resolves an account", async () => {
    mocks.fetchRuntimeConfig.mockResolvedValueOnce(CONFIG);
    mocks.initAuth.mockResolvedValueOnce(ACCOUNT);
    const setAuthSessionSpy = vi.spyOn(useSession.getState(), "setAuthSession");
    const { bootstrap } = await import("./bootstrap");
    await bootstrap({ renderApp, renderError });
    expect(setAuthSessionSpy).toHaveBeenCalledWith(ACCOUNT.name, ACCOUNT.roles);
    expect(renderApp).toHaveBeenCalledOnce();
    setAuthSessionSpy.mockRestore();
  });

  it("renders an error and logs when initAuth throws", async () => {
    const error = new Error("interaction failed");
    mocks.fetchRuntimeConfig.mockResolvedValueOnce(CONFIG);
    mocks.initAuth.mockRejectedValueOnce(error);
    const { bootstrap } = await import("./bootstrap");
    await bootstrap({ renderApp, renderError });
    expect(consoleErrorSpy).toHaveBeenCalledWith(error);
    expect(renderError).toHaveBeenCalledWith("Sign-in failed. Check the Microsoft Entra ID configuration.");
    expect(renderApp).not.toHaveBeenCalled();
  });
});
