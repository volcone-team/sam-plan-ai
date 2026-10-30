'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Open or close new customer registration.
 * GET/PUT /api/admin/registration-toggle (super admin only). Saves immediately.
 */
type State = { open: boolean; available: boolean };

export function RegistrationToggle() {
  const labelId = useId();
  const helpId = useId();
  const [state, setState] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/registration-toggle', { cache: 'no-store' });
      const body = (await res.json().catch(() => null)) as (Partial<State> & { error?: string }) | null;
      if (!res.ok || !body) {
        setError(body?.error ?? `Could not load the switch (${res.status}).`);
        return;
      }
      setState({ open: body.open !== false, available: body.available !== false });
      setError(null);
    } catch {
      setError('Could not reach the server.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (open: boolean) => {
    if (!open && !window.confirm('Close new registrations? New customers will not be able to sign up until you turn this back on.')) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/registration-toggle', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ open }),
      });
      const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!res.ok) setError(body?.message ?? body?.error ?? `Could not save (${res.status}).`);
      await load();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  const checked = state?.open !== false;
  const disabled = state === null || !state.available || saving;

  return (
    <div className="mb-6">
      <div className="mb-4 flex items-center gap-2">
        <UserPlus className="h-5 w-5 text-[hsl(var(--primary))]" />
        <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">New Registrations</h2>
      </div>
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p id={labelId} className="text-sm font-medium text-[hsl(var(--foreground))]">
              Allow new customers to register
              {state && (
                <span
                  className={cn(
                    'ml-2 rounded-full px-2 py-0.5 text-xs font-medium',
                    checked
                      ? 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300'
                      : 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300'
                  )}
                >
                  {checked ? 'Open' : 'Closed'}
                </span>
              )}
            </p>
            <p id={helpId} className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
              Off: the signup form and plan selection show a &quot;not accepting new registrations&quot;
              message and no new customer account can be created. Existing customers, team invites and
              accounts you create in admin are not affected.
            </p>
            {state && !state.available && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                Migration 062 has not been applied yet, so registration stays open and this switch cannot be changed.
              </p>
            )}
            {error && (
              <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-labelledby={labelId}
            aria-describedby={helpId}
            disabled={disabled}
            onClick={() => void save(!checked)}
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              checked
                ? 'bg-[hsl(var(--primary))]'
                : 'border border-[hsl(var(--border))] bg-[hsl(var(--background-muted))]'
            )}
          >
            <span
              className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform',
                checked ? 'translate-x-6' : 'translate-x-1'
              )}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
