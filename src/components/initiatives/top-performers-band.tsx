import { Trophy } from 'lucide-react';
import type { RankedPerformer } from '@/lib/top-performers';

export interface TopPerformersBandProps {
  /** Already ranked by `rankTopPerformers` - at most three rows are rendered. */
  performers: RankedPerformer[];
  /** The year being ranked, used in the empty-state copy. */
  year?: number;
  /**
   * Self-reported fallback from the intake questionnaire
   * (`planning_inputs.successful_initiative_types`), in the order the user
   * chose them. Used only when `performers` is empty. Deliberately carries NO
   * revenue figures - the user told us these channels worked, they did not tell
   * us what each one earned, and splitting `prior_year_revenue` across them
   * would be inventing numbers.
   */
  selfReported?: string[];
  /** Total prior-year revenue, shown once as context beside the fallback. */
  priorYearRevenue?: number;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

/**
 * "Top performers last year" band.
 *
 * With no ranked performers it explains why rather than disappearing. Every
 * account starts with an empty `results` table, so hiding the section entirely
 * made a working feature look unbuilt - which is worse than an honest empty
 * state. Blank rows are still avoided; the copy replaces them.
 */
export function TopPerformersBand({
  performers,
  year,
  selfReported,
  priorYearRevenue,
}: TopPerformersBandProps) {
  const rows = performers.slice(0, 3);
  const fallback = rows.length === 0 ? (selfReported || []).filter(Boolean).slice(0, 3) : [];

  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-[hsl(var(--primary)/0.06)] p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Trophy className="h-4 w-4 text-[hsl(var(--primary))]" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-[hsl(var(--foreground))]">
          Top performers last year
        </h2>
      </div>
      <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
        Double down on what already worked.
      </p>

      {rows.length === 0 && fallback.length > 0 ? (
        <>
          <ul className="mt-4 space-y-2.5">
            {fallback.map((name, i) => (
              <li key={name} className="flex items-center gap-3">
                <span className="w-7 shrink-0 text-xs font-bold tabular-nums text-[hsl(var(--primary))]">
                  #{i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[hsl(var(--foreground))]">
                  {name}
                </span>
                <span className="shrink-0 text-xs text-[hsl(var(--foreground-muted))]">
                  you told us
                </span>
              </li>
            ))}
          </ul>
          {/* Never attribute revenue to a self-reported channel. */}
          <p className="mt-3 text-xs text-[hsl(var(--foreground-muted))]">
            From your intake answers, not measured results
            {priorYearRevenue && priorYearRevenue > 0
              ? ` (${formatCurrency(priorYearRevenue)} total last year)`
              : ''}
            . Log weekly actuals and this ranks by real revenue.
          </p>
        </>
      ) : rows.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-md)] border border-dashed border-border/70 px-4 py-3 text-sm text-[hsl(var(--foreground-muted))]">
          No revenue logged{year ? ` for ${year}` : ' yet'}. Record weekly actuals against your
          initiatives and the ones that earned the most will be ranked here.
        </p>
      ) : (
      <ul className="mt-4 space-y-2.5">
        {rows.map(performer => (
          <li key={performer.initiativeId} className="flex items-center gap-3">
            <span className="w-7 shrink-0 text-xs font-bold tabular-nums text-[hsl(var(--primary))]">
              #{performer.rank}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-[hsl(var(--foreground))]">
              {performer.name}
            </span>
            {/* Decorative: the rank and the figure either side already say it. */}
            <div
              className="hidden h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-[hsl(var(--background-muted))] sm:block md:w-36"
              aria-hidden="true"
            >
              <div
                className="h-full rounded-full bg-[hsl(var(--primary))]"
                style={{ width: `${performer.barPercent}%` }}
              />
            </div>
            <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-[hsl(var(--foreground))]">
              {formatCurrency(performer.revenue)}
            </span>
          </li>
        ))}
      </ul>
      )}
    </section>
  );
}
