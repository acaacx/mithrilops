import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pipelineRuns } from "@secureflow/mock-data";
import * as http from "./http";

const okJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("http providers", () => {
  it("listRuns fetches /api/runs and applies filters client-side", async () => {
    fetchMock.mockResolvedValue(okJson(pipelineRuns));
    const failed = await http.pipelineProvider.listRuns({ status: "failed" });
    expect(fetchMock).toHaveBeenCalledWith("/api/runs", expect.anything());
    expect(failed.every((r) => r.status === "failed")).toBe(true);
  });

  it("retryStage POSTs to the retry route and resolves on 204", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await http.pipelineProvider.retryStage("run-0001", "stage-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-0001/stages/stage-1/retry",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("updateFindingStatus PATCHes a JSON body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await http.securityProvider.updateFindingStatus("find-1", "accepted-risk", "because");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/findings/find-1/status");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ status: "accepted-risk", reason: "because" });
  });

  it("surfaces the API detail message on error responses", async () => {
    fetchMock.mockResolvedValue(okJson({ detail: "run_not_found" }, 404));
    await expect(http.pipelineProvider.getRun("run-none")).rejects.toThrow(/run_not_found/);
  });

  it("promote sends camelCase body to the promote route", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await http.deploymentProvider.promote("app-1", "production");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/applications/app-1/promote");
    expect(JSON.parse(init.body as string)).toEqual({ toEnvironment: "production" });
  });
});

describe("provider factory", () => {
  it("selects mock providers when VITE_DATA_SOURCE=memory", async () => {
    const factory = await import("./index");
    const mock = await import("./mock");
    expect(factory.dataSource).toBe("memory");
    expect(factory.pipelineProvider).toBe(mock.pipelineProvider);
  });
});
