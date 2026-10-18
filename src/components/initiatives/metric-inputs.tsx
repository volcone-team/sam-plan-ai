'use client';

/**
 * Metric-set inputs and read-outs, shared by the Results tab and the weekly
 * planner so the two cannot diverge.
 *
 * Inputs are plain `type="text"` with `inputMode="decimal"` (or "numeric"
 * for counts) and are validated by `normaliseMetricInput`. Not
 * `NumberInputRaw`: its digit-grouping reformat is built for whole money
 * amounts, and a metric field must accept partial decimals ("0.", "12.")
 * and a typed "%" without reformatting under the cursor.
 */
import { computeDerived, type InitiativeMetricSet } from '@/lib/metrics/metric-set';
import {
  fieldLabelWithUnit,
  formatMetricValue,
  metricGroupsOf,
  normaliseMetricInput,
  otherMetricEntries,
  otherMetricLabel,
  parseMetricDraft,
  type MetricFieldGroup,
} from '@/lib/metrics/result-metrics';

const inputClass =
  'w-full rounded-[var(--radius-md)] border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]';

export interface MetricInputsProps {
  set: InitiativeMetricSet;
  /** Raw text by field id. */
  values: Readonly<Record<string, string>>;
  onChange: (next: Record<string, string>) => void;
  /** Makes element ids unique when several forms are on a page. */
  idPrefix: string;
}

/** Inputs per group, with live read-only derived values. */
export function MetricInputs({ set, values, onChange, idPrefix }: MetricInputsProps) {
  const groups = metricGroupsOf(set);
  const derived = computeDerived(set, parseMetricDraft(groups, values).values);
  const showHeadings = groups.length >= 2;
  const domId = (fieldId: string) => `${idPrefix}-${fieldId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  return (
    <div className="space-y-4">
      {groups.map((g, gi) => (
        <fieldset key={`${g.label ?? 'general'}-${gi}`} className="space-y-2">
          {showHeadings ? (
            <legend className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground))] mb-1">
              {g.label ?? 'General'}
            </legend>
          ) : (
            <legend className="sr-only">Metrics</legend>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.fields.map(f => {
              const id = domId(f.id);
              const raw = values[f.id] ?? '';
              const check = normaliseMetricInput(f.kind, raw);
              const errorId = `${id}-error`;
              return (
                <div key={f.id}>
                  <label htmlFor={id} className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
                    {fieldLabelWithUnit(f)}
                    {f.optional && <span className="font-normal"> (optional)</span>}
                  </label>
                  <input
                    id={id}
                    type="text"
                    inputMode={f.kind === 'count' ? 'numeric' : 'decimal'}
                    autoComplete="off"
                    value={raw}
                    onChange={e => onChange({ ...values, [f.id]: e.target.value })}
                    aria-invalid={!check.ok || undefined}
                    aria-describedby={!check.ok ? errorId : undefined}
                    className={`${inputClass} ${check.ok ? 'border-border' : 'border-red-500'}`}
                  />
                  {!check.ok && (
                    <p id={errorId} role="alert" className="mt-1 text-xs text-red-700">{check.error}</p>
                  )}
                </div>
              );
            })}
          </div>
          {g.derived.length > 0 && (
            <ul className="space-y-1">
              {g.derived.map(d => {
                const id = domId(d.id);
                return (
                  <li key={d.id} className="text-xs text-[hsl(var(--foreground-muted))]">
                    <output id={id} aria-describedby={`${id}-formula`} aria-live="polite">
                      <span className="font-medium text-[hsl(var(--foreground))]">{d.label}:</span>{' '}
                      {formatMetricValue(d.kind, d.unit, derived[d.id])}
                    </output>
                    <span id={`${id}-formula`}> — {d.formulaText}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>
      ))}
    </div>
  );
}

/** True when any field of the draft is invalid. */
export function metricDraftHasErrors(set: InitiativeMetricSet, values: Readonly<Record<string, string>>): boolean {
  return Object.keys(parseMetricDraft(metricGroupsOf(set), values).errors).length > 0;
}

function ValueChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-xs bg-[hsl(var(--background-muted))] px-1.5 py-0.5 rounded">
      {label}: {value}
    </span>
  );
}

/**
 * One result's metrics, read-only: entered values, derived values, then any
 * stored key the set does not own under "Other recorded metrics".
 */
export function MetricValuesView({ set, metrics }: { set: InitiativeMetricSet; metrics: Readonly<Record<string, number>> | null | undefined }) {
  const groups: MetricFieldGroup[] = metricGroupsOf(set);
  const stored = metrics ?? {};
  const derived = computeDerived(set, stored);
  const other = otherMetricEntries(groups, stored);
  const showHeadings = groups.length >= 2;

  const groupChips = groups.map(g => ({
    label: g.label,
    entered: g.fields.filter(f => typeof stored[f.id] === 'number'),
    derived: g.derived.filter(d => derived[d.id] !== null && derived[d.id] !== undefined),
  })).filter(x => x.entered.length > 0 || x.derived.length > 0);

  if (groupChips.length === 0 && other.length === 0) return null;

  return (
    <div className="space-y-2">
      {groupChips.map((x, i) => (
        <div key={`${x.label ?? 'general'}-${i}`}>
          <p className="text-xs text-[hsl(var(--foreground-muted))]">{showHeadings ? (x.label ?? 'General') : 'Metrics'}</p>
          <div className="flex flex-wrap gap-1.5 mt-0.5">
            {x.entered.map(f => (
              <ValueChip key={f.id} label={f.label} value={formatMetricValue(f.kind, f.unit, stored[f.id])} />
            ))}
            {x.derived.map(d => (
              <ValueChip key={d.id} label={d.label} value={formatMetricValue(d.kind, d.unit, derived[d.id])} />
            ))}
          </div>
        </div>
      ))}
      {other.length > 0 && (
        <div>
          <p className="text-xs text-[hsl(var(--foreground-muted))]">Other recorded metrics</p>
          <div className="flex flex-wrap gap-1.5 mt-0.5">
            {other.map(([k, v]) => (
              <ValueChip key={k} label={otherMetricLabel(k)} value={v.toLocaleString('en-US', { maximumFractionDigits: 2 })} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
