"use client";

import * as React from "react";
import { Check, Plus, Search, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { countGrouped, groupByCategory } from "@/lib/library/picker";
import { distinguishingLabel } from "@/lib/library/display-name";
import { browseScoreLabel } from "@/lib/recommend/score-display";

/** One active library initiative as the recommendations screen lists it. */
export interface LibraryOption {
  key: string;
  name: string;
  category: string | null;
  oneLiner: string | null;
  ownOrOps: string | null;
  /** From isEligible — a label, not a filter. */
  eligible: boolean;
  reason: string | null;
  forecast: number;
  /** SCORE for display. Optional so an older response still renders. */
  score?: {
    total: number;
    weightedTotal: number;
    complete: boolean;
    missing: string[];
  };
}


export interface AllInitiativesListProps {
  options: readonly LibraryOption[];
  /** Keys we recommended: badged and listed first within their category. */
  recommendedKeys: readonly string[];
  /** Keys currently selected for the plan. */
  selectedKeys: ReadonlySet<string>;
  /** Keys the user already entered themselves; shown, not addable here. */
  ownKeys: ReadonlySet<string>;
  /** True when the plan is full; adding is refused with the shared notice. */
  atCapacity: boolean;
  onToggle: (key: string) => void;
  /** The refusal notice, rendered here too so it is seen where the click was. */
  notice?: React.ReactNode;
}

/**
 * Every active initiative, grouped by category and searchable, under the
 * recommendation cards.
 *
 * Each row is a toggle button with `aria-pressed`, so a screen reader hears
 * "Paid Ads, toggle button, pressed". Selection runs through the screen's own
 * toggleAccept, so the five-initiative cap and its notice apply exactly as
 * they do to the cards.
 */
export function AllInitiativesList({
  options,
  recommendedKeys,
  selectedKeys,
  ownKeys,
  atCapacity,
  onToggle,
  notice,
}: AllInitiativesListProps) {
  const [search, setSearch] = React.useState("");
  const [hideNotFit, setHideNotFit] = React.useState(false);
  const headingId = React.useId();
  const searchId = React.useId();
  const countId = React.useId();
  const hideId = React.useId();

  const recommended = React.useMemo(() => new Set(recommendedKeys), [recommendedKeys]);
  // A not-a-fit initiative already in the plan stays visible, so the filter
  // never hides something the user would then be unable to remove.
  const visible = React.useMemo(
    () => (hideNotFit ? options.filter((o) => o.eligible || selectedKeys.has(o.key)) : options),
    [options, hideNotFit, selectedKeys]
  );
  const groups = React.useMemo(
    () => groupByCategory(visible, { search, pinFirst: recommendedKeys }),
    [visible, search, recommendedKeys]
  );
  const shown = countGrouped(groups);
  const anyIneligible = options.some((o) => !o.eligible);
  const filtered = search.trim() !== "" || visible.length < options.length;

  if (options.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="space-y-1">
        <h2 id={headingId} className="text-sm font-semibold text-foreground">
          Every initiative
        </h2>
        <p className="text-xs text-[hsl(var(--foreground-muted))]">
          Prefer something else? Pick any initiative below. Ours are marked
          Recommended.
        </p>
        {anyIneligible && (
          <p className="text-xs text-[hsl(var(--foreground-muted))]">
            Initiatives that are not a fit for your business, are still shown; but labeled.
          </p>
        )}
      </div>

      {anyIneligible && (
        <div className="flex items-center gap-2">
          <input
            id={hideId}
            type="checkbox"
            checked={hideNotFit}
            onChange={(e) => setHideNotFit(e.target.checked)}
            className="h-4 w-4 rounded border-input accent-[hsl(var(--primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <label htmlFor={hideId} className="text-sm text-foreground">
            Hide initiatives that are not a fit
          </label>
        </div>
      )}

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
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search initiatives…"
          aria-describedby={countId}
          className="w-full rounded-[var(--radius-md)] border border-input bg-background py-2 pl-9 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {search !== "" && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[hsl(var(--foreground-muted))] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      <p id={countId} aria-live="polite" className="text-xs text-[hsl(var(--foreground-muted))]">
        {filtered ? `${shown} of ${options.length} initiatives shown` : `${options.length} initiatives`}
      </p>

      {notice}

      <div className="max-h-[28rem] overflow-y-auto rounded-[var(--radius-md)] border border-border">
        {shown === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-[hsl(var(--foreground-muted))]">
            {search.trim() !== ""
              ? <>Nothing matches &ldquo;{search}&rdquo;.</>
              : "Every initiative is hidden by the filter above."}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.category} role="group" aria-label={group.category}>
              <p
                aria-hidden="true"
                className="sticky top-0 z-10 border-b border-border bg-[hsl(var(--background-muted))] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]"
              >
                {group.category}
              </p>
              <ul>
                {group.items.map((option) => {
                  const own = ownKeys.has(option.key);
                  const selected = selectedKeys.has(option.key);
                  const isRecommended = recommended.has(option.key);
                  return (
                    <li key={option.key} className="border-b border-border last:border-b-0">
                      {own ? (
                        <div className="flex items-start gap-3 px-3 py-2.5 opacity-70">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--primary))]" aria-hidden="true" />
                          <RowText option={option} siblings={options} />
                          <Badge>Already planning</Badge>
                        </div>
                      ) : (
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => onToggle(option.key)}
                          // Not disabled at capacity: the click is refused WITH an
                          // explanation, which a disabled button cannot give.
                          className={cn(
                            "flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[hsl(var(--background-muted))] focus-visible:bg-[hsl(var(--background-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            selected && "bg-[hsl(var(--primary)_/_0.06)]",
                            isRecommended && !selected && "bg-[hsl(var(--primary)_/_0.03)]"
                          )}
                        >
                          {selected ? (
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--primary))]" aria-hidden="true" />
                          ) : (
                            <Plus
                              className={cn(
                                "mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--foreground-muted))]",
                                atCapacity && "opacity-50"
                              )}
                              aria-hidden="true"
                            />
                          )}
                          <RowText option={option} siblings={options} />
                          <span className="flex shrink-0 flex-col items-end gap-1">
                            {isRecommended && (
                              <Badge tone="primary">
                                <Sparkles className="h-3 w-3" aria-hidden="true" />
                                Recommended
                              </Badge>
                            )}
                            {selected && <Badge tone="primary">In your plan</Badge>}
                            {!option.eligible && <Badge tone="warning">Not a fit</Badge>}
                            {option.eligible && browseScoreLabel(option.score) && (
                              <span
                                className="text-[10px] font-semibold tabular-nums text-[hsl(var(--foreground-muted))]"
                                title={
                                  option.score && !option.score.complete
                                    ? "Provisional: some scores are not filled in yet"
                                    : undefined
                                }
                              >
                                {browseScoreLabel(option.score)}
                              </span>
                            )}
                          </span>
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function RowText({ option, siblings }: { option: LibraryOption; siblings: readonly LibraryOption[] }) {
  const subtitle = distinguishingLabel(option, siblings);
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-medium text-foreground">{option.name}</span>
      {subtitle && (
        <span className="block text-xs font-medium text-[hsl(var(--foreground-muted))]">
          {subtitle}
        </span>
      )}
      {option.oneLiner && (
        <span className="mt-0.5 block text-xs text-[hsl(var(--foreground-muted))]">
          {option.oneLiner}
        </span>
      )}
      {/*
        The reason gets its own full-width line rather than living in a pill:
        a sentence squeezed into a 12rem badge wrapped into a ragged column.
      */}
      {!option.eligible && option.reason && (
        <span className="mt-1 block text-xs text-foreground">
          <span className="font-medium">Not a fit:</span> {option.reason}
        </span>
      )}
    </span>
  );
}

function Badge({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "primary" | "warning";
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-[12rem] items-center gap-1 rounded-full px-2 py-0.5 text-right text-[10px] font-medium",
        tone === "primary" && "bg-[hsl(var(--primary)_/_0.12)] text-[hsl(var(--primary))]",
        tone === "warning" && "bg-[hsl(var(--warning)_/_0.15)] text-foreground",
        tone === "muted" && "bg-[hsl(var(--background-muted))] text-[hsl(var(--foreground-muted))]"
      )}
    >
      {children}
    </span>
  );
}
