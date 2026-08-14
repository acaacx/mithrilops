import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
});
