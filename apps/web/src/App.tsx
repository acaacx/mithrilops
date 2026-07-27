import { lazy, useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { TooltipProvider } from "@/components/ui/misc";
import { dataSource } from "@/lib/providers";
import { startPipelineSimulator } from "@/lib/realtime/simulator";
import { startEventStream } from "@/lib/realtime/sse-client";

const OverviewPage = lazy(() => import("@/pages/overview"));
const ApplicationsPage = lazy(() => import("@/pages/applications"));
const ApplicationWorkspacePage = lazy(() => import("@/pages/application-workspace"));
const PipelinesPage = lazy(() => import("@/pages/pipelines"));
const PipelineRunPage = lazy(() => import("@/pages/pipeline-run"));
const SecurityPage = lazy(() => import("@/pages/security"));
const InfrastructurePage = lazy(() => import("@/pages/infrastructure"));
const DeploymentsPage = lazy(() => import("@/pages/deployments"));
const CompliancePage = lazy(() => import("@/pages/compliance"));
const GeneratorPage = lazy(() => import("@/pages/generator"));
const IntegrationsPage = lazy(() => import("@/pages/integrations"));
const AuditLogPage = lazy(() => import("@/pages/audit-log"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const NotFoundPage = lazy(() => import("@/pages/not-found"));

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
  // Global error surface for HTTP mode: any query or mutation that fails
  // (e.g. the API is unreachable) shows a toast instead of failing silently.
  // Mutation-level onError handlers are intentionally not used elsewhere to
  // avoid double-toasting — this is the single layer for mutation errors.
  queryCache: new QueryCache({
    onError: (error) => {
      toast.error("Failed to load data", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      toast.error("Action failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  }),
});

export function App() {
  useEffect(
    () =>
      dataSource === "memory"
        ? startPipelineSimulator(queryClient)
        : startEventStream(queryClient),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<OverviewPage />} />
              <Route path="applications" element={<ApplicationsPage />} />
              <Route path="applications/:appId" element={<ApplicationWorkspacePage />} />
              <Route path="pipelines" element={<PipelinesPage />} />
              <Route path="pipelines/:runId" element={<PipelineRunPage />} />
              <Route path="security" element={<SecurityPage />} />
              <Route path="infrastructure" element={<InfrastructurePage />} />
              <Route path="deployments" element={<DeploymentsPage />} />
              <Route path="compliance" element={<CompliancePage />} />
              <Route path="generator" element={<GeneratorPage />} />
              <Route path="integrations" element={<IntegrationsPage />} />
              <Route path="audit" element={<AuditLogPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            style: {
              background: "var(--surface-2)",
              border: "1px solid var(--line-strong)",
              color: "var(--fg)",
            },
          }}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
