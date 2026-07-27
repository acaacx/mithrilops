import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { useNotifications } from "@/stores/notifications";
import { handleNotification, handleRunUpdated } from "./sse-client";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

describe("sse-client handlers", () => {
  it("run-updated invalidates run-related query keys", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    handleRunUpdated(qc, { runId: "run-0512" });
    const keys = spy.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
    expect(keys).toContain(JSON.stringify(["runs"]));
    expect(keys).toContain(JSON.stringify(["run", "run-0512"]));
    expect(keys).toContain(JSON.stringify(["deployments"]));
  });

  it("notification pushes to the notifications store", () => {
    const qc = new QueryClient();
    const before = useNotifications.getState().items.length;
    handleNotification(qc, { title: "Pipeline started", body: "demo", kind: "info" });
    expect(useNotifications.getState().items.length).toBe(before + 1);
  });
});
