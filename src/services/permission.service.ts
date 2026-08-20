/**
 * Permission Service
 * Manages roles, permissions, and role-permission mappings.
 * Uses localStorage for now — will swap to Supabase later.
 */

import type {
  PermissionDefinition,
  PermissionScope,
  Role,
  RolePermission,
  RoleWithPermissions,
  PermissionCategory,
  InternalTeamMember,
} from '@/types/permission.types';

// ─── Storage Keys ─────────────────────────────────────────────
const STORAGE_KEY_PERMISSIONS = 'sam-permissions-definitions';
const STORAGE_KEY_ROLES = 'sam-roles';
const STORAGE_KEY_ROLE_PERMISSIONS = 'sam-role-permissions';
const STORAGE_KEY_INTERNAL_TEAM = 'sam-internal-team';

// ─── Default Permission Definitions ───────────────────────────
const DEFAULT_CUSTOMER_PERMISSIONS: Omit<PermissionDefinition, 'id'>[] = [
  // Initiatives
  { key: 'initiatives.view', label: 'View initiatives', category: 'Initiatives', scope: 'customer', displayOrder: 1 },
  { key: 'initiatives.create', label: 'Create initiatives', category: 'Initiatives', scope: 'customer', displayOrder: 2 },
  { key: 'initiatives.edit', label: 'Edit initiatives', category: 'Initiatives', scope: 'customer', displayOrder: 3 },
  { key: 'initiatives.delete', label: 'Delete initiatives', category: 'Initiatives', scope: 'customer', displayOrder: 4 },
  { key: 'initiatives.change_status', label: 'Change initiative status', category: 'Initiatives', scope: 'customer', displayOrder: 5 },
  // Tasks
  { key: 'tasks.view', label: 'View tasks', category: 'Tasks', scope: 'customer', displayOrder: 10 },
  { key: 'tasks.create', label: 'Create tasks', category: 'Tasks', scope: 'customer', displayOrder: 11 },
  { key: 'tasks.edit', label: 'Edit tasks', category: 'Tasks', scope: 'customer', displayOrder: 12 },
  { key: 'tasks.delete', label: 'Delete tasks', category: 'Tasks', scope: 'customer', displayOrder: 13 },
  { key: 'tasks.change_status', label: 'Change task status', category: 'Tasks', scope: 'customer', displayOrder: 14 },
  { key: 'tasks.assign', label: 'Assign tasks to others', category: 'Tasks', scope: 'customer', displayOrder: 15 },
  // Results
  { key: 'results.view', label: 'View results', category: 'Results', scope: 'customer', displayOrder: 20 },
  { key: 'results.create', label: 'Enter/add results', category: 'Results', scope: 'customer', displayOrder: 21 },
  { key: 'results.edit', label: 'Edit results', category: 'Results', scope: 'customer', displayOrder: 22 },
  { key: 'results.delete', label: 'Delete results', category: 'Results', scope: 'customer', displayOrder: 23 },
  // Expenses
  { key: 'expenses.view', label: 'View expenses', category: 'Expenses', scope: 'customer', displayOrder: 30 },
  { key: 'expenses.create', label: 'Add expenses', category: 'Expenses', scope: 'customer', displayOrder: 31 },
  { key: 'expenses.edit', label: 'Edit expenses', category: 'Expenses', scope: 'customer', displayOrder: 32 },
  { key: 'expenses.delete', label: 'Delete expenses', category: 'Expenses', scope: 'customer', displayOrder: 33 },
  // Planning
  { key: 'planning.view_annual', label: 'View Year-at-a-Glance', category: 'Planning', scope: 'customer', displayOrder: 40 },
  { key: 'planning.edit_quarterly', label: 'View/edit quarterly plans', category: 'Planning', scope: 'customer', displayOrder: 41 },
  { key: 'planning.edit_monthly', label: 'View/edit monthly plans', category: 'Planning', scope: 'customer', displayOrder: 42 },
  { key: 'planning.edit_weekly', label: 'View/edit weekly plans', category: 'Planning', scope: 'customer', displayOrder: 43 },
  { key: 'planning.view_calendar', label: 'View calendar/timeline', category: 'Planning', scope: 'customer', displayOrder: 44 },
  // Products
  { key: 'products.view', label: 'View products', category: 'Products', scope: 'customer', displayOrder: 50 },
  { key: 'products.create', label: 'Add products', category: 'Products', scope: 'customer', displayOrder: 51 },
  { key: 'products.edit', label: 'Edit products', category: 'Products', scope: 'customer', displayOrder: 52 },
  { key: 'products.delete', label: 'Delete products', category: 'Products', scope: 'customer', displayOrder: 53 },
  // Reports
  { key: 'reports.view_revenue', label: 'View revenue report', category: 'Reports', scope: 'customer', displayOrder: 60 },
  { key: 'reports.view_products', label: 'View products report', category: 'Reports', scope: 'customer', displayOrder: 61 },
  { key: 'reports.view_expenses', label: 'View expenses report', category: 'Reports', scope: 'customer', displayOrder: 62 },
  { key: 'reports.view_roi', label: 'View ROI report', category: 'Reports', scope: 'customer', displayOrder: 63 },
  { key: 'reports.export', label: 'Export CSV', category: 'Reports', scope: 'customer', displayOrder: 64 },
  // Settings
  { key: 'settings.view', label: 'View company settings', category: 'Settings', scope: 'customer', displayOrder: 70 },
  { key: 'settings.edit', label: 'Edit company settings', category: 'Settings', scope: 'customer', displayOrder: 71 },
  { key: 'settings.manage_team', label: 'Manage team members', category: 'Settings', scope: 'customer', displayOrder: 72 },
  { key: 'settings.manage_billing', label: 'Manage subscription/billing', category: 'Settings', scope: 'customer', displayOrder: 73 },
  // Questionnaire
  { key: 'questionnaire.fill', label: 'Fill questionnaire', category: 'Questionnaire', scope: 'customer', displayOrder: 80 },
  { key: 'questionnaire.regenerate', label: 'Regenerate plan', category: 'Questionnaire', scope: 'customer', displayOrder: 81 },
];

const DEFAULT_ADMIN_PERMISSIONS: Omit<PermissionDefinition, 'id'>[] = [
  { key: 'admin.dashboard.view', label: 'View admin dashboard', category: 'Dashboard', scope: 'admin', displayOrder: 1 },
  { key: 'admin.users.view', label: 'View user list', category: 'Users', scope: 'admin', displayOrder: 10 },
  { key: 'admin.users.edit', label: 'Edit user details', category: 'Users', scope: 'admin', displayOrder: 11 },
  { key: 'admin.users.delete', label: 'Delete/deactivate users', category: 'Users', scope: 'admin', displayOrder: 12 },
  { key: 'admin.companies.view', label: 'View company list', category: 'Companies', scope: 'admin', displayOrder: 20 },
  { key: 'admin.companies.view_details', label: 'View company details', category: 'Companies', scope: 'admin', displayOrder: 21 },
  { key: 'admin.companies.edit', label: 'Edit company data', category: 'Companies', scope: 'admin', displayOrder: 22 },
  { key: 'admin.companies.delete', label: 'Delete companies', category: 'Companies', scope: 'admin', displayOrder: 23 },
  { key: 'admin.questionnaire.view', label: 'View questions', category: 'Questionnaire Mgmt', scope: 'admin', displayOrder: 30 },
  { key: 'admin.questionnaire.manage', label: 'Add/edit/delete questions', category: 'Questionnaire Mgmt', scope: 'admin', displayOrder: 31 },
  { key: 'admin.initiatives.view', label: 'View initiative types', category: 'Initiative Library', scope: 'admin', displayOrder: 40 },
  { key: 'admin.initiatives.manage', label: 'Add/edit initiative types', category: 'Initiative Library', scope: 'admin', displayOrder: 41 },
  { key: 'admin.initiatives.delete', label: 'Delete initiative types', category: 'Initiative Library', scope: 'admin', displayOrder: 42 },
  { key: 'admin.initiatives.benchmarks', label: 'Manage benchmarks', category: 'Initiative Library', scope: 'admin', displayOrder: 43 },
  { key: 'admin.workbook.view', label: 'View prompts', category: 'AI Workbook', scope: 'admin', displayOrder: 50 },
  { key: 'admin.workbook.edit', label: 'Edit prompts', category: 'AI Workbook', scope: 'admin', displayOrder: 51 },
  { key: 'admin.workbook.upload', label: 'Upload workbook', category: 'AI Workbook', scope: 'admin', displayOrder: 52 },
  { key: 'admin.workbook.test', label: 'Test playground', category: 'AI Workbook', scope: 'admin', displayOrder: 53 },
  { key: 'admin.benchmarks.view', label: 'View benchmarks', category: 'Benchmarks', scope: 'admin', displayOrder: 60 },
  { key: 'admin.benchmarks.manage', label: 'Add/edit benchmarks', category: 'Benchmarks', scope: 'admin', displayOrder: 61 },
  { key: 'admin.benchmarks.delete', label: 'Delete benchmarks', category: 'Benchmarks', scope: 'admin', displayOrder: 62 },
  { key: 'admin.content.university', label: 'Manage SAM University', category: 'Content', scope: 'admin', displayOrder: 70 },
  { key: 'admin.content.faq', label: 'Manage FAQ', category: 'Content', scope: 'admin', displayOrder: 71 },
  { key: 'admin.content.emails', label: 'Manage email templates', category: 'Content', scope: 'admin', displayOrder: 72 },
  { key: 'admin.subscriptions.view', label: 'View subscriptions', category: 'Subscriptions', scope: 'admin', displayOrder: 80 },
  { key: 'admin.subscriptions.manage', label: 'Change subscription tiers', category: 'Subscriptions', scope: 'admin', displayOrder: 81 },
  { key: 'admin.subscriptions.billing', label: 'Manage billing', category: 'Subscriptions', scope: 'admin', displayOrder: 82 },
  { key: 'admin.analytics.usage', label: 'View usage analytics', category: 'Analytics', scope: 'admin', displayOrder: 90 },
  { key: 'admin.analytics.revenue', label: 'View revenue analytics', category: 'Analytics', scope: 'admin', displayOrder: 91 },
  { key: 'admin.analytics.engagement', label: 'View engagement metrics', category: 'Analytics', scope: 'admin', displayOrder: 92 },
  { key: 'admin.settings.feature_flags', label: 'Manage feature flags', category: 'Settings', scope: 'admin', displayOrder: 100 },
  { key: 'admin.settings.platform', label: 'Manage platform settings', category: 'Settings', scope: 'admin', displayOrder: 101 },
  { key: 'admin.settings.internal_roles', label: 'Manage internal team roles', category: 'Settings', scope: 'admin', displayOrder: 102 },
  { key: 'admin.settings.customer_roles', label: 'Define customer role privileges', category: 'Settings', scope: 'admin', displayOrder: 103 },
];

// ─── Helper: Generate IDs ─────────────────────────────────────
function genId(): string {
  return `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Initialize Defaults ──────────────────────────────────────
function getOrInitPermissions(): PermissionDefinition[] {
  if (typeof window === 'undefined') return [];
  const stored = localStorage.getItem(STORAGE_KEY_PERMISSIONS);
  if (stored) return JSON.parse(stored);

  const all: PermissionDefinition[] = [
    ...DEFAULT_CUSTOMER_PERMISSIONS.map(p => ({ ...p, id: genId() })),
    ...DEFAULT_ADMIN_PERMISSIONS.map(p => ({ ...p, id: genId() })),
  ];
  localStorage.setItem(STORAGE_KEY_PERMISSIONS, JSON.stringify(all));
  return all;
}

function getOrInitRoles(): Role[] {
  if (typeof window === 'undefined') return [];
  const stored = localStorage.getItem(STORAGE_KEY_ROLES);
  if (stored) return JSON.parse(stored);

  const now = new Date();
  const defaultRoles: Role[] = [
    { id: 'role-owner', name: 'Owner', description: 'Full access. Manages billing, team, and all features.', scope: 'customer', isDefault: false, isSystem: true, displayOrder: 1, createdAt: now, updatedAt: now },
    { id: 'role-operator', name: 'Operator', description: 'Runs the cadence. Manages initiatives, tasks, results.', scope: 'customer', isDefault: false, isSystem: true, displayOrder: 2, createdAt: now, updatedAt: now },
    { id: 'role-team-member', name: 'Team Member', description: 'Assigned tasks. Enters results for their work.', scope: 'customer', isDefault: true, isSystem: true, displayOrder: 3, createdAt: now, updatedAt: now },
    { id: 'role-viewer', name: 'Viewer', description: 'Read-only access to all data.', scope: 'customer', isDefault: false, isSystem: true, displayOrder: 4, createdAt: now, updatedAt: now },
    { id: 'role-super-admin', name: 'Super Admin', description: 'Unrestricted access. Cannot be modified.', scope: 'admin', isDefault: false, isSystem: true, displayOrder: 1, createdAt: now, updatedAt: now },
    { id: 'role-admin', name: 'Admin', description: 'Full admin access minus super-admin settings.', scope: 'admin', isDefault: false, isSystem: true, displayOrder: 2, createdAt: now, updatedAt: now },
    { id: 'role-support', name: 'Support', description: 'View customer data, help with issues.', scope: 'admin', isDefault: false, isSystem: true, displayOrder: 3, createdAt: now, updatedAt: now },
    { id: 'role-content-manager', name: 'Content Manager', description: 'Manage initiative types, benchmarks, prompts, university.', scope: 'admin', isDefault: false, isSystem: true, displayOrder: 4, createdAt: now, updatedAt: now },
    { id: 'role-analyst', name: 'Analyst', description: 'View analytics and reports, no edit access.', scope: 'admin', isDefault: false, isSystem: true, displayOrder: 5, createdAt: now, updatedAt: now },
  ];
  localStorage.setItem(STORAGE_KEY_ROLES, JSON.stringify(defaultRoles));
  return defaultRoles;
}

function getOrInitRolePermissions(permissions: PermissionDefinition[], roles: Role[]): RolePermission[] {
  if (typeof window === 'undefined') return [];
  const stored = localStorage.getItem(STORAGE_KEY_ROLE_PERMISSIONS);
  if (stored) return JSON.parse(stored);

  const mappings: RolePermission[] = [];

  for (const role of roles) {
    const scopePerms = permissions.filter(p => p.scope === role.scope);
    for (const perm of scopePerms) {
      let granted = false;

      // Customer roles
      if (role.name === 'Owner') granted = true;
      if (role.name === 'Operator') granted = !['settings.manage_billing', 'settings.manage_team'].includes(perm.key);
      if (role.name === 'Team Member') {
        granted = perm.key.includes('.view') || ['tasks.create', 'tasks.edit', 'tasks.change_status', 'results.create', 'results.edit', 'planning.view_annual', 'planning.view_calendar'].includes(perm.key);
      }
      if (role.name === 'Viewer') granted = perm.key.includes('.view');

      // Admin roles
      if (role.name === 'Super Admin') granted = true;
      if (role.name === 'Admin') granted = perm.key !== 'admin.settings.internal_roles';
      if (role.name === 'Support') granted = ['admin.dashboard.view', 'admin.users.view', 'admin.companies.view', 'admin.companies.view_details', 'admin.subscriptions.view'].includes(perm.key);
      if (role.name === 'Content Manager') granted = perm.key.startsWith('admin.initiatives') || perm.key.startsWith('admin.benchmarks') || perm.key.startsWith('admin.content') || perm.key.startsWith('admin.workbook') || perm.key === 'admin.dashboard.view';
      if (role.name === 'Analyst') granted = ['admin.dashboard.view', 'admin.analytics.usage', 'admin.analytics.revenue', 'admin.analytics.engagement', 'admin.users.view', 'admin.companies.view', 'admin.subscriptions.view'].includes(perm.key);

      mappings.push({ id: genId(), roleId: role.id, permissionId: perm.id, granted });
    }
  }

  localStorage.setItem(STORAGE_KEY_ROLE_PERMISSIONS, JSON.stringify(mappings));
  return mappings;
}

// ─── Service ──────────────────────────────────────────────────
class PermissionService {
  // ─── Permissions ────────────────────────────────
  async getPermissionsByScope(scope: PermissionScope): Promise<PermissionDefinition[]> {
    await delay(50);
    const all = getOrInitPermissions();
    return all.filter(p => p.scope === scope).sort((a, b) => a.displayOrder - b.displayOrder);
  }

  async getPermissionsGroupedByCategory(scope: PermissionScope): Promise<PermissionCategory[]> {
    const perms = await this.getPermissionsByScope(scope);
    const grouped: Record<string, PermissionDefinition[]> = {};
    for (const p of perms) {
      if (!grouped[p.category]) grouped[p.category] = [];
      grouped[p.category].push(p);
    }
    return Object.entries(grouped).map(([category, permissions]) => ({ category, permissions }));
  }

  // ─── Roles ──────────────────────────────────────
  async getRolesByScope(scope: PermissionScope): Promise<Role[]> {
    await delay(50);
    const all = getOrInitRoles();
    return all.filter(r => r.scope === scope).sort((a, b) => a.displayOrder - b.displayOrder);
  }

  async createRole(data: { name: string; description?: string; scope: PermissionScope }): Promise<Role> {
    await delay(100);
    const roles = getOrInitRoles();
    const newRole: Role = {
      id: genId(),
      name: data.name,
      description: data.description,
      scope: data.scope,
      isDefault: false,
      isSystem: false,
      displayOrder: roles.filter(r => r.scope === data.scope).length + 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    roles.push(newRole);
    localStorage.setItem(STORAGE_KEY_ROLES, JSON.stringify(roles));
    return newRole;
  }

  async deleteRole(roleId: string): Promise<void> {
    await delay(100);
    const roles = getOrInitRoles();
    const role = roles.find(r => r.id === roleId);
    if (role?.isSystem) throw new Error('Cannot delete system roles');
    const updated = roles.filter(r => r.id !== roleId);
    localStorage.setItem(STORAGE_KEY_ROLES, JSON.stringify(updated));
    // Also remove role_permissions for this role
    const mappings = JSON.parse(localStorage.getItem(STORAGE_KEY_ROLE_PERMISSIONS) || '[]') as RolePermission[];
    localStorage.setItem(STORAGE_KEY_ROLE_PERMISSIONS, JSON.stringify(mappings.filter(m => m.roleId !== roleId)));
  }

  // ─── Role Permissions ───────────────────────────
  async getRoleWithPermissions(roleId: string): Promise<RoleWithPermissions | null> {
    await delay(50);
    const roles = getOrInitRoles();
    const permissions = getOrInitPermissions();
    const mappings = getOrInitRolePermissions(permissions, roles);

    const role = roles.find(r => r.id === roleId);
    if (!role) return null;

    const roleMapping = mappings.filter(m => m.roleId === roleId);
    const permMap: Record<string, boolean> = {};
    for (const m of roleMapping) {
      const perm = permissions.find(p => p.id === m.permissionId);
      if (perm) permMap[perm.key] = m.granted;
    }

    return { role, permissions: permMap };
  }

  async getAllRolesWithPermissions(scope: PermissionScope): Promise<RoleWithPermissions[]> {
    const roles = await this.getRolesByScope(scope);
    const results: RoleWithPermissions[] = [];
    for (const role of roles) {
      const rp = await this.getRoleWithPermissions(role.id);
      if (rp) results.push(rp);
    }
    return results;
  }

  async updateRolePermission(roleId: string, permissionKey: string, granted: boolean): Promise<void> {
    await delay(50);
    const permissions = getOrInitPermissions();
    const roles = getOrInitRoles();
    const mappings = getOrInitRolePermissions(permissions, roles);

    const perm = permissions.find(p => p.key === permissionKey);
    if (!perm) return;

    const idx = mappings.findIndex(m => m.roleId === roleId && m.permissionId === perm.id);
    if (idx >= 0) {
      mappings[idx].granted = granted;
    } else {
      mappings.push({ id: genId(), roleId, permissionId: perm.id, granted });
    }
    localStorage.setItem(STORAGE_KEY_ROLE_PERMISSIONS, JSON.stringify(mappings));
  }

  async bulkUpdateRolePermissions(roleId: string, permissionUpdates: Record<string, boolean>): Promise<void> {
    for (const [key, granted] of Object.entries(permissionUpdates)) {
      await this.updateRolePermission(roleId, key, granted);
    }
  }

  // ─── Internal Team ──────────────────────────────
  async getInternalTeam(): Promise<InternalTeamMember[]> {
    await delay(50);
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem(STORAGE_KEY_INTERNAL_TEAM);
    return stored ? JSON.parse(stored) : [];
  }

  async addInternalTeamMember(data: { email: string; firstName: string; lastName: string; roleId: string }): Promise<InternalTeamMember> {
    await delay(100);
    const team = await this.getInternalTeam();
    const member: InternalTeamMember = {
      id: genId(),
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      roleId: data.roleId,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    team.push(member);
    localStorage.setItem(STORAGE_KEY_INTERNAL_TEAM, JSON.stringify(team));
    return member;
  }

  async removeInternalTeamMember(memberId: string): Promise<void> {
    await delay(100);
    const team = await this.getInternalTeam();
    localStorage.setItem(STORAGE_KEY_INTERNAL_TEAM, JSON.stringify(team.filter(m => m.id !== memberId)));
  }

  // ─── Permission Check (for UI guards) ──────────
  async hasPermission(roleId: string, permissionKey: string): Promise<boolean> {
    const rp = await this.getRoleWithPermissions(roleId);
    if (!rp) return false;
    return rp.permissions[permissionKey] ?? false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const permissionService = new PermissionService();
