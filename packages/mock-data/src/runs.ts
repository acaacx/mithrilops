import type {
  Approval,
  PipelineLogLine,
  PipelineRun,
  PipelineStage,
  StageFindingRef,
  StageStatus,
} from "@secureflow/types";
import { STAGE_DEFINITIONS, STAGE_OWNERS } from "./stage-definitions";

const now = Date.now();
const hoursAgo = (n: number) => new Date(now - n * 3_600_000).toISOString();

/** Deterministic pseudo-durations per stage index (seconds). */
const STAGE_DURATIONS = [4, 12, 48, 35, 96, 22, 41, 188, 33, 27, 19, 214, 76, 24, 11, 38, 92, 15, 0, 143, 31, 58, 167, 44, 412, 0, 96, 120, 0];

interface RunSpec {
  id: string;
  applicationId: string;
  startHoursAgo: number;
  status: PipelineRun["status"];
  /** Index into STAGE_DEFINITIONS where the run currently is (or stopped). Omit = completed all. */
  haltIndex?: number;
  haltStatus?: StageStatus;
  failureReason?: string;
  remediation?: string;
  branch: string;
  sha: string;
  message: string;
  author: string;
  environment: PipelineRun["environment"];
  trigger: PipelineRun["trigger"];
  artifactVersion: string;
  pr?: { number: number; title: string };
  securityGate: PipelineRun["securityGate"];
  approvalStatus: PipelineRun["approvalStatus"];
  stageFindings?: Record<string, StageFindingRef[]>;
  previousRunId?: string;
}

function buildStages(spec: RunSpec): PipelineStage[] {
  const startMs = now - spec.startHoursAgo * 3_600_000;
  let cursor = startMs;
  return STAGE_DEFINITIONS.map((def, i) => {
    const duration = STAGE_DURATIONS[i] ?? 30;
    const findings = spec.stageFindings?.[def.id] ?? [];
    let status: StageStatus;
    if (spec.haltIndex === undefined || i < spec.haltIndex) {
      status = "succeeded";
    } else if (i === spec.haltIndex) {
      status = spec.haltStatus ?? "failed";
    } else {
      status = spec.status === "running" ? "pending" : "skipped";
    }
    // The final rollback stage only executes on rolled-back runs.
    if (def.id === "auto-rollback" && spec.status !== "rolled-back") {
      if (status === "succeeded") status = "skipped";
    }
    const started = status === "pending" || status === "skipped" ? undefined : new Date(cursor).toISOString();
    const finished =
      status === "succeeded" || status === "failed"
        ? new Date(cursor + duration * 1000).toISOString()
        : undefined;
    if (status !== "pending" && status !== "skipped") cursor += duration * 1000;

    return {
      id: `${spec.id}-${def.id}`,
      definitionId: def.id,
      name: def.name,
      tool: def.tool,
      phase: def.phase,
      status,
      startedAt: started,
      finishedAt: finished,
      durationSeconds: finished ? duration : undefined,
      owner: STAGE_OWNERS[def.phase],
      blocksDeployment: def.gate,
      failureReason: i === spec.haltIndex ? spec.failureReason : undefined,
      remediation: i === spec.haltIndex ? spec.remediation : undefined,
      findings,
      evidenceIds: status === "succeeded" && def.gate ? [`ev-${spec.id}-${def.id}`] : [],
      canRetry: status === "failed" || status === "blocked",
    };
  });
}

function makeRun(spec: RunSpec): PipelineRun {
  const stages = buildStages(spec);
  const finishedStates: PipelineRun["status"][] = ["succeeded", "failed", "cancelled", "rolled-back", "blocked"];
  const totalSeconds = stages.reduce((acc, s) => acc + (s.durationSeconds ?? 0), 0);
  return {
    id: spec.id,
    applicationId: spec.applicationId,
    commit: {
      sha: spec.sha,
      message: spec.message,
      author: spec.author,
      branch: spec.branch,
      pullRequest: spec.pr
        ? { number: spec.pr.number, title: spec.pr.title, url: `https://github.com/meridian/${spec.applicationId.replace("app-", "")}/pull/${spec.pr.number}` }
        : undefined,
    },
    trigger: spec.trigger,
    environment: spec.environment,
    status: spec.status,
    securityGate: spec.securityGate,
    approvalStatus: spec.approvalStatus,
    artifactVersion: spec.artifactVersion,
    startedAt: hoursAgo(spec.startHoursAgo),
    finishedAt: finishedStates.includes(spec.status)
      ? new Date(now - spec.startHoursAgo * 3_600_000 + totalSeconds * 1000).toISOString()
      : undefined,
    durationSeconds: finishedStates.includes(spec.status) ? totalSeconds : undefined,
    stages,
    previousRunId: spec.previousRunId,
  };
}

export const pipelineRuns: PipelineRun[] = [
  makeRun({
    id: "run-1482",
    applicationId: "app-payments",
    startHoursAgo: 5,
    status: "waiting-approval",
    haltIndex: 25,
    haltStatus: "waiting-approval",
    branch: "release/2.15",
    sha: "8f3ec2a91d4b7c05a6e8d21f9b3a7c4e5d6f8a90",
    message: "feat(payments): ISO 20022 pain.001 v3 support with idempotency keys",
    author: "Rowan Ashford",
    environment: "production",
    trigger: "push",
    artifactVersion: "v2.15.0-rc.2",
    pr: { number: 861, title: "ISO 20022 pain.001 v3 support" },
    securityGate: "passed",
    approvalStatus: "pending",
    previousRunId: "run-1481",
    stageFindings: {
      sca: [{ findingId: "find-dep-axios", severity: "medium", title: "Outdated dependency: axios 1.6.2" }],
    },
  }),
  makeRun({
    id: "run-1481",
    applicationId: "app-payments",
    startHoursAgo: 31,
    status: "succeeded",
    branch: "main",
    sha: "c72d1b45e9a3f8c60d2b4a17e5f9c8d3b6a2e410",
    message: "fix(settlement): correct rounding on multi-currency batches",
    author: "Marcus Oyelaran",
    environment: "production",
    trigger: "push",
    artifactVersion: "v2.14.3",
    securityGate: "passed",
    approvalStatus: "approved",
    previousRunId: "run-1480",
  }),
  makeRun({
    id: "run-1480",
    applicationId: "app-payments",
    startHoursAgo: 77,
    status: "succeeded",
    branch: "main",
    sha: "19ab34cd56ef78ab90cd12ef34ab56cd78ef90ab",
    message: "chore(deps): bump fastify to 5.2.1",
    author: "Tomás Herrera",
    environment: "production",
    trigger: "push",
    artifactVersion: "v2.14.2",
    securityGate: "passed",
    approvalStatus: "approved",
  }),
  makeRun({
    id: "run-2210",
    applicationId: "app-portal",
    startHoursAgo: 8,
    status: "blocked",
    haltIndex: 12,
    haltStatus: "blocked",
    failureReason: "Trivy found CVE-2025-21614 (critical, CVSS 9.8) in base image layer 'node:20.11-alpine'. Gate policy blocks deployment on critical CVEs with a known exploit path.",
    remediation: "Rebuild on node:20.19-alpine3.21 which carries the patched libcrypto3 3.3.2-r4, then re-run the image scan stage.",
    branch: "feature/session-refresh",
    sha: "e4b7a2f19c8d3e60b5a4d7c2f8e9b1a3c5d7e9f0",
    message: "feat(portal): silent session refresh + device binding",
    author: "Tomás Herrera",
    environment: "staging",
    trigger: "pull-request",
    artifactVersion: "v5.9.0-beta.1",
    pr: { number: 1427, title: "Silent session refresh + device binding" },
    securityGate: "failed",
    approvalStatus: "pending",
    previousRunId: "run-2208",
    stageFindings: {
      "image-scan": [
        { findingId: "find-cve-portal", severity: "critical", title: "CVE-2025-21614 in node:20.11-alpine (libcrypto3)" },
        { findingId: "find-root-container", severity: "high", title: "Container runs as root user" },
      ],
      "secret-scan": [],
    },
  }),
  makeRun({
    id: "run-2209",
    applicationId: "app-portal",
    startHoursAgo: 26,
    status: "failed",
    haltIndex: 4,
    haltStatus: "failed",
    failureReason: "Unit test suite failed: 3 assertions in session-store.test.ts — token rotation returns stale refresh token when clock skew exceeds 30s.",
    remediation: "Fix the rotation guard in src/auth/session-store.ts:141 to compare against server-issued iat rather than local clock.",
    branch: "feature/session-refresh",
    sha: "b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4a6b8c0",
    message: "wip(portal): session refresh rotation guard",
    author: "Tomás Herrera",
    environment: "development",
    trigger: "pull-request",
    artifactVersion: "v5.9.0-beta.0",
    pr: { number: 1427, title: "Silent session refresh + device binding" },
    securityGate: "in-progress",
    approvalStatus: "pending",
  }),
  makeRun({
    id: "run-2208",
    applicationId: "app-portal",
    startHoursAgo: 55,
    status: "succeeded",
    branch: "main",
    sha: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    message: "feat(portal): statement download watermarking",
    author: "Elin Sørensen",
    environment: "production",
    trigger: "push",
    artifactVersion: "v5.8.0",
    securityGate: "passed",
    approvalStatus: "approved",
  }),
  makeRun({
    id: "run-2207",
    applicationId: "app-portal",
    startHoursAgo: 74,
    status: "cancelled",
    haltIndex: 7,
    haltStatus: "skipped",
    branch: "spike/edge-caching",
    sha: "0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e",
    message: "spike: edge caching for statement assets",
    author: "Tomás Herrera",
    environment: "development",
    trigger: "manual",
    artifactVersion: "v0.0.0-spike",
    securityGate: "in-progress",
    approvalStatus: "pending",
  }),
  makeRun({
    id: "run-0864",
    applicationId: "app-identity",
    startHoursAgo: 52,
    status: "succeeded",
    branch: "main",
    sha: "77aa88bb99cc00dd11ee22ff33aa44bb55cc66dd",
    message: "feat(identity): FIDO2 step-up for high-risk transfers",
    author: "Priya Natarajan",
    environment: "production",
    trigger: "push",
    artifactVersion: "v3.2.1",
    securityGate: "passed",
    approvalStatus: "approved",
    previousRunId: "run-0863",
  }),
  makeRun({
    id: "run-0863",
    applicationId: "app-identity",
    startHoursAgo: 96,
    status: "succeeded",
    branch: "main",
    sha: "12ff34ee56dd78cc90bb12aa34ff56ee78dd90cc",
    message: "chore(identity): rotate signing key ceremony automation",
    author: "Priya Natarajan",
    environment: "production",
    trigger: "schedule",
    artifactVersion: "v3.2.0",
    securityGate: "passed",
    approvalStatus: "approved",
  }),
  makeRun({
    id: "run-0862",
    applicationId: "app-identity",
    startHoursAgo: 121,
    status: "failed",
    haltIndex: 8,
    haltStatus: "failed",
    failureReason: "Checkov CKV_AZURE_109: Key Vault network ACL default action is 'Allow' in module.identity_kv — public network access would be enabled.",
    remediation: "Set network_acls.default_action = \"Deny\" and add the AKS subnet to allowed virtual_network_subnet_ids in infrastructure/modules/key-vault.",
    branch: "infra/kv-firewall",
    sha: "45cc67dd89ee01ff23aa45bb67cc89dd01ee23ff",
    message: "infra(identity): key vault firewall exception for build agents",
    author: "Marcus Oyelaran",
    environment: "development",
    trigger: "pull-request",
    artifactVersion: "v3.2.1-dev",
    pr: { number: 388, title: "Key vault firewall exception for build agents" },
    securityGate: "failed",
    approvalStatus: "pending",
    stageFindings: {
      checkov: [
        { findingId: "find-kv-public", severity: "high", title: "Key Vault public network access enabled" },
      ],
    },
  }),
  makeRun({
    id: "run-0512",
    applicationId: "app-notify",
    startHoursAgo: 0.4,
    status: "running",
    haltIndex: 11,
    haltStatus: "running",
    branch: "main",
    sha: "9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c",
    message: "feat(notify): template versioning with locale fallback",
    author: "Derek Mensah",
    environment: "development",
    trigger: "push",
    artifactVersion: "v1.10.0-rc.1",
    securityGate: "in-progress",
    approvalStatus: "pending",
    previousRunId: "run-0511",
  }),
  makeRun({
    id: "run-0511",
    applicationId: "app-notify",
    startHoursAgo: 29,
    status: "succeeded",
    branch: "main",
    sha: "5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d",
    message: "fix(notify): dead-letter retry backoff jitter",
    author: "Derek Mensah",
    environment: "production",
    trigger: "push",
    artifactVersion: "v1.9.7",
    securityGate: "passed",
    approvalStatus: "approved",
  }),
  makeRun({
    id: "run-0713",
    applicationId: "app-reporting",
    startHoursAgo: 12,
    status: "rolled-back",
    haltIndex: 28,
    haltStatus: "succeeded",
    failureReason: "Post-deployment verification breached SLO: query error-rate burn 4.2x over 10m window after v4.2.0 canary reached 50%.",
    remediation: "Automated rollback to v4.1.0 completed. Investigate partition pruning regression in aggregation job before re-promoting.",
    branch: "main",
    sha: "3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b",
    message: "perf(reporting): partition-aware aggregation for daily close",
    author: "Aiko Tanaka",
    environment: "production",
    trigger: "push",
    artifactVersion: "v4.2.0",
    securityGate: "passed",
    approvalStatus: "approved",
    previousRunId: "run-0712",
  }),
  makeRun({
    id: "run-0712",
    applicationId: "app-reporting",
    startHoursAgo: 49,
    status: "succeeded",
    branch: "main",
    sha: "6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e",
    message: "feat(reporting): Basel III liquidity coverage extract",
    author: "Aiko Tanaka",
    environment: "production",
    trigger: "push",
    artifactVersion: "v4.1.0",
    securityGate: "passed",
    approvalStatus: "approved",
  }),
];

export const approvals: Approval[] = [
  { id: "appr-1", runId: "run-1482", environment: "production", requiredRole: "release-approver", decision: "pending" },
  { id: "appr-2", runId: "run-1482", environment: "production", requiredRole: "security-engineer", decision: "approved", decidedBy: "Priya Natarajan", decidedAt: hoursAgo(2), comment: "Security gate green; medium SCA finding tracked as REM-3121 with SLA." },
  { id: "appr-3", runId: "run-1481", environment: "production", requiredRole: "release-approver", decision: "approved", decidedBy: "Elin Sørensen", decidedAt: hoursAgo(29), comment: "DORA metrics nominal, canary clean." },
  { id: "appr-4", runId: "run-2210", environment: "staging", requiredRole: "security-engineer", decision: "rejected", decidedBy: "Priya Natarajan", decidedAt: hoursAgo(6), comment: "Critical CVE with public exploit — rebuild base image, no waiver." },
  { id: "appr-5", runId: "run-0713", environment: "production", requiredRole: "release-approver", decision: "approved", decidedBy: "Elin Sørensen", decidedAt: hoursAgo(11), comment: "Approved with canary strategy; rollback triggered automatically post-deploy." },
];

/** Deterministic per-stage logs. */
export function stageLogs(runId: string, stageDefinitionId: string): PipelineLogLine[] {
  const run = pipelineRuns.find((r) => r.id === runId);
  const stage = run?.stages.find((s) => s.definitionId === stageDefinitionId);
  if (!run || !stage || !stage.startedAt) return [];
  const t0 = new Date(stage.startedAt).getTime();
  const at = (s: number) => new Date(t0 + s * 1000).toISOString();
  const lines: PipelineLogLine[] = [
    { timestamp: at(0), level: "info", message: `Starting '${stage.name}' with ${stage.tool} (runner: az-ubuntu-24.04, region: westeurope)` },
    { timestamp: at(1), level: "debug", message: `workspace=${run.applicationId} ref=${run.commit.branch} sha=${run.commit.sha.slice(0, 12)}` },
    { timestamp: at(3), level: "info", message: `${stage.tool} initialized — policy bundle 2026.07.19 loaded` },
  ];
  if (stage.status === "failed" || stage.status === "blocked") {
    lines.push(
      { timestamp: at(6), level: "warn", message: "Gate evaluation started against org policy set 'prod-baseline-v9'" },
      { timestamp: at(8), level: "error", message: stage.failureReason ?? "Stage failed. See findings for details." },
      { timestamp: at(9), level: "error", message: `Exit code 1 — '${stage.name}' marked as ${stage.status}. Evidence bundle uploaded to secureflow-evidence/${runId}/${stageDefinitionId}.tar.gz` },
    );
  } else if (stage.status === "running") {
    lines.push({ timestamp: at(5), level: "info", message: "Execution in progress…" });
  } else if (stage.status === "waiting-approval") {
    lines.push(
      { timestamp: at(4), level: "info", message: "All automated gates passed. Awaiting human approval per policy 'prod-dual-approval'." },
      { timestamp: at(5), level: "warn", message: "Reminder sent to release-approver group (2 pending approvers)." },
    );
  } else {
    lines.push(
      { timestamp: at(5), level: "info", message: `${stage.tool} completed with 0 blocking violations` },
      { timestamp: at(stage.durationSeconds ?? 8), level: "info", message: `'${stage.name}' succeeded in ${stage.durationSeconds ?? 8}s — evidence sealed (sha256:${run.commit.sha.slice(0, 16)}…)` },
    );
  }
  return lines;
}
