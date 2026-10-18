'use client';

import { useId, useMemo, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import {
  countGrouped,
  groupByCategory,
  type CustomerLibraryItem,
} from '@/lib/library/picker';
import { distinguishingLabelBesideOwnOrOps } from '@/lib/library/display-name';

/** The radio value for the "Custom initiative" option. Never a library key. */
export const CUSTOM_CHOICE = '__custom__';

export interface LibraryInitiativePickerProps {
  initiatives: readonly CustomerLibraryItem[];
  /** A library key, CUSTOM_CHOICE, or null when nothing is chosen. */
  value: string | null;
  onChange: (value: string) => void;
  loading?: boolean;
  error?: string | null;
}

/**
 * Every active library initiative, grouped by category, searchable.
 *
 * NATIVE RADIOS in one group, each category a <fieldset> with a <legend>. That
 * gives the keyboard behaviour for free — Tab into the group, arrows move the
 * choice, Space selects — and a screen reader announces "Paid Ads, group" and
 * the position in the set. Choosing does not navigate: arrowing through the
 * list must not jump to the next step, so the panel has a Continue button.
 */
export function LibraryInitiativePicker({
  initiatives,
  value,
  onChange,
  loading,
  error,
}: LibraryInitiativePickerProps) {
  const [search, setSearch] = useState('');
  const baseId = useId();
  const name = `${baseId}-initiative`;
  const searchId = `${baseId}-search`;
  const countId = `${baseId}-count`;

  const groups = useMemo(() => groupByCategory(initiatives, { search }), [initiatives, search]);
  const shown = countGrouped(groups);

  return (
    <div className="space-y-3">
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          Search initiatives
        </label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--foreground-muted))]"
          aria-hidden="true"
        />
        <input
          id={searchId}
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search initiatives…"
          aria-describedby={countId}
          className="w-full rounded-[var(--radius-md)] border border-border bg-background py-2 pl-9 pr-9 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))] placeholder:text-[hsl(var(--foreground-muted))]"
        />
        {search !== '' && (
          <button
            type="button"
            onClick={() => setSearch('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Polite live region so typing a search announces how many remain. */}
      <p id={countId} aria-live="polite" className="text-xs text-[hsl(var(--foreground-muted))]">
        {loading
          ? 'Loading initiatives…'
          : error
            ? ''
            : search.trim() === ''
              ? `${initiatives.length} initiatives`
              : `${shown} of ${initiatives.length} initiatives match`}
      </p>

      {error && (
        <p role="alert" className="rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error} You can still add a custom initiative.
        </p>
      )}

      <div role="radiogroup" aria-label="Initiative" className="space-y-4">
        {/* Custom stays first and is never filtered out by the search. */}
        <ChoiceRow
          name={name}
          value={CUSTOM_CHOICE}
          checked={value === CUSTOM_CHOICE}
          onChange={onChange}
          title="Custom initiative"
          subtitle="Create your own initiative with your own settings"
          dashed
          icon
        />

        {groups.map(group => (
          <fieldset key={group.category} className="space-y-2">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]">
              {group.category}
            </legend>
            {group.items.map(item => (
              <ChoiceRow
                key={item.key}
                name={name}
                value={item.key}
                checked={value === item.key}
                onChange={onChange}
                title={item.name}
                variantLabel={distinguishingLabelBesideOwnOrOps(item, initiatives)}
                subtitle={item.oneLiner}
                badge={platformBadge(item.ownOrOps)}
              />
            ))}
          </fieldset>
        ))}

        {!loading && !error && shown === 0 && search.trim() !== '' && (
          <p className="px-1 py-4 text-center text-sm text-[hsl(var(--foreground-muted))]">
            Nothing matches &ldquo;{search}&rdquo;. Try another word, or add a custom initiative.
          </p>
        )}
      </div>
    </div>
  );
}

function platformBadge(ownOrOps: string | null): string | null {
  const v = (ownOrOps ?? '').trim().toUpperCase();
  if (v === 'OWN') return 'Your audience';
  if (v === 'OPS') return "Someone else's";
  return null;
}

function ChoiceRow({
  name,
  value,
  checked,
  onChange,
  title,
  variantLabel,
  subtitle,
  badge,
  dashed,
  icon,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  title: string;
  /** Tells same-name variants apart; see display-name.ts. */
  variantLabel?: string | null;
  subtitle?: string | null;
  badge?: string | null;
  dashed?: boolean;
  icon?: boolean;
}) {
  return (
    <label
      className={`group flex cursor-pointer items-start gap-3 rounded-[var(--radius-lg)] border bg-background p-3 transition-colors focus-within:ring-2 focus-within:ring-ring ${
        dashed ? 'border-dashed' : ''
      } ${
        checked
          ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.05)]'
          : 'border-border hover:border-[hsl(var(--primary))]'
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
      />
      {icon && (
        <Plus className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--foreground-muted))]" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-[hsl(var(--foreground))]">{title}</span>
          {badge && (
            <span className="inline-flex items-center rounded-full bg-[hsl(var(--background-muted))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--foreground-muted))]">
              {badge}
            </span>
          )}
        </span>
        {variantLabel && (
          <span className="block text-xs font-medium text-[hsl(var(--foreground-muted))]">{variantLabel}</span>
        )}
        {subtitle && (
          <span className="mt-0.5 block text-xs text-[hsl(var(--foreground-muted))] line-clamp-2">{subtitle}</span>
        )}
      </span>
    </label>
  );
}
