# Integration guide

Every external system sits behind an interface in `packages/types/src/providers.ts`. The UI consumes hooks in `apps/web/src/lib/queries.ts`; those hooks call whichever implementation is registered in `apps/web/src/lib/providers/index.ts`. To add a real integration you implement the interface — no page or component changes.

## Adding a real provider (pattern)

```ts
// apps/web/src/lib/providers/http/pipeline.ts
import type { PipelineProvider } from "@secureflow/types";

export function createHttpPipelineProvider(baseUrl: string): PipelineProvider {
  return {
    async listRuns(filters) {
      const qs = new URLSearchParams(filters as Record<string, string>);
      const res = await fetch(`${baseUrl}/api/runs?${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error(`runs: ${res.status}`);
      return res.json();
    },
    // getRun, getStageLogs, retryStage, approveDeployment …
  };
}
```

Switch on `VITE_DATA_SOURCE=api` in the provider registry.

## Mapping table

| Interface | Mock today | Real target |
|---|---|---|
| `PipelineProvider` | seeded runs + simulator | GitHub Actions REST/GraphQL (Azure DevOps later — same interface) |
| `SecurityProvider` | seeded findings | SonarQube, Snyk, Trivy, Checkov, tfsec, Gitleaks, ZAP, Defender for Cloud — normalize into `SecurityFinding` |
| `DeploymentProvider` | seeded deployments | Argo CD API (`/api/v1/applications`), Kubernetes |
| `InfrastructureProvider` | seeded plans | Terraform Cloud/CLI JSON plan output |
| `ComplianceProvider` | seeded frameworks | Azure Policy compliance results + evidence store |
| `ArchitectureProvider` | static diagrams | generated from Terraform state + Argo app topology |
| `AuditProvider` | in-memory | append-only store (Postgres + Log Analytics export) |
| `AIService` | deterministic | LLM endpoint (e.g. Claude via API gateway) — keep the response contract: confidence, evidence, affected assets, risk, action, disclaimer |

## Contract rules

1. Providers return domain types from `@secureflow/types` — adapters do the mapping, never the UI.
2. Errors throw; hooks surface toasts. No silent catch.
3. Anything that mutates must also `auditProvider.record(...)`.
4. `AIService` output is advisory. Gate logic must never read AI fields to decide pass/fail.
