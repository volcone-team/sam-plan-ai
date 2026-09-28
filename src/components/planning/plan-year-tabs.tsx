'use client';

/**
 * Year selector for the cadence screens.
 *
 * Only rendered when the plan actually covers more than one year - a 12-month
 * plan generated mid-year spans two, and without this its second half is
 * unreachable on Monthly/Quarterly/Reports. Single-year plans show nothing, so
 * no control appears where there is no choice to make.
 */
export function PlanYearTabs({
  years,
  selectedYear,
  onSelect,
  currentYear,
  className,
}: {
  years: number[];
  selectedYear: number;
  onSelect: (year: number) => void;
  currentYear: number;
  className?: string;
}) {
  if (years.length <= 1) return null;

  return (
    <div
      className={'flex flex-wrap items-center gap-1.5 ' + (className || '')}
      role="group"
      aria-label="Plan year"
    >
      {years.map((y) => {
        const active = y === selectedYear;
        return (
          <button
            key={y}
            type="button"
            onClick={() => onSelect(y)}
            aria-pressed={active}
            className={
              'rounded-[var(--radius-full)] px-3 py-1 text-xs font-semibold transition-colors ' +
              (active
                ? 'bg-[hsl(var(--foreground))] text-[hsl(var(--background))]'
                : 'border border-border text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background-muted))]')
            }
          >
            {y}
            {y === currentYear && (
              <span className="ml-1 text-[10px] font-normal opacity-70">now</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
