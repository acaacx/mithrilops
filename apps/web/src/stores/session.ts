import { create } from "zustand";
import type { EnvironmentName, Permission, Role } from "@secureflow/types";
import { rolesHavePermission } from "@/lib/rbac";

interface SessionState {
  roles: Role[];
  userName: string;
  /** True when identity came from an Entra ID token; hides the demo role switcher. */
  authMode: boolean;
  environment: EnvironmentName | "all";
  theme: "dark" | "light";
  sidebarCollapsed: boolean;
  setRole: (role: Role) => void;
  setAuthSession: (userName: string, roles: Role[]) => void;
  setEnvironment: (environment: EnvironmentName | "all") => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
}

export const useSession = create<SessionState>((set) => ({
  roles: ["devsecops-engineer"],
  userName: "Rowan Ashford",
  authMode: false,
  environment: "all",
  theme: "dark",
  sidebarCollapsed: false,
  setRole: (role) => set({ roles: [role] }),
  setAuthSession: (userName, roles) => set({ userName, roles, authMode: true }),
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
  return useSession((s) => rolesHavePermission(s.roles, permission));
}
