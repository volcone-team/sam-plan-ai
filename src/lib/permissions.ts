/**
 * Role-based permission map.
 *
 * Access roles (stored in profiles.role):
 *   - owner:       full access + team management
 *   - operator:    edit all plan data (initiatives, products, tasks, settings)
 *   - team_member: complete tasks, log results (no create/delete of plan structure)
 *   - viewer:      read-only
 */

export type AccessRole = 'owner' | 'operator' | 'team_member' | 'viewer';

export type Permission =
  | 'initiatives.create'
  | 'initiatives.edit'
  | 'initiatives.delete'
  | 'products.create'
  | 'products.edit'
  | 'products.delete'
  | 'tasks.create'
  | 'tasks.edit'
  | 'tasks.delete'
  | 'tasks.complete'
  | 'results.log'
  | 'plan.regenerate'
  | 'settings.company'
  | 'settings.manage_team';

const ROLE_PERMISSIONS: Record<AccessRole, Permission[]> = {
  owner: [
    'initiatives.create', 'initiatives.edit', 'initiatives.delete',
    'products.create', 'products.edit', 'products.delete',
    'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.complete',
    'results.log', 'plan.regenerate',
    'settings.company', 'settings.manage_team',
  ],
  operator: [
    'initiatives.create', 'initiatives.edit', 'initiatives.delete',
    'products.create', 'products.edit', 'products.delete',
    'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.complete',
    'results.log', 'plan.regenerate',
    'settings.company',
  ],
  team_member: [
    'tasks.complete',
    'results.log',
  ],
  viewer: [
    // read-only — no mutation permissions
  ],
};

/**
 * Check if a role has a specific permission.
 */
export function roleHasPermission(role: AccessRole | string | null, permission: Permission): boolean {
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role as AccessRole];
  if (!perms) return false;
  return perms.includes(permission);
}

/**
 * Get all permissions for a role.
 */
export function getPermissionsForRole(role: AccessRole | string | null): Permission[] {
  if (!role) return [];
  return ROLE_PERMISSIONS[role as AccessRole] || [];
}

/**
 * Is this role read-only (viewer)?
 */
export function isReadOnly(role: AccessRole | string | null): boolean {
  return role === 'viewer' || !role;
}
