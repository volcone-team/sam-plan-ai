/**
 * The two-screen initiative picker for the new Initiative Intake: the logic
 * only, no UI.
 *
 *   Screen 1  tiles      — the twelve categories, in the spec's tile order,
 *                          each with a LIVE count of what it holds.
 *   Screen 2  a category — that category's initiatives, grouped under the
 *                          audience headings where the category asks for it.
 *   Plus      search, an A–Z-style index by category, and recents.
 *
 * PURE. No database, no React. The data arrives from GET /api/intake-v3/picker
 * already filtered to what the picker may offer (isOfferedInIntakePicker) and
 * projected to `PickerItem` by `toPickerItems` below. Beside the items the
 * route also sends each offered item's effective LibraryRecordConfig
 * (`pickerConfigs` in config-repo) for the form; validation, settings,
 * warnings and workbook ids never leave the server.
 *
 * Separate from src/components/initiatives/library-initiative-picker, the old
 * list the add-initiative panel falls back to when nothing is offered here.
 */

import { CATEGORIES, categoryById, type CategoryId, type RecordAudienceSource } from "./library-config";
import type { LibraryConfigRecord } from "./config-repo";

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/** Everything the picker knows about one initiative. The whole wire shape. */
export interface PickerItem {
  key: string;
  name: string;
  oneLiner: string | null;
  categoryId: CategoryId;
  audience: RecordAudienceSource;
  /** SCORE Revenue 1-5, for the units suggestion (target setting). Optional. */
  revenueScore?: number | null;
}

/** A category as the picker shows it. `launchCount` deliberately absent. */
export interface PickerCategory {
  id: CategoryId;
  label: string;
  tileOrder: number;
}

export interface PickerTile extends PickerCategory {
  /** Live count of offered items. Never the static launchCount. */
  count: number;
}

export interface PickerSection {
  /** Null for items with no sub-heading. */
  subheading: string | null;
  items: PickerItem[];
}

export interface PickerGroup {
  /** Null when the category is shown as one ungrouped list. */
  audience: RecordAudienceSource | null;
  heading: string | null;
  description: string | null;
  sections: PickerSection[];
}

export interface CategoryList {
  category: PickerCategory;
  /** "Most plans use both kinds." for grouped categories, else null. */
  intro: string | null;
  groups: PickerGroup[];
}

export interface SearchResult {
  item: PickerItem;
  /** Shown beside the name: 17 records share a name with another record. */
  categoryLabel: string;
  audienceLabel: string;
}

export interface IndexEntry {
  category: PickerCategory;
  items: PickerItem[];
}

/* ------------------------------------------------------------------ *
 * Copy (the spec's, verbatim)
 * ------------------------------------------------------------------ */

export const AUDIENCE_HEADINGS: Readonly<
  Record<RecordAudienceSource, { heading: string; description: string }>
> = Object.freeze({
  own: {
    heading: "Your audience",
    description: "Your list, your following, your ad spend. You control the date and who sees it.",
  },
  borrowed: {
    heading: "Someone else's audience",
    description:
      "A host's stage, a partner's list, an affiliate's following. You're borrowing their reach, so they control the date and the audience.",
  },
});

export const AUDIENCE_GROUPS_INTRO = "Most plans use both kinds.";

/** Own first, then borrowed: the order the headings render in. */
const AUDIENCE_ORDER: readonly RecordAudienceSource[] = ["own", "borrowed"];

/** At most this many recents are offered. */
export const RECENTS_LIMIT = 4;

/**
 * Optional sub-headings inside a category list: initiative_key → sub-heading.
 * Sections render in the order their sub-heading first appears in this map.
 *
 * SHIPPED EMPTY ON PURPOSE. The spec's sub-heading map is keyed by workbook
 * IDs IN001–IN004, which do not exist in the client's workbook, so there is
 * nothing it can be translated to yet. Fill it with initiative_keys once the
 * client says which records it means.
 */
export const SUBHEADINGS: Readonly<Record<string, string>> = Object.freeze({});

/* ------------------------------------------------------------------ *
 * Server-side projection
 * ------------------------------------------------------------------ */

/**
 * Offered records → picker items. Copies ONLY the five picker fields, so the
 * config, validation, settings, warnings and workbook ids cannot leak through
 * a spread. Records without a resolved category or audience are dropped (a
 * valid record always has both; this is the type-level guarantee).
 *
 * `oneLiners` comes from wb_initiative_library.one_liner, which the config
 * record does not carry.
 */
export function toPickerItems(
  records: readonly Pick<LibraryConfigRecord, "initiativeKey" | "library" | "effective">[],
  oneLiners: ReadonlyMap<string, string | null> = new Map()
): PickerItem[] {
  const items: PickerItem[] = [];
  for (const r of records) {
    const category = categoryById(r.effective.categoryId);
    const audience = r.effective.audienceSource;
    if (!category || (audience !== "own" && audience !== "borrowed")) continue;
    const oneLiner = oneLiners.get(r.initiativeKey);
    items.push({
      key: r.initiativeKey,
      name: r.library.name?.trim() || r.initiativeKey,
      oneLiner: typeof oneLiner === "string" && oneLiner.trim() !== "" ? oneLiner.trim() : null,
      categoryId: category.id,
      audience,
    });
  }
  return items;
}

/* ------------------------------------------------------------------ *
 * Screen 1: tiles
 * ------------------------------------------------------------------ */

const ORDERED_CATEGORIES = [...CATEGORIES].sort((a, b) => a.tileOrder - b.tileOrder);

const toPickerCategory = (c: { id: CategoryId; label: string; tileOrder: number }): PickerCategory => ({
  id: c.id,
  label: c.label,
  tileOrder: c.tileOrder,
});

/** Categories in tile order with live counts. Empty categories are hidden. */
export function buildTiles(items: readonly PickerItem[]): PickerTile[] {
  const counts = new Map<CategoryId, number>();
  for (const i of items) counts.set(i.categoryId, (counts.get(i.categoryId) ?? 0) + 1);
  return ORDERED_CATEGORIES.filter((c) => (counts.get(c.id) ?? 0) > 0).map((c) => ({
    ...toPickerCategory(c),
    count: counts.get(c.id)!,
  }));
}

/* ------------------------------------------------------------------ *
 * Screen 2: one category
 * ------------------------------------------------------------------ */

/** Split a list into sub-heading sections; un-headed items come first. */
export function sectionize(
  items: readonly PickerItem[],
  subheadings: Readonly<Record<string, string>> = SUBHEADINGS
): PickerSection[] {
  const order = [...new Set(Object.values(subheadings))];
  const plain = items.filter((i) => !subheadings[i.key]);
  const sections: PickerSection[] = plain.length ? [{ subheading: null, items: plain }] : [];
  for (const heading of order) {
    const under = items.filter((i) => subheadings[i.key] === heading);
    if (under.length) sections.push({ subheading: heading, items: under });
  }
  return sections;
}

/**
 * The list behind one tile. Null for an unknown category id.
 * Grouped by audience only where the category's showsAudienceHeadings is set
 * (Webinars); an empty audience group is omitted.
 */
export function buildCategoryList(
  items: readonly PickerItem[],
  categoryId: string,
  subheadings: Readonly<Record<string, string>> = SUBHEADINGS
): CategoryList | null {
  const category = categoryById(categoryId);
  if (!category) return null;
  const inCategory = items.filter((i) => i.categoryId === category.id);

  if (!category.showsAudienceHeadings) {
    return {
      category: toPickerCategory(category),
      intro: null,
      groups: [{ audience: null, heading: null, description: null, sections: sectionize(inCategory, subheadings) }],
    };
  }

  const groups: PickerGroup[] = [];
  for (const audience of AUDIENCE_ORDER) {
    const members = inCategory.filter((i) => i.audience === audience);
    if (!members.length) continue;
    groups.push({
      audience,
      heading: AUDIENCE_HEADINGS[audience].heading,
      description: AUDIENCE_HEADINGS[audience].description,
      sections: sectionize(members, subheadings),
    });
  }
  return { category: toPickerCategory(category), intro: AUDIENCE_GROUPS_INTRO, groups };
}

/* ------------------------------------------------------------------ *
 * Search, index, recents
 * ------------------------------------------------------------------ */

const fold = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Case-insensitive substring search on name and one-liner, across every
 * category. Results come in index order (tile order, then library order).
 * A blank query returns nothing.
 */
export function searchItems(items: readonly PickerItem[], query: string): SearchResult[] {
  const q = fold(query);
  if (!q) return [];
  return buildIndex(items)
    .flatMap((entry) => entry.items)
    .filter((i) => fold(i.name).includes(q) || fold(i.oneLiner).includes(q))
    .map((item) => ({
      item,
      categoryLabel: categoryById(item.categoryId)!.label,
      audienceLabel: AUDIENCE_HEADINGS[item.audience].heading,
    }));
}

/** Every item grouped by category, in tile order. Empty categories omitted. */
export function buildIndex(items: readonly PickerItem[]): IndexEntry[] {
  return ORDERED_CATEGORIES.map((c) => ({
    category: toPickerCategory(c),
    items: items.filter((i) => i.categoryId === c.id),
  })).filter((e) => e.items.length > 0);
}

/**
 * Recently used initiatives that are still offered: the given order kept,
 * duplicates dropped, at most RECENTS_LIMIT.
 */
export function buildRecents(items: readonly PickerItem[], recentKeys: readonly string[]): PickerItem[] {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const seen = new Set<string>();
  const out: PickerItem[] = [];
  for (const key of recentKeys) {
    if (out.length >= RECENTS_LIMIT) break;
    const item = byKey.get(key);
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
