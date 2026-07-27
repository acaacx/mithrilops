import type { ComplianceControl, ComplianceEvidence, ComplianceFramework, FrameworkId } from "@secureflow/types";

import { now } from "./clock";
const daysAgo = (n: number) => new Date(now - n * 86_400_000).toISOString();
const daysAhead = (n: number) => new Date(now + n * 86_400_000).toISOString();

function control(
  frameworkId: FrameworkId,
  controlId: string,
  title: string,
  description: string,
  status: ComplianceControl["status"],
  opts: Partial<ComplianceControl> = {},
): ComplianceControl {
  return {
    id: `${frameworkId}-${controlId}`,
    frameworkId,
    controlId,
    title,
    description,
    status,
    evidenceIds: opts.evidenceIds ?? [],
    relatedStageDefinitionId: opts.relatedStageDefinitionId,
    relatedFindingIds: opts.relatedFindingIds ?? [],
    ownerUserId: opts.ownerUserId ?? "u-aiko",
    lastValidatedAt: opts.lastValidatedAt ?? daysAgo(6),
    nextReviewAt: opts.nextReviewAt ?? daysAhead(84),
  };
}

export const complianceFrameworks: ComplianceFramework[] = [
  {
    id: "owasp-top-10",
    name: "OWASP Top 10",
    version: "2021",
    coveragePercent: 90,
    controls: [
      control("owasp-top-10", "A01", "Broken Access Control", "Enforce least privilege and deny-by-default authorization on every route and API.", "passed", { relatedStageDefinitionId: "iam-review", evidenceIds: ["ev-authz-tests"] }),
      control("owasp-top-10", "A02", "Cryptographic Failures", "TLS everywhere, approved cipher suites, CMK for sensitive data at rest.", "passed", { evidenceIds: ["ev-tls-policy"] }),
      control("owasp-top-10", "A03", "Injection", "Parameterized queries and taint analysis in SAST gate.", "passed", { relatedStageDefinitionId: "sast", relatedFindingIds: ["find-sast-sqli"], evidenceIds: ["ev-sonar-gate"] }),
      control("owasp-top-10", "A06", "Vulnerable and Outdated Components", "SCA and container scanning gates block critical CVEs.", "failed", { relatedStageDefinitionId: "sca", relatedFindingIds: ["find-cve-portal", "find-dep-axios"] }),
      control("owasp-top-10", "A07", "Identification & Authentication Failures", "MFA, rate limiting, uniform auth responses.", "failed", { relatedStageDefinitionId: "dast", relatedFindingIds: ["find-dast-auth", "find-secret-notify"] }),
    ],
  },
  {
    id: "cis-benchmarks",
    name: "CIS Benchmarks",
    version: "AKS 1.5 / Docker 1.7",
    coveragePercent: 82,
    controls: [
      control("cis-benchmarks", "5.2.6", "Do not run containers as root", "Enforce runAsNonRoot via admission policy.", "failed", { relatedFindingIds: ["find-root-container"], relatedStageDefinitionId: "image-scan" }),
      control("cis-benchmarks", "5.4.1", "Resource limits on all workloads", "CPU/memory limits required by namespace LimitRange.", "needs-evidence", { relatedFindingIds: ["find-missing-limits"] }),
      control("cis-benchmarks", "6.2", "Restrict network ingress", "No 0.0.0.0/0 ingress except approved edge.", "failed", { relatedFindingIds: ["find-sg-open"], relatedStageDefinitionId: "tfsec" }),
    ],
  },
  {
    id: "nist-csf",
    name: "NIST Cybersecurity Framework",
    version: "2.0",
    coveragePercent: 78,
    controls: [
      control("nist-csf", "ID.AM-02", "Software inventories (SBOM)", "SBOM generated and stored for every shipped image.", "needs-evidence", { relatedStageDefinitionId: "sbom", relatedFindingIds: ["find-missing-sbom"] }),
      control("nist-csf", "PR.PS-06", "Software integrity", "All images signed with Cosign; admission verifies signatures.", "passed", { relatedStageDefinitionId: "sign", relatedFindingIds: ["find-unsigned-image"], evidenceIds: ["ev-cosign-policy"] }),
      control("nist-csf", "PR.AA-05", "Least-privilege access", "Scoped role assignments reviewed quarterly.", "failed", { relatedFindingIds: ["find-iam-wide"] }),
    ],
  },
  {
    id: "iso-27001",
    name: "ISO/IEC 27001",
    version: "2022",
    coveragePercent: 88,
    controls: [
      control("iso-27001", "A.8.24", "Use of cryptography", "Key management via Key Vault with rotation policies.", "exception", { relatedFindingIds: ["find-missing-encryption"], evidenceIds: ["ev-rex-31"] }),
      control("iso-27001", "A.8.12", "Data leakage prevention", "No public data endpoints without DLP review.", "failed", { relatedFindingIds: ["find-storage-public"] }),
      control("iso-27001", "A.8.2", "Privileged access rights", "Privileged roles time-bound and reviewed.", "needs-evidence", { relatedFindingIds: ["find-iam-wide"] }),
    ],
  },
  {
    id: "soc-2",
    name: "SOC 2",
    version: "Type II",
    coveragePercent: 92,
    controls: [
      control("soc-2", "CC6.1", "Logical access controls", "Access provisioned via Entra groups; secrets never in code.", "failed", { relatedFindingIds: ["find-secret-notify"], relatedStageDefinitionId: "secret-scan" }),
      control("soc-2", "CC6.6", "Boundary protection", "Private endpoints for data stores; public access denied.", "failed", { relatedFindingIds: ["find-storage-public"] }),
      control("soc-2", "CC8.1", "Change management", "All production changes flow through approved pipelines with dual approval.", "passed", { relatedStageDefinitionId: "prod-approval", evidenceIds: ["ev-approval-trail"] }),
    ],
  },
  {
    id: "pci-dss",
    name: "PCI DSS",
    version: "4.0.1",
    coveragePercent: 85,
    controls: [
      control("pci-dss", "6.3.3", "Patch critical vulnerabilities within one month", "Critical/high CVEs remediated inside SLA.", "failed", { relatedFindingIds: ["find-cve-portal", "find-dep-axios"] }),
      control("pci-dss", "8.3.4", "Limit repeated access attempts", "Lockout and throttling on all authentication flows.", "failed", { relatedFindingIds: ["find-dast-auth"] }),
      control("pci-dss", "10.2", "Audit log integrity", "Immutable audit trail for privileged operations.", "passed", { evidenceIds: ["ev-audit-immutability"] }),
    ],
  },
  {
    id: "azure-security-benchmark",
    name: "Azure Security Benchmark",
    version: "v3",
    coveragePercent: 87,
    controls: [
      control("azure-security-benchmark", "NS-2", "Secure PaaS with private endpoints", "Key Vault, Postgres, Storage behind private endpoints.", "failed", { relatedFindingIds: ["find-kv-public", "find-storage-public"], relatedStageDefinitionId: "checkov" }),
      control("azure-security-benchmark", "PA-7", "Just-enough administration", "Least-privilege scoped role assignments for automation.", "failed", { relatedFindingIds: ["find-iam-wide"] }),
      control("azure-security-benchmark", "PV-6", "Rapid vulnerability remediation", "Container and dependency scanning gates with SLAs.", "passed", { relatedStageDefinitionId: "image-scan", evidenceIds: ["ev-trivy-gate"] }),
    ],
  },
];

export const complianceEvidence: ComplianceEvidence[] = [
  { id: "ev-authz-tests", name: "Authorization test suite report", type: "scan-report", createdAt: daysAgo(6), source: "GitHub Actions run 9174", sha256: "4c1f0e2b9a7d3c5e8f1a2b4c6d8e0f2a4b6c8d0e2f4a6b8c0d2e4f6a8b0c2d4e" },
  { id: "ev-tls-policy", name: "TLS policy attestation", type: "attestation", createdAt: daysAgo(30), source: "Azure Policy compliance export", sha256: "9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b" },
  { id: "ev-sonar-gate", name: "SonarQube quality gate result", type: "policy-result", createdAt: daysAgo(2), source: "SonarQube project meridian-portal", sha256: "1f2e3d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1f2e" },
  { id: "ev-cosign-policy", name: "Cosign verification admission policy", type: "policy-result", createdAt: daysAgo(12), source: "AKS admission controller", sha256: "7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d" },
  { id: "ev-rex-31", name: "Risk exception REX-31 (CMK rollout)", type: "attestation", createdAt: daysAgo(20), source: "SecureFlow risk register", sha256: "3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a" },
  { id: "ev-approval-trail", name: "Production approval audit extract (90d)", type: "log-extract", createdAt: daysAgo(1), source: "SecureFlow audit log", sha256: "5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e5d6c" },
  { id: "ev-audit-immutability", name: "Immutable storage configuration proof", type: "policy-result", createdAt: daysAgo(15), source: "Azure Storage WORM policy", sha256: "8f9e0d1c2b3a4f5e6d7c8b9a0f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e" },
  { id: "ev-trivy-gate", name: "Trivy gate policy + latest pass", type: "scan-report", createdAt: daysAgo(1), source: "GitHub Actions run 9188", sha256: "2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b" },
];
