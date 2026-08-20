'use client';

import { useEffect, useState } from 'react';
import { Loader2, Shield, Users, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { permissionService } from '@/services/permission.service';
import type { RoleWithPermissions, PermissionCategory, PermissionScope } from '@/types';

/**
 * Role Management component for Admin Settings.
 * Two tabs: Customer Roles | Internal Roles
 * Each role shows a checkbox matrix of permissions grouped by category.
 */
export function RoleManagement() {
  const [activeTab, setActiveTab] = useState<PermissionScope>('customer');
  const [roles, setRoles] = useState<RoleWithPermissions[]>([]);
  const [categories, setCategories] = useState<PermissionCategory[]>([]);
  const [expandedRole, setExpandedRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [showAddRole, setShowAddRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [rolesData, categoriesData] = await Promise.all([
        permissionService.getAllRolesWithPermissions(activeTab),
        permissionService.getPermissionsGroupedByCategory(activeTab),
      ]);
      setRoles(rolesData);
      setCategories(categoriesData);
      if (rolesData.length > 0 && !expandedRole) {
        setExpandedRole(rolesData[0].role.id);
      }
    } catch (err) {
      console.error('Failed to load roles:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePermission = async (roleId: string, permissionKey: string, currentValue: boolean) => {
    // Don't allow editing Super Admin
    const role = roles.find(r => r.role.id === roleId);
    if (role?.role.name === 'Super Admin') return;

    setSaving(roleId);
    try {
      await permissionService.updateRolePermission(roleId, permissionKey, !currentValue);
      setRoles(prev =>
        prev.map(r =>
          r.role.id === roleId
            ? { ...r, permissions: { ...r.permissions, [permissionKey]: !currentValue } }
            : r
        )
      );
    } catch (err) {
      console.error('Failed to update permission:', err);
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
        <span className="ml-2 text-sm text-[hsl(var(--foreground-muted))]">Loading roles...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Role Management</h2>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Define what each role can do. Changes apply globally.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => { setActiveTab('customer'); setExpandedRole(null); }}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'customer'
              ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]'
              : 'border-transparent text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))]'
          }`}
        >
          <Users className="h-4 w-4" />
          Customer Roles
        </button>
        <button
          onClick={() => { setActiveTab('admin'); setExpandedRole(null); }}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'admin'
              ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]'
              : 'border-transparent text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))]'
          }`}
        >
          <Shield className="h-4 w-4" />
          Internal Roles
        </button>
      </div>

      {/* Role list */}
      <div className="space-y-3">
        {/* Add new role button */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-[hsl(var(--foreground-muted))]">
            {roles.length} role{roles.length !== 1 ? 's' : ''}
          </span>
          {!showAddRole ? (
            <button
              onClick={() => setShowAddRole(true)}
              className="text-xs font-medium text-[hsl(var(--primary))] hover:underline"
            >
              + Add Role
            </button>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newRoleName.trim()) return;
                await permissionService.createRole({ name: newRoleName.trim(), description: newRoleDesc, scope: activeTab });
                setNewRoleName('');
                setNewRoleDesc('');
                setShowAddRole(false);
                loadData();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={newRoleName}
                onChange={e => setNewRoleName(e.target.value)}
                placeholder="Role name"
                className="rounded-[var(--radius-md)] border border-border bg-background px-2 py-1 text-xs outline-none focus:border-[hsl(var(--primary))] w-28"
                autoFocus
              />
              <input
                type="text"
                value={newRoleDesc}
                onChange={e => setNewRoleDesc(e.target.value)}
                placeholder="Description (optional)"
                className="rounded-[var(--radius-md)] border border-border bg-background px-2 py-1 text-xs outline-none focus:border-[hsl(var(--primary))] w-40"
              />
              <button type="submit" className="text-xs font-medium text-[hsl(var(--primary))] hover:underline">Save</button>
              <button type="button" onClick={() => setShowAddRole(false)} className="text-xs text-[hsl(var(--foreground-muted))] hover:underline">Cancel</button>
            </form>
          )}
        </div>

        {roles.map(({ role, permissions }) => {
          const isExpanded = expandedRole === role.id;
          const isSuperAdmin = role.name === 'Super Admin';
          const grantedCount = Object.values(permissions).filter(Boolean).length;
          const totalCount = Object.keys(permissions).length;

          return (
            <div key={role.id} className="rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
              {/* Role header */}
              <button
                onClick={() => setExpandedRole(isExpanded ? null : role.id)}
                className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-[hsl(var(--background-muted))] transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-[hsl(var(--foreground-muted))]" /> : <ChevronRight className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[hsl(var(--foreground))]">{role.name}</span>
                      {role.isSystem && (
                        <span className="rounded-full bg-[hsl(var(--background-muted))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--foreground-muted))]">
                          System
                        </span>
                      )}
                      {isSuperAdmin && (
                        <span className="rounded-full bg-[hsl(var(--primary)_/_0.1)] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--primary))]">
                          Locked
                        </span>
                      )}
                    </div>
                    {role.description && (
                      <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">{role.description}</p>
                    )}
                  </div>
                </div>
                <span className="text-xs text-[hsl(var(--foreground-muted))]">
                  {grantedCount}/{totalCount} permissions
                </span>
                {!role.isSystem && (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (confirm(`Delete role "${role.name}"?`)) {
                        await permissionService.deleteRole(role.id);
                        loadData();
                      }
                    }}
                    className="ml-2 text-xs text-red-500 hover:text-red-700 hover:underline"
                  >
                    Delete
                  </button>
                )}
              </button>

              {/* Permission matrix */}
              {isExpanded && (
                <div className="border-t border-border px-5 py-4 space-y-4">
                  {isSuperAdmin && (
                    <p className="text-xs text-[hsl(var(--foreground-muted))] italic">
                      Super Admin has all permissions and cannot be modified.
                    </p>
                  )}

                  {categories.map(category => (
                    <div key={category.category}>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-muted))] mb-2">
                        {category.category}
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {category.permissions.map(perm => {
                          const isGranted = permissions[perm.key] ?? false;
                          return (
                            <label
                              key={perm.key}
                              className={`flex items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2 text-sm transition-colors ${
                                isSuperAdmin ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-[hsl(var(--background-muted))]'
                              }`}
                            >
                              <div
                                className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                                  isGranted
                                    ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]'
                                    : 'border-border bg-background'
                                }`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (!isSuperAdmin) handleTogglePermission(role.id, perm.key, isGranted);
                                }}
                              >
                                {isGranted && <Check className="h-3 w-3 text-white" />}
                              </div>
                              <span className="text-[hsl(var(--foreground))]">{perm.label}</span>
                              {saving === role.id && (
                                <Loader2 className="h-3 w-3 animate-spin text-[hsl(var(--foreground-muted))] ml-auto" />
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
