import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { PipelineRun, PipelineRunStatus } from "@secureflow/types";
import { PIPELINE_RUN_STATUSES, ENVIRONMENTS, type EnvironmentName } from "@secureflow/types";
import { applications } from "@secureflow/mock-data";
import { PageHeader } from "@/components/domain/page-header";
import { GateBadge, StatusBadge } from "@/components/domain/badges";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useRuns } from "@/lib/queries";
import { formatDateTime, formatDuration, shortSha, titleCase } from "@/lib/utils";
import { useSession } from "@/stores/session";

const columnHelper = createColumnHelper<PipelineRun>();

export default function PipelinesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<PipelineRunStatus | "all">("all");
  const [appId, setAppId] = useState("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "startedAt", desc: true }]);
  const sessionEnv = useSession((s) => s.environment);

  const { data: runs, isLoading } = useRuns({
    search: search || undefined,
    status: status === "all" ? undefined : status,
    applicationId: appId === "all" ? undefined : appId,
    environment: sessionEnv === "all" ? undefined : (sessionEnv as EnvironmentName),
  });

  const columns = useMemo(
    () => [
      columnHelper.accessor("id", {
        header: "Run",
        cell: (info) => (
          <Link to={`/pipelines/${info.getValue()}`} className="font-mono text-xs text-accent hover:underline">
            {info.getValue()}
          </Link>
        ),
      }),
      columnHelper.accessor("applicationId", {
        header: "Application",
        cell: (info) => (
          <span className="text-fg">{applications.find((a) => a.id === info.getValue())?.name ?? info.getValue()}</span>
        ),
      }),
      columnHelper.accessor((r) => r.commit.branch, {
        id: "branch",
        header: "Branch",
        cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
      }),
      columnHelper.accessor((r) => r.commit.sha, {
        id: "sha",
        header: "Commit",
        cell: (info) => <span className="font-mono text-xs text-fg-faint">{shortSha(info.getValue())}</span>,
        enableSorting: false,
      }),
      columnHelper.accessor("trigger", {
        header: "Trigger",
        cell: (info) => <span className="text-xs text-fg-muted">{titleCase(info.getValue())}</span>,
      }),
      columnHelper.accessor((r) => r.commit.author, {
        id: "author",
        header: "Author",
        cell: (info) => <span className="text-xs">{info.getValue()}</span>,
      }),
      columnHelper.accessor("environment", {
        header: "Env",
        cell: (info) => <span className="text-xs">{titleCase(info.getValue())}</span>,
      }),
      columnHelper.accessor("startedAt", {
        header: "Started",
        cell: (info) => <span className="whitespace-nowrap text-xs">{formatDateTime(info.getValue())}</span>,
      }),
      columnHelper.accessor("durationSeconds", {
        header: "Duration",
        cell: (info) => <span className="font-mono text-xs">{formatDuration(info.getValue())}</span>,
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: (info) => <StatusBadge status={info.getValue()} />,
      }),
      columnHelper.accessor("securityGate", {
        header: "Security",
        cell: (info) => <GateBadge gate={info.getValue()} />,
      }),
      columnHelper.accessor("approvalStatus", {
        header: "Approval",
        cell: (info) => (
          <Badge
            color={
              info.getValue() === "approved"
                ? "var(--ok)"
                : info.getValue() === "rejected"
                  ? "var(--danger)"
                  : info.getValue() === "changes-requested"
                    ? "var(--warn)"
                    : "var(--pending)"
            }
          >
            {titleCase(info.getValue())}
          </Badge>
        ),
      }),
      columnHelper.accessor("artifactVersion", {
        header: "Version",
        cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: runs ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="mx-auto max-w-[1500px] p-6 rise-in">
      <PageHeader
        title="Pipeline executions"
        subtitle="Every run across the portfolio — search, filter, and drill in"
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <label htmlFor="run-search" className="sr-only">Search runs</label>
          <Input
            id="run-search"
            placeholder="Search run id, commit, branch, author…"
            className="max-w-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label htmlFor="run-status" className="sr-only">Filter status</label>
          <Select id="run-status" className="w-44" value={status} onChange={(e) => setStatus(e.target.value as PipelineRunStatus | "all")}>
            <option value="all">All statuses</option>
            {PIPELINE_RUN_STATUSES.map((s) => (
              <option key={s} value={s}>{titleCase(s)}</option>
            ))}
          </Select>
          <label htmlFor="run-app" className="sr-only">Filter application</label>
          <Select id="run-app" className="w-44" value={appId} onChange={(e) => setAppId(e.target.value)}>
            <option value="all">All applications</option>
            {applications.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
          <span className="ml-auto text-xs text-fg-faint">
            {runs?.length ?? 0} run{(runs?.length ?? 0) === 1 ? "" : "s"}
            {ENVIRONMENTS.length && sessionEnv !== "all" ? ` · scoped to ${titleCase(sessionEnv)}` : ""}
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : (runs ?? []).length === 0 ? (
          <div className="p-4">
            <EmptyState title="No pipeline runs match your filters" hint="Adjust the search, status, or application filters — or change the environment scope in the top bar." />
          </div>
        ) : (
          <Table>
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <Th key={header.id}>
                      {header.column.getCanSort() ? (
                        <button
                          className="inline-flex items-center gap-1 uppercase hover:text-fg cursor-pointer"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getIsSorted() === "asc" ? (
                            <ArrowUp size={11} />
                          ) : header.column.getIsSorted() === "desc" ? (
                            <ArrowDown size={11} />
                          ) : (
                            <ArrowUpDown size={11} className="opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </Th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <Tr
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/pipelines/${row.original.id}`)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <Td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</Td>
                  ))}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
