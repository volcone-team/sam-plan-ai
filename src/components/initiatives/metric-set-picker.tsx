'use client';

import { useId, useMemo } from 'react';
import { Calculator, Check } from 'lucide-react';
import type { StoredMetrics } from '@/lib/metrics/parse-metrics';
import { METRICS_BY_KEY, type MetricKind } from '@/lib/metrics/dictionary';
import {
  buildMetricSet,
  formulaInWords,
  librarySelectables,
  type MetricSetMetric,
} from '@/lib/metrics/metric-set';

/** The customer's choices. Selection ids come from `librarySelectables`. */
export interface MetricChoice {
  /** Formats ticked. Null means every format (the default). */
  groupLabels: string[] | null;
  /** Optional metrics unticked. */
  excludedOptional: string[];
}

export const DEFAULT_METRIC_CHOICE: MetricChoice = { groupLabels: null, excludedOptional: [] };

export interface MetricSetPickerProps {
  libraryKey: string;
  metrics: StoredMetrics | null;
  value: MetricChoice;
  onChange: (value: MetricChoice) => void;
}

function kindHint(kind: MetricKind, unit?: string): string {
  if (unit === 'minutes') return 'minutes';
  if (kind === 'rate') return '%';
  if (kind === 'money') return '$';
  if (kind === 'score') return 'score';
  return 'number';
}

/**
 * "What you'll track" for a library initiative.
 *
 * Formats (VIRTUAL / IN-PERSON) are checkboxes only when the initiative has
 * two or more groups. Required metrics are listed, optional ones are
 * pre-ticked checkboxes, derived ones are read-only with their formula.
 * The list underneath is the metric set the server will build, so a derived
 * metric disappears when one of its inputs is unticked.
 */
export function MetricSetPicker({ libraryKey, metrics, value, onChange }: MetricSetPickerProps) {
  const baseId = useId();
  const groups = useMemo(() => librarySelectables(metrics), [metrics]);
  const formats = groups.filter(g => g.selectable).map(g => g.label as string);
  const chosenFormats = value.groupLabels ?? formats;

  const built = useMemo(
    () => buildMetricSet(libraryKey, metrics, {
      groupLabels: value.groupLabels ?? undefined,
      excludedOptional: value.excludedOptional,
    }),
    [libraryKey, metrics, value]
  );
  const tags = (metrics?.tags ?? []).map(k => METRICS_BY_KEY.get(k)?.label ?? k);

  if (groups.length === 0) {
    return (
      <p className="text-xs text-[hsl(var(--foreground-muted))]">
        No standard metrics for this initiative yet.
      </p>
    );
  }

  const toggleFormat = (label: string) => {
    const next = chosenFormats.includes(label)
      ? chosenFormats.filter(l => l !== label)
      : formats.filter(l => l === label || chosenFormats.includes(l));
    onChange({ ...value, groupLabels: next.length === formats.length ? null : next });
  };

  const toggleOptional = (id: string) => {
    const excluded = value.excludedOptional.includes(id)
      ? value.excludedOptional.filter(x => x !== id)
      : [...value.excludedOptional, id];
    onChange({ ...value, excludedOptional: excluded });
  };

  // Derived rows that survive the selection, per library group.
  const builtDerived = (label: string | null): MetricSetMetric[] =>
    built?.groups.find(g => g.label === label)?.metrics.filter(m => m.source === 'derived') ?? [];

  return (
    <div className="space-y-3">
      {formats.length > 0 && (
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-[hsl(var(--foreground))]">Formats you run</legend>
          <div className="flex flex-wrap gap-3">
            {formats.map(label => {
              const id = `${baseId}-format-${label}`;
              const checked = chosenFormats.includes(label);
              return (
                <label key={label} htmlFor={id} className="inline-flex items-center gap-2 text-sm text-[hsl(var(--foreground))]">
                  <input
                    id={id}
                    type="checkbox"
                    checked={checked}
                    // The last format cannot be unticked: something must be tracked.
                    disabled={checked && chosenFormats.length === 1}
                    onChange={() => toggleFormat(label)}
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                  />
                  {label}
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {groups
        .filter(g => !g.selectable || chosenFormats.includes(g.label as string))
        .map((g, gi) => (
          <fieldset key={g.label ?? `general-${gi}`} className="space-y-1.5 rounded-[var(--radius-md)] border border-border p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]">
              {g.label ?? (groups.length > 1 ? 'Whole initiative' : 'Metrics')}
            </legend>
            <ul className="space-y-1.5">
              {g.metrics.filter(m => m.source === 'entered').map(m => {
                const hint = kindHint(m.kind, m.unit);
                if (!m.optional) {
                  return (
                    <li key={m.id} className="flex items-center gap-2 text-sm text-[hsl(var(--foreground))]">
                      <Check className="h-4 w-4 shrink-0 text-[hsl(var(--primary))]" aria-hidden="true" />
                      <span>{m.label}</span>
                      <span className="text-[11px] text-[hsl(var(--foreground-muted))]">({hint})</span>
                    </li>
                  );
                }
                const id = `${baseId}-opt-${m.id}`;
                return (
                  <li key={m.id}>
                    <label htmlFor={id} className="flex items-center gap-2 text-sm text-[hsl(var(--foreground))]">
                      <input
                        id={id}
                        type="checkbox"
                        checked={!value.excludedOptional.includes(m.id)}
                        onChange={() => toggleOptional(m.id)}
                        className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                      />
                      <span>{m.label}</span>
                      <span className="text-[11px] text-[hsl(var(--foreground-muted))]">({hint}, if applicable)</span>
                    </label>
                  </li>
                );
              })}
              {builtDerived(g.label).map(m => (
                <li key={`derived-${m.key}`} className="flex items-start gap-2 text-sm text-[hsl(var(--foreground-muted))]">
                  <Calculator className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="text-[hsl(var(--foreground))]">{m.label}</span>
                    {' '}— calculated automatically
                    {m.formula && <span className="block text-[11px]">{formulaInWords(m.formula)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}

      {tags.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-[hsl(var(--foreground-muted))]">
          <span>Also noted:</span>
          {tags.map(t => (
            <span key={t} className="rounded-full bg-[hsl(var(--background-muted))] px-2 py-0.5">{t}</span>
          ))}
        </p>
      )}
    </div>
  );
}
