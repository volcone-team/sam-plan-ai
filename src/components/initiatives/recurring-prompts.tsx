'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, AlertTriangle } from 'lucide-react';
import { parseDateOnly } from '@/lib/plan-dates';
import type { CorrectionAction, CorrectionPrompt, InstanceOutcome } from '@/lib/initiatives/recurring';

export interface RecurringPromptsProps {
  initiativeId: string;
  /** Called after a correction choice changed the initiative row, so the page can reload it. */
  onInitiativeChanged?: () => void;
}

interface DuePrompt {
  date: string;
  goal: number;
}

type PromptsResponse =
  | { enabled: false }
  | {
      enabled: true;
      canEdit: boolean;
      duePrompts: DuePrompt[];
      correction: CorrectionPrompt | null;
    };

const OUTCOME_BUTTONS: ReadonlyArray<{ outcome: InstanceOutcome; label: string }> = [
  { outcome: 'ran', label: 'It ran' },
  { outcome: 'skipped', label: "It didn't run" },
  { outcome: 'not-yet', label: 'Not yet' },
];

const dismissKey = (id: string) => `sam:recurring-correction-dismissed:${id}`;

function readDismissed(id: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(dismissKey(id)) === '1';
  } catch {
    return false; // storage unavailable: the card just shows
  }
}

/** The GET, or null on any failure (the component then renders nothing). */
async function fetchPrompts(id: string): Promise<PromptsResponse | null> {
  try {
    const res = await fetch(`/api/initiatives/${id}/instances`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as PromptsResponse;
  } catch {
    return null;
  }
}

function formatRunDate(d: string): string {
  return parseDateOnly(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

const primaryBtn =
  'inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary-hover))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] focus-visible:ring-offset-2';
const secondaryBtn =
  'inline-flex items-center justify-center rounded-[var(--radius-md)] border border-border bg-card px-3 py-1.5 text-sm font-medium text-[hsl(var(--foreground))] hover:border-[hsl(var(--border-strong))] hover:bg-[hsl(var(--background-muted))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] focus-visible:ring-offset-2';

/**
 * "Did this run?" prompts and the skip-streak / four-quiet-weeks correction
 * card for one initiative. Everything comes from
 * GET /api/initiatives/[id]/instances; this component decides nothing.
 *
 * Renders nothing while loading, on an error, when the feature is off
 * (migration 046 not applied), when there is nothing to ask, or when the
 * caller's role may not answer.
 */
export function RecurringPrompts({ initiativeId, onInitiativeChanged }: RecurringPromptsProps) {
  const [data, setData] = useState<PromptsResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Read once on mount. The server render is null either way (no data yet).
  const [dismissed, setDismissed] = useState(() => readDismissed(initiativeId));

  useEffect(() => {
    let cancelled = false;
    fetchPrompts(initiativeId).then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [initiativeId]);

  const load = useCallback(async () => {
    setData(await fetchPrompts(initiativeId));
  }, [initiativeId]);

  const post = async (path: string, body: unknown, key: string): Promise<boolean> => {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/initiatives/${initiativeId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json?.error === 'string' ? json.error : 'Something went wrong. Please try again.');
        return false;
      }
      await load();
      return true;
    } catch {
      setError('Something went wrong. Please try again.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const answer = (date: string, outcome: InstanceOutcome) =>
    post('instances', { instanceDate: date, outcome }, `${date}:${outcome}`);

  const choose = async (action: CorrectionAction) => {
    const ok = await post('correction', { action }, `correction:${action}`);
    if (ok && action !== 'keep') onInitiativeChanged?.();
  };

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(dismissKey(initiativeId), '1');
    } catch {
      /* dismissal lasts for this render tree only */
    }
  };

  if (!data || !data.enabled || !data.canEdit) return null;
  const correction = dismissed ? null : data.correction;
  if (data.duePrompts.length === 0 && !correction) return null;

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-[hsl(var(--destructive))]">
          {error}
        </p>
      )}

      {correction && (
        <section
          aria-labelledby={`correction-heading-${initiativeId}`}
          className="rounded-[var(--radius-lg)] border border-border bg-[hsl(var(--primary)/0.06)] p-5 sm:p-6"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--primary))]" aria-hidden="true" />
            <h2
              id={`correction-heading-${initiativeId}`}
              className="text-sm font-semibold text-[hsl(var(--foreground))]"
            >
              {correction.heading}
            </h2>
          </div>
          <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">{correction.body}</p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {correction.options.map((opt) => (
              <li key={opt.action}>
                <button
                  type="button"
                  onClick={() => choose(opt.action)}
                  disabled={busy !== null}
                  aria-busy={busy === `correction:${opt.action}`}
                  className="flex h-full w-full flex-col items-start rounded-[var(--radius-md)] border border-border bg-card px-4 py-3 text-left transition-colors hover:border-[hsl(var(--primary))] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] focus-visible:ring-offset-2"
                >
                  <span className="text-sm font-medium text-[hsl(var(--foreground))]">{opt.label}</span>
                  <span className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">{opt.detail}</span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={dismiss}
            className="mt-3 text-sm text-[hsl(var(--foreground-muted))] underline-offset-2 hover:text-[hsl(var(--primary))] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]"
          >
            {correction.dismissLabel}
          </button>
        </section>
      )}

      {data.duePrompts.map((p) => {
        const label = formatRunDate(p.date);
        return (
          <section
            key={p.date}
            aria-label={`Did the ${label} run happen?`}
            className="rounded-[var(--radius-lg)] border border-border bg-card p-4 sm:p-5"
          >
            <div className="flex items-center gap-2">
              <CalendarCheck className="h-4 w-4 text-[hsl(var(--primary))]" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Did this run?</h3>
            </div>
            <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">{label}</p>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`Outcome for ${label}`}>
              {OUTCOME_BUTTONS.map((b) => (
                <button
                  key={b.outcome}
                  type="button"
                  onClick={() => answer(p.date, b.outcome)}
                  disabled={busy !== null}
                  aria-busy={busy === `${p.date}:${b.outcome}`}
                  className={b.outcome === 'ran' ? primaryBtn : secondaryBtn}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
