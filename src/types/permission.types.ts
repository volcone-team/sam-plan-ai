/**
 * Permission & Role domain types
 * Two scopes: 'customer' (inside companies) and 'admin' (internal team)
 */

export type PermissionScope = 'customer' | 'admin';

export interface PermissionDefinition {
  id: string;
  key: string;
  label: string;
  description?: string;
  category: string;
  scope: PermissionScope;
  displayOrder: number;
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  scope: PermissionScope;
  isDefault: boolean;
  isSystem: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RolePermission {
  id: string;
  roleId: string;
  permissionId: string;
  granted: boolean;
}

export interface InternalTeamMember {
  id: string;
  userId?: string;
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Grouped permissions for UI display
 */
export interface PermissionCategory {
  category: string;
  permissions: PermissionDefinition[];
}

/**
 * Role with its resolved permissions
 */
export interface RoleWithPermissions {
  role: Role;
  permissions: Record<string, boolean>; // permission key -> granted
}
