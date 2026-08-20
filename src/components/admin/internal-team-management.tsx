'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { permissionService } from '@/services/permission.service';
import type { InternalTeamMember, Role } from '@/types';

/**
 * Internal Team Members management.
 * Shows in Admin Settings — allows adding/removing internal staff and assigning roles.
 */
export function InternalTeamManagement() {
  const [team, setTeam] = useState<InternalTeamMember[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ email: '', firstName: '', lastName: '', roleId: '' });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [teamData, rolesData] = await Promise.all([
        permissionService.getInternalTeam(),
        permissionService.getRolesByScope('admin'),
      ]);
      setTeam(teamData);
      setRoles(rolesData);
      if (rolesData.length > 0 && !addForm.roleId) {
        setAddForm(prev => ({ ...prev, roleId: rolesData[0].id }));
      }
    } catch (err) {
      console.error('Failed to load internal team:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.email.trim() || !addForm.firstName.trim() || !addForm.roleId) return;

    setAdding(true);
    try {
      await permissionService.addInternalTeamMember({
        email: addForm.email.trim(),
        firstName: addForm.firstName.trim(),
        lastName: addForm.lastName.trim(),
        roleId: addForm.roleId,
      });
      setAddForm({ email: '', firstName: '', lastName: '', roleId: roles[0]?.id || '' });
      setShowAddForm(false);
      loadData();
    } catch (err) {
      console.error('Failed to add team member:', err);
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (memberId: string) => {
    if (!confirm('Remove this team member?')) return;
    await permissionService.removeInternalTeamMember(memberId);
    loadData();
  };

  const getRoleName = (roleId: string): string => {
    return roles.find(r => r.id === roleId)?.name || 'Unknown';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--primary))]" />
        <span className="ml-2 text-sm text-[hsl(var(--foreground-muted))]">Loading team...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-[hsl(var(--primary))]" />
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Internal Team</h2>
        </div>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Add Member
          </button>
        )}
      </div>

      {/* Add form */}
      {showAddForm && (
        <form onSubmit={handleAdd} className="rounded-[var(--radius-lg)] border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-medium text-[hsl(var(--foreground))]">Add Internal Team Member</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">First name *</label>
              <input
                type="text"
                required
                value={addForm.firstName}
                onChange={e => setAddForm(prev => ({ ...prev, firstName: e.target.value }))}
                className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]"
                placeholder="Jane"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Last name</label>
              <input
                type="text"
                value={addForm.lastName}
                onChange={e => setAddForm(prev => ({ ...prev, lastName: e.target.value }))}
                className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]"
                placeholder="Smith"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Email *</label>
            <input
              type="email"
              required
              value={addForm.email}
              onChange={e => setAddForm(prev => ({ ...prev, email: e.target.value }))}
              className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]"
              placeholder="jane@samplanai.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Role *</label>
            <select
              value={addForm.roleId}
              onChange={e => setAddForm(prev => ({ ...prev, roleId: e.target.value }))}
              className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]"
            >
              {roles.map(role => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] border border-border hover:bg-[hsl(var(--background-muted))]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={adding}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50"
            >
              {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Add
            </button>
          </div>
        </form>
      )}

      {/* Team list */}
      {team.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border bg-card p-8 text-center">
          <Users className="h-8 w-8 mx-auto text-[hsl(var(--foreground-muted))]" />
          <p className="mt-2 text-sm text-[hsl(var(--foreground-muted))]">No internal team members yet.</p>
          <p className="text-xs text-[hsl(var(--foreground-muted))]">Add your first team member above.</p>
        </div>
      ) : (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-[hsl(var(--background-muted))]">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[hsl(var(--foreground-muted))]">Name</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[hsl(var(--foreground-muted))]">Email</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[hsl(var(--foreground-muted))]">Role</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[hsl(var(--foreground-muted))]">Status</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-[hsl(var(--foreground-muted))]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {team.map(member => (
                <tr key={member.id} className="border-b border-border last:border-0 hover:bg-[hsl(var(--background-muted)_/_0.5)]">
                  <td className="px-4 py-3">
                    <span className="font-medium text-[hsl(var(--foreground))]">
                      {member.firstName} {member.lastName}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[hsl(var(--foreground-muted))]">{member.email}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-[hsl(var(--primary)_/_0.1)] px-2 py-0.5 text-xs font-medium text-[hsl(var(--primary))]">
                      {getRoleName(member.roleId)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      member.isActive
                        ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                    }`}>
                      {member.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleRemove(member.id)}
                      className="p-1.5 rounded hover:bg-red-50 text-[hsl(var(--foreground-muted))] hover:text-red-600 transition-colors"
                      title="Remove member"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
