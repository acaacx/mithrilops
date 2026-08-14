import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { useNotifications } from "@/stores/notifications";
import { registerTokenGetter, resetAuthHooks } from "@/lib/auth/token";
import { handleNotification, handleRunUpdated, startEventStream } from "./sse-client";

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

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  close() {
    this.closed = true;
  }
}

describe("startEventStream auth wiring", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    resetAuthHooks();
  });

  it("connects without a token in demo mode", async () => {
    const stop = startEventStream(new QueryClient());
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events");
    stop();
  });

  it("appends access_token in auth mode", async () => {
    registerTokenGetter(async () => "tok-sse");
    const stop = startEventStream(new QueryClient());
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(FakeEventSource.instances[0]!.url).toBe("/api/events?access_token=tok-sse");
    stop();
  });

  it("reconnects with a fresh token after an error", async () => {
    let n = 0;
    registerTokenGetter(async () => `tok-${++n}`);
    const stop = startEventStream(new QueryClient());
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0]!.onerror?.();
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    expect(FakeEventSource.instances[1]!.url).toBe("/api/events?access_token=tok-2");
    stop();
  });

  it("does not reconnect after stop() is called", async () => {
    registerTokenGetter(async () => "tok");
    const stop = startEventStream(new QueryClient());
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    stop();
    FakeEventSource.instances[0]!.onerror?.();
    await vi.advanceTimersByTimeAsync(5000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("opens no stream when the token getter resolves null (redirect in flight)", async () => {
    registerTokenGetter(async () => null);
    const stop = startEventStream(new QueryClient());
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeEventSource.instances).toHaveLength(0);
    stop();
  });
});
