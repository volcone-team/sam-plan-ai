/**
 * Presenting the workbook library in the intake picker.
 *
 * The library's own `category` values come straight from the workbook's sheet
 * structure and read like internal notes: "YOUR OWN STAGES - OWN -DIGITAL",
 * "OTHER PEOPLE'S STAGES - OPS - IN-PERSON", "MRR". They are correct as data
 * and unusable as UI labels.
 *
 * So grouping is a PURE, TESTED mapping rather than string munging inside a
 * component. The library is re-uploadable, which means an unrecognised category
 * is not an error condition — it is Tuesday. Anything unmapped falls through to
 * a sensible group instead of vanishing from the picker, because an initiative
 * the user cannot find is worse than one filed under a slightly odd heading.
 */

import { EVENT_ONLY_CATEGORIES } from "@/lib/intake/schema";
import type { StoredMetrics } from "@/lib/metrics/parse-metrics";

/** One initiative as the picker consumes it. */
export interface LibraryInitiative {
  key: string;
  name: string;
  category: string | null;
  oneLiner: string | null;
  ownOrOps: string | null;
  priceTier: string | null;
  difficulty: number | null;
  speedToResults: string | null;
  needsSalesTeam: string | null;
  /**
   * The workbook's "Ideal Industries" (migration 040). Optional: the picker
   * API does not send it, and a library stored before 040 has none. Absent or
   * empty means Broad fit — see passesIndustry.
   */
  idealIndustries?: readonly string[];
  /*
   * The rest of the migration-040 fields, carried for later tasks. Optional for
   * the same reason; nothing in the picker or the rules reads them yet.
   */
  workbookId?: string | null;
  /** Set on a variant ("webinar-own"): the initiative it varies ("webinar"). */
  baseKey?: string | null;
  speedScore?: number | null;
  costScore?: number | null;
  oddsScore?: number | null;
  revenueScore?: number | null;
  easeScore?: number | null;
  scoreTotal?: number | null;
  ctaOptions?: readonly string[];
  training?: readonly string[];
  metricsRaw?: string | null;
  /** Parsed Metrics cell; null when never parsed. See readStoredMetrics. */
  metrics?: StoredMetrics | null;
}

/**
 * The headings shown in the picker, in display order.
 *
 * Ordered deliberately: virtual and digital first because they are what most
 * businesses can start this month, in-person later because it needs a venue and
 * a lead time.
 */
export const PICKER_GROUPS = [
  "Virtual Events",
  "Content & Media",
  "Digital Marketing",
  "Sales & Referrals",
  "In-Person Events",
  "Recurring Revenue",
  "Other",
] as const;

export type PickerGroup = (typeof PICKER_GROUPS)[number];

/**
 * Library category to picker heading.
 *
 * Keyed on the lowercased category so a casing change in the workbook does not
 * silently drop a whole group into "Other".
 */
const CATEGORY_TO_GROUP: Record<string, PickerGroup> = {
  "virtual live video events": "Virtual Events",
  "social media lives": "Content & Media",
  series: "Content & Media",
  "your own stages - own -digital": "Digital Marketing",
  "other people's stages - ops - in-person": "In-Person Events",
  "large format": "In-Person Events",
  "small format": "In-Person Events",
  mrr: "Recurring Revenue",
};

/**
 * Initiatives whose group differs from their category's default.
 *
 * Needed because the workbook files eleven very different things under
 * "YOUR OWN STAGES - OWN -DIGITAL" — paid ads sit beside sales calls and
 * referrals. Grouping purely by category would produce one eleven-item heading
 * that mixes marketing with selling, which is exactly the list the user has to
 * scan.
 */
const KEY_TO_GROUP: Record<string, PickerGroup> = {
  "sales-calls": "Sales & Referrals",
  referral: "Sales & Referrals",
  "direct-message-reach-out": "Sales & Referrals",
  "podcast-vodcast-guest": "Content & Media",
  "content-organic-social": "Content & Media",
  "ops-in-person-other-peoples-stages": "Content & Media",
};

/**
 * Which heading an initiative belongs under.
 *
 * The legacy sheet-structure categories above are remapped (and the key
 * overrides apply only to them). ANY OTHER category is used AS WRITTEN: the
 * Oct 2026 workbook has readable categories ("Paid Ads", "Webinars", "Local
 * Presence"), and filing all 87 of its initiatives under "Other" — which is
 * what the old fallback did — made the grouping useless. Only a blank
 * category lands in "Other".
 */
export function groupFor(initiative: LibraryInitiative): string {
  const raw = (initiative.category ?? "").trim();
  const byCategory = CATEGORY_TO_GROUP[raw.toLowerCase()];
  if (byCategory) return KEY_TO_GROUP[initiative.key] ?? byCategory;
  return raw === "" ? "Other" : raw;
}

/* ------------------------------------------------------------------ *
 * OPS / OWN disambiguation (REQ-8.4)
 * ------------------------------------------------------------------ */

/** Normalised platform. Null when the library does not say, or says both. */
export function platformOf(initiative: LibraryInitiative): "own" | "ops" | null {
  const value = (initiative.ownOrOps ?? "").trim().toUpperCase();
  if (value === "OWN") return "own";
  if (value === "OPS") return "ops";
  // "OWN & OPS" (affiliate launches) is genuinely both, so neither applies.
  return null;
}

/**
 * The picker label, disambiguating platform ONLY where it is ambiguous.
 *
 * REQ-8.4 asks for the suffix "where a name exists as both OPS and OWN" — and
 * that condition is load-bearing. Suffixing unconditionally produces
 * "Courses & Memberships (on someone else's platform)", which is worse than no
 * label at all: the platform is irrelevant to a membership, and the phrasing
 * implies something untrue about it.
 *
 * So the whole collection is needed to decide. A name carried in both variants
 * gets the suffix because the user genuinely cannot tell the two apart;
 * everything else is left as the workbook wrote it. The platform is still
 * surfaced — see `platformOf` — as a separate badge rather than by rewriting
 * the name.
 */
export function labelFor(
  initiative: LibraryInitiative,
  collection: readonly LibraryInitiative[] = []
): string {
  const platform = platformOf(initiative);
  if (!platform) return initiative.name;

  const ambiguous = collection.some(
    (other) =>
      other.key !== initiative.key &&
      other.name.trim().toLowerCase() === initiative.name.trim().toLowerCase() &&
      platformOf(other) !== null &&
      platformOf(other) !== platform
  );

  if (!ambiguous) return initiative.name;

  return platform === "own"
    ? `${initiative.name} (on your own platform)`
    : `${initiative.name} (on someone else's platform)`;
}

/* ------------------------------------------------------------------ *
 * Filtering and grouping
 * ------------------------------------------------------------------ */

export interface GroupedInitiatives {
  /** A PickerGroup for legacy categories, otherwise the category as written. */
  group: string;
  initiatives: LibraryInitiative[];
}

export interface PickerFilters {
  /** Free-text search over name, one-liner and group. */
  search?: string;
  /**
   * True when the user has at least one Event product selected.
   *
   * REQ-8.3: Ticket Map items are only meaningful for an event, so they are
   * hidden otherwise rather than shown and later rejected.
   */
  hasEventProduct?: boolean;
  /** Keys to leave out, e.g. ones already answered on screen 5 (REQ-9.2). */
  exclude?: readonly string[];
}

/**
 * Searchable, grouped list for the picker.
 *
 * Search matches the DISPLAYED label rather than the raw name, so typing "own
 * platform" finds what the user can see. It also matches the group heading,
 * because people search for "webinar" and for "virtual" interchangeably.
 */
export function groupInitiatives(
  initiatives: readonly LibraryInitiative[],
  filters: PickerFilters = {}
): GroupedInitiatives[] {
  const excluded = new Set(filters.exclude ?? []);
  const eventOnly = new Set(EVENT_ONLY_CATEGORIES.map((c) => c.toLowerCase()));
  const needle = (filters.search ?? "").trim().toLowerCase();

  const visible = initiatives.filter((initiative) => {
    if (excluded.has(initiative.key)) return false;

    // REQ-8.3 — Ticket Map needs an Event product behind it.
    const category = (initiative.category ?? "").toLowerCase();
    if (eventOnly.has(category) && !filters.hasEventProduct) return false;

    if (needle === "") return true;

    const haystack = [
      labelFor(initiative, initiatives),
      initiative.name,
      initiative.oneLiner ?? "",
      groupFor(initiative),
      // Searchable because "own" and "someone else's" is how the user thinks
      // about it, even when the label does not carry the suffix.
      platformOf(initiative) === "own" ? "your own platform" : "",
      platformOf(initiative) === "ops" ? "someone else's platform" : "",
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(needle);
  });

  /**
   * Order: the declared PICKER_GROUPS first (stable whatever order rows
   * arrive in), then any other category in the order it first appears — the
   * library arrives in workbook display order — and "Other" last. Empty groups
   * are dropped rather than rendered.
   */
  // The declared order only means something for a legacy workbook; a current
  // one is shown in its own order (a "Content & Media" category must not jump
  // ahead just because the legacy list happens to share the name).
  const legacy = visible.some(
    (initiative) => CATEGORY_TO_GROUP[(initiative.category ?? "").trim().toLowerCase()] !== undefined
  );
  const declared = new Set<string>(legacy ? PICKER_GROUPS : []);
  const extra: string[] = [];
  for (const initiative of visible) {
    const group = groupFor(initiative);
    if (group !== "Other" && !declared.has(group) && !extra.includes(group)) extra.push(group);
  }
  const order = [
    ...(legacy ? PICKER_GROUPS.filter((group) => group !== "Other") : []),
    ...extra,
    "Other",
  ];

  return order
    .map((group) => ({
      group,
      initiatives: visible.filter((initiative) => groupFor(initiative) === group),
    }))
    .filter((entry) => entry.initiatives.length > 0);
}

/** Flat lookup from key to initiative, for resolving a stored answer. */
export function byKey(
  initiatives: readonly LibraryInitiative[]
): Map<string, LibraryInitiative> {
  return new Map(initiatives.map((initiative) => [initiative.key, initiative]));
}

/**
 * Does this initiative need someone to take sales calls?
 *
 * The workbook answers YES / NO / POSSIBLY as free text. Only an explicit YES
 * counts, because REQ-13.10 excludes sales-call initiatives for users who do
 * not take calls — and treating POSSIBLY as YES would strip out most of the
 * library for them, leaving almost nothing to recommend.
 */
export function requiresSalesCalls(initiative: LibraryInitiative): boolean {
  return (initiative.needsSalesTeam ?? "").trim().toUpperCase() === "YES";
}
