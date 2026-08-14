import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authConfigured,
  getAccessToken,
  handleUnauthorized,
  registerTokenGetter,
  registerUnauthorizedHandler,
  resetAuthHooks,
} from "./token";

afterEach(() => resetAuthHooks());

describe("token registry", () => {
  it("returns null when no getter is registered (demo mode)", async () => {
    await expect(getAccessToken()).resolves.toBeNull();
  });

  it("delegates to the registered getter (auth mode)", async () => {
    registerTokenGetter(async () => "tok-123");
    await expect(getAccessToken()).resolves.toBe("tok-123");
  });

  it("handleUnauthorized is a no-op without a handler, calls it when registered", () => {
    expect(() => handleUnauthorized()).not.toThrow();
    const handler = vi.fn();
    registerUnauthorizedHandler(handler);
    handleUnauthorized();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("authConfigured is false in demo mode, true once a getter is registered", () => {
    expect(authConfigured()).toBe(false);
    registerTokenGetter(async () => "tok-123");
    expect(authConfigured()).toBe(true);
  });

  it("authConfigured stays true even while a redirect is in flight (getter resolves null)", async () => {
    registerTokenGetter(async () => null);
    expect(authConfigured()).toBe(true);
    await expect(getAccessToken()).resolves.toBeNull();
    expect(authConfigured()).toBe(true);
  });
});
