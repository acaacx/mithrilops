import type { Permission, Role } from "@secureflow/types";
import matrix from "@secureflow/types/role-permissions.json";

export const ROLE_PERMISSIONS = matrix as Record<Role, Permission[]>;

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
