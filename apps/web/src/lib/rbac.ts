import type { Permission, Role } from "@secureflow/types";

const BASE: Permission[] = ["audit.view", "evidence.download"];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  developer: [...BASE, "pipeline.trigger", "pipeline.retry-stage", "remediation.create"],
  "devsecops-engineer": [
    ...BASE,
    "pipeline.trigger",
    "pipeline.retry-stage",
    "finding.update-status",
    "remediation.create",
    "deployment.request-changes",
  ],
  "security-engineer": [
    ...BASE,
    "finding.update-status",
    "risk.accept",
    "remediation.create",
    "deployment.request-changes",
    "deployment.reject",
  ],
  "platform-engineer": [
    ...BASE,
    "pipeline.trigger",
    "pipeline.retry-stage",
    "deployment.rollback",
    "integration.manage",
  ],
  "application-owner": [
    ...BASE,
    "deployment.request-changes",
    "remediation.create",
    "risk.accept",
  ],
  "compliance-reviewer": [...BASE, "compliance.review"],
  "release-approver": [
    ...BASE,
    "deployment.approve",
    "deployment.reject",
    "deployment.request-changes",
    "deployment.promote",
    "deployment.rollback",
  ],
  administrator: [
    ...BASE,
    "deployment.approve",
    "deployment.reject",
    "deployment.request-changes",
    "deployment.promote",
    "deployment.rollback",
    "pipeline.retry-stage",
    "pipeline.trigger",
    "risk.accept",
    "finding.update-status",
    "remediation.create",
    "compliance.review",
    "integration.manage",
    "settings.manage",
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
