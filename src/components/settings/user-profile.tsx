'use client';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';

import { useState, useEffect } from 'react';
import { Save, CheckCircle, Trash2, AlertTriangle, Lock, Loader2, Eye, EyeOff } from 'lucide-react';
import { userService } from '@/services/user.service';
import { createClient } from '@/lib/supabase/client';
import { cacheClearAll } from '@/lib/client-cache';
import { DeleteAccountModal } from './delete-account-modal';

interface ProfileFormData {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  theme: 'system' | 'light' | 'dark';
}

export function UserProfile() {
  const { userId, firstName, lastName, email, role: authRole, loading: authLoading } = useAuth();
  const { theme: currentTheme, setTheme } = useTheme();
  const router = useRouter();
  const [formData, setFormData] = useState<ProfileFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSuccess, setShowSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Which delete flow the modal is showing, or null when closed. */
  const [deleteMode, setDeleteMode] = useState<'account' | 'company' | null>(null);

  // --- Security / Change Password state (kept separate from profile-save state) ---
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  useEffect(() => {
    if (authLoading) return;

    async function loadUser() {
      // Theme's source of truth is next-themes (falls back to 'system').
      const theme = (currentTheme as ProfileFormData['theme']) || 'system';

      // Role comes from the shared auth context (reads profiles.role once).
      // Do NOT default to Owner — that misrepresented viewers/operators.
      const resolvedRole = authRole || 'viewer';
      setFormData({
        firstName: firstName || '',
        lastName: lastName || '',
        email: email || '',
        role: resolvedRole,
        theme,
      });
      setLoading(false);
    }

    loadUser();
  }, [authLoading, userId, firstName, lastName, email, authRole, currentTheme]);

  const handleSave = async () => {
    if (!formData) return;
    setSaveError(null);

    // Theme is applied live via next-themes (which persists it itself).
    if (userId) {
      try {
        await userService.updateUser(userId, {
          firstName: formData.firstName,
          lastName: formData.lastName,
        });
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Could not save your profile.');
        return;
      }
    }

    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3000);
  };

  const handleChange = (field: keyof ProfileFormData, value: string) => {
    if (!formData) return;
    setFormData({ ...formData, [field]: value });
  };

  // Both account and company deletion end the current user's session, so wipe
  // client cache, sign out, and send them to the landing page.
  const handleDeleted = async () => {
    setDeleteMode(null);
    cacheClearAll();
    try {
      await createClient().auth.signOut();
    } catch {
      // Even if sign-out fails, the account/company is already gone server-side.
    }
    router.push('/');
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(false);

    // Client-side validation before hitting the API.
    if (newPassword !== confirmPassword) {
      setPwError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setPwError('Password must be at least 8 characters.');
      return;
    }

    setPwSubmitting(true);
    try {
      const res = await fetch('/api/me/password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setPwError(data.message || data.error || 'Could not update password.');
        return;
      }

      // Success: clear fields and show confirmation.
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwSuccess(true);
      setTimeout(() => setPwSuccess(false), 3000);
    } catch {
      setPwError('Could not update password.');
    } finally {
      setPwSubmitting(false);
    }
  };

  const getInitials = (): string => {
    if (!formData) return '';
    return `${formData.firstName.charAt(0)}${formData.lastName.charAt(0)}`.toUpperCase();
  };

  if (loading || !formData) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {saveError && (
        <div role="alert" className="rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {saveError}
        </div>
      )}

      {/* Success Toast */}
      {showSuccess && (
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          <CheckCircle className="h-4 w-4" />
          Profile saved successfully.
        </div>
      )}

      {/* Avatar */}
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-lg font-bold text-[hsl(var(--primary-foreground))]">
          {getInitials()}
        </div>
        <div>
          <p className="font-medium">{formData.firstName} {formData.lastName}</p>
          <p className="text-sm text-[hsl(var(--foreground-muted))]">{formData.email}</p>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {/* First Name */}
        <div className="space-y-2">
          <label className="text-sm font-medium">First Name</label>
          <input
            type="text"
            value={formData.firstName}
            onChange={e => handleChange('firstName', e.target.value)}
            className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
          />
        </div>

        {/* Last Name */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Last Name</label>
          <input
            type="text"
            value={formData.lastName}
            onChange={e => handleChange('lastName', e.target.value)}
            className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
          />
        </div>

        {/* Email */}
        <div className="space-y-2 sm:col-span-2">
          <label className="text-sm font-medium">Email</label>
          <input
            type="email"
            value={formData.email}
            onChange={e => handleChange('email', e.target.value)}
            className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
          />
        </div>

        {/* Access Role (set by company owner, not editable here) */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Access Role</label>
          <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] px-3 py-2 text-sm">
            <span className="capitalize font-medium">{formData.role.replace('_', ' ')}</span>
            <span className="text-xs text-[hsl(var(--foreground-muted))]">
              {formData.role === 'owner' && '— Full access + team management'}
              {formData.role === 'operator' && '— Can edit plans, initiatives, and tasks'}
              {formData.role === 'team_member' && '— Can complete tasks and log results'}
              {formData.role === 'viewer' && '— Read-only access'}
            </span>
          </div>
          {formData.role !== 'owner' && (
            <p className="text-xs text-[hsl(var(--foreground-muted))]">
              Contact your company owner to change your access role.
            </p>
          )}
        </div>
      </div>

      {/* Theme Preference */}
      <div className="space-y-3">
        <label className="text-sm font-medium">Theme Preference</label>
        <div className="flex gap-4">
          {(['system', 'light', 'dark'] as const).map(theme => (
            <label key={theme} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="theme"
                value={theme}
                checked={formData.theme === theme}
                onChange={e => {
                  const next = e.target.value as ProfileFormData['theme'];
                  console.log('[UserProfile] Theme changed to:', next);
                  handleChange('theme', next);
                  setTheme(next); // apply immediately via next-themes
                }}
                className="h-4 w-4 accent-[hsl(var(--primary))]"
              />
              <span className="text-sm capitalize">{theme}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end border-t border-border pt-6">
        <button
          onClick={handleSave}
          className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
        >
          <Save className="h-4 w-4" />
          Save Profile
        </button>
      </div>

      {/* Security — change password. */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <Lock className="h-5 w-5 text-[hsl(var(--primary))]" />
          <h3 className="text-base font-semibold">Security</h3>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <p className="text-sm font-medium">Change Password</p>
            <p className="text-xs text-[hsl(var(--foreground-muted))]">
              Enter your current password, then choose a new one.
            </p>
          </div>

          {pwError && (
            <div role="alert" className="rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {pwError}
            </div>
          )}

          {pwSuccess && (
            <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
              <CheckCircle className="h-4 w-4" />
              Password updated successfully.
            </div>
          )}

          <form onSubmit={handlePasswordUpdate} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="currentPassword" className="text-sm font-medium">
                Current password
              </label>
              <div className="relative">
                <input
                  id="currentPassword"
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 pr-10 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
                  placeholder="Enter current password"
                />
                <button
                  type="button"
                  onClick={() => setShowPasswords(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--foreground-muted))] hover:text-foreground"
                  aria-label={showPasswords ? 'Hide passwords' : 'Show passwords'}
                >
                  {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="newPassword" className="text-sm font-medium">
                  New password
                </label>
                <input
                  id="newPassword"
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
                  placeholder="Min 8 characters"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="confirmPassword" className="text-sm font-medium">
                  Confirm new password
                </label>
                <input
                  id="confirmPassword"
                  type={showPasswords ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
                  placeholder="Re-enter new password"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={pwSubmitting}
                className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {pwSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4" />
                    Update Password
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Danger Zone — destructive, irreversible actions. */}
      <div className="rounded-[var(--radius-lg)] border border-red-200 bg-card p-5 dark:border-red-900/60">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <h3 className="text-base font-semibold text-red-600 dark:text-red-400">Danger Zone</h3>
        </div>

        <div className="mt-4 space-y-4">
          {/* Delete account — always available. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Delete Account</p>
              <p className="text-xs text-[hsl(var(--foreground-muted))]">
                Permanently delete your account. This cannot be undone.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDeleteMode('account')}
              className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              <Trash2 className="h-4 w-4" />
              Delete Account
            </button>
          </div>

          {/* Delete company — owners only. */}
          {authRole === 'owner' && (
            <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Delete Company &amp; All Data</p>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">
                  Removes the entire company and every member, along with all plans and data.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteMode('company')}
                className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                <Trash2 className="h-4 w-4" />
                Delete Company &amp; All Data
              </button>
            </div>
          )}
        </div>
      </div>

      <DeleteAccountModal
        open={deleteMode !== null}
        mode={deleteMode ?? 'account'}
        onClose={() => setDeleteMode(null)}
        userEmail={email || formData.email}
        onConfirmed={handleDeleted}
      />
    </div>
  );
}
