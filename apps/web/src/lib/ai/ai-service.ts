import type {
  AIRecommendation,
  AIService,
  GeneratorRequest,
  GeneratorResult,
  PipelineStageDefinition,
} from "@secureflow/types";
import { STAGE_DEFINITIONS } from "@secureflow/mock-data";
import { infrastructureProvider, pipelineProvider, securityProvider } from "@/lib/providers";
import { delay } from "@/lib/providers/mock-state";

const DISCLAIMER =
  "AI-generated analysis. A human reviewer must validate before acting; AI output never bypasses security or production approval gates.";

let idCounter = 0;
function rec(partial: Omit<AIRecommendation, "id" | "generatedAt" | "disclaimer">): AIRecommendation {
  return {
    ...partial,
    id: `ai-${++idCounter}`,
    generatedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
  };
}

/**
 * Deterministic simulated AI service. A production implementation would call a
 * model endpoint behind this same interface (e.g. Azure OpenAI with the
 * claude-fable-5 or GPT-class models via a gateway).
 */
export const aiService: AIService = {
  async summarizeRun(runId: string) {
    const run = await pipelineProvider.getRun(runId);
    const failed = run.stages.find((s) => s.status === "failed" || s.status === "blocked");
    const previous = run.previousRunId;

    if (run.status === "waiting-approval") {
      return delay(
        rec({
          capability: "pipeline-failure-summary",
          title: "Release is safe to promote with one tracked exception",
          summary: `All 25 automated gates passed for ${run.artifactVersion}. One medium SCA finding (axios 1.6.2) is in remediation with an SLA inside the release window.`,
          detail: [
            "Changed from previous execution: ISO 20022 message handling, 2 new Terraform resources (burst node pool, Key Vault private endpoint).",
            "Highest risk item: axios SSRF-class advisory — reachable in the webhook dispatcher, mitigated by egress allow-list at the mesh layer.",
            "Estimated blast radius: payments initiation path only; settlement and refunds unaffected (separate deployment unit).",
            "Recommended order: approve → canary 10% for 30m → auto-promote on clean burn rate.",
            "Suggested rollback action: 'argo rollouts undo payments-api-prod' restores v2.14.3 in under 2 minutes.",
          ],
          confidence: "high",
          supportingEvidence: ["trivy-report-run-1482.json", "snyk-report-run-1482.json", "plan-payments-1482"],
          affectedAssets: ["payments-api", "aks/payments-prod", "kv-meridian-payments"],
          riskLevel: "low",
          suggestedAction: "Approve for canary deployment; hold full rollout until REM-3121 (axios upgrade) merges.",
        }),
        600,
      );
    }
    if (failed) {
      return delay(
        rec({
          capability: "pipeline-failure-summary",
          title: `Pipeline ${failed.status === "blocked" ? "blocked" : "failed"} at '${failed.name}'`,
          summary: failed.failureReason ?? "Gate policy stopped the run.",
          detail: [
            `Failing stage: ${failed.name} (${failed.tool}), owner ${failed.owner}.`,
            previous
              ? `What changed vs ${previous}: new base image / dependency set introduced in this branch.`
              : "First tracked execution for this branch.",
            `Highest-risk issue: ${failed.findings[0]?.title ?? "see stage logs"}.`,
            "Recommended remediation order: fix the blocking finding first; other findings do not gate this run.",
            "Not safe to promote: the security gate is a hard block by policy — no AI override exists.",
          ],
          confidence: "high",
          supportingEvidence: failed.evidenceIds.length ? failed.evidenceIds : [`${runId}/${failed.definitionId}/logs`],
          affectedAssets: [run.applicationId, run.artifactVersion],
          riskLevel: failed.findings.some((f) => f.severity === "critical") ? "critical" : "high",
          suggestedAction: failed.remediation ?? "Review stage logs and re-run after remediation.",
        }),
        600,
      );
    }
    if (run.status === "rolled-back") {
      return delay(
        rec({
          capability: "pipeline-failure-summary",
          title: "Automated rollback executed — SLO breach during canary",
          summary: "Post-deployment verification detected a 4.2x error-budget burn within 10 minutes at 50% canary traffic; Argo Rollouts restored the previous version automatically.",
          detail: [
            "Root-cause hypothesis: partition pruning regression in the aggregation job (query plans show full scans on daily-close tables).",
            "Blast radius was contained to canary traffic; no data-integrity impact detected.",
            "Recommended: reproduce with production-shaped data in staging before re-promoting.",
          ],
          confidence: "medium",
          supportingEvidence: ["prometheus-burn-rate-snapshot.json", "argo-rollouts-event-log"],
          affectedAssets: [run.applicationId, run.artifactVersion],
          riskLevel: "medium",
          suggestedAction: "Keep v4.1.0 pinned; attach the regression test to REM backlog before next attempt.",
        }),
        600,
      );
    }
    return delay(
      rec({
        capability: "executive-summary",
        title: "Healthy execution",
        summary: `Run ${runId} completed cleanly; all gates green, artifact ${run.artifactVersion} signed and attested.`,
        detail: ["No blocking findings.", "Evidence bundle complete for audit.", "No drift introduced."],
        confidence: "high",
        supportingEvidence: [`${runId} evidence bundle`],
        affectedAssets: [run.applicationId],
        riskLevel: "low",
        suggestedAction: "No action required.",
      }),
      500,
    );
  },

  async explainFinding(findingId: string) {
    const finding = await securityProvider.getFinding(findingId);
    return delay(
      rec({
        capability: "finding-explanation",
        title: finding.title,
        summary: finding.aiExplanation,
        detail: [
          `Exploitability: ${finding.exploitability}; reachability: ${finding.reachability}.`,
          `Business impact: ${finding.businessImpact}`,
          `Suggested fix: ${finding.suggestedFix}`,
        ],
        confidence: finding.reachability === "unknown" ? "medium" : "high",
        supportingEvidence: finding.evidence.length ? finding.evidence : [finding.ruleId],
        affectedAssets: [finding.affectedResource],
        riskLevel:
          finding.severity === "critical" ? "critical" : finding.severity === "high" ? "high" : finding.severity === "medium" ? "medium" : "low",
        suggestedAction: finding.suggestedFix,
      }),
      500,
    );
  },

  async summarizeTerraformPlan(planId: string) {
    const plan = await infrastructureProvider.getPlan(planId);
    const risky = plan.policyViolations.length > 0 || plan.driftStatus === "drift-detected";
    return delay(
      rec({
        capability: "terraform-risk-summary",
        title: risky ? "Plan carries policy or drift risk" : "Low-risk infrastructure change",
        summary: `${plan.summary.add} to add, ${plan.summary.change} to change, ${plan.summary.destroy} to destroy. Cost delta ${plan.costDeltaUsd >= 0 ? "+" : ""}$${plan.costDeltaUsd}/mo.`,
        detail: [
          ...plan.policyViolations.map((v) => `Policy violation (${v.severity}): ${v.policy} on ${v.resource}.`),
          plan.driftStatus === "drift-detected"
            ? "Drift detected: live state diverges from Terraform — reconcile before applying to avoid clobbering manual changes."
            : "State and live infrastructure are in sync.",
          ...plan.resources.filter((r) => r.securityNotes).slice(0, 3).map((r) => `${r.address}: ${r.securityNotes}`),
        ],
        confidence: "high",
        supportingEvidence: [`${plan.id}.tfplan.json`],
        affectedAssets: plan.resources.map((r) => r.address).slice(0, 6),
        riskLevel: plan.policyViolations.some((v) => v.severity === "critical") ? "critical" : risky ? "high" : "low",
        suggestedAction: risky
          ? "Resolve policy violations and reconcile drift before approval."
          : "Safe to approve with standard review.",
      }),
      550,
    );
  },

  async scoreDeploymentRisk(runId: string) {
    const run = await pipelineProvider.getRun(runId);
    const critical = run.stages.flatMap((s) => s.findings).filter((f) => f.severity === "critical").length;
    const score = Math.min(95, 12 + critical * 45 + (run.securityGate === "failed" ? 30 : 0));
    return delay(
      rec({
        capability: "deployment-risk-score",
        title: `Deployment risk score: ${score}/100`,
        summary:
          score < 30
            ? "Low risk: gates green, small change surface, fast rollback path."
            : "Elevated risk driven by unresolved blocking findings.",
        detail: [
          `Change size: ${run.stages.length} stages, artifact ${run.artifactVersion}.`,
          `Security gate: ${run.securityGate}.`,
          `Critical findings in this run: ${critical}.`,
        ],
        confidence: "medium",
        supportingEvidence: [`${runId} stage results`],
        affectedAssets: [run.applicationId],
        riskLevel: score >= 70 ? "critical" : score >= 45 ? "high" : score >= 25 ? "medium" : "low",
        suggestedAction: score < 30 ? "Proceed with canary strategy." : "Remediate blocking findings before deployment.",
      }),
      450,
    );
  },

  async executiveSummary() {
    return delay(
      rec({
        capability: "executive-summary",
        title: "Portfolio posture: stable, two active risk hotspots",
        summary:
          "Deployment success rate is 87% over 30 days. Customer Portal and Reporting Platform carry the aggregate risk: one exploitable critical CVE and one public storage exposure.",
        detail: [
          "Customer Portal: blocked release (critical CVE with public exploit) plus an unthrottled password-reset flow found by DAST.",
          "Reporting Platform: public blob access drifted back on after a portal edit — policy exception expired; treat as active exposure.",
          "Payments API: release candidate waiting on production approval; risk low with one tracked SCA item.",
          "Compliance: PCI 6.3.3 and SOC 2 CC6.x currently failing — both map to the same two hotspots, so remediation is high-leverage.",
        ],
        confidence: "high",
        supportingEvidence: ["30d pipeline metrics", "defender-alert-88213.json", "zap-scan-run-2208.html"],
        affectedAssets: ["customer-portal", "reporting-platform", "payments-api"],
        riskLevel: "high",
        suggestedAction: "Prioritize the portal base-image rebuild and storage-account lockdown this week; both close multiple framework gaps at once.",
      }),
      700,
    );
  },

  async generatePipeline(request: GeneratorRequest): Promise<GeneratorResult> {
    const isAks = request.targetService === "aks";
    const stages: PipelineStageDefinition[] = STAGE_DEFINITIONS.filter((s) => {
      if (s.id === "dast" && !request.requiredScanners.includes("owasp-zap")) return false;
      if (s.id === "checkov" && !request.requiredScanners.includes("checkov")) return false;
      if (s.id === "tfsec" && !request.requiredScanners.includes("tfsec") && !request.requiredScanners.includes("trivy")) return false;
      return true;
    });
    const components = [
      { id: "github", label: "GitHub Repository", kind: "scm", rationale: "Source control with branch protection and required reviews." },
      { id: "actions", label: "GitHub Actions", kind: "ci", rationale: "CI with OIDC federation — no long-lived cloud secrets." },
      { id: "terraform", label: "Terraform", kind: "iac", rationale: "Modular IaC with remote state and policy gates." },
      { id: "acr", label: "Azure Container Registry", kind: "registry", rationale: "Private registry; Trivy scans + Cosign signatures." },
      {
        id: "compute",
        label: isAks ? "Azure Kubernetes Service" : request.targetService === "container-apps" ? "Azure Container Apps" : request.targetService === "functions" ? "Azure Functions" : "Azure App Service",
        kind: "compute",
        rationale: request.deploymentModel === "containerized" ? "Container runtime with managed identity and autoscaling." : "Serverless runtime with consumption scaling.",
      },
      ...(isAks ? [{ id: "argocd", label: "Argo CD", kind: "cd", rationale: "GitOps reconciliation for AKS workloads." }] : []),
      { id: "keyvault", label: "Azure Key Vault", kind: "secrets", rationale: "Secrets via managed identity; no secrets in config." },
      { id: "entra", label: "Microsoft Entra ID", kind: "identity", rationale: "Workload identity and RBAC." },
      { id: "monitor", label: "Azure Monitor + App Insights", kind: "observability", rationale: `Golden signals to meet ${request.availabilityTarget}% availability.` },
      ...(request.complianceRequirements.length ? [{ id: "policy", label: "Azure Policy", kind: "governance", rationale: `Guardrails mapped to ${request.complianceRequirements.length} framework(s).` }] : []),
    ];
    const edges = [
      { source: "github", target: "actions", label: "triggers" },
      { source: "actions", target: "terraform", label: "plan/apply" },
      { source: "actions", target: "acr", label: "push" },
      ...(isAks
        ? [
            { source: "github", target: "argocd", label: "desired state" },
            { source: "argocd", target: "compute", label: "sync" },
          ]
        : [{ source: "actions", target: "compute", label: "deploy" }]),
      { source: "acr", target: "compute", label: "pull" },
      { source: "keyvault", target: "compute", label: "secrets" },
      { source: "entra", target: "compute", label: "identity" },
      { source: "compute", target: "monitor", label: "telemetry" },
    ];
    const slug = request.applicationName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const baseCost = request.targetService === "aks" ? 2900 : request.targetService === "container-apps" ? 840 : 520;
    const envCost = request.environments.length * 260;

    const result: GeneratorResult = {
      id: `gen-${Date.now()}`,
      request,
      architecture: { components, edges },
      pipelineStages: stages,
      terraformFileTree: [
        "infrastructure/",
        "  modules/",
        "    resource-group/",
        "    network/",
        ...(isAks ? ["    aks-cluster/"] : [`    ${request.targetService}/`]),
        "    acr/",
        "    key-vault/",
        "    monitoring/",
        "    identity/",
        "  environments/",
        ...request.environments.map((e) => `    ${e === "development" ? "dev" : e === "production" ? "prod" : e}/`),
      ],
      workflowYaml: buildWorkflowYaml(slug, request),
      securityPolicy: [
        { control: "Critical CVE gate", setting: "block (no waiver)" },
        { control: "Secret scan", setting: "block on any verified match" },
        { control: "Image signing", setting: request.riskTolerance === "high" ? "warn" : "required (Cosign, keyless OIDC)" },
        { control: "SBOM", setting: "required (SPDX via Syft)" },
        { control: "IaC policy", setting: request.riskTolerance === "low" ? "block on medium+" : "block on high+" },
        { control: "Production approval", setting: request.approvalModel },
      ],
      requiredIntegrations: ["GitHub", "GitHub Actions", "Azure (OIDC)", "ACR", "Key Vault", ...(isAks ? ["AKS", "Argo CD"] : []), ...request.requiredScanners],
      monthlyCostEstimateUsd: baseCost + envCost,
      identifiedRisks: [
        ...(request.riskTolerance === "high"
          ? [{ risk: "High risk tolerance relaxes the image-signing gate", severity: "medium", mitigation: "Re-enable signing before first production release." }]
          : []),
        ...(request.availabilityTarget === "99.99"
          ? [{ risk: "99.99% target requires multi-zone + tested failover", severity: "high", mitigation: "Zone-redundant node pools and quarterly game days." }]
          : []),
        ...(!request.requiredScanners.includes("owasp-zap")
          ? [{ risk: "No DAST coverage selected", severity: "medium", mitigation: "Add OWASP ZAP against staging before exposing public endpoints." }]
          : []),
        { risk: "New pipeline has no historical baseline for anomaly detection", severity: "low", mitigation: "Baselines establish automatically after ~20 runs." },
      ],
      implementationChecklist: [
        `Create repository ${request.repository} with branch protection (2 reviews, signed commits)`,
        "Register Entra workload identity and federate with GitHub OIDC",
        "Bootstrap Terraform remote state (storage account + lock container)",
        `Provision ${request.environments.join(", ")} via environment tfvars`,
        "Install scanner configs (severity thresholds per security policy)",
        isAks ? "Register application in Argo CD with auto-sync + pruning" : "Configure deployment slots / revisions for safe rollout",
        `Wire ${request.deploymentStrategy} strategy with automated rollback on SLO breach`,
        "Run the pipeline end-to-end against development before first staging promotion",
      ],
      aiRecommendation: rec({
        capability: "pipeline-generation",
        title: `Generated secure delivery plan for ${request.applicationName}`,
        summary: `${stages.length}-stage pipeline targeting ${request.targetService.toUpperCase()} with ${request.deploymentStrategy} deployments across ${request.environments.length} environment(s).`,
        detail: [
          `Compliance scope: ${request.complianceRequirements.length ? request.complianceRequirements.join(", ") : "baseline only"}.`,
          `Approval model: ${request.approvalModel}; risk tolerance ${request.riskTolerance}.`,
          "All secrets flow through Key Vault + managed identity; the workflow uses OIDC (no client secrets).",
        ],
        confidence: "high",
        supportingEvidence: ["org baseline policy prod-baseline-v9", "requirements text"],
        affectedAssets: [slug],
        riskLevel: request.riskTolerance === "high" ? "medium" : "low",
        suggestedAction: "Review the architecture and stage list, then create the scaffold pull request.",
      }),
    };
    return delay(result, 1400);
  },
};

function buildWorkflowYaml(slug: string, request: GeneratorRequest): string {
  return `name: ${slug}-secure-delivery
on:
  pull_request:
  push:
    branches: [main]

permissions:
  id-token: write   # OIDC federation to Azure — no client secrets
  contents: read
  security-events: write

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint && pnpm typecheck && pnpm test
      - name: Secret scan (Gitleaks)
        uses: gitleaks/gitleaks-action@v2
${request.requiredScanners.includes("snyk") ? `      - name: SCA (Snyk)
        run: snyk test --severity-threshold=high
` : ""}      - name: Build image
        run: docker build -t $ACR/${slug}:$GITHUB_SHA .
      - name: Scan image (Trivy)
        run: trivy image --exit-code 1 --severity CRITICAL $ACR/${slug}:$GITHUB_SHA
      - name: SBOM (Syft)
        run: syft $ACR/${slug}:$GITHUB_SHA -o spdx-json > sbom.spdx.json
      - name: Sign (Cosign, keyless)
        run: cosign sign --yes $ACR/${slug}:$GITHUB_SHA

  infrastructure:
    needs: ci
    runs-on: ubuntu-latest
    steps:
      - uses: azure/login@v2
        with:
          client-id: \${{ vars.AZURE_CLIENT_ID }}
          tenant-id: \${{ vars.AZURE_TENANT_ID }}
          subscription-id: \${{ vars.AZURE_SUBSCRIPTION_ID }}
      - run: terraform fmt -check && terraform validate
      - name: Policy scan (Checkov)
        run: checkov -d infrastructure --hard-fail-on ${request.riskTolerance === "low" ? "MEDIUM" : "HIGH"}
      - run: terraform plan -out=tfplan

  deploy:
    needs: infrastructure
    environment: production   # manual approval gate lives here
    runs-on: ubuntu-latest
    steps:
      - run: terraform apply tfplan
      - name: ${request.targetService === "aks" ? "Argo CD sync" : "Deploy"}
        run: ${request.targetService === "aks" ? `argocd app sync ${slug} --strategy ${request.deploymentStrategy}` : `az containerapp update -n ${slug}`}
      - name: Post-deployment verification
        run: ./scripts/verify-slo.sh --strategy ${request.deploymentStrategy} --auto-rollback
`;
}
