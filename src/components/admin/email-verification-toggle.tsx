'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Whether new customers must click a confirmation email before paying.
 * GET/PUT /api/admin/email-verification-toggle (super admin only).
 * Rendered as a row inside the Billing controls card, under the trial.
 */
type State = { required: boolean; available: boolean };

export function EmailVerificationToggle() {
  const labelId = useId();
  const helpId = useId();
  const [state, setState] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/email-verification-toggle', { cache: 'no-store' });
      const body = (await res.json().catch(() => null)) as (Partial<State> & { error?: string }) | null;
      if (!res.ok || !body) {
        setError(body?.error ?? `Could not load the switch (${res.status}).`);
        return;
      }
      setState({ required: body.required === true, available: body.available !== false });
      setError(null);
    } catch {
      setError('Could not reach the server.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (required: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/email-verification-toggle', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ required }),
      });
      const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!res.ok) {
        setError(body?.message ?? body?.error ?? `Could not save (${res.status}).`);
      }
      await load();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  const checked = state?.required === true;
  const disabled = state === null || !state.available || saving;

  return (
    <div className="border-t border-border pt-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p id={labelId} className="text-sm font-medium">
            Require email verification at signup
          </p>
          <p id={helpId} className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
            Off: new customers go straight from the signup form to payment, with no confirmation
            email. On: they must click the confirmation email before paying (the current flow).
          </p>
          {state && !state.available && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              Migration 049 has not been applied yet, so this switch is off and cannot be changed.
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
  );
}
