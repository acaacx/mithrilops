/**
 * Exports the mock dataset to JSON fixtures consumed by the Python API
 * (apps/api/data). Run after changing any mock data:
 *
 *   pnpm --filter @secureflow/mock-data export:fixtures
 *
 * Time origin is pinned via MOCK_NOW so output is deterministic — rerunning
 * without data changes produces no git diff. The dataset must be imported
 * after the pin, hence the dynamic import.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.MOCK_NOW = String(Date.parse("2026-07-27T00:00:00.000Z"));

const {
  applications,
  approvals,
  architectureDiagrams,
  auditEvents,
  complianceFrameworks,
  deployments,
  infrastructurePlans,
  integrations,
  pipelineRuns,
  securityFindings,
} = await import("../src/index");

const out = fileURLToPath(new URL("../../../apps/api/data/", import.meta.url));
mkdirSync(out, { recursive: true });
const write = (name: string, data: unknown) =>
  writeFileSync(`${out}${name}.json`, `${JSON.stringify(data, null, 2)}\n`);

write("applications", applications);
write("runs", pipelineRuns);
write("approvals", approvals);
write("findings", securityFindings);
write("deployments", deployments);
write("plans", infrastructurePlans);
write("frameworks", complianceFrameworks);
write("audit", auditEvents);
write("integrations", integrations);
write("diagrams", architectureDiagrams);
console.log(`fixtures written to ${out}`);
