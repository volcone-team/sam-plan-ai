'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';

/**
 * Table whose search and paging happen IN THE QUERY, not in the browser.
 *
 * Why this rather than filtering an array already loaded: client-side paging still
 * transfers every row, so the request grows without bound as the table does. At a
 * few thousand accounts the page becomes slow to load and heavy on the database
 * regardless of how few rows are displayed. Pushing both into the query keeps the
 * cost proportional to what is shown.
 *
 * The caller supplies a `fetchPage` function so this component stays agnostic
 * about the endpoint. It owns the page index, the search box, debouncing and the
 * loading state.
 */

export interface ServerColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export interface PageResult<T> {
  rows: T[];
  /** Total matching rows on the server, NOT the number returned. */
  total: number;
}

interface ServerDataTableProps<T> {
  /** Called on mount, on page change, and on a settled search term. */
  fetchPage: (args: { search: string; limit: number; offset: number }) => Promise<PageResult<T>>;
  columns: ServerColumn<T>[];
  rowKey: (row: T) => string;
  pageSize?: number;
  searchPlaceholder?: string;
  emptyMessage?: string;
  /** Change this value to force a reload — e.g. after a mutation elsewhere. */
  reloadToken?: unknown;
}

/** Typing should not fire a request per keystroke. */
const SEARCH_DEBOUNCE_MS = 350;

export function ServerDataTable<T>({
  fetchPage,
  columns,
  rowKey,
  pageSize = 20,
  searchPlaceholder = 'Search...',
  emptyMessage = 'Nothing to show.',
  reloadToken,
}: ServerDataTableProps<T>) {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce the search term. Committing it resets to page 0, because page 3 of
  // the old results is meaningless against a new filter.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(input.trim());
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input]);

  /**
   * Guards against a stale response overwriting a newer one. Requests can resolve
   * out of order — a slow page 1 landing after a fast page 2 would silently show
   * the wrong data — so each request is tagged and late arrivals are discarded.
   */
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPage({
        search,
        limit: pageSize,
        offset: page * pageSize,
      });
      if (id !== requestId.current) return; // superseded
      setRows(result.rows);
      setTotal(result.total);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : 'Could not load');
      setRows([]);
      setTotal(0);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [fetchPage, search, page, pageSize]);

  useEffect(() => { load(); }, [load, reloadToken]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Total can shrink beneath the current page (a filter, or deleted rows), which
  // would otherwise strand the user on an empty page.
  useEffect(() => {
    if (page > 0 && page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--foreground-muted))]" />
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="w-full min-w-[16rem] rounded-[var(--radius-md)] border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        {/* Inline, so refining a search does not blank the table it replaces. */}
        {loading && <Spinner size="sm" />}
      </div>

      {error && (
        <div role="alert" className="rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-4 py-3 text-sm text-[hsl(var(--destructive))]">
          {error}
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
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-[hsl(var(--foreground-muted))]"
                >
                  {loading ? '' : search ? `No matches for "${search}".` : emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
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

      {total > 0 && (
        <div className="flex items-center justify-between gap-2 text-xs text-[hsl(var(--foreground-muted))]">
          <span>
            {from}–{to} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
              aria-label="Previous page"
              className="rounded-[var(--radius-md)] border border-border p-1.5 hover:bg-[hsl(var(--background-muted))] disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-1">
              {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1 || loading}
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
