import { PageHeader } from "@/components/domain/page-header";
import { ROLE_PERMISSIONS } from "@/lib/rbac";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/misc";
import { PERMISSIONS, ROLES } from "@secureflow/types";
import { useSession } from "@/stores/session";
import { titleCase } from "@/lib/utils";
import { Check, Minus } from "lucide-react";
import { Table, Td, Th, Tr } from "@/components/ui/table";

export default function SettingsPage() {
  const { roles, theme, toggleTheme } = useSession();

  return (
    <div className="mx-auto max-w-[1200px] p-6 rise-in">
      <PageHeader title="Settings" subtitle="Session preferences and the role-permission model" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="self-start">
          <CardHeader title="Appearance" />
          <CardBody className="flex items-center justify-between">
            <div>
              <p className="text-sm text-fg">Dark theme</p>
              <p className="text-xs text-fg-faint">Security-operations dark mode is the default.</p>
            </div>
            <Switch checked={theme === "dark"} onCheckedChange={toggleTheme} aria-label="Toggle dark theme" />
          </CardBody>
        </Card>

        <Card className="self-start">
          <CardHeader title="Session" />
          <CardBody className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-fg-faint">Active role</span>
              <Badge color="var(--accent)">{roles.map(titleCase).join(", ")}</Badge>
            </div>
            <p className="text-xs text-fg-faint">
              Switch roles from the profile menu in the top bar to demo RBAC behavior. When Entra ID
              sign-in is enabled, roles come from the token's app-role claims and the switcher is hidden.
            </p>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Role-permission matrix"
          subtitle="The same matrix drives every gated button in the UI and every authorization check in the API layer"
        />
        <Table>
          <thead>
            <tr>
              <Th>Permission</Th>
              {ROLES.map((r) => (
                <Th key={r} className="text-center">{titleCase(r).split(" ").map((w) => w.slice(0, 5)).join(" ")}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((p) => (
              <Tr key={p}>
                <Td><span className="font-mono text-xs">{p}</span></Td>
                {ROLES.map((r) => (
                  <Td key={r} className="text-center">
                    {ROLE_PERMISSIONS[r].includes(p) ? (
                      <Check size={14} className="mx-auto" style={{ color: "var(--ok)" }} aria-label={`${titleCase(r)} has ${p}`} />
                    ) : (
                      <Minus size={14} className="mx-auto text-fg-faint opacity-40" aria-label={`${titleCase(r)} lacks ${p}`} />
                    )}
                  </Td>
                ))}
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
