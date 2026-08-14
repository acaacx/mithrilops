import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Bell,
  CircleAlert,
  HelpCircle,
  LogOut,
  Moon,
  Search,
  Sun,
  UserRound,
} from "lucide-react";
import { ENVIRONMENTS, ROLES, type EnvironmentName, type Role } from "@secureflow/types";
import { useSession } from "@/stores/session";
import { useNotifications } from "@/stores/notifications";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/dropdown";
import { Badge } from "@/components/ui/badge";
import { formatRelative, titleCase } from "@/lib/utils";
import { CommandPalette } from "./command-palette";

const NOTIF_COLORS = {
  info: "var(--info)",
  success: "var(--ok)",
  warning: "var(--warn)",
  error: "var(--danger)",
} as const;

export function Topbar() {
  const navigate = useNavigate();
  const { roles, userName, authMode, environment, theme, setRole, setEnvironment, toggleTheme } =
    useSession();
  const notifications = useNotifications((s) => s.items);
  const markAllRead = useNotifications((s) => s.markAllRead);
  const unread = notifications.filter((n) => !n.read).length;
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <button
        onClick={() => setSearchOpen(true)}
        className="flex h-8.5 w-full max-w-sm items-center gap-2 rounded-md border border-line bg-surface-2 px-3 text-sm text-fg-faint transition-colors hover:border-line-strong cursor-pointer"
        aria-label="Open global search"
      >
        <Search size={14} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">Search apps, runs, findings…</span>
        <kbd className="rounded border border-line bg-surface px-1.5 font-mono text-[10px]">⌘K</kbd>
      </button>
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />

      <div className="ml-auto flex items-center gap-2">
        <label htmlFor="env-select" className="sr-only">
          Environment scope
        </label>
        <Select
          id="env-select"
          className="w-36"
          value={environment}
          onChange={(e) => setEnvironment(e.target.value as EnvironmentName | "all")}
        >
          <option value="all">All environments</option>
          {ENVIRONMENTS.map((env) => (
            <option key={env} value={env}>
              {titleCase(env)}
            </option>
          ))}
        </Select>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Active incidents"
          onClick={() => navigate("/?panel=incidents")}
          className="relative"
        >
          <CircleAlert size={16} />
          <span className="absolute -right-0.5 -top-0.5 grid h-4 w-4 place-items-center rounded-full bg-danger font-mono text-[9px] font-bold text-white">
            2
          </span>
        </Button>

        <Dropdown>
          <DropdownTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Notifications, ${unread} unread`} className="relative">
              <Bell size={16} />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid h-4 w-4 place-items-center rounded-full bg-accent font-mono text-[9px] font-bold text-accent-fg">
                  {unread}
                </span>
              )}
            </Button>
          </DropdownTrigger>
          <DropdownContent align="end" className="w-96">
            <div className="flex items-center justify-between px-2 py-1.5">
              <DropdownLabel className="p-0">Notifications</DropdownLabel>
              <button
                onClick={markAllRead}
                className="text-xs text-accent hover:underline cursor-pointer"
              >
                Mark all read
              </button>
            </div>
            <DropdownSeparator />
            <div className="max-h-80 overflow-y-auto thin-scroll">
              {notifications.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-fg-faint">No notifications.</p>
              ) : (
                notifications.slice(0, 12).map((n) => (
                  <div key={n.id} className="flex gap-2.5 px-3 py-2.5 hover:bg-surface-2">
                    <span
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      style={{ background: NOTIF_COLORS[n.kind], opacity: n.read ? 0.3 : 1 }}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg">{n.title}</p>
                      <p className="mt-0.5 text-xs text-fg-muted">{n.body}</p>
                      <p className="mt-0.5 text-[10px] text-fg-faint">{formatRelative(n.timestamp)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </DropdownContent>
        </Dropdown>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Help"
          onClick={() => window.alert("SecureFlow Control Center — see docs/ in the repository for guides.")}
        >
          <HelpCircle size={16} />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={toggleTheme}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </Button>

        <Dropdown>
          <DropdownTrigger asChild>
            <Button variant="ghost" className="gap-2 pl-1.5" aria-label="User profile and role">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-3 text-[10px] font-bold text-fg">
                {userName
                  .split(" ")
                  .map((p) => p[0])
                  .join("")}
              </span>
              <span className="hidden text-left leading-tight md:block">
                <span className="block text-xs font-medium text-fg">{userName}</span>
                <span className="block text-[10px] text-fg-faint">{roles.map(titleCase).join(", ")}</span>
              </span>
            </Button>
          </DropdownTrigger>
          <DropdownContent align="end" className="w-64">
            {authMode ? (
              <>
                <DropdownLabel>
                  <span className="flex items-center gap-1.5">
                    <UserRound size={12} aria-hidden /> Signed in with Microsoft Entra ID
                  </span>
                </DropdownLabel>
                <DropdownItem
                  onSelect={() => {
                    void import("@/lib/auth/msal").then((m) => m.signOut());
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <LogOut size={12} aria-hidden /> Sign out
                  </span>
                </DropdownItem>
              </>
            ) : (
              <>
                <DropdownLabel>
                  <span className="flex items-center gap-1.5">
                    <UserRound size={12} aria-hidden /> Simulated role (RBAC demo)
                  </span>
                </DropdownLabel>
                {ROLES.map((r) => (
                  <DropdownItem key={r} onSelect={() => setRole(r as Role)}>
                    <span className="flex-1">{titleCase(r)}</span>
                    {roles.includes(r as Role) && <Badge color="var(--accent)">Active</Badge>}
                  </DropdownItem>
                ))}
              </>
            )}
          </DropdownContent>
        </Dropdown>
      </div>
    </header>
  );
}
