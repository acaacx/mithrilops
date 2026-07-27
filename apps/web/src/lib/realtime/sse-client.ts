import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNotifications } from "@/stores/notifications";

export interface NotificationEvent {
  title: string;
  body: string;
  kind: "info" | "success" | "warning" | "error";
}

/**
 * HTTP-mode realtime: subscribes to the API's SSE stream and pushes updates
 * through the same TanStack Query invalidation + notification paths the
 * memory-mode simulator uses.
 */
export function startEventStream(queryClient: QueryClient): () => void {
  const source = new EventSource("/api/events");
  source.addEventListener("run-updated", (event) => {
    handleRunUpdated(queryClient, JSON.parse((event as MessageEvent).data));
  });
  source.addEventListener("notification", (event) => {
    handleNotification(queryClient, JSON.parse((event as MessageEvent).data));
  });
  return () => source.close();
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
