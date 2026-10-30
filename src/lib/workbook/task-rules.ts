/**
 * Which workbook tasks an initiative gets, from the answers on its form.
 *
 * Client, Oct 2026: "the reason the intake form exists the way it does is so
 * that it can pull the appropriate information for the tasks". The form's
 * answers used to reach task generation not at all; now they choose sections.
 *
 *   1. SECTIONS OF ITS OWN TEMPLATE, by the ask:
 *        "selling" / "sales" sections         -> Make an offer
 *        "lead collect" / "opt-in" sections    -> Collect leads
 *        "book-a-call" / "BAC" sections        -> Drive to calls
 *      and by format ("virtual", "in-person", "hybrid" in the heading).
 *      Unknown ask or format keeps everything; a section with no such word
 *      is always kept.
 *   2. SECTIONS PULLED IN FROM OTHER TABS:
 *        New opt-in funnel = yes  -> Funnels: Registration Funnels for the
 *                                    format on an event, BAC Opt-in on the
 *                                    calls path, else Opt-in Funnels
 *        New sales funnel = yes   -> Funnels: For Sales Funnels
 *        Promoted by ads          -> each chosen platform's ad tasks
 *   3. TASKS DROPPED BY AN ANSWER: no booth, not travelling, already has a
 *      deck (or needs none), talk already crafted.
 *
 * Every match is on the workbook's own wording, so it is a list to CONFIRM
 * with the client (see the handover). Pure: no I/O.
 */
import type { TaskTemplate } from "./materialise";

export interface TaskAnswers {
  /** offer | calls | leads | speaker-fee; null/undefined = not answered. */
  path?: string | null;
  /** in-person | digital | hybrid. */
  format?: string | null;
  categoryId?: string | null;
  newOptinFunnel?: boolean | null;
  newSalesFunnel?: boolean | null;
  /** attrs.ad_platforms: only present while "Ads" promotes it. */
  adPlatforms?: readonly string[];
  /** attrs.category: the category schema answers (booth, traveling, deck, talkCrafted). */
  category?: Readonly<Record<string, unknown>>;
  /** attrs.cart_opens: sales-funnel tasks count back from it. */
  cartOpens?: string | null;
}

/** The tab that holds funnel sections for every initiative. */
export const FUNNELS_TEMPLATE_KEY = "funnels";

/** Ad platform (intake form) -> the Paid Ads initiative whose tasks it adds. */
export const AD_PLATFORM_TEMPLATE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  meta: "paid-ads-meta",
  "instagram-feed": "paid-ads-meta",
  "instagram-reels": "paid-ads-meta",
  youtube: "youtube-ads",
  google: "google-search-intent-ads",
  pinterest: "paid-ads-pinterest",
  linkedin: "linkedin-ads",
});

/** How a platform's tasks are told apart when several platforms are chosen. */
export const AD_TEMPLATE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "paid-ads-meta": "Meta Ads",
  "youtube-ads": "YouTube Ads",
  "google-search-intent-ads": "Google Ads",
  "paid-ads-pinterest": "Pinterest Ads",
  "linkedin-ads": "LinkedIn Ads",
});

/** The saved initiative's answers, in the shape the rules read. */
export function answersFromInitiative(row: {
  conversionPath?: string | null;
  format?: string | null;
  categoryId?: string | null;
  attrs?: Readonly<Record<string, unknown>> | null;
}): TaskAnswers {
  const attrs = row.attrs ?? {};
  const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
  const category = attrs.category;
  return {
    path: row.conversionPath ?? null,
    format: row.format ?? null,
    categoryId: row.categoryId ?? null,
    newOptinFunnel: bool(attrs.new_optin_funnel),
    newSalesFunnel: bool(attrs.new_sales_funnel),
    adPlatforms: Array.isArray(attrs.ad_platforms)
      ? (attrs.ad_platforms as unknown[]).filter((p): p is string => typeof p === "string")
      : [],
    category: typeof category === "object" && category !== null && !Array.isArray(category)
      ? (category as Record<string, unknown>)
      : {},
    cartOpens: typeof attrs.cart_opens === "string" ? attrs.cart_opens : null,
  };
}

/** Other templates the answers pull sections from. */
export function extraTemplateKeys(ownKey: string, answers: TaskAnswers): string[] {
  const out = new Set<string>();
  if (answers.newOptinFunnel === true || answers.newSalesFunnel === true) out.add(FUNNELS_TEMPLATE_KEY);
  for (const p of answers.adPlatforms ?? []) {
    const key = AD_PLATFORM_TEMPLATE_KEYS[p];
    if (key && key !== ownKey) out.add(key);
  }
  out.delete(ownKey);
  return [...out];
}

/* ------------------------------------------------------------------ *
 * Section conditions
 * ------------------------------------------------------------------ */

type Path = "offer" | "calls" | "leads";

function pathsFor(section: string): Path[] {
  const s = section.toLowerCase();
  const out: Path[] = [];
  if (/book[- ]a[- ]call|\bbac\b/.test(s)) out.push("calls");
  else if (/lead collect|opt-?in only|opt-?in campaign/.test(s)) out.push("leads");
  if (/\bsell(ing)?\b|\bsales\b/.test(s)) out.push("offer");
  return out;
}

function formatsFor(section: string): string[] {
  const s = section.toLowerCase();
  const out: string[] = [];
  if (/\bvirtual\b/.test(s)) out.push("digital", "hybrid");
  if (/in-?person/.test(s)) out.push("in-person", "hybrid");
  if (/\bhybrid\b/.test(s)) out.push("hybrid");
  return out;
}

/** Does a section of the initiative's OWN template apply to these answers? */
export function sectionApplies(section: string | null | undefined, answers: TaskAnswers): boolean {
  if (!section) return true;
  const paths = pathsFor(section);
  const path = answers.path === "speaker-fee" ? "offer" : answers.path;
  if (paths.length > 0 && (path === "offer" || path === "calls" || path === "leads") && !paths.includes(path)) {
    return false;
  }
  const formats = formatsFor(section);
  if (formats.length > 0 && answers.format && !formats.includes(answers.format)) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * Funnel sections pulled in
 * ------------------------------------------------------------------ */

/**
 * An event the user HOSTS gets a registration funnel rather than a plain
 * opt-in. Speaking on someone else's stage does not: the host registers the
 * attendees, the speaker collects leads.
 */
function isHostedEvent(answers: TaskAnswers): boolean {
  return /^(your-own-event|webinars)/.test(answers.categoryId ?? "");
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The Funnels sections these answers want, matched on the heading. */
export function wantedFunnelSections(answers: TaskAnswers): ((section: string) => boolean)[] {
  const out: ((section: string) => boolean)[] = [];
  if (answers.newOptinFunnel === true) {
    if (answers.path === "calls") {
      out.push((s) => /\bbac\b|book a call/.test(norm(s)));
    } else if (isHostedEvent(answers) && answers.format) {
      const want = answers.format === "hybrid" ? "hybrid" : answers.format === "in-person" ? "in person" : "virtual";
      out.push((s) => norm(s).startsWith("registration") && norm(s).includes(want));
    } else {
      out.push((s) => norm(s) === "opt in funnels");
    }
  }
  if (answers.newSalesFunnel === true) out.push((s) => /sales funnel/.test(norm(s)));
  return out;
}

/* ------------------------------------------------------------------ *
 * Tasks an answer makes unnecessary
 * ------------------------------------------------------------------ */

const isNo = (v: unknown) => v === false || (typeof v === "string" && /^(no|false)$/i.test(v));
const isYes = (v: unknown) => v === true || (typeof v === "string" && /^(yes|true)$/i.test(v));

/** Task-name tests to drop, from the category answers. */
export function droppedTaskTests(answers: TaskAnswers): ((name: string) => boolean)[] {
  const c = answers.category ?? {};
  const out: ((name: string) => boolean)[] = [];
  if (isNo(c.booth)) out.push((n) => /\bbooth\b|exhibit/i.test(n));
  if (isNo(c.traveling)) out.push((n) => /\btravel/i.test(n));
  if (isYes(c.deck) || (typeof c.deck === "string" && /need/i.test(c.deck))) {
    out.push((n) => /create (the )?slide ?decks?/i.test(n));
  }
  if (isYes(c.talkCrafted)) out.push((n) => /choose (the )?(speech|talk)|talk title|craft (the |your )?talk/i.test(n));
  return out;
}

/* ------------------------------------------------------------------ *
 * Putting it together
 * ------------------------------------------------------------------ */

/**
 * The templates an initiative gets: its own (sections that apply), plus the
 * sections and platform tasks its answers pull in, minus tasks its answers
 * make unnecessary. Each row is tagged with its `group` so task numbers and
 * dependencies stay within the template and section they came from.
 *
 * No answers at all keeps the initiative's own template whole, as before.
 */
export function selectTemplates(args: {
  ownKey: string;
  own: readonly TaskTemplate[];
  extras: ReadonlyMap<string, readonly TaskTemplate[]>;
  answers: TaskAnswers;
}): TaskTemplate[] {
  const { answers } = args;
  const out: TaskTemplate[] = args.own
    .filter((t) => sectionApplies(t.section, answers))
    .map((t) => ({ ...t, group: args.ownKey }));

  const funnels = args.extras.get(FUNNELS_TEMPLATE_KEY) ?? [];
  for (const wants of wantedFunnelSections(answers)) {
    for (const t of funnels) if (t.section && wants(t.section)) out.push({ ...t, group: FUNNELS_TEMPLATE_KEY });
  }
  /*
   * Ad platforms. With two or more chosen, a platform's own steps ("Launch
   * ads", "Film videos") are named for it, so Meta's and YouTube's do not
   * merge into one task. Planning steps the initiative already has ("Define
   * pricing") still merge.
   */
  const ownNames = new Set(out.map((t) => norm(t.name)));
  const adKeys = [...args.extras.keys()].filter((k) => k !== FUNNELS_TEMPLATE_KEY);
  for (const key of adKeys) {
    const label = AD_TEMPLATE_LABELS[key];
    for (const t of args.extras.get(key) ?? []) {
      const named = adKeys.length > 1 && label && !ownNames.has(norm(t.name)) ? `${t.name} (${label})` : t.name;
      out.push({ ...t, name: named, group: key });
    }
  }

  /*
   * The sales funnel has to be live when the cart opens, so with a cart date
   * its tasks count back from that date instead of from the event.
   */
  if (answers.cartOpens) {
    for (const t of out) if (t.section && /sales (funnel|campaign)/.test(norm(t.section))) t.anchor = "cart";
  }

  const drops = droppedTaskTests(answers);
  return drops.length === 0 ? out : out.filter((t) => !drops.some((d) => d(t.name)));
}
