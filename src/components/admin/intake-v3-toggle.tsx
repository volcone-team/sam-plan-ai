'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * The on/off switch for the new Initiative Intake in customers' Add
 * Initiative panel. GET/PUT /api/admin/intake-v3-toggle (super admin only).
 *
 * The count is re-read on mount and after each save; edits in the config
 * editor below change it, and a reload picks those up.
 */

type State = {
  enabled: boolean;
  available: boolean;
  offeredInPicker: number | null;
};

export function IntakeV3Toggle() {
  const labelId = useId();
  const helpId = useId();
  const [state, setState] = useState<State | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/intake-v3-toggle', { cache: 'no-store' });
      const body = (await res.json().catch(() => null)) as Partial<State> & { error?: string } | null;
      if (!res.ok || !body) {
        setError(body?.error ?? `Could not load the switch (${res.status}).`);
        return;
      }
      setState({
        enabled: body.enabled === true,
        available: body.available !== false,
        offeredInPicker: typeof body.offeredInPicker === 'number' ? body.offeredInPicker : null,
      });
      setError(null);
    } catch {
      setError('Could not reach the server.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (enabled: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/intake-v3-toggle', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
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

  const checked = state?.enabled === true;
  const disabled = state === null || !state.available || saving;

  return (
    <section className="mb-6 rounded-[var(--radius-lg)] border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p id={labelId} className="text-sm font-semibold text-[hsl(var(--foreground))]">
            New initiative form for customers
          </p>
          <p id={helpId} className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
            Off: customers see the current Add Initiative form. On: customers see the new picker and form
            for every record that is switched on and valid. Super admins always see the new form to preview.
          </p>
          <p className="mt-2 text-xs font-medium text-[hsl(var(--foreground))]">
            In new picker: {state?.offeredInPicker ?? '—'}
          </p>
          {state && !state.available && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              Migration 047 has not been applied yet, so this switch is off and cannot be changed.
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
    </section>
  );
}
