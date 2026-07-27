import { create } from "zustand";

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  kind: "info" | "success" | "warning" | "error";
  timestamp: string;
  read: boolean;
}

interface NotificationState {
  items: AppNotification[];
  push: (n: Omit<AppNotification, "id" | "timestamp" | "read">) => void;
  markAllRead: () => void;
}

let counter = 0;

export const useNotifications = create<NotificationState>((set) => ({
  items: [
    {
      id: "seed-1",
      title: "Production approval pending",
      body: "payments-api run #1482 is waiting for a Release Approver decision.",
      kind: "warning",
      timestamp: new Date(Date.now() - 22 * 60_000).toISOString(),
      read: false,
    },
    {
      id: "seed-2",
      title: "Security gate failed",
      body: "customer-portal run #2210 blocked by a critical container CVE.",
      kind: "error",
      timestamp: new Date(Date.now() - 71 * 60_000).toISOString(),
      read: false,
    },
  ],
  push: (n) =>
    set((s) => ({
      items: [
        { ...n, id: `n-${++counter}`, timestamp: new Date().toISOString(), read: false },
        ...s.items,
      ].slice(0, 50),
    })),
  markAllRead: () => set((s) => ({ items: s.items.map((i) => ({ ...i, read: true })) })),
}));
