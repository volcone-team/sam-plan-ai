'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Clock, RefreshCw, Search, X } from 'lucide-react';
import {
  AUDIENCE_HEADINGS,
  buildCategoryList,
  buildIndex,
  buildRecents,
  buildTiles,
  searchItems,
  type PickerItem,
} from '@/lib/intake-v3/picker';
import { categoryById } from '@/lib/intake-v3/library-config';
import {
  categoryAnnouncement,
  countCategoryList,
  interpretPickerResponse,
  searchAnnouncement,
  type PickerLoad,
} from './intake-picker-view';

export interface IntakePickerProps {
  onSelect: (item: PickerItem) => void;
  onCancel?: () => void;
  /**
   * Data the caller already fetched from GET /api/intake-v3/picker. When
   * given, the picker does not fetch it again.
   */
  load?: PickerLoad;
}

/**
 * The two-screen initiative picker for the new Initiative Intake.
 *
 *   Above both screens  search (results replace the screens), Recently used,
 *                       and a collapsible "Browse all" index.
 *   Screen 1            category tiles with live counts, in tile order.
 *   Screen 2            one category's list, with audience headings where the
 *                       category asks for them (Webinars).
 *
 * Fetches GET /api/intake-v3/picker itself unless the caller passes `load`.
 * Every initiative is a button; clicking one calls onSelect. Mounted by
 * AddInitiativePanel, which passes `load`.
 */
export function IntakePicker({ onSelect, onCancel, load: preloaded }: IntakePickerProps) {
  /** Null while a request is in flight. */
  const [fetched, setLoad] = useState<PickerLoad | null>(null);
  const load = preloaded ?? fetched;
  const skipFetch = preloaded !== undefined;
  /** Bumped by Retry to re-run the fetch. */
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const baseId = useId();
  const searchId = `${baseId}-search`;
  const liveId = `${baseId}-live`;
  const rootRef = useRef<HTMLDivElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  /** What to focus after the next screen change. */
  const pendingFocus = useRef<{ kind: 'list-heading' } | { kind: 'tile'; id: string } | null>(null);

  useEffect(() => {
    if (skipFetch) return;
    let cancelled = false;
    (async () => {
      let result: PickerLoad;
      try {
        const response = await fetch('/api/intake-v3/picker', { cache: 'no-store' });
        const body: unknown = await response.json().catch(() => undefined);
        result = interpretPickerResponse(response.status, body);
      } catch {
        result = interpretPickerResponse(null, undefined);
      }
      if (!cancelled) setLoad(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, skipFetch]);

  const items = useMemo(() => (load?.status === 'ready' ? load.items : []), [load]);
  const recentKeys = useMemo(() => (load?.status === 'ready' ? load.recentKeys : []), [load]);

  const tiles = useMemo(() => buildTiles(items), [items]);
  const index = useMemo(() => buildIndex(items), [items]);
  const recents = useMemo(() => buildRecents(items, recentKeys), [items, recentKeys]);
  const results = useMemo(() => searchItems(items, query), [items, query]);
  const list = useMemo(
    () => (categoryId ? buildCategoryList(items, categoryId) : null),
    [items, categoryId]
  );

  const searching = query.trim() !== '';
  // A category that no longer resolves (e.g. after a reload) falls back to the tiles.
  const onListScreen = list !== null;

  // Move focus after a screen change: into the list heading, or back to the tile.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target.kind === 'list-heading') {
      listHeadingRef.current?.focus();
    } else {
      rootRef.current
        ?.querySelector<HTMLButtonElement>(`[data-tile-id="${CSS.escape(target.id)}"]`)
        ?.focus();
    }
  }, [categoryId]);

  const openCategory = (id: string) => {
    pendingFocus.current = { kind: 'list-heading' };
    setCategoryId(id);
  };

  const backToTiles = () => {
    if (categoryId) pendingFocus.current = { kind: 'tile', id: categoryId };
    setCategoryId(null);
  };

  const retry = () => {
    setLoad(null);
    setAttempt(a => a + 1);
  };

  const announcement =
    load?.status !== 'ready' || items.length === 0
      ? ''
      : searching
        ? searchAnnouncement(results.length, query)
        : list
          ? categoryAnnouncement(countCategoryList(list), list.category.label)
          : '';

  return (
    <div ref={rootRef} className="space-y-4">
      {/* Always mounted so screen readers pick up changes. */}
      <p id={liveId} aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {load === null && (
        <p role="status" className="px-1 py-6 text-center text-sm text-[hsl(var(--foreground-muted))]">
          Loading initiatives…
        </p>
      )}

      {load?.status === 'error' && (
        <div
          role="alert"
          className="space-y-3 rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
        >
          <p>{load.message}</p>
          <button
            type="button"
            onClick={retry}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-red-300 bg-background px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/50"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Try again
          </button>
        </div>
      )}

      {load?.status === 'ready' && items.length === 0 && (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm font-medium text-[hsl(var(--foreground))]">
            No initiatives are available here yet.
          </p>
          <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
            Nothing is wrong with your account. Initiatives will appear here once they have been set up.
          </p>
        </div>
      )}

      {load?.status === 'ready' && items.length > 0 && (
        <>
          {/* Search across every category. */}
          <div className="relative">
            <label htmlFor={searchId} className="sr-only">
              Search all initiatives
            </label>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--foreground-muted))]"
              aria-hidden="true"
            />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search all initiatives…"
              aria-describedby={liveId}
              className="w-full rounded-[var(--radius-md)] border border-border bg-background py-2 pl-9 pr-9 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))] placeholder:text-[hsl(var(--foreground-muted))]"
            />
            {searching && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          {searching ? (
            <section aria-labelledby={`${baseId}-results`} className="space-y-2">
              <h3 id={`${baseId}-results`} className="sr-only">
                Search results
              </h3>
              {results.length === 0 ? (
                <p className="px-1 py-4 text-center text-sm text-[hsl(var(--foreground-muted))]">
                  Nothing matches &ldquo;{query.trim()}&rdquo;. Try another word.
                </p>
              ) : (
                <ul className="space-y-2">
                  {results.map(r => (
                    <li key={r.item.key}>
                      <ItemButton
                        item={r.item}
                        label={`${r.categoryLabel} · ${r.audienceLabel}`}
                        onSelect={onSelect}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <>
              {recents.length > 0 && (
                <section aria-labelledby={`${baseId}-recents`} className="space-y-2">
                  <h3
                    id={`${baseId}-recents`}
                    className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]"
                  >
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    Recently used
                  </h3>
                  <ul className="flex flex-wrap gap-2">
                    {recents.map(item => (
                      <li key={item.key}>
                        <button
                          type="button"
                          onClick={() => onSelect(item)}
                          aria-label={`${item.name}, ${itemLabel(item)}`}
                          className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {item.name}
                          <span className="ml-1.5 text-[hsl(var(--foreground-muted))]">{itemLabel(item)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {onListScreen ? (
                <section aria-labelledby={`${baseId}-list`} className="space-y-4">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={backToTiles}
                      className="inline-flex items-center gap-1 rounded-[var(--radius-md)] p-1.5 text-sm text-[hsl(var(--foreground-muted))] transition-colors hover:bg-background hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                      All categories
                    </button>
                  </div>
                  <h3
                    id={`${baseId}-list`}
                    ref={listHeadingRef}
                    tabIndex={-1}
                    className="text-base font-semibold text-[hsl(var(--foreground))] outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-[var(--radius-sm)]"
                  >
                    {list.category.label}
                  </h3>
                  {list.intro && (
                    <p className="text-sm text-[hsl(var(--foreground-muted))]">{list.intro}</p>
                  )}
                  {list.groups.map(group => (
                    <div key={group.audience ?? 'all'} className="space-y-2">
                      {group.heading && (
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]">
                            {group.heading}
                          </h4>
                          {group.description && (
                            <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">
                              {group.description}
                            </p>
                          )}
                        </div>
                      )}
                      {group.sections.map(section => (
                        <div key={section.subheading ?? '_'} className="space-y-2">
                          {section.subheading &&
                            (group.heading ? (
                              <h5 className="text-xs font-medium text-[hsl(var(--foreground))]">{section.subheading}</h5>
                            ) : (
                              <h4 className="text-xs font-medium text-[hsl(var(--foreground))]">{section.subheading}</h4>
                            ))}
                          <ul className="space-y-2">
                            {section.items.map(item => (
                              <li key={item.key}>
                                <ItemButton
                                  item={item}
                                  // Grouped lists already say the audience in the heading.
                                  label={group.heading ? null : AUDIENCE_HEADINGS[item.audience].heading}
                                  onSelect={onSelect}
                                />
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ))}
                </section>
              ) : (
                <section aria-labelledby={`${baseId}-tiles`} className="space-y-2">
                  <h3
                    id={`${baseId}-tiles`}
                    className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]"
                  >
                    Categories
                  </h3>
                  <ul className="grid grid-cols-2 gap-2">
                    {tiles.map(tile => (
                      <li key={tile.id}>
                        <button
                          type="button"
                          data-tile-id={tile.id}
                          onClick={() => openCategory(tile.id)}
                          className="flex h-full w-full items-center justify-between gap-2 rounded-[var(--radius-lg)] border border-border bg-background p-3 text-left transition-colors hover:border-[hsl(var(--primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-[hsl(var(--foreground))]">
                              {tile.label}
                            </span>
                            <span className="block text-xs text-[hsl(var(--foreground-muted))]">
                              {tile.count} {tile.count === 1 ? 'initiative' : 'initiatives'}
                            </span>
                          </span>
                          <ChevronRight
                            className="h-4 w-4 shrink-0 text-[hsl(var(--foreground-muted))]"
                            aria-hidden="true"
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Native <details>: keyboard and screen-reader toggling for free. */}
              <details className="group rounded-[var(--radius-lg)] border border-border">
                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-[var(--radius-lg)] [&::-webkit-details-marker]:hidden">
                  Browse all initiatives
                  <ChevronDown
                    className="h-4 w-4 text-[hsl(var(--foreground-muted))] transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <div className="space-y-4 border-t border-border px-3 py-3">
                  {index.map(entry => (
                    <div key={entry.category.id} className="space-y-1">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]">
                        {entry.category.label}
                      </h4>
                      <ul className="space-y-0.5">
                        {entry.items.map(item => (
                          <li key={item.key}>
                            <button
                              type="button"
                              onClick={() => onSelect(item)}
                              className="w-full rounded-[var(--radius-md)] px-2 py-1 text-left text-sm text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--background-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {item.name}
                              <span className="ml-1.5 text-xs text-[hsl(var(--foreground-muted))]">
                                {AUDIENCE_HEADINGS[item.audience].heading}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
            </>
          )}
        </>
      )}

      {onCancel && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium text-[hsl(var(--foreground))] transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/** "Webinars · Your audience": what tells same-name records apart. */
function itemLabel(item: PickerItem): string {
  const category = categoryById(item.categoryId)?.label ?? item.categoryId;
  return `${category} · ${AUDIENCE_HEADINGS[item.audience].heading}`;
}

function ItemButton({
  item,
  label,
  onSelect,
}: {
  item: PickerItem;
  label: string | null;
  onSelect: (item: PickerItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="flex w-full items-start gap-3 rounded-[var(--radius-lg)] border border-border bg-background p-3 text-left transition-colors hover:border-[hsl(var(--primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-[hsl(var(--foreground))]">{item.name}</span>
        {label && (
          <span className="block text-xs font-medium text-[hsl(var(--foreground-muted))]">{label}</span>
        )}
        {item.oneLiner && (
          <span className="mt-0.5 block text-xs text-[hsl(var(--foreground-muted))] line-clamp-2">
            {item.oneLiner}
          </span>
        )}
      </span>
      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--foreground-muted))]" aria-hidden="true" />
    </button>
  );
}
