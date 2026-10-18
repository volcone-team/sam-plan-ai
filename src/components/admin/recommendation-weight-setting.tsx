'use client';

import { useEffect, useMemo, useState } from 'react';
import { Scale, Loader2, TriangleAlert, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LoadingPanel } from '@/components/ui/spinner';
import {
  scoreAndRank,
  parseRevenueWeight,
  MIN_REVENUE_WEIGHT,
  MAX_REVENUE_WEIGHT,
  REVENUE_WEIGHT_STEP,
  type ScoreInput,
} from '@/lib/recommend/score';

/**
 * How recommendations are RANKED: the Revenue weight in SCORE
 * (S+C+O+E + R x weight). Super-admin only, like the toggles below it.
 *
 * Sits on /admin/ai-workbook beside the library toggles because both decide
 * what the AI offers: the toggles say WHICH initiatives, this says in WHAT
 * ORDER. The preview is the active library with no intake context, so it
 * shows the ranking before any customer's FIT rules remove anything.
 */

interface PreviewInitiative extends ScoreInput {
  key: string;
  category: string | null;
}

interface WeightResponse {
  weight: number;
  available: boolean;
  initiatives: PreviewInitiative[];
}

const PRESETS = [
  { value: 1, label: 'Equal weight (max 25)' },
  { value: 2, label: 'Revenue counts double (max 30)' },
] as const;

const PREVIEW_SIZE = 10;

function isPreset(weight: number): boolean {
  return PRESETS.some((p) => p.value === weight);
}

async function fetchWeight(): Promise<WeightResponse | { error: string }> {
  try {
    const res = await fetch('/api/admin/recommendation-weight', { credentials: 'same-origin' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body?.message || body?.error || 'Could not load the ranking setting.' };
    return body as WeightResponse;
  } catch {
    return { error: 'Could not reach the server.' };
  }
}

export function RecommendationWeightSetting() {
  const [data, setData] = useState<WeightResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  /** 'custom' or the preset value. */
  const [choice, setChoice] = useState<string>('1');
  const [custom, setCustom] = useState('1.5');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await fetchWeight();
      if (cancelled) return;
      if ('error' in result) {
        setError(result.error);
      } else {
        setData(result);
        if (isPreset(result.weight)) {
          setChoice(String(result.weight));
        } else {
          setChoice('custom');
          setCustom(String(result.weight));
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** The weight the form currently describes, or null when the custom value is invalid. */
  const selected = choice === 'custom' ? parseRevenueWeight(Number(custom)) : Number(choice);

  const columns = useMemo(() => {
    const weights: number[] = [1, 2];
    if (selected !== null && !weights.includes(selected)) weights.push(selected);
    return weights.map((weight) => ({
      weight,
      top: scoreAndRank(data?.initiatives ?? [], { revenueWeight: weight }).slice(0, PREVIEW_SIZE),
    }));
  }, [data, selected]);

  const save = async () => {
    if (selected === null || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/admin/recommendation-weight', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weight: selected }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message || `Could not save: ${body?.error ?? 'unknown error'}`);
        return;
      }
      setData((prev) => (prev ? { ...prev, weight: selected } : prev));
      setSaved(true);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingPanel />;

  const unchanged = data !== null && selected === data.weight;

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-[hsl(var(--primary))]" aria-hidden="true" />
          <h3 className="text-base font-semibold">How recommendations are ranked</h3>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-[hsl(var(--foreground-muted))]">
          Initiatives that fit a customer are ranked by SCORE: Speed + Cost + Odds +
          Revenue + Ease, each 1 to 5. Choose how much Revenue counts. The AI explains
          the ranking; it never changes the order.
        </p>
      </div>

      {data && !data.available && (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/20 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Migration 041 has not been applied, so this cannot be saved yet. Ranking
            uses equal weight until then. The preview below still works.
          </span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="sr-only">Revenue weight</legend>
        {PRESETS.map((preset) => (
          <label key={preset.value} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name="revenue-weight"
              value={String(preset.value)}
              checked={choice === String(preset.value)}
              onChange={() => setChoice(String(preset.value))}
              className="h-4 w-4 accent-[hsl(var(--primary))]"
            />
            {preset.label}
          </label>
        ))}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="revenue-weight"
              value="custom"
              checked={choice === 'custom'}
              onChange={() => setChoice('custom')}
              className="h-4 w-4 accent-[hsl(var(--primary))]"
            />
            Custom Revenue weight
          </label>
          <input
            type="number"
            aria-label="Custom Revenue weight"
            min={MIN_REVENUE_WEIGHT}
            max={MAX_REVENUE_WEIGHT}
            step={REVENUE_WEIGHT_STEP}
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              setChoice('custom');
            }}
            className="w-20 rounded-[var(--radius-md)] border border-border bg-transparent px-2 py-1 text-sm"
          />
          {choice === 'custom' && selected === null && (
            <span className="text-xs text-[hsl(var(--destructive))]">
              Use {MIN_REVENUE_WEIGHT} to {MAX_REVENUE_WEIGHT} in steps of {REVENUE_WEIGHT_STEP}.
            </span>
          )}
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || selected === null || unchanged || (data !== null && !data.available)}
          className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-40"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          Save ranking
        </button>
        {data && (
          <span className="text-xs text-[hsl(var(--foreground-muted))]">Live: weight {data.weight}</span>
        )}
        {saved && !error && (
          <span className="flex items-center gap-1 text-sm text-[hsl(var(--primary))]">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Saved.
          </span>
        )}
      </div>

      <div>
        <p className="flex items-center gap-1.5 text-xs text-[hsl(var(--foreground-muted))]">
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          Top {PREVIEW_SIZE} of the active library under each weighting, before any
          customer&apos;s fit rules. * means a score is missing and counted as 3.
        </p>
        {(data?.initiatives.length ?? 0) === 0 ? (
          <p className="mt-2 text-sm text-[hsl(var(--foreground-muted))]">No active initiatives to preview.</p>
        ) : (
          <div className="mt-2 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {columns.map(({ weight, top }) => (
              <div
                key={weight}
                className={cn(
                  'rounded-[var(--radius-md)] border border-border p-3',
                  weight === selected && 'border-[hsl(var(--primary))]'
                )}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]">
                  Weight {weight}
                  {weight === selected ? ' (selected)' : ''}
                </p>
                <ol className="mt-2 space-y-1 text-sm">
                  {top.map(({ initiative, score, rank }) => (
                    <li key={initiative.key} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">
                        {rank}. {initiative.name}
                        {!score.complete && <span title="A score is missing"> *</span>}
                      </span>
                      <span className="shrink-0 tabular-nums text-[hsl(var(--foreground-muted))]">
                        {score.weightedTotal}/{score.weightedMax}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
