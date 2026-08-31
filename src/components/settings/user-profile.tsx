'use client';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from 'next-themes';

import { useState, useEffect } from 'react';
import { Save, CheckCircle } from 'lucide-react';
import { userService } from '@/services/user.service';
import type { User } from '@/types';

const STORAGE_KEY = 'sam-flow-user-profile';

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
  const [formData, setFormData] = useState<ProfileFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSuccess, setShowSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
    </div>
  );
}
