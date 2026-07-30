import { NavLink } from "react-router";
import {
  LayoutDashboard,
  Boxes,
  GitBranch,
  ShieldHalf,
  Landmark,
  Rocket,
  ClipboardCheck,
  Wand2,
  Plug,
  ScrollText,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useSession } from "@/stores/session";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/applications", label: "Applications", icon: Boxes },
  { to: "/pipelines", label: "Pipelines", icon: GitBranch },
  { to: "/security", label: "Security", icon: ShieldHalf },
  { to: "/infrastructure", label: "Infrastructure", icon: Landmark },
  { to: "/deployments", label: "Deployments", icon: Rocket },
  { to: "/compliance", label: "Compliance", icon: ClipboardCheck },
  { to: "/generator", label: "AI Generator", icon: Wand2 },
  { to: "/integrations", label: "Integrations", icon: Plug },
  { to: "/audit", label: "Audit Log", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const collapsed = useSession((s) => s.sidebarCollapsed);
  const toggleSidebar = useSession((s) => s.toggleSidebar);

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200",
        collapsed ? "w-14" : "w-14 lg:w-56",
      )}
      aria-label="Primary navigation"
    >
      <div className={cn("flex h-14 items-center gap-2.5 border-b border-line px-3", collapsed && "justify-center px-0")}>
        <span
          aria-hidden
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md font-mono text-sm font-bold text-accent-fg"
          style={{ background: "linear-gradient(135deg, var(--accent), var(--info))" }}
        >
          SF
        </span>
        {!collapsed && (
          <div className="hidden min-w-0 leading-tight lg:block">
            <p className="truncate text-sm font-semibold tracking-tight">SecureFlow</p>
            <p className="truncate text-[10px] uppercase tracking-widest text-fg-faint">
              Control Center
            </p>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-2 thin-scroll">
        <ul className="space-y-0.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                title={collapsed ? label : undefined}
                className={({ isActive }) =>
                  cn(
                    "flex items-center justify-center gap-2.5 rounded-md px-0 py-2 text-sm transition-colors lg:justify-start lg:px-2.5",
                    collapsed && "lg:justify-center lg:px-0",
                    isActive
                      ? "bg-accent/12 font-medium text-accent"
                      : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                  )
                }
              >
                <Icon size={16} aria-hidden className="shrink-0" />
                {!collapsed && <span className="hidden truncate lg:block">{label}</span>}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <button
        onClick={toggleSidebar}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="flex items-center justify-center gap-2 border-t border-line py-2.5 text-fg-faint transition-colors hover:text-fg cursor-pointer"
      >
        {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        {!collapsed && <span className="hidden text-xs lg:block">Collapse</span>}
      </button>
    </aside>
  );
}
