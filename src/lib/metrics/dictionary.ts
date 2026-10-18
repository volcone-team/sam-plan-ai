/**
 * The standard metric dictionary.
 *
 * The workbook's Metrics cell is free text ("- Show-up", "Opt-ins",
 * "VIP Ticker Sales"...). Every token is resolved to one of the keys below by
 * `parseMetricsCell`, so a week's results are stored against a stable key no
 * matter how the client spelled it.
 *
 * KEYS ARE STABLE. Results rows will be keyed by them; renaming one orphans
 * every value recorded against it. Add synonyms freely, add keys carefully,
 * never rename.
 *
 * WHY MORE KEYS THAN "views" AND "clicks". Several apparently-similar metrics
 * appear SIDE BY SIDE in one initiative (Views AND Visits; Clicks, Email
 * Clicks, Funnel Clicks, Ad Clicks AND Page Clicks; Reach AND Ad Reach;
 * Watch Rate AND Listen Rate; Internal AND Affiliate opt-ins), so merging
 * them would lose data. Merges are made only where the workbook never lists
 * both forms together.
 *
 * DERIVED METRICS. A def with a `formula` is derived ONLY when every key the
 * formula reads is an entered metric of the same initiative (and group).
 * Otherwise the parser emits it as an ordinary entered metric, because a
 * rate the user types in is better than one we cannot compute. `source` on
 * the def records which it CAN be; the parser's output records which it IS.
 *
 * AGGREGATE. How weekly values roll up. For derived rates, "average" is the
 * fallback only: a consumer that has the inputs should recompute the rate
 * from the summed inputs (sum of attendees / sum of registrations), because
 * the average of weekly rates is wrong whenever weeks differ in size.
 *
 * TAGS (`kind: "tag"`) are recognised labels that are NOT numbers ("Product
 * Category", "Buyer Plan"). They are reported separately and must never be
 * offered as a numeric input.
 */

export type MetricKind = "count" | "rate" | "money" | "score" | "tag";
export type MetricAggregate = "sum" | "average" | "latest";
export type MetricSource = "entered" | "derived";

/**
 * value = ((numerator - minus) / denominator) * multiplier
 *
 * `minus` and `denominator` are optional so the same shape expresses a ratio
 * (show-up rate), a difference (profit) and both (ROI). A zero or missing
 * denominator yields null, never Infinity.
 */
export interface MetricFormula {
  numerator: string;
  minus?: string;
  denominator?: string;
  multiplier?: number;
}

export interface MetricDef {
  key: string;
  label: string;
  kind: MetricKind;
  aggregate: MetricAggregate;
  source: MetricSource;
  formula?: MetricFormula;
  unit?: string;
  /** Lower-case spellings. Matched after `normaliseMetricText`, so punctuation variants need not be listed. */
  synonyms: readonly string[];
}

/** Bump when keys, synonyms or parsing rules change, so stored parses can be identified and redone. */
export const METRICS_DICTIONARY_VERSION = 1;

const count = (key: string, label: string, synonyms: string[], aggregate: MetricAggregate = "sum"): MetricDef =>
  ({ key, label, kind: "count", aggregate, source: "entered", synonyms });
const money = (key: string, label: string, synonyms: string[]): MetricDef =>
  ({ key, label, kind: "money", aggregate: "sum", source: "entered", unit: "$", synonyms });
const rate = (key: string, label: string, synonyms: string[], formula?: MetricFormula): MetricDef =>
  ({
    key, label, kind: "rate", aggregate: "average", unit: "%",
    source: formula ? "derived" : "entered", ...(formula ? { formula } : {}), synonyms,
  });
const tag = (key: string, label: string, synonyms: string[]): MetricDef =>
  ({ key, label, kind: "tag", aggregate: "latest", source: "entered", synonyms });

const pct = (numerator: string, denominator: string): MetricFormula => ({ numerator, denominator, multiplier: 100 });

export const METRICS: readonly MetricDef[] = [
  // ---- Traffic and reach ----
  count("visits", "Visits", ["visits", "visit", "views/visits", "visits/views", "website/store views", "website views", "store views"]),
  count("views", "Views", ["views", "organic views"]),
  count("reach", "Reach", ["reach", "organic reach"]),
  count("ad_reach", "Ad reach", ["ad reach"]),
  count("profile_visits", "Profile visits", ["profile visits"]),
  count("search_results", "Search results", ["search results", "search impressions"]),

  // ---- Clicks ----
  count("clicks", "Clicks", ["clicks", "link clicks"]),
  count("email_clicks", "Email clicks", ["email clicks"]),
  count("funnel_clicks", "Funnel clicks", ["funnel clicks"]),
  count("ad_clicks", "Ad clicks", ["ad clicks"]),
  count("page_clicks", "Page clicks", ["page clicks"]),

  // ---- Email / SMS / DM ----
  count("opens", "Opens", ["opens", "opens/views"]),
  count("unopens", "Unopens", ["unopens", "unopened"]),
  count("bounces", "Bounces", ["bounces"]),
  count("replies", "Replies", ["replies"]),
  count("spam_reports", "Spam reports", ["report as spam", "spam reports"]),

  // ---- Leads ----
  count("optins", "Opt-ins", [
    "optins", "leads", "leads/optins", "internal optins", "optin to your free gift",
    // Email Campaign: registering for the free thing IS the opt-in.
    "registrations/optins",
  ]),
  count("affiliate_optins", "Affiliate opt-ins", ["affiliate optins"]),
  count("signups", "Sign-ups", ["sign ups", "signups"]),
  count("registrations", "Registrations", ["registrations", "ga registrations"]),
  count("quiz_completions", "Quiz completions", ["quiz completions"]),
  count("downloads", "Downloads", ["downloads"]),
  count("list_growth", "List growth", ["list growth", "new subscribers"]),
  count("list_size", "List size", ["list size"], "latest"),

  // ---- Events ----
  count("invites_sent", "Invites sent", ["number invited", "invites sent"]),
  count("invites_accepted", "Invites accepted", ["invites accepted"]),
  count("attendees", "Attendees", ["attendees", "attendance", "attended"]),
  // "Ticket sales" on its own is general admission: VIP is always named.
  count("ga_ticket_sales", "GA ticket sales", ["ga ticket sales", "ga sales", "ticket sales"]),
  count("vip_buyers", "VIP buyers", [
    "vip buyers", "vip sales", "vip ticket sales", "event vip ticket sales",
    "vip ticker sales", // workbook typo
  ]),

  // ---- Sales ----
  // A count of buyers. "Core offer sales" / "Core offers sold" are recorded
  // here too: the workbook uses them interchangeably with buyers.
  count("core_offer_buyers", "Core offer buyers", [
    "core offer buyers", "core offer sales", "core offers sold", "buyers", "offer buyer",
    "internal buyers", "buyers/upgrades",
  ]),
  count("affiliate_buyers", "Affiliate buyers", ["affiliate buyers"]),
  count("upsell_buyers", "Upsell buyers", ["upsell buyers", "upsells"]),
  count("downsell_buyers", "Downsell buyers", ["downsell buyers", "downsells"]),
  count("cross_sell_buyers", "Cross-sell buyers", ["cross sells", "cross sell buyers"]),
  count("order_bump_buyers", "Order bump buyers", ["order bumps", "order bump buyers"]),
  count("pre_orders", "Pre-orders", ["pre orders", "preorders"]),
  count("conversions", "Conversions", ["conversions"]),
  count("add_to_carts", "Added to cart", ["added to cart", "add to cart", "add to carts"]),
  count("abandoned_carts", "Abandoned carts", ["abandon cart", "abandoned", "abandoned carts", "abandoned cart"]),
  count("renewals", "Renewals", ["renewals"]),
  count("cancellations", "Cancellations", ["cancellations", "call cancellations"]),

  // ---- Calls ----
  count("calls_made", "Calls made", ["calls made", "dials"]),
  count("calls_booked", "Calls booked", ["calls booked", "calls scheduled", "appointments made", "appointments made/calls booked"]),
  count("calls_completed", "Calls completed", ["calls completed", "calls attended"]),
  count("no_shows", "No-shows", ["no shows", "no show"]),
  count("conversations", "Conversations", ["conversations"]),

  // ---- Social and content ----
  count("followers", "Followers", ["followers"], "latest"),
  count("saves", "Saves / pins", ["saves", "pins"]),
  count("shares", "Shares", ["shares"]),
  count("comments", "Comments", ["comments"]),
  count("listens", "Listens", ["listens"]),
  count("reviews", "Reviews / ratings", ["reviews", "rating #s", "ratings"]),
  { key: "avg_consumption_time", label: "Average listening / viewing time", kind: "count", aggregate: "average",
    source: "entered", unit: "minutes", synonyms: ["average listening/viewing time", "average viewing time", "average listening time"] },

  // ---- Rates ----
  rate("registration_rate", "Registration rate", ["registration rate"], pct("registrations", "visits")),
  rate("show_up_rate", "Show-up rate", ["show up rate", "show up", "show rate"], pct("attendees", "registrations")),
  rate("conversion_rate", "Conversion rate", ["conversion", "conversion rate"], pct("core_offer_buyers", "attendees")),
  rate("optin_rate", "Opt-in rate", ["optin rate"], pct("optins", "visits")),
  rate("list_growth_rate", "List growth %", ["list growth %", "list growth rate"], pct("list_growth", "list_size")),
  rate("watch_rate", "Watch rate", ["watch rate"]),
  rate("listen_rate", "Listen rate", ["listen rate"]),

  // ---- Scores ----
  { key: "nps", label: "NPS (Net Promoter Score)", kind: "score", aggregate: "average", source: "entered",
    synonyms: ["nps", "net promoter score", "nps net promoter score"] },
  { key: "search_rating", label: "Search rating", kind: "score", aggregate: "latest", source: "entered",
    synonyms: ["search rating"] },

  // ---- Money ----
  // "Spend" alone is Influencer Marketing's fee to the influencer: a cost,
  // not ad spend.
  money("cost", "Cost", ["cost", "spend", "costs"]),
  money("ad_spend", "Ad spend", ["ad spend", "ad spends"]),
  money("revenue", "Revenue", ["revenue", "total revenue"]),
  money("sponsor_revenue", "Sponsor revenue", ["sponsor revenue", "sponsorship $", "sponsorship revenue"]),
  { key: "cost_per_click", label: "Cost per ad click", kind: "money", aggregate: "average", source: "derived",
    unit: "$", formula: { numerator: "ad_spend", denominator: "ad_clicks" }, synonyms: ["cost per click", "cpc"] },
  { key: "profit", label: "Profit", kind: "money", aggregate: "sum", source: "derived", unit: "$",
    formula: { numerator: "revenue", minus: "cost" }, synonyms: ["profit"] },
  rate("roi", "Return on investment", ["return on investment", "roi"],
    { numerator: "revenue", minus: "cost", denominator: "cost", multiplier: 100 }),

  // ---- Tags: recognised, never numeric ----
  tag("product_category", "Product category", ["product category"]),
  tag("product_type", "Product type", ["product type"]),
  tag("buyer_plan", "Buyer plan", ["buyer plan"]),
];

export const METRICS_BY_KEY: ReadonlyMap<string, MetricDef> = new Map(METRICS.map((m) => [m.key, m]));

/**
 * The comparable form of a metric phrase.
 *
 * Lower-case; "&" to "and"; hyphens, underscores and dots become spaces;
 * whitespace collapsed. Kept: "/" (a combiner the parser splits on), and
 * "%", "$", "#" (they carry meaning: "List Growth" vs "List Growth %").
 */
export function normaliseMetricText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[-_.]/g, " ")
    .replace(/[^a-z0-9/%$# ]+/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lookup form: normalised with spaces removed, so "opt ins", "optins" and "opt-ins" meet. */
export function compactMetricText(value: string): string {
  return normaliseMetricText(value).replace(/ /g, "");
}

/**
 * Synonym index, built once. Throws at module load if two keys claim one
 * spelling, which is a dictionary bug and must not ship (a test imports this).
 */
export const SYNONYM_INDEX: ReadonlyMap<string, string> = (() => {
  const index = new Map<string, string>();
  for (const def of METRICS) {
    for (const s of [def.key.replace(/_/g, " "), def.label, ...def.synonyms]) {
      const k = compactMetricText(s);
      if (!k) continue;
      const prior = index.get(k);
      if (prior && prior !== def.key) {
        throw new Error(`Metric synonym "${s}" is claimed by both ${prior} and ${def.key}`);
      }
      index.set(k, def.key);
    }
  }
  return index;
})();

/**
 * Resolve one phrase to a key, or null.
 *
 * Exact compact match first, then a single trailing-"s" tolerance in either
 * direction ("Registration" finds "registrations"). Exact always wins, which
 * is what keeps "Conversion" (a rate) apart from "Conversions" (a count).
 */
export function resolveMetric(phrase: string): string | null {
  const k = compactMetricText(phrase);
  if (!k) return null;
  return SYNONYM_INDEX.get(k)
    ?? SYNONYM_INDEX.get(`${k}s`)
    ?? (k.endsWith("s") ? SYNONYM_INDEX.get(k.slice(0, -1)) : undefined)
    ?? null;
}

/** Keys a formula reads. */
export function formulaInputs(f: MetricFormula): string[] {
  return [f.numerator, f.minus, f.denominator].filter((k): k is string => !!k);
}

/**
 * Evaluate a formula against known values. Null when an input is missing or
 * not finite, or the denominator is zero: an undefined rate is not 0%.
 */
export function evaluateFormula(f: MetricFormula, values: Readonly<Record<string, number | null | undefined>>): number | null {
  const read = (k: string): number | null => {
    const v = values[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const n = read(f.numerator);
  if (n === null) return null;
  let top = n;
  if (f.minus) {
    const m = read(f.minus);
    if (m === null) return null;
    top -= m;
  }
  let out = top;
  if (f.denominator) {
    const d = read(f.denominator);
    if (d === null || d === 0) return null;
    out = top / d;
  }
  return out * (f.multiplier ?? 1);
}
