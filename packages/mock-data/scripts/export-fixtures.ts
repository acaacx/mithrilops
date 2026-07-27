/**
 * Exports the mock dataset to JSON fixtures consumed by the Python API
 * (apps/api/data). Run after changing any mock data:
 *
 *   pnpm --filter @secureflow/mock-data export:fixtures
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  applications,
  auditEvents,
  complianceFrameworks,
  deployments,
  infrastructurePlans,
  pipelineRuns,
  securityFindings,
} from "../src/index";

const out = fileURLToPath(new URL("../../../apps/api/data/", import.meta.url));
mkdirSync(out, { recursive: true });
const write = (name: string, data: unknown) =>
  writeFileSync(`${out}${name}.json`, `${JSON.stringify(data, null, 2)}\n`);

write("applications", applications);
write("runs", pipelineRuns);
write("findings", securityFindings);
write("deployments", deployments);
write("plans", infrastructurePlans);
write("frameworks", complianceFrameworks);
write("audit", auditEvents);
console.log(`fixtures written to ${out}`);
