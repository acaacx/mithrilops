import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNotifications } from "@/stores/notifications";
import { getAccessToken } from "@/lib/auth/token";

export interface NotificationEvent {
  title: string;
  body: string;
  kind: "info" | "success" | "warning" | "error";
}

const RECONNECT_DELAY_MS = 3000;

/**
 * HTTP-mode realtime: subscribes to the API's SSE stream and pushes updates
 * through the same TanStack Query invalidation + notification paths the
 * memory-mode simulator uses.
 */
export function startEventStream(queryClient: QueryClient): () => void {
  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const attach = (s: EventSource) => {
    s.addEventListener("run-updated", (event) => {
      handleRunUpdated(queryClient, JSON.parse((event as MessageEvent).data));
    });
    s.addEventListener("notification", (event) => {
      handleNotification(queryClient, JSON.parse((event as MessageEvent).data));
    });
  };

  const connect = async () => {
    const token = await getAccessToken();
    if (closed) return;
    if (token === null) {
      // Demo mode: EventSource's native reconnect is fine — the URL never goes stale.
      source = new EventSource("/api/events");
      attach(source);
      return;
    }
    // Auth mode: native reconnect would replay the original (stale) token, so
    // replace the stream with a freshly-tokened one on every error.
    source = new EventSource(`/api/events?access_token=${encodeURIComponent(token)}`);
    attach(source);
    source.onerror = () => {
      source?.close();
      if (!closed) retryTimer = setTimeout(() => void connect(), RECONNECT_DELAY_MS);
    };
  };

  void connect();
  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    source?.close();
  };
}

export function handleRunUpdated(queryClient: QueryClient, payload: { runId: string }): void {
  void queryClient.invalidateQueries({ queryKey: ["runs"] });
  void queryClient.invalidateQueries({ queryKey: ["run", payload.runId] });
  void queryClient.invalidateQueries({ queryKey: ["deployments"] });
  void queryClient.invalidateQueries({ queryKey: ["applications"] });
}

export function handleNotification(queryClient: QueryClient, n: NotificationEvent): void {
  useNotifications.getState().push(n);
  const fn =
    n.kind === "success"
      ? toast.success
      : n.kind === "warning"
        ? toast.warning
        : n.kind === "error"
          ? toast.error
          : toast.info;
  fn(n.title, { description: n.body });
  void queryClient.invalidateQueries({ queryKey: ["audit"] });
}
