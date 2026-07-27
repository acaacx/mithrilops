import { describe, expect, it } from "vitest";
import type { GeneratorRequest } from "@secureflow/types";
import { aiService } from "./ai-service";

const request: GeneratorRequest = {
  applicationName: "Test API",
  repository: "meridian/test-api",
  applicationType: "api",
  language: "typescript",
  deploymentModel: "containerized",
  targetService: "aks",
  environments: ["development", "production"],
  complianceRequirements: ["pci-dss"],
  availabilityTarget: "99.95",
  deploymentStrategy: "canary",
  riskTolerance: "low",
  requiredScanners: ["gitleaks", "trivy", "checkov"],
  approvalModel: "dual-approval",
  requirements: "Deploy the test API to AKS with Key Vault and managed identity.",
};

describe("simulated AI service", () => {
  it("every recommendation carries a human-review disclaimer", async () => {
    const [summary, explanation, exec] = await Promise.all([
      aiService.summarizeRun("run-2210"),
      aiService.explainFinding("find-cve-portal"),
      aiService.executiveSummary(),
    ]);
    for (const rec of [summary, explanation, exec]) {
      expect(rec.disclaimer.toLowerCase()).toContain("human");
      expect(rec.confidence).toMatch(/^(high|medium|low)$/);
      expect(rec.supportingEvidence.length).toBeGreaterThan(0);
      expect(rec.affectedAssets.length).toBeGreaterThan(0);
    }
  });

  it("blocked runs are never reported as safe to promote", async () => {
    const rec = await aiService.summarizeRun("run-2210");
    expect(rec.riskLevel).toMatch(/^(critical|high)$/);
    expect(rec.detail.join(" ")).toContain("no AI override");
  });

  it("generates a pipeline containing mandatory security gates", async () => {
    const result = await aiService.generatePipeline(request);
    const ids = result.pipelineStages.map((s) => s.id);
    for (const gate of ["secret-scan", "image-scan", "sbom", "sign", "manual-approval", "prod-approval"]) {
      expect(ids).toContain(gate);
    }
    expect(result.workflowYaml).toContain("id-token: write");
    expect(result.workflowYaml).not.toContain("AZURE_CLIENT_SECRET");
  });

  it("includes Argo CD only for AKS targets", async () => {
    const aks = await aiService.generatePipeline(request);
    expect(aks.architecture.components.some((c) => c.id === "argocd")).toBe(true);
    const aca = await aiService.generatePipeline({ ...request, targetService: "container-apps" });
    expect(aca.architecture.components.some((c) => c.id === "argocd")).toBe(false);
  });

  it("high risk tolerance surfaces an identified risk instead of silently weakening gates", async () => {
    const result = await aiService.generatePipeline({ ...request, riskTolerance: "high" });
    expect(result.identifiedRisks.some((r) => r.risk.includes("image-signing"))).toBe(true);
  });
});
