import type { Permission, Role } from "@secureflow/types";
import matrix from "@secureflow/types/role-permissions.json";

export const ROLE_PERMISSIONS = matrix as Record<Role, Permission[]>;

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Union semantics across multiple roles — mirrors the server's permissions_for. */
export function rolesHavePermission(roles: Role[], permission: Permission): boolean {
  return roles.some((role) => hasPermission(role, permission));
}
