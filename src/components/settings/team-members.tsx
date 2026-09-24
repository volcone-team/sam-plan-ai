'use client';

import { useState, useEffect } from 'react';
import { Trash2, UserPlus, Shield, Eye, Crown, Loader2, Mail, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';

interface TeamMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  pending?: boolean;
  lastSignInAt?: string | null;
}

const ROLE_CONFIG = {
  owner: { label: 'Owner', icon: Crown, color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  operator: { label: 'Operator', icon: Shield, color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  team_member: { label: 'Team Member', icon: Shield, color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  viewer: { label: 'Viewer', icon: Eye, color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
};

export function TeamMembers() {
  const { userId, role: authRole } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  // Resend invite state
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resentId, setResentId] = useState<string | null>(null);

  // Edit member state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editRole, setEditRole] = useState<'operator' | 'team_member' | 'viewer'>('operator');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Add form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'operator' | 'team_member' | 'viewer'>('operator');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);
  const [addWarning, setAddWarning] = useState<string | null>(null);

  // Fetch members
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/team');
        if (res.ok) {
          const data = await res.json();
          setMembers(data.members || []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    setAddSuccess(null);
    setAddWarning(null);
    setAddLoading(true);

    try {
      const res = await fetch('/api/team/create-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email, role }),
      });

      const data = await res.json();

      if (!res.ok) {
        setAddError(data.error || 'Failed to add member');
        return;
      }

      // Add to list — new members are pending until they sign in
      setMembers((prev) => [...prev, {
        id: data.member.id,
        email: data.member.email,
        firstName: data.member.firstName,
        lastName: data.member.lastName,
        role: data.member.role,
        isActive: true,
        createdAt: new Date().toISOString(),
        pending: true,
        lastSignInAt: null,
      }]);

      if (data.invited) {
        setAddSuccess(`${firstName} has been added — an invite email was sent to ${email}.`);
      } else {
        setAddWarning(`${firstName} was added, but the invite email couldn\u2019t be sent. Use \u201CResend invite\u201D next to their name to try again.`);
      }

      setFirstName('');
      setLastName('');
      setEmail('');
      setRole('operator');
    } catch {
      setAddError('Something went wrong. Please try again.');
    } finally {
      setAddLoading(false);
    }
  };

  const handleRemove = async (memberId: string) => {
    setRemovingId(memberId);
    try {
      const res = await fetch(`/api/team/${memberId}`, { method: 'DELETE' });
      if (res.ok) {
        setMembers((prev) => prev.filter((m) => m.id !== memberId));
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to remove member');
      }
    } catch {
      alert('Something went wrong.');
    } finally {
      setRemovingId(null);
      setConfirmRemoveId(null);
    }
  };

  const handleResendInvite = async (memberId: string) => {
    setResendingId(memberId);
    try {
      const res = await fetch(`/api/team/${memberId}/resend-invite`, { method: 'POST' });
      if (res.ok) {
        setResentId(memberId);
        setTimeout(() => {
          setResentId((prev) => (prev === memberId ? null : prev));
        }, 2000);
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to resend invite');
      }
    } catch {
      alert('Something went wrong.');
    } finally {
      setResendingId(null);
    }
  };

  const handleStartEdit = (member: TeamMember) => {
    setEditingId(member.id);
    setEditFirstName(member.firstName || '');
    setEditLastName(member.lastName || '');
    setEditRole(
      member.role === 'team_member' || member.role === 'viewer' ? member.role : 'operator'
    );
    setEditError(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;

    if (!editFirstName.trim() || !editLastName.trim()) {
      setEditError('First and last name are required.');
      return;
    }

    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/team/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          firstName: editFirstName,
          lastName: editLastName,
          role: editRole,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setEditError(data.message || data.error || 'Could not save changes.');
        return;
      }

      setMembers((prev) =>
        prev.map((m) =>
          m.id === data.member.id
            ? {
                ...m,
                firstName: data.member.firstName,
                lastName: data.member.lastName,
                role: data.member.role,
              }
            : m
        )
      );
      setEditingId(null);
      setEditError(null);
    } catch {
      setEditError('Something went wrong.');
    } finally {
      setEditSaving(false);
    }
  };

  // Determine ownership: use auth hook role (reliable), fallback to members list
  const currentUserRole = authRole || members.find((m) => m.id === userId)?.role;
  const isOwner = currentUserRole === 'owner';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Team Members</h3>
          <p className="text-sm text-[hsl(var(--foreground-muted))]">
            {members.length} member{members.length !== 1 ? 's' : ''} in your company
          </p>
        </div>
        {isOwner && (
          <Button
            size="sm"
            onClick={() => { setShowAddForm(!showAddForm); setAddError(null); setAddSuccess(null); setAddWarning(null); }}
          >
            <UserPlus className="mr-1.5 h-4 w-4" />
            Add Member
          </Button>
        )}
      </div>

      {/* Add Member Form */}
      {showAddForm && isOwner && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-[hsl(var(--background-muted))] p-5">
          <h4 className="mb-4 text-sm font-semibold">Add New Team Member</h4>

          {addError && (
            <div className="mb-4 rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {addError}
            </div>
          )}

          {addSuccess && (
            <div className="mb-4 rounded-[var(--radius-md)] border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300">
              {addSuccess}
            </div>
          )}

          {addWarning && (
            <div className="mb-4 rounded-[var(--radius-md)] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              {addWarning}
            </div>
          )}

          <form onSubmit={handleAdd} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">First Name</label>
                <input
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Last Name</label>
                <input
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                placeholder="team@company.com"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'operator' | 'team_member' | 'viewer')}
                className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              >
                <option value="operator">Operator — Full edit access to plans, initiatives, and tasks</option>
                <option value="team_member">Team Member — Can complete tasks and log results</option>
                <option value="viewer">Viewer — Read-only access to the dashboard</option>
              </select>
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" size="sm" disabled={addLoading}>
                {addLoading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Add Member
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setShowAddForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Members List */}
      <div className="divide-y divide-border rounded-[var(--radius-lg)] border border-border">
        {members.map((member) => {
          const config = ROLE_CONFIG[member.role as keyof typeof ROLE_CONFIG] || ROLE_CONFIG.viewer;
          const Icon = config.icon;
          const isConfirming = confirmRemoveId === member.id;
          const isPending = member.pending === true && member.id !== userId;
          const isEditing = editingId === member.id;
          const canEdit = isOwner && member.role !== 'owner';

          if (isEditing) {
            return (
              <div key={member.id} className="px-4 py-3">
                {editError && (
                  <div
                    role="alert"
                    className="mb-3 rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                  >
                    {editError}
                  </div>
                )}
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor={`edit-first-${member.id}`} className="mb-1 block text-xs font-medium">
                        First Name
                      </label>
                      <input
                        id={`edit-first-${member.id}`}
                        type="text"
                        value={editFirstName}
                        onChange={(e) => setEditFirstName(e.target.value)}
                        className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                      />
                    </div>
                    <div>
                      <label htmlFor={`edit-last-${member.id}`} className="mb-1 block text-xs font-medium">
                        Last Name
                      </label>
                      <input
                        id={`edit-last-${member.id}`}
                        type="text"
                        value={editLastName}
                        onChange={(e) => setEditLastName(e.target.value)}
                        className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor={`edit-role-${member.id}`} className="mb-1 block text-xs font-medium">
                      Role
                    </label>
                    <select
                      id={`edit-role-${member.id}`}
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value as 'operator' | 'team_member' | 'viewer')}
                      className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                    >
                      <option value="operator">Operator — Full edit access to plans, initiatives, and tasks</option>
                      <option value="team_member">Team Member — Can complete tasks and log results</option>
                      <option value="viewer">Viewer — Read-only access to the dashboard</option>
                    </select>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <Button type="button" size="sm" onClick={handleSaveEdit} disabled={editSaving}>
                      {editSaving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      Save
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={handleCancelEdit}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={member.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-sm font-medium text-white">
                  {(member.firstName || member.email).charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {member.firstName} {member.lastName}
                    {member.id === userId && (
                      <span className="ml-1.5 text-xs text-[hsl(var(--foreground-muted))]">(you)</span>
                    )}
                  </p>
                  <p className="text-xs text-[hsl(var(--foreground-muted))]">{member.email}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.color}`}>
                  <Icon className="h-3 w-3" />
                  {config.label}
                </span>

                {isPending && (
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                    Pending invite
                  </span>
                )}

                {isOwner && member.id !== userId && (
                  <button
                    type="button"
                    onClick={() => handleResendInvite(member.id)}
                    disabled={resendingId === member.id}
                    aria-label={`${isPending ? 'Resend invite to' : 'Send a password link to'} ${member.email}`}
                    title={isPending ? 'Resend invite email' : 'Send a set-password link'}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-2.5 py-1 text-xs font-medium hover:bg-[hsl(var(--background-muted))] transition-colors disabled:opacity-50"
                  >
                    {resendingId === member.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Mail className="h-3.5 w-3.5" />
                    )}
                    {resendingId === member.id
                      ? 'Sending...'
                      : resentId === member.id
                        ? 'Sent \u2713'
                        : isPending
                          ? 'Resend invite'
                          : 'Send password link'}
                  </button>
                )}

                {canEdit && (
                  <button
                    type="button"
                    onClick={() => handleStartEdit(member)}
                    aria-label={`Edit ${member.firstName} ${member.lastName}`}
                    className="rounded-[var(--radius-md)] p-1.5 text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background-muted))] hover:text-[hsl(var(--foreground))] transition-colors"
                    title="Edit member"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}

                {isOwner && member.id !== userId && (
                  <>
                    {isConfirming ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleRemove(member.id)}
                          disabled={removingId === member.id}
                          className="rounded-[var(--radius-md)] bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {removingId === member.id ? 'Removing...' : 'Confirm'}
                        </button>
                        <button
                          onClick={() => setConfirmRemoveId(null)}
                          className="rounded-[var(--radius-md)] border border-border px-2.5 py-1 text-xs font-medium hover:bg-[hsl(var(--background-muted))]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmRemoveId(member.id)}
                        className="rounded-[var(--radius-md)] p-1.5 text-[hsl(var(--foreground-muted))] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/20 transition-colors"
                        title="Remove member"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {members.length === 0 && (
        <div className="py-8 text-center text-sm text-[hsl(var(--foreground-muted))]">
          No team members yet. Add your first member above.
        </div>
      )}
    </div>
  );
}
