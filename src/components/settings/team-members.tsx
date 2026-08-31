'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, UserPlus, Shield, Eye, Crown, Loader2, Copy, Check } from 'lucide-react';
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
}

const ROLE_CONFIG = {
  owner: { label: 'Owner', icon: Crown, color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  operator: { label: 'Operator', icon: Shield, color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  team_member: { label: 'Team Member', icon: Shield, color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  viewer: { label: 'Viewer', icon: Eye, color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
};

function generatePassword(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let pw = '';
  for (let i = 0; i < 10; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

export function TeamMembers() {
  const { userId, role: authRole } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  // Add form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(generatePassword());
  const [role, setRole] = useState<'operator' | 'team_member' | 'viewer'>('operator');
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);
  const [copiedPassword, setCopiedPassword] = useState(false);

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
    setAddLoading(true);

    try {
      const res = await fetch('/api/team/create-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email, password, role }),
      });

      const data = await res.json();

      if (!res.ok) {
        setAddError(data.error || 'Failed to add member');
        return;
      }

      // Add to list
      setMembers((prev) => [...prev, {
        id: data.member.id,
        email: data.member.email,
        firstName: data.member.firstName,
        lastName: data.member.lastName,
        role: data.member.role,
        isActive: true,
        createdAt: new Date().toISOString(),
      }]);

      setAddSuccess(`${firstName} has been added. Share their credentials: ${email} / ${password}`);
      setFirstName('');
      setLastName('');
      setEmail('');
      setPassword(generatePassword());
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

  const handleCopyPassword = () => {
    navigator.clipboard.writeText(password);
    setCopiedPassword(true);
    setTimeout(() => setCopiedPassword(false), 2000);
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
            onClick={() => { setShowAddForm(!showAddForm); setAddError(null); setAddSuccess(null); }}
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
              <label className="mb-1 block text-xs font-medium">Password</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="flex-1 rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                />
                <button
                  type="button"
                  onClick={handleCopyPassword}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 py-2 text-xs font-medium hover:bg-[hsl(var(--background-muted))] transition-colors"
                >
                  {copiedPassword ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedPassword ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  onClick={() => setPassword(generatePassword())}
                  className="inline-flex items-center rounded-[var(--radius-md)] border border-border px-3 py-2 text-xs font-medium hover:bg-[hsl(var(--background-muted))] transition-colors"
                >
                  Generate
                </button>
              </div>
              <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
                Share this password with the team member directly. No email will be sent.
              </p>
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
