'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Sparkles, Loader2, TriangleAlert, Info, CheckCircle2, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LoadingPanel } from '@/components/ui/spinner';

/**
 * Which workbook initiatives the AI may use.
 *
 * The list is the WORKBOOK'S — every initiative the uploaded spreadsheet
 * defines is shown, switched on or off. Nothing is removed from the library;
 * these toggles only decide what the AI is allowed to reference, and they live
 * in their own table so a re-upload cannot wipe them.
 *
 * Sits beside the upload on /admin/ai-workbook because that is where the
 * library comes from: seeing "22 initiatives, 6 active" next to the file that
 * produced them is the context that makes the toggles make sense.
 *
 * NOT to be confused with /admin/initiatives, which toggles a different list
 * the AI has never read.
 */

interface LibraryInitiative {
  initiativeKey: string;
  name: string;
  category: string | null;
  oneLiner: string | null;
  difficulty: number | null;
  speedToResults: string | null;
  ownOrOps: string | null;
  needsSalesTeam: string | null;
  isActive: boolean;
  /** True when nobody has made a decision about this one yet. */
  isDefault: boolean;
  notes: string | null;
}

interface LibraryResponse {
  initiatives: LibraryInitiative[];
  counts: { total: number; active: number; inactive: number };
  maxPlanInitiatives: number;
  orphanedSettings: string[];
  libraryEmpty: boolean;
}

export function InitiativeLibraryToggles() {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  // A flag, not a timestamp: Date.now() in a component is impure, and all this
  // drives is a "Saved." line.
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/initiative-library', { credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          body?.error === 'settings_unavailable'
            ? 'Could not read the toggle settings. Has migration 034 been applied?'
            : body?.message || body?.error || 'Could not load the initiative library.'
        );
        return;
      }
      setData(body as LibraryResponse);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Toggle one initiative, optimistically.
   *
   * The row flips immediately and reverts if the write fails. A toggle that
   * waits for a round trip feels broken when you are switching six of them.
   */
  const toggle = async (initiative: LibraryInitiative) => {
    if (!data || savingKey) return;

    const nextActive = !initiative.isActive;
    setSavingKey(initiative.initiativeKey);
    setError(null);
    setSaved(false);

    const previous = data;
    setData({
      ...data,
      initiatives: data.initiatives.map((i) =>
        i.initiativeKey === initiative.initiativeKey
          ? { ...i, isActive: nextActive, isDefault: false }
          : i
      ),
      counts: {
        ...data.counts,
        active: data.counts.active + (nextActive ? 1 : -1),
        inactive: data.counts.inactive + (nextActive ? -1 : 1),
      },
    });

    try {
      const res = await fetch('/api/admin/initiative-library', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changes: [{ initiativeKey: initiative.initiativeKey, isActive: nextActive }],
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setData(previous);
        setError(body?.message || `Could not save: ${body?.error ?? 'unknown error'}`);
        return;
      }

      setSaved(true);
    } catch {
      setData(previous);
      setError('Could not reach the server.');
    } finally {
      setSavingKey(null);
    }
  };

  /** Grouped by the workbook's own categories, in the order they arrived. */
  const grouped = useMemo(() => {
    if (!data) return [];
    const groups = new Map<string, LibraryInitiative[]>();
    for (const initiative of data.initiatives) {
      const key = initiative.category?.trim() || 'Uncategorised';
      const list = groups.get(key) ?? [];
      list.push(initiative);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [data]);

  if (loading) return <LoadingPanel />;

  const active = data?.counts.active ?? 0;
  const total = data?.counts.total ?? 0;
  const cap = data?.maxPlanInitiatives ?? 5;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[hsl(var(--primary))]" />
            <h3 className="text-base font-semibold">What the AI may recommend</h3>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-[hsl(var(--foreground-muted))]">
            Every initiative from the uploaded workbook is listed here. Switching
            one off hides it from recommendations, the intake picker, plan
            generation, Enhance and the chatbot — it stays in the library and can
            be switched back on at any time. A workbook re-upload keeps these
            choices.
          </p>
        </div>

        <button
          type="button"
          onClick={load}
          className="inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm font-medium hover:bg-[hsl(var(--background-muted))]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {data?.libraryEmpty && (
        /*
          An empty library and an all-off library look identical on screen but
          have completely different fixes, so they are never conflated.
        */
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] px-3 py-2.5 text-sm text-[hsl(var(--foreground-muted))]">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            No initiatives yet — upload a workbook above and they will appear here.
          </span>
        </div>
      )}

      {!data?.libraryEmpty && (
        <>
          {/* The count, and what it means for a customer's plan. */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] px-4 py-3">
            <p className="text-sm font-medium">
              {active} of {total} active
            </p>
            <p className="text-xs text-[hsl(var(--foreground-muted))]">
              A customer&apos;s plan holds at most {cap} initiatives.
            </p>
          </div>

          {/*
            Nothing active means the AI has no vocabulary at all: no
            recommendations, and plan generation falls back to whatever it can
            manage without a library. Honoured, but never silent.
          */}
          {active === 0 && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Nothing is active, so the AI has nothing to recommend. Customers
                will reach the recommendations screen with an empty shortlist.
              </span>
            </div>
          )}

          {/*
            Three is the practical floor, not a hard rule: the eligibility
            checks (sales model, budget, hours, already-planned) can easily
            exclude two of a small set and leave a customer with nothing.
          */}
          {active > 0 && active < 3 && (
            <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/20 dark:text-amber-200">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Only {active} active. The eligibility rules can exclude an
                initiative for a customer&apos;s budget, hours or sales model, so
                some customers may see an empty or very short shortlist. Three or
                more is safer.
              </span>
            </div>
          )}

          {saved && !error && (
            <p className="flex items-center gap-2 text-sm text-[hsl(var(--primary))]">
              <CheckCircle2 className="h-4 w-4" />
              Saved.
            </p>
          )}

          <div className="space-y-5">
            {grouped.map(([category, initiatives]) => (
              <div key={category}>
                <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]">
                  {category}
                </p>
                <ul className="mt-2 divide-y divide-border rounded-[var(--radius-md)] border border-border">
                  {initiatives.map((initiative) => (
                    <li
                      key={initiative.initiativeKey}
                      className={cn(
                        'flex items-start justify-between gap-4 px-4 py-3 transition-colors',
                        !initiative.isActive && 'bg-[hsl(var(--background-muted))]'
                      )}
                    >
                      <div className="min-w-0">
                        <p
                          className={cn(
                            'text-sm font-medium',
                            !initiative.isActive && 'text-[hsl(var(--foreground-muted))]'
                          )}
                        >
                          {initiative.name}
                        </p>
                        {initiative.oneLiner && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-[hsl(var(--foreground-muted))]">
                            {initiative.oneLiner}
                          </p>
                        )}
                        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[hsl(var(--foreground-subtle))]">
                          <span className="font-mono">{initiative.initiativeKey}</span>
                          {initiative.difficulty !== null && (
                            <span>Difficulty {initiative.difficulty}/5</span>
                          )}
                          {initiative.speedToResults && <span>{initiative.speedToResults}</span>}
                          {initiative.ownOrOps && <span>{initiative.ownOrOps}</span>}
                        </p>
                      </div>

                      <label className="flex shrink-0 cursor-pointer items-center gap-2">
                        <span
                          className={cn(
                            'text-xs font-medium',
                            initiative.isActive
                              ? 'text-[hsl(var(--primary))]'
                              : 'text-[hsl(var(--foreground-muted))]'
                          )}
                        >
                          {initiative.isActive ? 'Active' : 'Off'}
                        </span>
                        {savingKey === initiative.initiativeKey ? (
                          <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--foreground-muted))]" />
                        ) : (
                          <input
                            type="checkbox"
                            checked={initiative.isActive}
                            onChange={() => toggle(initiative)}
                            disabled={!!savingKey}
                            className="h-4 w-4 accent-[hsl(var(--primary))] disabled:opacity-40"
                            aria-label={`${initiative.isActive ? 'Disable' : 'Enable'} ${initiative.name}`}
                          />
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/*
            A toggle for an initiative the current workbook does not contain.
            Harmless, but invisible and inexplicable later if that initiative
            ever returns, so it is stated rather than hidden.
          */}
          {data && data.orphanedSettings.length > 0 && (
            <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2.5 text-xs text-[hsl(var(--foreground-muted))]">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {data.orphanedSettings.length} saved setting
                {data.orphanedSettings.length === 1 ? '' : 's'} refer to initiatives
                not in the current workbook ({data.orphanedSettings.join(', ')}).
                They will apply again if those initiatives come back.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
