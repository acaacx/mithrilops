import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRuntimeConfig } from "./config";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchRuntimeConfig", () => {
  it("fetches /api/config and returns the parsed body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ authEnabled: true, tenantId: "t", clientId: "c" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(fetchRuntimeConfig()).resolves.toEqual({
      authEnabled: true,
      tenantId: "t",
      clientId: "c",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/config");
  });

  it("throws on a non-OK response (fail closed)", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(fetchRuntimeConfig()).rejects.toThrow(/503/);
  });
});
