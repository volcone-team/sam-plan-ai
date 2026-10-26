'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  TriangleAlert,
  CheckCircle2,
  Check,
  X,
  Info,
  Plug,
  Play,
  RotateCcw,
} from 'lucide-react';
import { LoadingPanel } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import {
  describeGhlEventType,
  describeGhlFixedTags,
  describeGhlRowStatus,
  type GhlOutboxCounts,
  type GhlOutboxSummary,
} from '@/lib/ghl/admin-view';

/**
 * The GoHighLevel integration panel (migration 044).
 *
 * THE CLIENT ASKED FOR ONE THING — a global switch to disable the sync — and
 * this screen is that switch plus the minimum needed to use it responsibly:
 * which of the five configuration states we are in, whether the credentials
 * exist, what is in the outbox, and what the last few deliveries did. A lone
 * toggle with no feedback would mean the only way to find out whether the
 * integration works is to look at the client's CRM afterwards.
 *
 * ON THE PLATFORM SETTINGS PAGE, NOT ON SUBSCRIPTIONS. The call gate and
 * retention live beside the subscription because they are "what happens to a
 * customer at the edges of their subscription". This is plumbing: an outbox, a
 * cron, two env vars and a third-party API.
 *
 * ONE SWITCH PER REQUEST, AND GOING LIVE TAKES TWO DELIBERATE ACTIONS. The
 * route refuses a single PUT that both enables the integration and turns dry
 * run off (`admin-input.ts` argues why). This panel therefore saves each
 * switch on flip rather than collecting them behind a Save button, so the
 * refused combination is not expressible from the UI and the operator never
 * meets the error — the server rule is there for curl, not for them.
 *
 * PER-ACTION BUSY FLAGS. `savingEnabled`, `savingDryRun`, `draining`,
 * `retryingAll` and `retryingId` are separate on purpose: a single shared
 * `busy` putting every button in a spinner was a bug fixed earlier in this
 * project, and it is especially wrong here, where a drain can legitimately take
 * a while and the operator still wants to read the log.
 */

/* ------------------------------------------------------------------
   Types — mirror the GET contracts
   ------------------------------------------------------------------ */

type GhlStatus = 'live' | 'dry_run' | 'disabled' | 'not_configured' | 'unavailable';

interface GhlSettingsResponse {
  enabled: boolean;
  dryRun: boolean;
  status: GhlStatus;
  description: string;
  /** False → migration 044 is missing. */
  available: boolean;
  mayWrite: boolean;
  /** PRESENCE booleans. The route never sends values. */
  env: { locationId: boolean; token: boolean };
  envVars: { locationId: string; token: string };
}

interface GhlEventEntry {
  id: string;
  createdAt: string;
  eventType: string | null;
  companyId: string | null;
  companyName: string | null;
  contactEmail: string | null;
  tagsAdd: string[];
  tagsRemove: string[];
  status: string | null;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  dryRun: boolean;
}

interface GhlEventsResponse {
  counts: GhlOutboxCounts;
  summary: GhlOutboxSummary;
  entries: GhlEventEntry[];
  total: number;
  limit: number;
  offset: number;
}

interface DrainSummary {
  claimed: number;
  delivered: number;
  skipped: number;
  failed: number;
  retrying: number;
  leaseLost: number;
  halted?: string;
  dryRun: boolean;
  status: GhlStatus;
  config: string;
}

interface RetryResult {
  requeued: number;
  superseded: number;
  unchanged: number;
  failedRemaining: number;
  capped: boolean;
}

const PAGE_SIZE = 25;

/* ------------------------------------------------------------------
   Status copy — one entry per GhlConfigStatus
   ------------------------------------------------------------------ */

/**
 * What to do next, per status.
 *
 * `describeGhlConfig` from the server says WHAT the state is, credential-free
 * and identical in the logs; this says what the operator should do about it.
 * Five entries because `config.ts` deliberately keeps four distinct "no"s
 * rather than a boolean — each has a different fix, and collapsing them is how
 * you end up with a dead switch and a guessing admin.
 */
const NEXT_STEP: Record<GhlStatus, string> = {
  live: 'Tags are being written to the client’s CRM. Watch the log below; anything in Failed needs attention.',
  dry_run:
    'Everything runs except the GoHighLevel calls. Run a drain, check the log shows the contacts and tags you expect, then turn dry run off.',
  disabled:
    'Nothing is queued and nothing is sent. Turn the sync on to start recording events — dry run stays on, so the CRM is still untouched.',
  not_configured:
    'The sync is on but the credentials are missing, so nothing can be delivered. Set the environment variables below in Vercel and redeploy.',
  unavailable:
    'The settings could not be read, so nothing is being sent. If migration 044 is applied, this is a database error worth a second look.',
};

const STATUS_TONE: Record<GhlStatus, string> = {
  live: 'border-[hsl(var(--primary)_/_0.3)] bg-[hsl(var(--primary)_/_0.06)] text-[hsl(var(--primary))]',
  dry_run:
    'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200',
  disabled: 'border-border bg-[hsl(var(--background-muted))] text-[hsl(var(--foreground-muted))]',
  not_configured:
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  unavailable:
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ------------------------------------------------------------------
   Main component
   ------------------------------------------------------------------ */

export function GhlSettings() {
  const [settings, setSettings] = useState<GhlSettingsResponse | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // One flag per switch: flipping the sync must not freeze the dry-run control.
  const [savingEnabled, setSavingEnabled] = useState(false);
  const [savingDryRun, setSavingDryRun] = useState(false);
  /** The "are you sure" step for the one flip that starts writing to the CRM. */
  const [confirmGoLive, setConfirmGoLive] = useState(false);

  const [events, setEvents] = useState<GhlEventsResponse | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const [draining, setDraining] = useState(false);
  const [drainResult, setDrainResult] = useState<DrainSummary | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retryResult, setRetryResult] = useState<RetryResult | null>(null);

  const loadSettings = useCallback(async () => {
    setSettingsError(null);
    try {
      const res = await fetch('/api/admin/ghl/settings', { credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSettingsError(
          body?.message || body?.error || 'Could not load the GoHighLevel settings.'
        );
        // A 409 migration_required still tells us the controls must be dead.
        if (body?.error === 'migration_required') {
          setSettings((prev) => (prev ? { ...prev, available: false } : prev));
        }
        return;
      }
      setSettings(body as GhlSettingsResponse);
    } catch {
      setSettingsError('Could not reach the server.');
    } finally {
      setLoadingSettings(false);
    }
  }, []);

  const loadEvents = useCallback(async (nextOffset: number) => {
    setEventsError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(nextOffset),
      });
      const res = await fetch(`/api/admin/ghl/events?${params.toString()}`, {
        credentials: 'same-origin',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEventsError(body?.message || body?.error || 'Could not load the delivery log.');
        return;
      }
      setEvents(body as GhlEventsResponse);
    } catch {
      setEventsError('Could not reach the server.');
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  /*
   * BOTH EFFECTS CALL THEIR LOADER THROUGH AN INNER async FUNCTION, as
   * activity-log.tsx does. Calling it directly in the effect body trips this
   * repo's react-hooks/set-state-in-effect rule, because the loader's first
   * statement is a synchronous setState (call-gate-settings.tsx still carries
   * that finding).
   *
   * Neither effect sets its loading flag either, for the same reason. Paging
   * is an EVENT and sets the flag itself; the first load rides the initial
   * `true`.
   */
  useEffect(() => {
    const run = async () => {
      await loadSettings();
    };
    run();
  }, [loadSettings]);

  useEffect(() => {
    const run = async () => {
      await loadEvents(offset);
    };
    run();
  }, [loadEvents, offset]);

  /**
   * Save one switch.
   *
   * Sends ONLY the field that changed, which is what keeps the server's refused
   * combination unreachable from here, and reloads from the response: the
   * resolved `status` depends on the credentials as well as the switches, so
   * "enabled" can legitimately land on `not_configured`.
   */
  const saveSwitch = async (field: 'enabled' | 'dryRun', value: boolean) => {
    const setBusy = field === 'enabled' ? setSavingEnabled : setSavingDryRun;
    setBusy(true);
    setSettingsError(null);
    setSaved(null);
    try {
      const res = await fetch('/api/admin/ghl/settings', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSettingsError(body?.message || `Could not save: ${body?.error ?? 'unknown error'}`);
        return;
      }
      setSettings(body as GhlSettingsResponse);
      setSaved(field === 'enabled' ? (value ? 'Sync on.' : 'Sync off.') : value ? 'Dry run on.' : 'Dry run off — live writes.');
    } catch {
      setSettingsError('Could not reach the server.');
    } finally {
      setBusy(false);
      setConfirmGoLive(false);
    }
  };

  const runDrain = async () => {
    setDraining(true);
    setActionError(null);
    setDrainResult(null);
    setRetryResult(null);
    try {
      const res = await fetch('/api/admin/ghl/drain', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(body?.message || body?.error || 'The drain could not be run.');
        return;
      }
      setDrainResult(body as DrainSummary);
      await loadEvents(offset);
    } catch {
      setActionError('Could not reach the server.');
    } finally {
      setDraining(false);
    }
  };

  const retry = async (id: string | null) => {
    if (id) setRetryingId(id);
    else setRetryingAll(true);
    setActionError(null);
    setRetryResult(null);
    setDrainResult(null);
    try {
      const res = await fetch('/api/admin/ghl/retry', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id ? { id } : {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(body?.message || body?.error || 'Those rows could not be requeued.');
        return;
      }
      setRetryResult(body as RetryResult);
      await loadEvents(offset);
    } catch {
      setActionError('Could not reach the server.');
    } finally {
      setRetryingId(null);
      setRetryingAll(false);
    }
  };

  if (loadingSettings) return <LoadingPanel />;

  const unavailable = settings ? !settings.available : false;
  const status: GhlStatus = settings?.status ?? 'unavailable';
  const counts = events?.counts;
  const needsAttention = events?.summary.needsAttention ?? 0;

  /**
   * The flip that starts writing to the client's CRM, and the only one that
   * asks twice. Turning dry run off while the sync is already on is the moment
   * tags start landing on real contacts.
   */
  const goingLiveNext = !!settings?.enabled && !!settings?.dryRun;
  /**
   * The other way into live writes: dry run already off on a disabled
   * integration, so enabling it goes straight to real calls. The server allows
   * it (one field, one deliberate change) and this warns about it, which is the
   * whole reason the panel reads the stored switch rather than inferring it.
   */
  const enableWouldGoLive = !!settings && !settings.enabled && !settings.dryRun;

  const pageStart = !events || events.total === 0 ? 0 : events.offset + 1;
  const pageEnd = events ? events.offset + events.entries.length : 0;
  const hasPrev = offset > 0;
  const hasNext = !!events && pageEnd < events.total;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Plug className="h-5 w-5 text-[hsl(var(--primary))]" />
        <h2 className="text-lg font-semibold">GoHighLevel sync</h2>
      </div>

      {/* ---------------- Status + switches ---------------- */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <h3 className="text-sm font-semibold">Status</h3>

        {unavailable ? (
          <div
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-[var(--radius-md)] border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Migration 044 (<code>044_ghl_outbox.sql</code>) has not been applied to
              this database yet, so there is nowhere to store these settings and no
              outbox to read. Run it in the Supabase SQL editor and reload this page.
              Until then nothing is queued and nothing is sent.
            </span>
          </div>
        ) : (
          <div
            className={cn(
              'mt-3 rounded-[var(--radius-md)] border px-3 py-2.5 text-sm',
              STATUS_TONE[status]
            )}
          >
            <p className="font-medium">{settings?.description}</p>
            <p className="mt-1 opacity-90">{NEXT_STEP[status]}</p>
          </div>
        )}

        {settingsError && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{settingsError}</span>
          </div>
        )}

        {saved && !settingsError && (
          <div className="mt-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--primary)_/_0.3)] bg-[hsl(var(--primary)_/_0.06)] px-3 py-2.5 text-sm text-[hsl(var(--primary))]">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Saved. {saved}
          </div>
        )}

        <div className="mt-5 space-y-5">
          {/* The client's global off switch. */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Enable GoHighLevel sync</p>
              <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
                Off means nothing is recorded and nothing is sent: no purchase,
                cancellation, intake, plan or first-login event reaches GoHighLevel,
                and no event is queued for later either. Customers notice nothing —
                this only affects the CRM.
              </p>
              {enableWouldGoLive && (
                <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                  Dry run is currently off, so switching the sync on will write to
                  the live CRM straight away. Turn dry run on first if you want a
                  rehearsal.
                </p>
              )}
            </div>
            <Toggle
              checked={!!settings?.enabled}
              disabled={savingEnabled || unavailable}
              busy={savingEnabled}
              onChange={(v) => saveSwitch('enabled', v)}
              ariaLabel="Enable GoHighLevel sync"
            />
          </div>

          {/* Dry run. */}
          <div className="flex items-start justify-between gap-4 border-t border-border pt-5">
            <div className="min-w-0">
              <p className="text-sm font-medium">Dry run</p>
              <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
                <strong>On: nothing is sent to GoHighLevel.</strong> Events are still
                queued, claimed and resolved, and the log below shows exactly which
                contact would have been tagged with what — the CRM is untouched. Turn
                it off only once a drain looks right.
              </p>
              {/*
                The two-step, spelled out where the operator is standing. The
                route refuses a single request that both enables the sync and
                leaves dry run, so this panel never sends one; the confirm step
                below is what makes the second action deliberate rather than a
                stray click.
              */}
              {goingLiveNext && !confirmGoLive && (
                <p className="mt-2 text-xs text-[hsl(var(--foreground-muted))]">
                  Turning this off starts real writes into the client’s CRM. A tag
                  cannot be un-sent once it has triggered their workflow.
                </p>
              )}
              {confirmGoLive && (
                <div className="mt-3 rounded-[var(--radius-md)] border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  <p className="font-medium">Go live?</p>
                  <p className="mt-1">
                    Queued events will be delivered to the real GoHighLevel account on
                    the next drain. Check the log below shows the contacts and tags you
                    expect first.
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => saveSwitch('dryRun', false)}
                      disabled={savingDryRun}
                      className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-1.5 font-semibold text-white hover:opacity-90 disabled:opacity-40"
                    >
                      {savingDryRun && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Yes, go live
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmGoLive(false)}
                      disabled={savingDryRun}
                      className="rounded-[var(--radius-md)] border border-border px-3 py-1.5 font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-40"
                    >
                      Keep dry run on
                    </button>
                  </div>
                </div>
              )}
            </div>
            <Toggle
              checked={!!settings?.dryRun}
              disabled={savingDryRun || unavailable || !settings?.enabled}
              busy={savingDryRun}
              onChange={(v) => {
                // Turning it ON is always safe and saves immediately; turning
                // it OFF is the live-write moment and asks first.
                if (v) saveSwitch('dryRun', true);
                else setConfirmGoLive(true);
              }}
              ariaLabel="Dry run"
            />
          </div>

          {/* Credentials. */}
          <div className="border-t border-border pt-5">
            <p className="text-sm font-medium">Credentials</p>
            <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
              Both are <strong>environment variables</strong>, not settings — they are
              not stored in the database and cannot be set from this screen. For
              production they must be set in Vercel (and the app redeployed); locally
              they go in <code>.env.local</code>. The values are never shown here.
            </p>
            <ul className="mt-3 space-y-1.5">
              <CredentialRow
                name={settings?.envVars.locationId ?? 'GHL_LOCATION_ID'}
                present={!!settings?.env.locationId}
              />
              <CredentialRow
                name={settings?.envVars.token ?? 'GHL_PRIVATE_TOKEN'}
                present={!!settings?.env.token}
              />
            </ul>
          </div>
        </div>
      </div>

      {/* ---------------- Tags ---------------- */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <h3 className="text-sm font-semibold">Tags this app writes</h3>
        <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
          Exact strings. A GoHighLevel workflow must match them character for
          character. Buyer tags (one per plan, state and cycle) are not listed.
        </p>
        <ul className="mt-3 space-y-2">
          {describeGhlFixedTags().map((row) => (
            <li key={row.tag} className="text-xs">
              <code className="font-mono text-[hsl(var(--foreground))]">{row.tag}</code>
              <p className="text-[hsl(var(--foreground-muted))]">{row.description}</p>
            </li>
          ))}
        </ul>
      </div>

      {/* ---------------- Outbox ---------------- */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Outbox</h3>
            <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
              Events are delivered automatically a moment after whatever created
              them, and anything that misses out — a failed row waiting on its
              retry, or a row queued while this page was half set up — is picked up
              by a full sweep once a day. Running one by hand here is safe at any
              time: rows are claimed under a lease, so an overlapping automatic run
              loses the race rather than sending twice.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runDrain}
              disabled={draining || unavailable}
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              {draining ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run drain now
            </button>
            <button
              type="button"
              onClick={() => retry(null)}
              disabled={retryingAll || unavailable || needsAttention === 0}
              title={
                needsAttention === 0
                  ? 'Nothing has failed, so there is nothing to retry.'
                  : undefined
              }
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-40"
            >
              {retryingAll ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              Retry failed ({needsAttention})
            </button>
          </div>
        </div>

        {counts && (
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <CountTile label="Pending" value={counts.pending} hint={`${counts.dueNow} due now`} />
            <CountTile label="Delivered" value={counts.delivered} />
            {/*
              SKIPPED IS BENIGN. 044 is explicit that it is a terminal success —
              the contact is not in that sub-account — so it is rendered in the
              same muted voice as pending and never counted as an error.
            */}
            <CountTile
              label="Skipped"
              value={counts.skipped}
              hint="Not in the CRM — normal"
            />
            <CountTile
              label="Failed"
              value={counts.failed}
              hint={counts.failed > 0 ? 'Needs attention' : undefined}
              tone={counts.failed > 0 ? 'error' : undefined}
            />
            <CountTile label="Total" value={events?.summary.total ?? 0} />
          </dl>
        )}

        {actionError && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}

        {drainResult && !actionError && (
          <div className="mt-4 rounded-[var(--radius-md)] bg-[hsl(var(--background-muted))] px-3 py-2.5 text-xs leading-relaxed text-[hsl(var(--foreground-muted))]">
            <p>
              Claimed {drainResult.claimed} · delivered {drainResult.delivered} ·
              skipped {drainResult.skipped} · failed {drainResult.failed} · retrying{' '}
              {drainResult.retrying} · already claimed elsewhere{' '}
              {drainResult.leaseLost}
              {drainResult.dryRun ? ' · dry run, nothing was sent' : ''}
            </p>
            {/* The confusing zero, explained where it happens. */}
            {drainResult.claimed === 0 && drainResult.leaseLost > 0 && (
              <p className="mt-1">
                Nothing was delivered because the automatic drain had already claimed
                those rows. Nothing is wrong, and nothing was sent twice.
              </p>
            )}
            {drainResult.halted && (
              <p className="mt-1">
                Nothing was claimed: {drainResult.config}
              </p>
            )}
          </div>
        )}

        {retryResult && !actionError && (
          <div className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--background-muted))] px-3 py-2.5 text-xs leading-relaxed text-[hsl(var(--foreground-muted))]">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {retryResult.requeued} row{retryResult.requeued === 1 ? '' : 's'} back in
              the queue. {retryResult.failedRemaining} still failed.
              {retryResult.superseded > 0 && (
                <>
                  {' '}
                  {retryResult.superseded} left alone because a newer event already
                  covers the same change — that is the right outcome, not an error.
                </>
              )}
              {retryResult.capped && ' More remain than one request moves; press again.'}
            </span>
          </div>
        )}
      </div>

      {/* ---------------- Delivery log ---------------- */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Delivery log</h3>
            <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
              Newest first. Rows marked <em>dry run</em> never left this app.
            </p>
          </div>
          {!loadingEvents && !eventsError && (events?.total ?? 0) > 0 && (
            <p className="text-xs text-[hsl(var(--foreground-muted))]">
              Showing {pageStart}–{pageEnd} of {events?.total}
            </p>
          )}
        </div>

        {eventsError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{eventsError}</span>
          </div>
        )}

        {loadingEvents && !eventsError && (
          <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
            <p className="text-sm text-[hsl(var(--foreground-muted))]">Loading the log…</p>
          </div>
        )}

        {!loadingEvents && !eventsError && (events?.entries.length ?? 0) === 0 && (
          <div className="rounded-[var(--radius-lg)] border border-border bg-card p-10 text-center">
            <p className="text-sm text-[hsl(var(--foreground-muted))]">
              Nothing has been queued yet.
            </p>
          </div>
        )}

        {!loadingEvents && !eventsError && (events?.entries.length ?? 0) > 0 && (
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border bg-card">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                GoHighLevel delivery log, newest first. Each row shows when the event
                was queued, what it was, which company and contact it concerns, the
                tags it adds and removes, how it ended and any error.
              </caption>
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-[hsl(var(--foreground-muted))]">
                  <th scope="col" className="px-4 py-3 font-medium">When</th>
                  <th scope="col" className="px-4 py-3 font-medium">Event</th>
                  <th scope="col" className="px-4 py-3 font-medium">Company</th>
                  <th scope="col" className="px-4 py-3 font-medium">Contact</th>
                  <th scope="col" className="px-4 py-3 font-medium">Tags</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 font-medium">Attempts</th>
                  <th scope="col" className="px-4 py-3 font-medium">Last error</th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(events?.entries ?? []).map((entry) => {
                  const described = describeGhlRowStatus(entry.status);
                  const isFailed = entry.status === 'failed';
                  return (
                    <tr key={entry.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-[hsl(var(--foreground-muted))]">
                        {formatTimestamp(entry.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        {describeGhlEventType(entry.eventType)}
                        {entry.dryRun && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                            dry run
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[hsl(var(--foreground-muted))]">
                        {entry.companyName ?? '—'}
                      </td>
                      <td className="px-4 py-3">{entry.contactEmail ?? '—'}</td>
                      <td className="px-4 py-3 text-xs">
                        {entry.tagsAdd.length > 0 && (
                          <p className="text-[hsl(var(--foreground))]">
                            + {entry.tagsAdd.join(', ')}
                          </p>
                        )}
                        {entry.tagsRemove.length > 0 && (
                          <p className="text-[hsl(var(--foreground-muted))]">
                            − {entry.tagsRemove.join(', ')}
                          </p>
                        )}
                        {entry.tagsAdd.length === 0 && entry.tagsRemove.length === 0 && '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          title={described.detail}
                          className={cn(
                            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                            described.tone === 'ok' &&
                              'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
                            described.tone === 'error' &&
                              'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
                            described.tone === 'muted' &&
                              'bg-[hsl(var(--muted))] text-[hsl(var(--foreground-muted))]'
                          )}
                        >
                          {described.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[hsl(var(--foreground-muted))]">
                        {entry.attempts}
                      </td>
                      <td className="max-w-xs px-4 py-3 text-xs text-[hsl(var(--foreground-muted))]">
                        {/*
                          Verbatim: the server has already nulled the drain's
                          dry-run marker, which lives in the same column but is
                          a note rather than an error.
                        */}
                        {entry.lastError ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        {isFailed && (
                          <button
                            type="button"
                            onClick={() => retry(entry.id)}
                            disabled={retryingId === entry.id}
                            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-2 py-1 text-xs font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-40"
                          >
                            {retryingId === entry.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3 w-3" />
                            )}
                            Retry
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loadingEvents && !eventsError && (hasPrev || hasNext) && (
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setLoadingEvents(true);
                setOffset(Math.max(offset - PAGE_SIZE, 0));
              }}
              disabled={!hasPrev}
              className="rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-[hsl(var(--muted))] disabled:cursor-not-allowed disabled:opacity-50"
            >
              ← Previous
            </button>
            <button
              type="button"
              onClick={() => {
                setLoadingEvents(true);
                setOffset(offset + PAGE_SIZE);
              }}
              disabled={!hasNext}
              className="rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-[hsl(var(--muted))] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Load more →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Pieces
   ------------------------------------------------------------------ */

function CredentialRow({ name, present }: { name: string; present: boolean }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      {present ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" aria-hidden />
      ) : (
        <X className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      )}
      <code className="font-mono">{name}</code>
      <span className={present ? 'text-[hsl(var(--foreground-muted))]' : 'text-amber-700 dark:text-amber-400'}>
        {present ? 'set' : 'not set'}
      </span>
    </li>
  );
}

function CountTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: 'error';
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border px-3 py-2.5">
      <dt className="text-xs text-[hsl(var(--foreground-muted))]">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-lg font-semibold',
          tone === 'error' ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--foreground))]'
        )}
      >
        {value}
      </dd>
      {hint && (
        <p
          className={cn(
            'text-[11px]',
            tone === 'error'
              ? 'text-[hsl(var(--destructive))]'
              : 'text-[hsl(var(--foreground-muted))]'
          )}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * Same switch as call-gate-settings.tsx's, so the tabs look like one app, with
 * a `busy` state added: these save on flip rather than behind a Save button, so
 * the control itself is the only place that can show the request in progress.
 */
function Toggle({
  checked,
  onChange,
  ariaLabel,
  disabled,
  busy,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-busy={busy || undefined}
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
