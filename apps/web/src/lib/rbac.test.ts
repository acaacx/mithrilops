import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLES } from "@secureflow/types";
import { ROLE_PERMISSIONS, hasPermission, rolesHavePermission } from "./rbac";

describe("RBAC matrix", () => {
  it("defines permissions for every role", () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
      expect(ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });

  it("only grants known permissions", () => {
    for (const role of ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) {
        expect(PERMISSIONS).toContain(p);
      }
    }
  });

  it("developers cannot approve deployments", () => {
    expect(hasPermission("developer", "deployment.approve")).toBe(false);
  });

  it("only release approvers and administrators can approve deployments", () => {
    const approvers = ROLES.filter((r) => hasPermission(r, "deployment.approve"));
    expect(approvers.sort()).toEqual(["administrator", "release-approver"]);
  });

  it("risk acceptance is limited to security, owners, and administrators", () => {
    const acceptors = ROLES.filter((r) => hasPermission(r, "risk.accept"));
    expect(acceptors.sort()).toEqual(["administrator", "application-owner", "security-engineer"]);
  });

  it("compliance review is held by compliance reviewers and administrators", () => {
    const reviewers = ROLES.filter((r) => hasPermission(r, "compliance.review"));
    expect(reviewers.sort()).toEqual(["administrator", "compliance-reviewer"]);
  });

  it("every role can view the audit trail", () => {
    for (const role of ROLES) {
      expect(hasPermission(role, "audit.view")).toBe(true);
    }
  });
});

describe("rolesHavePermission", () => {
  it("unions permissions across roles like the server", () => {
    // developer alone cannot approve; release-approver can.
    expect(rolesHavePermission(["developer"], "deployment.approve")).toBe(false);
    expect(rolesHavePermission(["developer", "release-approver"], "deployment.approve")).toBe(true);
  });

  it("returns false for an empty roles array", () => {
    expect(rolesHavePermission([], "audit.view")).toBe(false);
  });
});
