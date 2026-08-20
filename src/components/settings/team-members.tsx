'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { permissionService } from '@/services/permission.service';
import type { Role } from '@/types';

interface TeamMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
  isActive: boolean;
  addedAt: string;
}

const STORAGE_KEY = 'sam-customer-team-members';

function loadTeamMembers(): TeamMember[] {
  if (typeof window === 'undefined') return [];
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

function saveTeamMembers(members: TeamMember[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(members));
}

/**
 * Customer-side Team Members management.
 * The company Owner can invite team members and assign customer roles.
 */
export function TeamMembers() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', firstName: '', lastName: '', roleId: '' });
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const customerRoles = await permissionService.getRolesByScope('customer');
        setRoles(customerRoles);
        setMembers(loadTeamMembers());
        if (customerRoles.length > 0) {
          setInviteForm(prev => ({ ...prev, roleId: customerRoles.find(r => r.isDefault)?.id || customerRoles[0].id }));
        }
      } catch (err) {
        console.error('Failed to load team data:', err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteForm.email.trim() || !inviteForm.firstName.trim()) return;

    setInviting(true);
    const newMember: TeamMember = {
      id: `member-${Date.now()}`,
      email: inviteForm.email.trim(),
      firstName: inviteForm.firstName.trim(),
      lastName: inviteForm.lastName.trim(),
      roleId: inviteForm.roleId,
      isActive: true,
      addedAt: new Date().toISOString(),
    };

    const updated = [...members, newMember];
    setMembers(updated);
    saveTeamMembers(updated);
    setInviteForm({ email: '', firstName: '', lastName: '', roleId: roles.find(r => r.isDefault)?.id || roles[0]?.id || '' });
    setShowInvite(false);
    setInviting(false);
  };

  const handleRemove = (memberId: string) => {
    if (!confirm('Remove this team member? They will lose access to the dashboard.')) return;
    const updated = members.filter(m => m.id !== memberId);
    setMembers(updated);
    saveTeamMembers(updated);
  };

  const handleRoleChange = (memberId: string, newRoleId: string) => {
    const updated = members.map(m => m.id === memberId ? { ...m, roleId: newRoleId } : m);
    setMembers(updated);
    saveTeamMembers(updated);
  };

  const getRoleName = (roleId: string) => roles.find(r => r.id === roleId)?.name || 'Unknown';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--primary))]" />
        <span className="ml-2 text-sm text-[hsl(var(--foreground-muted))]">Loading team...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-[hsl(var(--foreground))]">Team Members</h3>
          <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">
            Invite team members and assign roles. Roles determine what they can see and do.
          </p>
        </div>
        {!showInvite && (
          <button
            onClick={() => setShowInvite(true)}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-2 text-xs font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Invite Member
          </button>
        )}
      </div>

      {/* Invite form */}
      {showInvite && (
        <form onSubmit={handleInvite} className="rounded-[var(--radius-lg)] border border-border bg-[hsl(var(--background-muted))] p-4 space-y-3">
          <h4 className="text-sm font-medium text-[hsl(var(--foreground))]">Invite a team member</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">First name *</label>
              <input
                type="text"
                required
                value={inviteForm.firstName}
                onChange={e => setInviteForm(prev => ({ ...prev, firstName: e.target.value }))}
                className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]"
                placeholder="Marcus"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Last name</label>
              <input
                type="text"
                value={inviteForm.lastName}
                onChange={e => setInviteForm(prev => ({ ...prev, lastName: e.target.value }))}
                className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]"
                placeholder="Chen"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Email *</label>
            <input
              type="email"
              required
              value={inviteForm.email}
              onChange={e => setInviteForm(prev => ({ ...prev, email: e.target.value }))}
              className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]"
              placeholder="marcus@company.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Role</label>
            <select
              value={inviteForm.roleId}
              onChange={e => setInviteForm(prev => ({ ...prev, roleId: e.target.value }))}
              className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]"
            >
              {roles.filter(r => r.name !== 'Owner').map(role => (
                <option key={role.id} value={role.id}>
                  {role.name} — {role.description}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowInvite(false)}
              className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] border border-border hover:bg-[hsl(var(--background-muted))]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={inviting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50"
            >
              {inviting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Send Invite
            </button>
          </div>
        </form>
      )}

      {/* Team list */}
      {members.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-8 text-center">
          <Users className="h-8 w-8 mx-auto text-[hsl(var(--foreground-muted))]" />
          <p className="mt-2 text-sm font-medium text-[hsl(var(--foreground))]">No team members yet</p>
          <p className="text-xs text-[hsl(var(--foreground-muted))]">
            Invite your team to collaborate on your revenue plan.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {members.map(member => (
            <div key={member.id} className="flex items-center justify-between rounded-[var(--radius-md)] border border-border px-4 py-3 hover:bg-[hsl(var(--background-muted)_/_0.5)] transition-colors">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--primary)_/_0.1)] text-xs font-bold text-[hsl(var(--primary))]">
                  {member.firstName[0]}{member.lastName?.[0] || ''}
                </div>
                <div>
                  <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                    {member.firstName} {member.lastName}
                  </p>
                  <p className="text-xs text-[hsl(var(--foreground-muted))]">{member.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={member.roleId}
                  onChange={e => handleRoleChange(member.id, e.target.value)}
                  className="rounded-[var(--radius-md)] border border-border bg-background px-2 py-1 text-xs outline-none focus:border-[hsl(var(--primary))]"
                >
                  {roles.filter(r => r.name !== 'Owner').map(role => (
                    <option key={role.id} value={role.id}>{role.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => handleRemove(member.id)}
                  className="p-1.5 rounded hover:bg-red-50 text-[hsl(var(--foreground-muted))] hover:text-red-600 transition-colors"
                  title="Remove member"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
