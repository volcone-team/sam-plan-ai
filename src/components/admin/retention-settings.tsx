'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, Loader2, Save, CheckCircle2, TriangleAlert, Info } from 'lucide-react';
import { LoadingPanel } from '@/components/ui/spinner';

/**
 * Retention controls for the cancellation flow.
 *
 * Just the two booking links today. They live here rather than in an env var
 * because a booking link changes when a calendar moves or a coach does, and the
 * person who owns the calendar should not need a deploy to change it.
 *
 * The panel states which SCREENS each URL enables, because that is the part
 * that is not obvious: leaving the strategy field blank does not disable that
 * screen, it makes it reuse the reset-call link.
 */

interface RetentionSettings {
  resetCallUrl: string | null;
  strategyCallUrl: string | null;
  screens: {
    resetCallEnabled: boolean;
    strategyCallEnabled: boolean;
    strategyUsesResetUrl: boolean;
  };
}

export function RetentionSettings() {
  const [data, setData] = useState<RetentionSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [resetUrl, setResetUrl] = useState('');
  const [strategyUrl, setStrategyUrl] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/retention-settings', { credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          body?.error === 'settings_unavailable'
            ? 'Could not read retention settings. Has migration 033 been applied?'
            : body?.message || body?.error || 'Could not load retention settings.'
        );
        return;
      }
      const settings = body as RetentionSettings;
      setData(settings);
      setResetUrl(settings.resetCallUrl ?? '');
      setStrategyUrl(settings.strategyCallUrl ?? '');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/admin/retention-settings', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        // Empty string clears, which is how a screen gets switched off again.
        body: JSON.stringify({
          resetCallUrl: resetUrl.trim() || null,
          strategyCallUrl: strategyUrl.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(body?.message || `Could not save: ${body?.error ?? 'unknown error'}`);
        return;
      }

      setSaved(true);
      // Reload so the "which screens are live" summary reflects what was saved
      // rather than what was typed.
      await load();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingPanel />;

  const dirty =
    (data?.resetCallUrl ?? '') !== resetUrl.trim() ||
    (data?.strategyCallUrl ?? '') !== strategyUrl.trim();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <CalendarCheck className="h-5 w-5 text-[hsl(var(--primary))]" />
        <h2 className="text-lg font-semibold">Cancellation flow</h2>
      </div>

      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <h3 className="text-sm font-semibold">Coaching call booking links</h3>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          When a customer starts to cancel, two of the reasons can offer them a
          call instead. Each screen is hidden until a link is set here, so a
          customer never sees a booking button that goes nowhere. Any
          https:// link works — Calendly, GoHighLevel, or anything else.
        </p>

        {error && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {saved && !error && (
          <div className="mt-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--primary)_/_0.3)] bg-[hsl(var(--primary)_/_0.06)] px-3 py-2.5 text-sm text-[hsl(var(--primary))]">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Saved.
          </div>
        )}

        <div className="mt-5 space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="reset-call-url" className="text-sm font-medium">
              Plan reset call
            </label>
            <p className="text-xs text-[hsl(var(--foreground-muted))]">
              Offered to customers who say they fell behind and stopped.
            </p>
            <input
              id="reset-call-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={resetUrl}
              onChange={(e) => setResetUrl(e.target.value)}
              placeholder="https://calendly.com/your-team/plan-reset"
              className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
            />
            <StatusLine enabled={data?.screens.resetCallEnabled ?? false} />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="strategy-call-url" className="text-sm font-medium">
              Strategy call
            </label>
            <p className="text-xs text-[hsl(var(--foreground-muted))]">
              Offered to customers who say they are not seeing results yet.
            </p>
            <input
              id="strategy-call-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={strategyUrl}
              onChange={(e) => setStrategyUrl(e.target.value)}
              placeholder="https://calendly.com/your-team/strategy"
              className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
            />
            <StatusLine enabled={data?.screens.strategyCallEnabled ?? false} />
          </div>

          {/*
            The non-obvious bit. One calendar is the common case, so leaving
            this blank reuses the reset link rather than switching the screen
            off — stated explicitly because the fields alone do not show it.
          */}
          {data?.screens.strategyUsesResetUrl && (
            <div className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--background-muted))] px-3 py-2.5 text-xs leading-relaxed text-[hsl(var(--foreground-muted))]">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                The strategy call is using the plan reset link, because it has
                none of its own. Set one above to send those customers to a
                different calendar.
              </span>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save booking links
          </button>
          {!dirty && !saving && (
            <span className="text-xs text-[hsl(var(--foreground-muted))]">
              No unsaved changes
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Whether the screen this URL controls is currently shown to customers. */
function StatusLine({ enabled }: { enabled: boolean }) {
  return (
    <p
      className={
        enabled
          ? 'text-xs font-medium text-[hsl(var(--primary))]'
          : 'text-xs text-[hsl(var(--foreground-muted))]'
      }
    >
      {enabled
        ? 'This screen is live in the cancellation flow.'
        : 'This screen is hidden — customers go straight to the cancel confirmation.'}
    </p>
  );
}
