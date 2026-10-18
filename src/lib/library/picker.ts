/**
 * The customer-facing initiative library: what the pickers may see, and how
 * they group and search it.
 *
 * Shared by the recommendations screen's "every initiative" list and the
 * in-app Add Initiative panel, so both group, order and search identically.
 *
 * Grouped by the workbook's own `category`. The Oct 2026 workbook writes
 * readable categories ("Paid Ads", "Webinars", "Local Presence"), so they are
 * shown as written rather than remapped — a re-uploaded workbook with a new
 * category simply gets a new heading.
 */

import type { LibraryEntry } from "@/lib/workbook/read";
import type { StoredMetrics } from "@/lib/metrics/parse-metrics";
import { libraryMetricsFor } from "@/lib/metrics/library-metric-set";

/**
 * One initiative as a customer picker receives it.
 *
 * DELIBERATELY NARROW. Price tier, sales-team need, ideal industries, AI
 * context and the raw Metrics cell are inputs to OUR recommendation rules and
 * stay server-side; nothing here is admin-only.
 */
export interface CustomerLibraryItem {
  key: string;
  name: string;
  category: string | null;
  oneLiner: string | null;
  ownOrOps: string | null;
  /** S/C/O/R/E, each 1-5 where 5 is best; null where the workbook is blank. */
  scores: {
    speed: number | null;
    cost: number | null;
    odds: number | null;
    revenue: number | null;
    ease: number | null;
    total: number | null;
  };
  /** Parsed Metrics cell (stored, else parsed live from the raw cell); null when there is none. */
  metrics: StoredMetrics | null;
}

export function toCustomerLibraryItem(entry: LibraryEntry): CustomerLibraryItem {
  return {
    key: entry.initiativeKey,
    name: entry.name,
    category: entry.category,
    oneLiner: entry.oneLiner,
    ownOrOps: entry.ownOrOps,
    scores: {
      speed: entry.speedScore,
      cost: entry.costScore,
      odds: entry.oddsScore,
      revenue: entry.revenueScore,
      ease: entry.easeScore,
      total: entry.scoreTotal,
    },
    // Stored parse, else a live parse of the raw cell (not yet re-uploaded),
    // so the picker shows what POST /api/initiatives will build.
    metrics: libraryMetricsFor(entry),
  };
}

/** Heading for an initiative with no category. Always rendered last. */
export const UNCATEGORISED = "Other";

/** The fields grouping and search read. */
export interface Pickable {
  key: string;
  name: string;
  category: string | null;
  oneLiner: string | null;
}

export interface CategoryGroup<T extends Pickable> {
  category: string;
  items: T[];
}

export function categoryOf(item: Pickable): string {
  const category = (item.category ?? "").trim();
  return category === "" ? UNCATEGORISED : category;
}

/**
 * Does `item` match the search text?
 *
 * Every word must appear somewhere in the name, one-liner or category, case-
 * insensitively — so "paid face" finds "Paid Ads - Facebook" and typing a
 * category name lists the whole category. Blank search matches everything.
 */
export function matchesSearch(item: Pickable, search: string | null | undefined): boolean {
  const words = (search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [item.name, item.oneLiner ?? "", categoryOf(item)].join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * Filter by search, then group by category.
 *
 * Categories keep the order they first appear in — the library arrives in the
 * workbook's display order — with the uncategorised heading last. Items keep
 * their order within a category, except that `pinFirst` keys (the
 * recommendations) are moved to the front of their category, in `pinFirst`
 * order. Empty categories are dropped.
 */
export function groupByCategory<T extends Pickable>(
  items: readonly T[],
  opts: { search?: string | null; pinFirst?: readonly string[] } = {}
): CategoryGroup<T>[] {
  const pinRank = new Map((opts.pinFirst ?? []).map((key, index) => [key, index]));
  const groups = new Map<string, T[]>();

  for (const item of items) {
    if (!matchesSearch(item, opts.search)) continue;
    const category = categoryOf(item);
    const list = groups.get(category);
    if (list) list.push(item);
    else groups.set(category, [item]);
  }

  const out: CategoryGroup<T>[] = [];
  let uncategorised: CategoryGroup<T> | null = null;

  for (const [category, list] of groups) {
    // Stable: unpinned items keep their incoming order.
    const ordered = list
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const pa = pinRank.get(a.item.key) ?? Number.POSITIVE_INFINITY;
        const pb = pinRank.get(b.item.key) ?? Number.POSITIVE_INFINITY;
        return pa === pb ? a.index - b.index : pa - pb;
      })
      .map(({ item }) => item);

    const group = { category, items: ordered };
    if (category === UNCATEGORISED) uncategorised = group;
    else out.push(group);
  }

  if (uncategorised) out.push(uncategorised);
  return out;
}

/** How many items a grouping holds in total. */
export function countGrouped<T extends Pickable>(groups: readonly CategoryGroup<T>[]): number {
  return groups.reduce((sum, group) => sum + group.items.length, 0);
}
