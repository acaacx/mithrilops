import { PageHeader } from "@/components/domain/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { useIntegrations } from "@/lib/queries";
import { formatRelative, titleCase } from "@/lib/utils";
import type { Integration } from "@secureflow/types";

const STATUS_COLORS: Record<Integration["status"], string> = {
  connected: "var(--ok)",
  degraded: "var(--warn)",
  disconnected: "var(--pending)",
  simulated: "var(--info)",
};

export default function IntegrationsPage() {
  const { data: integrations, isLoading } = useIntegrations();
  const categories = [...new Set((integrations ?? []).map((i) => i.category))];

  return (
    <div className="mx-auto max-w-[1500px] p-6 rise-in">
      <PageHeader
        title="Integrations"
        subtitle="Every provider sits behind an adapter interface — mock today, real endpoints tomorrow, no UI changes"
      />
      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        categories.map((cat) => (
          <section key={cat} className="mb-6">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-faint">
              {titleCase(cat)}
            </h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {(integrations ?? [])
                .filter((i) => i.category === cat)
                .map((i) => (
                  <Card key={i.id} className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-fg">{i.name}</p>
                      <Badge color={STATUS_COLORS[i.status]} dot>{titleCase(i.status)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-fg-muted">{i.description}</p>
                    {i.lastSyncAt && (
                      <p className="mt-2 text-[11px] text-fg-faint">Last sync {formatRelative(i.lastSyncAt)}</p>
                    )}
                  </Card>
                ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
