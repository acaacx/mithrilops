import { create } from "zustand";
import type { EnvironmentName, Permission, Role } from "@secureflow/types";
import { hasPermission } from "@/lib/rbac";

interface SessionState {
  role: Role;
  userName: string;
  environment: EnvironmentName | "all";
  theme: "dark" | "light";
  sidebarCollapsed: boolean;
  setRole: (role: Role) => void;
  setEnvironment: (environment: EnvironmentName | "all") => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
}

export const useSession = create<SessionState>((set) => ({
  role: "devsecops-engineer",
  userName: "Rowan Ashford",
  environment: "all",
  theme: "dark",
  sidebarCollapsed: false,
  setRole: (role) => set({ role }),
  setEnvironment: (environment) => set({ environment }),
  toggleTheme: () =>
    set((s) => {
      const theme = s.theme === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", theme === "dark");
      return { theme };
    }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));

export function useCan(permission: Permission): boolean {
  return useSession((s) => hasPermission(s.role, permission));
}
