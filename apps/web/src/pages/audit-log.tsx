import { useState } from "react";
import { PageHeader } from "@/components/domain/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useAuditEvents } from "@/lib/queries";
import { formatDateTime, titleCase } from "@/lib/utils";

export default function AuditLogPage() {
  const { data: events, isLoading } = useAuditEvents();
  const [search, setSearch] = useState("");

  const filtered = (events ?? []).filter(
    (e) =>
      !search ||
      e.action.toLowerCase().includes(search.toLowerCase()) ||
      e.actor.toLowerCase().includes(search.toLowerCase()) ||
      e.target.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-[1500px] p-6 rise-in">
      <PageHeader
        title="Audit log"
        subtitle="Immutable trail of privileged operations — approvals, rejections, retries, exceptions, RBAC denials"
      />
      <Card>
        <div className="border-b border-line p-3">
          <label htmlFor="audit-search" className="sr-only">Search audit events</label>
          <Input
            id="audit-search"
            placeholder="Search actor, action, target…"
            className="max-w-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4"><EmptyState title="No audit events match" /></div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Timestamp</Th>
                <Th>Actor</Th>
                <Th>Role</Th>
                <Th>Action</Th>
                <Th>Target</Th>
                <Th>Outcome</Th>
                <Th>Detail</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <Tr key={e.id}>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(e.timestamp)}</Td>
                  <Td className="text-xs">{e.actor}</Td>
                  <Td className="text-xs">{titleCase(e.actorRole)}</Td>
                  <Td><span className="font-mono text-xs">{e.action}</span></Td>
                  <Td className="max-w-52 truncate font-mono text-xs">{e.target}</Td>
                  <Td>
                    <Badge color={e.outcome === "success" ? "var(--ok)" : e.outcome === "denied" ? "var(--warn)" : "var(--danger)"}>
                      {e.outcome}
                    </Badge>
                  </Td>
                  <Td className="max-w-md text-xs">{e.detail}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
