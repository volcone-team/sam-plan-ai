'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Table with search and pagination.
 *
 * Both are CLIENT-side, filtering and paging an array already in memory. That is
 * the right trade at current scale (tens to low hundreds of rows) and keeps the
 * component reusable without every caller needing a paginated endpoint.
 *
 * It will stop being the right trade: once a table holds thousands of rows the
 * request that loads them becomes the bottleneck, and search/paging need to move
 * into the query. The `searchOf` accessor is deliberately per-column so that move
 * is mechanical rather than a rewrite.
 */

export interface Column<T> {
  key: string;
  header: string;
  /** Cell contents. */
  render: (row: T) => ReactNode;
  /** Text this column contributes to search. Omit to exclude it from matching. */
  searchOf?: (row: T) => string | null | undefined;
  className?: string;
}

interface DataTableProps<T> {
  rows: readonly T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Hidden below this many rows — searching 5 items is noise. */
  searchThreshold?: number;
  pageSize?: number;
  emptyMessage?: string;
  searchPlaceholder?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchThreshold = 8,
  pageSize = 15,
  emptyMessage = 'Nothing to show.',
  searchPlaceholder = 'Search...',
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    // Every search term must appear somewhere in the row, so "acme past" narrows
    // rather than widening as it would with OR matching.
    const terms = q.split(/\s+/);
    return rows.filter((row) => {
      const haystack = columns
        .map((c) => (c.searchOf ? c.searchOf(row) ?? '' : ''))
        .join(' ')
        .toLowerCase();
      return terms.every((t) => haystack.includes(t));
    });
  }, [rows, columns, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Clamped rather than stored: filtering can shrink the list below the current
  // page, which would otherwise show an empty table with no way back.
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const showSearch = rows.length >= searchThreshold;
  const showPager = filtered.length > pageSize;

  return (
    <div className="space-y-3">
      {showSearch && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--foreground-muted))]" />
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="w-full max-w-sm rounded-[var(--radius-md)] border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
      )}

      <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-[hsl(var(--foreground-muted))]">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={cn('px-4 py-2 font-medium', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-6 text-center text-[hsl(var(--foreground-muted))]"
                >
                  {query ? `No matches for "${query}".` : emptyMessage}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={rowKey(row)} className="border-b border-border last:border-0">
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-4 py-2', c.className)}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showPager && (
        <div className="flex items-center justify-between gap-2 text-xs text-[hsl(var(--foreground-muted))]">
          <span>
            {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, filtered.length)} of{' '}
            {filtered.length}
            {query && rows.length !== filtered.length && ` (filtered from ${rows.length})`}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(Math.max(0, safePage - 1))}
              disabled={safePage === 0}
              aria-label="Previous page"
              className="rounded-[var(--radius-md)] border border-border p-1.5 hover:bg-[hsl(var(--background-muted))] disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-1">
              {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
              disabled={safePage >= pageCount - 1}
              aria-label="Next page"
              className="rounded-[var(--radius-md)] border border-border p-1.5 hover:bg-[hsl(var(--background-muted))] disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
