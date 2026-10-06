'use client';

import { useState } from 'react';
import { ArrowUpRight, CalendarDays, Trash2, Trophy } from 'lucide-react';
import { formatDate, formatRelativeDays } from '@/lib/format-date';
import { formatMoney } from '@/lib/format-money';
import { progressPercent } from '@/lib/top-performers';
import type { Initiative } from '@/types';
import type { DifficultyDimensions } from '@/types/initiative-type.types';

export interface InitiativeCardProps {
  initiative: Initiative;
  initiativeTypeName: string;
  productName: string;
  /**
   * Channel of the initiative type, e.g. `webinar`. Shown in the meta row in
   * place of the type name when available.
   */
  channel?: string;
  /**
   * Difficulty dimensions of the initiative type, on the documented 1-10 scale.
   * Partial because rows created by the plan generator can carry an empty
   * `difficulty` object.
   */
  difficulty?: Partial<DifficultyDimensions>;
  /**
   * Actual revenue and spend for the current year, summed from `results`.
   * Absent or zero is the normal case before any results are logged.
   */
  actuals?: { revenue: number; spend: number };
  /**
   * Where an initiative with this name placed in last year's ranking. Supplied
   * by the caller via `findPerformerByName` - see `@/lib/top-performers` for why
   * the match is by name and what that means for renamed initiatives.
   */
  lastYear?: { rank: number; revenue: number };
  onViewDetails?: (id: string) => void;
  onRemove?: (id: string) => void;
}

const STATUS_STYLES: Record<string, { label: string; dot: string; pill: string }> = {
  planned: {
    label: 'Planned',
    dot: 'bg-[hsl(var(--foreground-subtle))]',
    pill: 'bg-[hsl(var(--background-muted))] text-[hsl(var(--foreground-muted))]',
  },
  in_progress: {
    label: 'In Progress',
    dot: 'bg-blue-500',
    pill: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  },
  launched: {
    label: 'Launched',
    dot: 'bg-green-500',
    pill: 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  },
  completed: {
    label: 'Completed',
    dot: 'bg-emerald-500',
    pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  paused: {
    label: 'Paused',
    dot: 'bg-yellow-500',
    pill: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300',
  },
  retired: {
    label: 'Retired',
    dot: 'bg-gray-400',
    pill: 'bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300',
  },
};

/** Compact money, sign-safe so a negative NET never reads as `$-1,200`. */
// Full comma-separated figures — see lib/format-money.
const formatCurrency = formatMoney;

/** Dots rendered per difficulty meter. */
const DIFFICULTY_DOTS = 5;

/**
 * Difficulty is stored on the documented 1-10 scale (see `DifficultyLevel` in
 * `initiative-type.types.ts` and DOMAIN_MODEL.md), while the card shows five
 * dots. Halving and rounding up keeps a rated dimension at a minimum of one
 * dot: 1-2 -> 1, 3-4 -> 2, 5-6 -> 3 (the seed default), 7-8 -> 4, 9-10 -> 5.
 * Unrated dimensions return null and render as an empty, labelled meter.
 */
function toDots(level: number | undefined): number | null {
  if (typeof level !== 'number' || !Number.isFinite(level) || level <= 0) return null;
  return Math.min(DIFFICULTY_DOTS, Math.max(1, Math.ceil(level / 2)));
}

function DifficultyMeter({
  short,
  label,
  level,
}: {
  short: string;
  label: string;
  level: number | undefined;
}) {
  const dots = toDots(level);
  const description =
    dots === null ? `${label}: not rated` : `${label}: ${dots} of ${DIFFICULTY_DOTS}`;

  return (
    <div className="flex items-center gap-1" role="img" aria-label={description}>
      <span
        className="text-[10px] font-bold text-[hsl(var(--foreground-subtle))]"
        aria-hidden="true"
      >
        {short}
      </span>
      <span className="flex items-center gap-[2px]" aria-hidden="true">
        {Array.from({ length: DIFFICULTY_DOTS }, (_, index) => (
          <span
            key={index}
            className={
              'h-1.5 w-1.5 rounded-full ' +
              (dots !== null && index < dots
                ? 'bg-[hsl(var(--foreground-muted))]'
                : 'bg-[hsl(var(--background-muted))]')
            }
          />
        ))}
      </span>
    </div>
  );
}

function MiniBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div
      className="h-1 w-full overflow-hidden rounded-full bg-[hsl(var(--background-muted))]"
      aria-hidden="true"
    >
      <div className={'h-full rounded-full ' + color} style={{ width: `${percent}%` }} />
    </div>
  );
}

function ScenarioBox({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      className={
        'rounded-[var(--radius-md)] px-2 py-1.5 text-center ' +
        (accent
          ? 'bg-[hsl(var(--primary)/0.1)] ring-1 ring-inset ring-[hsl(var(--primary)/0.25)]'
          : 'bg-[hsl(var(--background-muted)/0.6)]')
      }
    >
      <p
        className={
          'text-[10px] font-semibold uppercase tracking-wider ' +
          (accent ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--foreground-subtle))]')
        }
      >
        {label}
      </p>
      <p
        className={
          'mt-0.5 text-xs font-bold tabular-nums ' + (accent ? 'text-[hsl(var(--primary))]' : '')
        }
      >
        {formatCurrency(value)}
      </p>
    </div>
  );
}

/**
 * Dense initiative card: status and channel meta, actual vs expected revenue,
 * spend against budget, NET/ROI, the three revenue scenarios, and the initiative
 * type's difficulty profile.
 *
 * The whole card is one button (a stretched overlay) rather than a clickable
 * container wrapping more buttons, so there is exactly one primary action in the
 * tab order. The remove control sits above that overlay as a sibling.
 */
export function InitiativeCard({
  initiative,
  initiativeTypeName,
  productName,
  channel,
  difficulty,
  actuals,
  lastYear,
  onViewDetails,
  onRemove,
}: InitiativeCardProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  const status = STATUS_STYLES[initiative.status] || STATUS_STYLES.planned;

  const actualRevenue = actuals?.revenue || 0;
  // Matches the existing actuals convention: prefer logged results, fall back to
  // the spend recorded on the initiative itself.
  const spend = actuals?.spend || initiative.actualSpend || 0;
  const expectedRevenue = initiative.revenueScenarios?.better || 0;
  const plannedBudget = initiative.plannedBudget || 0;
  const net = actualRevenue - spend;
  // No spend means ROI is undefined, not Infinity and not -100%.
  const roi = spend > 0 ? Math.round((net / spend) * 100) : null;

  const revenuePercent = progressPercent(actualRevenue, expectedRevenue);
  const spendPercent = progressPercent(spend, plannedBudget);

  const anchorDate = initiative.eventDate || initiative.activationDate;
  const relativeDate = formatRelativeDays(anchorDate);

  return (
    <div className="group relative flex h-full flex-col rounded-[var(--radius-lg)] border border-border bg-card p-4 transition-colors hover:border-[hsl(var(--primary))] sm:p-5">
      {/* Primary action. Covers the card, so the whole surface is clickable
          while only one control is in the tab order. */}
      {onViewDetails && (
        <button
          type="button"
          onClick={() => onViewDetails(initiative.id)}
          className="absolute inset-0 rounded-[var(--radius-lg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--primary))]"
        >
          <span className="sr-only">View {initiative.name}</span>
        </button>
      )}

      {/* Meta row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={'h-1.5 w-1.5 shrink-0 rounded-full ' + status.dot} aria-hidden="true" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
            {channel || initiativeTypeName}
          </span>
          <span className="rounded-full bg-[hsl(var(--background-muted))] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
            {initiative.kind}
          </span>
          {lastYear && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--primary)/0.1)] px-1.5 py-0.5 text-[10px] font-semibold text-[hsl(var(--primary))]">
              <Trophy className="h-2.5 w-2.5" aria-hidden="true" />#{lastYear.rank} last year
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onRemove && (
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              className="relative z-10 rounded-[var(--radius-md)] p-1 text-[hsl(var(--foreground-subtle))] transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] dark:hover:bg-red-500/15"
              aria-label={`Remove ${initiative.name}`}
              title="Remove from plan"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {onViewDetails && (
            <ArrowUpRight
              className="h-4 w-4 text-[hsl(var(--foreground-subtle))] transition-colors group-hover:text-[hsl(var(--primary))]"
              aria-hidden="true"
            />
          )}
        </div>
      </div>

      {/* Title + subtitle */}
      <h3 className="mt-2 line-clamp-2 text-sm font-semibold text-[hsl(var(--foreground))]">
        {initiative.name}
      </h3>
      <p className="mt-0.5 truncate text-xs text-[hsl(var(--foreground-muted))]">
        {productName}
        {lastYear && ` · ${formatCurrency(lastYear.revenue)} last year`}
      </p>

      {/* Headline figures */}
      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xl font-bold tabular-nums text-[hsl(var(--foreground))]">
            {formatCurrency(actualRevenue)}
          </span>
          <span className="ml-1 text-xs text-[hsl(var(--foreground-muted))]">
            / {formatCurrency(expectedRevenue)} expected
          </span>
        </div>
        {relativeDate && (
          <span
            className="flex shrink-0 items-center gap-1 text-xs text-[hsl(var(--foreground-muted))]"
            title={formatDate(anchorDate)}
          >
            <CalendarDays className="h-3 w-3" aria-hidden="true" />
            {/* "13d out" on its own is ambiguous without the date it counts to. */}
            <span className="sr-only">
              {initiative.eventDate ? 'Event date' : 'Activation date'}: {formatDate(anchorDate)},{' '}
            </span>
            {relativeDate}
          </span>
        )}
      </div>

      {/* Revenue progress */}
      <div className="mt-1.5">
        <MiniBar percent={revenuePercent} color="bg-[hsl(var(--foreground))]" />
      </div>

      {/* Spend */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
          Spend
        </span>
        <div className="min-w-0 flex-1">
          <MiniBar percent={spendPercent} color="bg-emerald-500" />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-[hsl(var(--foreground-muted))]">
          {formatCurrency(spend)} / {formatCurrency(plannedBudget)}
        </span>
      </div>

      {/* NET / ROI */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-[var(--radius-md)] bg-[hsl(var(--background-muted)/0.6)] px-2.5 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
            Net
          </p>
          {/* The minus sign carries the meaning; colour only reinforces it. */}
          <p
            className={
              'mt-0.5 text-sm font-bold tabular-nums ' + (net < 0 ? 'text-red-600 dark:text-red-400' : '')
            }
          >
            {formatCurrency(net)}
          </p>
        </div>
        <div className="rounded-[var(--radius-md)] bg-[hsl(var(--background-muted)/0.6)] px-2.5 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
            ROI
          </p>
          <p
            className={
              'mt-0.5 text-sm font-bold tabular-nums ' +
              (roi !== null && roi < 0 ? 'text-red-600 dark:text-red-400' : '')
            }
          >
            {roi === null ? '—' : `${roi > 0 ? '+' : ''}${roi}%`}
          </p>
        </div>
      </div>

      {/* Scenarios */}
      <div className="mt-2 grid grid-cols-3 gap-2">
        <ScenarioBox label="Good" value={initiative.revenueScenarios?.good || 0} />
        <ScenarioBox label="Better" value={initiative.revenueScenarios?.better || 0} />
        <ScenarioBox label="Best" value={initiative.revenueScenarios?.best || 0} accent />
      </div>

      {/* Footer: difficulty profile + status */}
      <div className="flex-1" />
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <DifficultyMeter short="S" label="Skill required" level={difficulty?.skillExpertiseRequired} />
          <DifficultyMeter short="T" label="Time to results" level={difficulty?.timeToResults} />
          <DifficultyMeter short="$" label="Cost to run" level={difficulty?.costToRun} />
          <DifficultyMeter short="P" label="Effort to implement" level={difficulty?.effortToImplement} />
        </div>
        <span
          className={
            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ' +
            status.pill
          }
        >
          {status.label}
        </span>
      </div>

      {/* Remove confirmation dialog */}
      {showConfirm && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/30"
            onClick={() => setShowConfirm(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`remove-initiative-${initiative.id}`}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-lg)] border border-border bg-card p-6 text-left shadow-lg"
          >
            <h3
              id={`remove-initiative-${initiative.id}`}
              className="text-lg font-semibold text-[hsl(var(--foreground))]"
            >
              Remove Initiative
            </h3>
            <p className="mt-2 text-sm text-[hsl(var(--foreground-muted))]">
              Are you sure you want to remove <strong>{initiative.name}</strong> from the plan? This
              action cannot be undone.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium text-[hsl(var(--foreground-muted))] transition-colors hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirm(false);
                  onRemove?.(initiative.id);
                }}
                className="rounded-[var(--radius-md)] bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
              >
                Remove
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
