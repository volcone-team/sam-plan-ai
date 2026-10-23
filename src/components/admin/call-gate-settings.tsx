'use client';

import { useCallback, useEffect, useState } from 'react';
import { PhoneCall, Loader2, Save, CheckCircle2, TriangleAlert, Info } from 'lucide-react';
import { LoadingPanel } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/**
 * The onboarding call gate (migration 043): sign up -> pay -> thank-you page
 * with a booking button -> an admin opens the portal after the call.
 *
 * Two values, on the Subscriptions page beside Retention because both are
 * "what happens to a customer at the edges of the subscription" rather than
 * platform plumbing.
 *
 * THE HELPER TEXT CARRIES THE ONE FACT THAT IS NOT VISIBLE FROM THE CONTROLS:
 * the switch is snapshotted onto each company AT CREATION, so turning it on
 * gates signups from now on and leaves every existing customer alone. An admin
 * who assumed otherwise would either expect a lockout that never comes or
 * fear one that cannot happen.
 *
 * Same load/save/busy/error shape as retention-settings.tsx, with one addition:
 * when migration 043 is not applied the route says so and the controls are
 * disabled, instead of offering a switch that silently discards what it is
 * told.
 */

interface CallGateSettings {
  requireCall: boolean;
  bookingUrl: string | null;
  /** Migration 048. Blank → yearly customers get the monthly link. */
  bookingUrlYearly: string | null;
  /** False → migration 043 is missing. */
  available: boolean;
  /** False → migration 048 is missing; only the yearly field is disabled. */
  yearlyAvailable: boolean;
}

const INPUT_CLASS =
  'w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))] disabled:opacity-50';

export function CallGateSettings() {
  const [data, setData] = useState<CallGateSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [requireCall, setRequireCall] = useState(false);
  const [bookingUrl, setBookingUrl] = useState('');
  const [bookingUrlYearly, setBookingUrlYearly] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/call-gate-settings', { credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message || body?.error || 'Could not load the onboarding call settings.');
        return;
      }
      const settings = body as CallGateSettings;
      setData(settings);
      setRequireCall(settings.requireCall);
      setBookingUrl(settings.bookingUrl ?? '');
      setBookingUrlYearly(settings.bookingUrlYearly ?? '');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const yearlyDirty = !!data && (data.bookingUrlYearly ?? '') !== bookingUrlYearly.trim();

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/admin/call-gate-settings', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        // Empty clears the link, which is how the booking button is taken off
        // the thank-you page again.
        body: JSON.stringify({
          requireCall,
          bookingUrl: bookingUrl.trim() || null,
          // Sent only when it changed, so a database without migration 048
          // can still save the switch and the monthly link.
          ...(yearlyDirty ? { bookingUrlYearly: bookingUrlYearly.trim() || null } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(body?.message || `Could not save: ${body?.error ?? 'unknown error'}`);
        return;
      }

      setSaved(true);
      // Reloaded rather than trusted: the server re-validates the stored URL on
      // the way out, so this shows what the customer will actually get.
      await load();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingPanel />;

  const unavailable = data ? !data.available : false;
  const yearlyUnavailable = unavailable || (data ? !data.yearlyAvailable : false);
  const dirty =
    !!data &&
    (data.requireCall !== requireCall ||
      (data.bookingUrl ?? '') !== bookingUrl.trim() ||
      yearlyDirty);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <PhoneCall className="h-5 w-5 text-[hsl(var(--primary))]" />
        <h2 className="text-lg font-semibold">Onboarding call</h2>
      </div>

      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <h3 className="text-sm font-semibold">Call before portal access</h3>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          With this on, a new customer who has paid lands on the thank-you page
          with a booking button instead of in the portal. You open their account
          from Companies once the call has happened.
        </p>

        {unavailable && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Migration 043 (<code>043_call_before_access.sql</code>) has not been
              applied to this database yet, so there is nowhere to store these
              settings. Run it in the Supabase SQL editor and reload this page.
              Until then nobody is gated.
            </span>
          </div>
        )}

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
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                Require an onboarding call before portal access
              </p>
              {/*
                The non-obvious bit, stated where the decision is made: the
                switch is read only when a company is created, so it is a rule
                for future signups and not a lever that locks out the people
                already using the product.
              */}
              <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
                Applies only to companies that sign up AFTER you switch it on.
                Existing customers, and anyone already in the portal, are never
                affected — each company keeps the setting that was in force when
                it was created.
              </p>
            </div>
            <Toggle
              checked={requireCall}
              disabled={saving || unavailable}
              onChange={setRequireCall}
              ariaLabel="Require an onboarding call before portal access"
            />
          </div>

          <div className="space-y-1.5 border-t border-border pt-5">
            <label htmlFor="onboarding-call-url" className="text-sm font-medium">
              Onboarding call link — monthly plans (also used for trials)
            </label>
            <p className="text-xs text-[hsl(var(--foreground-muted))]">
              The calendar behind the &ldquo;Book a call with us&rdquo; button on the
              thank-you page. Any https:// link works — GoHighLevel, Calendly, or
              anything else. This is separate from the cancellation calendars on
              the Retention tab.
            </p>
            <input
              id="onboarding-call-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              disabled={unavailable}
              value={bookingUrl}
              onChange={(e) => setBookingUrl(e.target.value)}
              placeholder="https://link.gohighlevel.com/widget/bookings/your-calendar"
              className={INPUT_CLASS}
            />
            <p
              className={
                data?.bookingUrl
                  ? 'text-xs font-medium text-[hsl(var(--primary))]'
                  : 'text-xs text-[hsl(var(--foreground-muted))]'
              }
            >
              {data?.bookingUrl
                ? 'The thank-you page shows the booking button.'
                : 'No link set — the thank-you page tells customers you will be in touch instead of showing a button that goes nowhere.'}
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="onboarding-call-url-yearly" className="text-sm font-medium">
              Onboarding call link — yearly plans
            </label>
            <p className="text-xs text-[hsl(var(--foreground-muted))]">
              Leave blank to use the monthly link.
            </p>
            <input
              id="onboarding-call-url-yearly"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              disabled={yearlyUnavailable}
              value={bookingUrlYearly}
              onChange={(e) => setBookingUrlYearly(e.target.value)}
              placeholder="https://link.gohighlevel.com/widget/bookings/your-yearly-calendar"
              className={INPUT_CLASS}
            />
            {data && !data.yearlyAvailable && !unavailable && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Migration 048 (<code>048_yearly_booking_link.sql</code>) has not been
                applied yet, so there is nowhere to store this link. Yearly customers
                get the monthly link until it is.
              </p>
            )}
          </div>

          {/*
            Shown only in the state that is actually broken: gating people and
            giving them no way to book is the one combination that leaves a
            paying customer stuck with nothing to do.
          */}
          {data?.requireCall && !data.bookingUrl && !unavailable && (
            <div className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--background-muted))] px-3 py-2.5 text-xs leading-relaxed text-[hsl(var(--foreground-muted))]">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                The gate is on but there is no booking link, so new customers are
                waiting without a way to book. Add a link above, or switch the
                gate off.
              </span>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty || unavailable}
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save onboarding call settings
          </button>
          {!dirty && !saving && !unavailable && (
            <span className="text-xs text-[hsl(var(--foreground-muted))]">
              No unsaved changes
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Same switch as billing-management.tsx's, so the two tabs look like one app. */
function Toggle({
  checked,
  onChange,
  ariaLabel,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-40',
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
  );
}
