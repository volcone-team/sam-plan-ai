/**
 * The Initiative Intake configuration contract: the twelve canonical
 * categories, the per-record settings an admin may set, and the pure rules
 * that turn those settings into a form layout.
 *
 * THE SINGLE SOURCE OF THE CATEGORY IDENTITIES AND THE CONFIG SHAPE. The
 * migration that adds the columns, the admin editor that writes them, the
 * two-screen picker, the form renderer and the category schemas all read this
 * module. A value is right here or it is wrong everywhere.
 *
 * WHY A CONTRACT MODULE AT ALL, rather than letting each consumer read the
 * library row: the client's workbook names a category as free text, in three
 * different spellings of the same thing (see CATEGORY_SOURCE_STRINGS below),
 * and the product spec names it in a fourth. Anything that compares those
 * strings by hand will match some of the 87 rows and silently drop the rest —
 * the same failure mode as the positional library columns in
 * src/lib/workbook/parse.ts, which stored five fields from the wrong column
 * for weeks without one parse warning. So raw strings are resolved to a
 * `CategoryId` exactly once, at the edge, and only the id is ever stored.
 *
 * NEVER STORE A DISPLAY LABEL. The labels here are the spec's em-dash
 * spelling because that is what a user reads; the workbook's is hyphen +
 * newline. Both resolve to the same id. Persisting either string would make
 * the stored data depend on which spelling happened to arrive.
 *
 * PURE. No database, no network, no React, no env vars. The only import is
 * `normalizeKey` from the workbook parser, which is itself pure. Safe to
 * import from a bare unit test.
 *
 * SCOPE: this is the configuration contract only. It does not know what is in
 * the library (that is the migration and the admin editor), and it is
 * deliberately separate from src/lib/intake/**, which owns the live 10-screen
 * onboarding flow and is not changed by this work.
 */

import { normalizeKey } from "../workbook/parse";
import { REPEAT_FREQUENCIES, type RepeatFrequency } from "../intake-forecast";

/* ------------------------------------------------------------------ *
 * Vocabularies
 *
 * Closed unions, not strings. Every one of these is written into a database
 * column and switched on downstream; a typo in a string union is a compile
 * error, a typo in a string is a row that no branch handles.
 * ------------------------------------------------------------------ */

/**
 * How an initiative repeats.
 *
 * `ongoing` is NOT "recurring with no end": it means the initiative has no
 * event, which is why it removes the event date and the whole Timing section
 * (see resolveFormLayout). Paid Ads run ongoing; a webinar funnel runs
 * evergreen. Both are the same shape, which is why the WORD is per record
 * (`ongoingLabel`) and the behaviour is not.
 */
export type InitiativeKind = "one-time" | "recurring" | "ongoing";

export const INITIATIVE_KINDS: readonly InitiativeKind[] = Object.freeze([
  "one-time",
  "recurring",
  "ongoing",
]);

/**
 * How the initiative turns attention into money.
 *
 * One of the four is not universally available, and the restriction is
 * encoded in `availableConversionPaths` / `validateLibraryConfig` rather than
 * left as prose:
 *
 *   `speaker-fee` STAGE INITIATIVES ONLY. Somebody paying you to speak only
 *                 happens on someone else's stage; see STAGE_CATEGORY_IDS.
 *                 The owner's designs agree: only the two Other People's
 *                 Stages screens offer it.
 *
 * `leads` IS NOT AUDIENCE-RESTRICTED. It used to be borrowed-only, on the
 * reasoning that your own audience is already yours. The owner's category
 * designs overrule that: they offer "Collect leads" on own-audience screens —
 * Your Own Event — Virtual ("What's the ask? Make an offer · Drive to calls ·
 * Collect leads"), Content & Media ("Mostly collect leads") and Local
 * Presence ("Path: collect leads"). Followers, searchers and reviewers on your
 * own channels are not yet on your list, so there is a lead to collect.
 *
 * "I don't know yet" is an ANSWER, not a path — see ASK_UNDECIDED.
 */
export type ConversionPath = "offer" | "calls" | "leads" | "speaker-fee";

export const CONVERSION_PATHS: readonly ConversionPath[] = Object.freeze([
  "offer",
  "calls",
  "leads",
  "speaker-fee",
]);

/**
 * Whose audience the initiative reaches.
 *
 * `mixed` is only ever a CATEGORY value, never a record value — see
 * `RecordAudienceSource`. It means "the category does not decide this", and it
 * is what keeps the partner block honest: a category that resolved `borrowed`
 * by guesswork would attach a "who's hosting?" block to every record under it,
 * and one that resolved `own` would strip it from every booked placement.
 */
export type AudienceSource = "own" | "borrowed" | "mixed";

/**
 * A single record always resolves to one or the other.
 *
 * The workbook's `own_or_ops` column has three values, not two: OWN (59),
 * OPS (25) and "OWN & OPS" (3, including Affiliate Launch). A record cannot
 * stay ambiguous — the partner block and the contract-terms revenue window
 * both branch on it — so the mixed rows are resolved at config time by `resolveRecordAudience`,
 * and the spec's ruling for Affiliate Launch is `borrowed`.
 */
export type RecordAudienceSource = Extract<AudienceSource, "own" | "borrowed">;

/** In-person, digital or both. `digital` is the spec's word, not "virtual". */
export type InitiativeFormat = "in-person" | "digital" | "hybrid";

export const INITIATIVE_FORMATS: readonly InitiativeFormat[] = Object.freeze([
  "in-person",
  "digital",
  "hybrid",
]);

/**
 * What the category does with the format question.
 *
 * `pinned-*` is the interesting case and the reason
 * `SuppressedSetting`/`SectionState` exist: the question does not render AND
 * the value is still written. "Your Own Event — Virtual Events" never asks
 * whether it is digital, but the record is useless without `format` set.
 * `not-asked` is the opposite: no question and nothing to store, because the
 * concept does not apply to an email campaign.
 *
 * `pinned-in-person` IS USED BY NO CATEGORY, and that is deliberate rather
 * than an oversight. The two In-Person Events categories ASK — see their
 * entries in CATEGORIES for why. The member stays because the pinning
 * machinery is still needed for `LibraryRecordConfig.formatOverride`, which is
 * how one record declares itself in-person inside a category that asks. Do not
 * delete it as dead code.
 */
export type CategoryFormatBehaviour =
  | "asked"
  | "pinned-in-person"
  | "pinned-digital"
  | "pinned-hybrid"
  | "not-asked";

/**
 * Recurrence frequencies.
 *
 * ADOPTED, NOT INVENTED: these are exactly `RepeatFrequency` from
 * src/lib/intake-forecast.ts, which the forecast already understands, and are
 * defined there (that module has no imports, so every consumer can use it).
 * Canonical order, most often first: weekly, bi-weekly, monthly, bi-monthly,
 * quarterly, semi-annually, annually.
 */
export type RecurrenceFrequency = RepeatFrequency;

export {
  REPEAT_FREQUENCIES as RECURRENCE_FREQUENCIES,
  REPEAT_FREQUENCY_LABELS as RECURRENCE_FREQUENCY_LABELS,
  REPEAT_RUNS_PER_YEAR as RECURRENCE_RUNS_PER_YEAR,
  isRepeatFrequency as isRecurrenceFrequency,
} from "../intake-forecast";

/**
 * Where a revenue line gets its price.
 *
 * The four spellings are the spec's, verbatim, dots included. `product.price`
 * reads the linked product; the other three read an answer on the initiative
 * itself. Not normalised to one shape on purpose — these are stored values and
 * renaming them later is a migration.
 */
// "vip_price" was removed with the VIP block (client, Oct 2026: "delete VIP completely").
export type PriceSource = "product.price" | "attrs.entry_price" | "host_fee";

export const PRICE_SOURCES: readonly PriceSource[] = Object.freeze([
  "product.price",
  "attrs.entry_price",
  "host_fee",
]);

/**
 * The named dates a revenue window may reference.
 *
 * Named rather than absolute because a revenue line is library configuration,
 * shared by every company that picks the initiative; only the user's own
 * answers know when their cart opens. `validateLibraryConfig` refuses a window
 * naming a date the record can never have.
 */
export type NamedDate =
  | "registration_opens"
  | "registration_closes"
  | "cart_opens"
  | "cart_closes"
  | "event_date"
  | "close_date"
  | "contract_terms";

export const NAMED_DATES: readonly NamedDate[] = Object.freeze([
  "registration_opens",
  "registration_closes",
  "cart_opens",
  "cart_closes",
  "event_date",
  "close_date",
  "contract_terms",
]);

/* ------------------------------------------------------------------ *
 * The twelve categories
 * ------------------------------------------------------------------ */

/**
 * The stored category identity.
 *
 * SLUGS, AND THE ONLY THING THAT IS EVER PERSISTED OR SWITCHED ON. The
 * workbook's category text is an input, not a key: it carries embedded
 * newlines in three of the twelve values and an em dash in none of them, while
 * the spec uses an em dash in four. An id has no spelling to get wrong.
 *
 * The "ops" categories keep the spec's wording ("Other People's Stages")
 * rather than the workbook column's abbreviation, so that a reader of the
 * slug does not have to know that OPS means someone else's audience.
 */
export type CategoryId =
  | "webinars"
  | "funnels-launches-promotions"
  | "your-own-event-in-person"
  | "your-own-event-virtual"
  | "other-peoples-stages-in-person"
  | "other-peoples-stages-virtual"
  | "paid-ads"
  | "email-text-mail"
  | "sales-outreach"
  | "content-media"
  | "partnerships-referrals"
  | "local-presence";

export interface CanonicalCategory {
  id: CategoryId;
  /**
   * What the user reads. The SPEC's em-dash spelling, deliberately not the
   * workbook's, because the workbook's contains a line break mid-title.
   */
  label: string;
  /**
   * Position in the picker, 1-based.
   *
   * THE SPEC'S ORDER IS "BY WHAT PEOPLE PLAN FIRST" and it is a product
   * decision, not a presentation detail. Do not alphabetise and do not sort by
   * launch count; both have been proposed and both bury Webinars, which is
   * where most of the client's customers start.
   */
  tileOrder: number;
  /**
   * How many launches the picker tile advertises.
   *
   * A CROSS-CHECK, NOT THE DISPLAYED VALUE. These twelve numbers are the
   * launch-set expectation, verified against the client's 18 Oct workbook and
   * summing to 87 (asserted in the tests). But THE PICKER MUST STILL COUNT THE
   * LIBRARY — records with `isLaunch` — because a tile that disagrees with the
   * list it opens is worse than a tile with no number, and the library drifts
   * every time the workbook is re-uploaded or a record is switched off.
   *
   * So what these are for is catching that drift: a category whose live count
   * no longer matches the number here means either the workbook lost rows or
   * someone toggled records off, and either way somebody should know.
   *
   * Still `number | null` in the type: a thirteenth category added before its
   * count is known should be expressible without a made-up number.
   */
  launchCount: number | null;
  /**
   * Whose audience this category reaches, where the category decides it.
   *
   * `mixed` means IT DOES NOT DECIDE and the record (or the user) does. Four
   * categories are mixed (Webinars, Paid Ads, Email, Text & Mail, and
   * Partnerships & Referrals), for different reasons, and only Webinars shows
   * headings — see showsAudienceHeadings.
   */
  audienceSource: AudienceSource;
  /**
   * Split the initiative list under "Your audience" / "Someone else's
   * audience" headings.
   *
   * TRUE FOR WEBINARS ONLY, per the spec. Webinars is the one category that
   * genuinely holds both kinds side by side — your own list on your own
   * webinar, and a partner's list on a co-hosted one — so a flat list there
   * reads as arbitrary. Everywhere else the heading would either be a single
   * heading over the whole list (noise) or, in Partnerships & Referrals, a
   * split the records do not actually make.
   */
  showsAudienceHeadings: boolean;
  /** What the category does with the format question. */
  formatBehaviour: CategoryFormatBehaviour;
  /**
   * The format preselected when the question is ASKED.
   *
   * ONLY MEANINGFUL WITH `formatBehaviour: "asked"`, and the two In-Person
   * Events categories are the only askers; both default to `in-person`. A
   * default is not a pin — the field renders, the user can change it, and the
   * answer that gets stored is theirs. The default exists so that the common
   * case is one less click, not so that the library can avoid deciding.
   */
  defaultFormat?: InitiativeFormat;
}

/**
 * The twelve, in the spec's order.
 *
 * Frozen: module-level shared state that the picker, the admin editor and the
 * validator all read. A caller that sorted it in place would reorder the
 * picker for the rest of the process.
 *
 * AUDIENCE VALUES COME FROM THE OWNER'S CATEGORY DESIGNS (the full-size
 * screen per category), which are more specific than the written spec and
 * overrule it where they differ; each entry quotes the design line it rests
 * on. Values still marked INFERRED were not settled by either and are the safe
 * reading rather than a known product decision.
 */
export const CATEGORIES: readonly CanonicalCategory[] = Object.freeze([
  {
    id: "webinars",
    label: "Webinars",
    tileOrder: 1,
    launchCount: 7,
    // The spec: Webinars "holds both". Your own list and a partner's list run
    // the same initiative, so neither answer can be pinned.
    audienceSource: "mixed",
    showsAudienceHeadings: true,
    // A webinar is digital by definition; asking would be a question with one
    // answer. The value is still stored — see "pinned-*" on
    // CategoryFormatBehaviour.
    formatBehaviour: "pinned-digital",
  },
  {
    id: "funnels-launches-promotions",
    label: "Funnels, Launches & Promotions",
    tileOrder: 2,
    launchCount: 11,
    // A launch or promotion is run AT your list. INFERRED: the spec names the
    // audience outright only for the four event categories.
    audienceSource: "own",
    showsAudienceHeadings: false,
    // INFERRED, and the uncertain one: a launch can hang off an in-person
    // bootcamp, a virtual challenge or both, so "asked" is possible here.
    // `not-asked` is the safe direction for the rest of the non-event
    // categories but NOT obviously safe for this one — see the report.
    formatBehaviour: "not-asked",
  },
  {
    id: "your-own-event-in-person",
    label: "Your Own Event — In-Person Events",
    tileOrder: 3,
    launchCount: 8,
    // Named outright by the category: it is YOUR event, you fill the room.
    audienceSource: "own",
    showsAudienceHeadings: false,
    // ASKED, NOT PINNED, and this is the spec's wording turned into code: most
    // stage formats run both ways. A networking event, corporate training, a
    // breakout panel, a chamber meeting and a mastermind room all happen in a
    // room OR on a call, so filing them under In-Person Events must not force
    // an answer the library has no business assuming. What the field actually
    // captures is the exception — a format normally held in a room that is
    // running on a call this time.
    formatBehaviour: "asked",
    defaultFormat: "in-person",
  },
  {
    id: "your-own-event-virtual",
    label: "Your Own Event — Virtual Events",
    tileOrder: 4,
    launchCount: 7,
    audienceSource: "own",
    showsAudienceHeadings: false,
    formatBehaviour: "pinned-digital",
  },
  {
    id: "other-peoples-stages-in-person",
    label: "Other People's Stages — In-Person Events",
    tileOrder: 5,
    launchCount: 13,
    // Named outright: someone else gathered the room, so the partner block
    // attaches. (`speaker-fee` comes from being a stage category, not from
    // the audience — see STAGE_CATEGORY_IDS.)
    audienceSource: "borrowed",
    showsAudienceHeadings: false,
    // Asked, for the same reason as Your Own Event — In-Person Events above:
    // the category says where these formats USUALLY run, not where they can.
    formatBehaviour: "asked",
    defaultFormat: "in-person",
  },
  {
    id: "other-peoples-stages-virtual",
    label: "Other People's Stages — Virtual Events",
    tileOrder: 6,
    launchCount: 7,
    audienceSource: "borrowed",
    showsAudienceHeadings: false,
    formatBehaviour: "pinned-digital",
  },
  {
    id: "paid-ads",
    label: "Paid Ads",
    tileOrder: 7,
    launchCount: 8,
    // MIXED, per the owner's design. Standalone ads are YOUR ad spend — the
    // "Your audience" heading literally says "your ad spend" — so they are
    // own. "Bought placements — podcast ads, newsletter ads… there's a host and
    // a booking, so the Partner block applies": those records are borrowed.
    // The category cannot decide; each record does.
    audienceSource: "mixed",
    showsAudienceHeadings: false,
    formatBehaviour: "not-asked",
  },
  {
    id: "email-text-mail",
    label: "Email, Text & Mail",
    tileOrder: 8,
    launchCount: 6,
    // MIXED, per the owner's design: "Borrowed campaigns are real here: a solo
    // ad, a sponsored newsletter send or a partner's dedicated send is a
    // borrowed-audience email campaign, booked with a named partner on a set
    // date, so the Partner block applies." Your own list is the own half.
    audienceSource: "mixed",
    showsAudienceHeadings: false,
    formatBehaviour: "not-asked",
  },
  {
    id: "sales-outreach",
    label: "Sales & Outreach",
    tileOrder: 9,
    launchCount: 7,
    // OWN, per the owner's design: "Your own audience only. This category
    // never renders on the borrowed branch, so no Partner block attaches."
    // Its only path is drive to calls.
    audienceSource: "own",
    showsAudienceHeadings: false,
    formatBehaviour: "not-asked",
  },
  {
    id: "content-media",
    label: "Content & Media",
    tileOrder: 10,
    launchCount: 5,
    // OWN, per the owner's design: this is the always-on publishing layer —
    // organic social, content, SEO & AI search, your own newsletter, local PR.
    // Podcast and YouTube guesting, the borrowed part this category used to
    // be suspected of holding, moved to Other People's Stages — Virtual.
    // "Mostly collect leads", which is now allowed on own records.
    audienceSource: "own",
    showsAudienceHeadings: false,
    formatBehaviour: "not-asked",
  },
  {
    id: "partnerships-referrals",
    label: "Partnerships & Referrals",
    tileOrder: 11,
    launchCount: 5,
    // The spec DELIBERATELY DOES NOT RESOLVE this one. A referral arrangement
    // can run either way round — your customers referring out, or a partner
    // referring in — and often both at once, so the category must not decide.
    // No headings, unlike Webinars: the records here do not divide into two
    // clean halves, so a heading would be an arbitrary cut.
    audienceSource: "mixed",
    showsAudienceHeadings: false,
    formatBehaviour: "not-asked",
  },
  {
    id: "local-presence",
    label: "Local Presence",
    tileOrder: 12,
    launchCount: 3,
    // OWN, per the owner's design: your own business profile, reviews and
    // listings. "Path: collect leads", which is now allowed on own records.
    audienceSource: "own",
    showsAudienceHeadings: false,
    // INFERRED: "local" sounds in-person, but the category also covers local
    // search and directory listings, so pinning in-person would be wrong for
    // part of it. See the report.
    formatBehaviour: "not-asked",
  },
]);

const CATEGORY_BY_ID: ReadonlyMap<CategoryId, CanonicalCategory> = new Map(
  CATEGORIES.map((c) => [c.id, c])
);

/**
 * The stage categories.
 *
 * WHAT "STAGE INITIATIVE" MEANS, once, for the `speaker-fee` rule. Only the
 * two Other People's Stages categories: your own event has a stage too, but
 * nobody pays you a speaker fee to appear at it.
 *
 * NOT THE PARTNER-BLOCK RULE any more. The partner block follows the RECORD's
 * audience (see resolveFormLayout), because the owner's designs attach it to
 * bought ad placements and sponsored email sends as well as stages.
 *
 * Content & Media is not in here: per the owner's design, podcast and YouTube
 * guesting moved to Other People's Stages — Virtual, so it is already covered.
 */
export const STAGE_CATEGORY_IDS: readonly CategoryId[] = Object.freeze([
  "other-peoples-stages-in-person",
  "other-peoples-stages-virtual",
]);

export const isStageCategory = (id: CategoryId): boolean =>
  STAGE_CATEGORY_IDS.includes(id);

/**
 * Categories whose records can involve many partners at once, which is what
 * the affiliate block collects.
 *
 * DERIVED FROM THE CATEGORY, not a per-record flag, because no such flag is in
 * the config shape the spec defines and `fieldExtras` is explicitly capped at
 * three "only for a field something downstream reads" — a block is not an
 * extra. If the owner wants per-record control this becomes a config field.
 */
export const AFFILIATE_BLOCK_CATEGORY_IDS: readonly CategoryId[] = Object.freeze([
  "funnels-launches-promotions",
  "partnerships-referrals",
]);

/**
 * Categories whose BORROWED records still do not get the partner block.
 *
 * Two categories, both per the owner's designs, and both get the affiliate
 * block instead:
 * - Partnerships & Referrals: "many partners at once, so who's hosting? and is
 *   it booked? don't apply".
 * - Funnels, Launches & Promotions, in its "When partners are involved" block:
 *   "The Affiliate block, not the Partner block — many partners, no single
 *   host, so who's hosting? doesn't apply." This is what a borrowed Funnels
 *   record such as Affiliate Launch ("OWN & OPS", resolved to borrowed) hits.
 * Everywhere else a borrowed record has a named partner on a set date, which
 * is what the partner block is for.
 */
export const PARTNER_BLOCK_EXCLUDED_CATEGORY_IDS: readonly CategoryId[] = Object.freeze([
  "funnels-launches-promotions",
  "partnerships-referrals",
]);

/**
 * The fifth answer to "What's the ask?": "I don't know yet".
 *
 * AN ANSWER, NOT A `ConversionPath`. It means "path not decided": the form
 * resolves with `effectivePath` null, so no path-gated block (cart, lead
 * handoff) attaches and the close-date label stays generic. Making it a fifth
 * path would force a revenue rule onto it, and the whole point of the answer
 * is that the revenue is NOT guessed. Nothing is stored for it — the
 * conversion path stays null — so it needs no DB change.
 */
export const ASK_UNDECIDED = "undecided" as const;
export type AskUndecided = typeof ASK_UNDECIDED;

/**
 * Categories whose "What's the ask?" offers ASK_UNDECIDED.
 *
 * Only Other People's Stages — In-Person, per the owner's design: a host may
 * not have said yet whether you can pitch, take calls or collect leads.
 */
export const ASK_UNDECIDED_CATEGORY_IDS: readonly CategoryId[] = Object.freeze([
  "other-peoples-stages-in-person",
]);

export const offersAskUndecided = (id: CategoryId): boolean =>
  ASK_UNDECIDED_CATEGORY_IDS.includes(id);

// The VIP tier block was removed (client, Oct 2026: "can you just delete VIP completely?").
/* ------------------------------------------------------------------ *
 * The category matcher
 * ------------------------------------------------------------------ */

/**
 * The twelve category strings EXACTLY AS THE WORKBOOK HOLDS THEM.
 *
 * Written with explicit escapes so that no editor, formatter or copy-paste
 * through a tool that tidies whitespace can quietly change them — the same
 * precaution the GHL tag contract takes with its non-ASCII characters, and for
 * the same reason: a changed character here does not fail, it just stops
 * matching 7 of the 87 rows.
 *
 * Three things about these strings are load-bearing:
 *
 *   \u002D  HYPHEN-MINUS, not an em dash. The workbook uses a plain hyphen in
 *           all four event categories; the product spec uses an em dash in all
 *           four. Neither spelling is wrong and both must resolve.
 *   \n      THREE of the four event categories carry a LINE BREAK after the
 *           hyphen, from how the cell was typed. "Other People's Stages -
 *           Virtual Events" does not — the inconsistency is the client's and
 *           is reproduced faithfully rather than tidied, because the matcher
 *           has to cope with real data, not data we wish we had.
 *   \u0027  Straight apostrophe, not a typographic one.
 *
 * NOTE THAT INGEST ALREADY COLLAPSES THIS. `cell()` in
 * src/lib/workbook/parse.ts runs `.replace(/\s+/g, ' ')`, so the value stored
 * in wb_initiative_library.category is the single-spaced form. The matcher
 * accepts both because it sits at an edge that can receive either: a stored
 * row, or a freshly parsed sheet.
 */
export const CATEGORY_SOURCE_STRINGS: Readonly<Record<CategoryId, string>> = Object.freeze({
  webinars: "Webinars",
  "funnels-launches-promotions": "Funnels, Launches & Promotions",
  "your-own-event-in-person": "Your Own Event \u002D \nIn-Person Events",
  "your-own-event-virtual": "Your Own Event \u002D \nVirtual Events",
  "other-peoples-stages-in-person": "Other People\u0027s Stages \u002D \nIn-Person Events",
  // The one without the line break. Not a typo here; a typo in the workbook.
  "other-peoples-stages-virtual": "Other People\u0027s Stages \u002D Virtual Events",
  "paid-ads": "Paid Ads",
  "email-text-mail": "Email, Text & Mail",
  "sales-outreach": "Sales & Outreach",
  "content-media": "Content & Media",
  "partnerships-referrals": "Partnerships & Referrals",
  "local-presence": "Local Presence",
});

/**
 * Extra spellings that must resolve, beyond the source strings and the labels.
 *
 * Only forms that have actually been seen or that the spec uses. This is NOT a
 * place to pre-empt spellings nobody writes: every alias is a chance for two
 * categories to collapse into one.
 */
const CATEGORY_ALIASES: Readonly<Record<string, CategoryId>> = Object.freeze({
  // The workbook's own abbreviation, which appears in sheet names and in the
  // `own_or_ops` column's vocabulary rather than in the category cell.
  "ops-in-person": "other-peoples-stages-in-person",
  "ops-virtual": "other-peoples-stages-virtual",
  // Banner rows are written as "CATEGORY: OTHER PEOPLE'S STAGES" (see the
  // parser's header comment); the trailing colon and prefix normalise away but
  // the un-split form still needs somewhere to go. Deliberately NOT mapped:
  // "other peoples stages" alone cannot choose between in-person and virtual,
  // and guessing would file half the stage initiatives under the wrong tile.
});

/**
 * Build the lookup.
 *
 * `normalizeKey` FROM THE WORKBOOK PARSER DOES THE WHOLE JOB, which is why no
 * new normaliser is written here. It lowercases, drops apostrophes, then
 * replaces every run of non-`[a-z0-9]` with a single hyphen. That one
 * substitution collapses all four of the variations at once:
 *
 *   "Your Own Event - \nIn-Person Events" -> "your-own-event-in-person-events"
 *   "Your Own Event - In-Person Events"   -> "your-own-event-in-person-events"
 *   "Your Own Event \u2014 In-Person Events" -> "your-own-event-in-person-events"
 *   "  YOUR OWN EVENT -- in person events " -> "your-own-event-in-person-events"
 *
 * `canonicalKey` is deliberately NOT used. Its KEY_ALIASES table maps
 * INITIATIVE names onto library keys ("live-webinar" -> "webinar"); routing a
 * category through it would be a category/initiative confusion that happens to
 * be harmless today and would break the first time an initiative is named
 * after its category.
 */
function buildCategoryLookup(): Map<string, CategoryId> {
  const lookup = new Map<string, CategoryId>();
  const put = (raw: string, id: CategoryId) => {
    const key = normalizeKey(raw);
    const existing = lookup.get(key);
    // A clash means two categories normalise to the same key, which would make
    // the matcher's answer depend on insertion order. Louder than a silent
    // overwrite, and it can only ever fire in development.
    if (existing && existing !== id) {
      throw new Error(
        `Category spelling "${raw}" normalises to "${key}", which already maps to ${existing}.`
      );
    }
    lookup.set(key, id);
  };

  for (const category of CATEGORIES) {
    put(category.id, category.id);
    put(category.label, category.id);
    put(CATEGORY_SOURCE_STRINGS[category.id], category.id);
    // The whitespace-collapsed form ingest actually stores. Normalises to the
    // same key as the raw form; added explicitly so that a future change to
    // normalizeKey which stopped collapsing newlines would fail a test rather
    // than silently drop three categories.
    put(CATEGORY_SOURCE_STRINGS[category.id].replace(/\s+/g, " ").trim(), category.id);
  }
  for (const [alias, id] of Object.entries(CATEGORY_ALIASES)) put(alias, id);

  return lookup;
}

const CATEGORY_LOOKUP = buildCategoryLookup();

export type CategoryMatch =
  | { ok: true; category: CanonicalCategory }
  | {
      ok: false;
      /** `empty`: nothing to match. `unknown`: a real string, no category. */
      error: "empty" | "unknown";
      /** What it normalised to. The thing to add as an alias, if it is one. */
      normalized: string;
      message: string;
    };

/**
 * Resolve any spelling of a category to the canonical one.
 *
 * REFUSES WITH A RESULT, NOT AN EXCEPTION, and not with a fallback category.
 * The two tempting fallbacks are both worse than a refusal: defaulting to the
 * first category files unknown rows under Webinars, and inventing a
 * "other" category puts records in a tile the spec does not have. The caller —
 * ingest, or the admin editor — reports the unmatched string so somebody can
 * either fix the workbook cell or add an alias, which is how the parser's
 * unmatched-sheet warnings already work.
 */
export function resolveCategory(raw: unknown): CategoryMatch {
  const normalized = normalizeKey(raw);
  if (normalized === "") {
    return {
      ok: false,
      error: "empty",
      normalized,
      message: "No category was given.",
    };
  }
  const id = CATEGORY_LOOKUP.get(normalized);
  if (!id) {
    return {
      ok: false,
      error: "unknown",
      normalized,
      message:
        `"${String(raw)}" is not one of the twelve initiative categories ` +
        `(it reads as "${normalized}"). Fix the category cell in the workbook, ` +
        `or add the spelling to CATEGORY_ALIASES if it is a real variant.`,
    };
  }
  // Non-null: every id in the lookup comes from CATEGORIES.
  return { ok: true, category: CATEGORY_BY_ID.get(id)! };
}

/** The category for an id already known to be valid, or undefined. */
export const categoryById = (id: unknown): CanonicalCategory | undefined =>
  typeof id === "string" ? CATEGORY_BY_ID.get(id as CategoryId) : undefined;

/**
 * The reverse direction: id -> what the user reads.
 *
 * Returns the raw id for an unknown one rather than throwing or returning
 * empty. A label is display text; an id that outlived a category rename should
 * show up as an odd-looking tile, not as a blank one or a crashed page.
 */
export function categoryLabel(id: unknown): string {
  const category = categoryById(id);
  return category ? category.label : String(id ?? "");
}

/** Is this a category id we know? Narrows, for use on database reads. */
export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === "string" && CATEGORY_BY_ID.has(value as CategoryId);
}

/* ------------------------------------------------------------------ *
 * Per-record configuration
 * ------------------------------------------------------------------ */

/**
 * A revenue window: when the money from one price arrives.
 *
 * MULTI-LINE BY DESIGN. A launch with a VIP tier earns at two prices over two
 * windows, and a stage gig earns a speaker fee on contract terms plus product
 * sales at the event. One line per price, each with its own window, is what
 * lets the forecast spread them correctly instead of dropping everything on
 * the event date.
 */
export interface RevenueLine {
  /** Stable within the record. Referenced by the user's per-line answers. */
  id: string;
  priceSource: PriceSource;
  /** Named dates, resolved against the user's answers at forecast time. */
  windowOpens: NamedDate;
  windowCloses: NamedDate;
  /**
   * Optional gate, e.g. only count this line when the conversion path is
   * `offer`. Free text on purpose: nothing here evaluates it, and inventing an
   * expression language before there is a second consumer would be a guess at
   * a grammar.
   */
  condition?: string;
}

/**
 * One extra question, beyond the universal inputs and the category schema.
 *
 * THE CEILING IS THREE AND IT IS A HARD RULE, not a guideline: the spec's test
 * for an extra is "something downstream reads this field". Without the cap,
 * every initiative acquires its own bespoke questionnaire and the form stops
 * being a form. `validateLibraryConfig` refuses a fourth.
 */
export interface FieldExtra {
  /** Column/attribute key the answer is written to. */
  key: string;
  label: string;
  /**
   * What reads it. Required, because it is the justification for the extra
   * existing at all — an extra nobody reads is the thing the cap exists to
   * stop.
   */
  readBy: string;
  /**
   * The answer's type. ABSENT MEANS `text`, so rows saved before types
   * existed keep reading the way they always did.
   */
  type?: FieldExtraType;
  /** Muted help text under the field. */
  hint?: string;
  /**
   * The extra IS a universal answer, asked in this record's words.
   *
   * A BOUND EXTRA STORES NO COPY. It renders as the universal field it binds
   * (relabelled, with `hint` as its note) and its value is that field's value,
   * so there is exactly one answer and nothing to drift. Affiliate Launch is
   * the case: the offer owner sets the cart dates, and the record needs to say
   * so on the cart fields rather than ask for the dates twice.
   *
   * Only meaningful while the cart block is attached: both targets are cart
   * dates, and the close date only reads as "Cart closes" on the offer path.
   */
  binds?: FieldExtraBind;
  /**
   * A universal answer this extra's value PREFILLS. The user can still change
   * it; see `setExtraAnswer` in universal-form.ts for when it stops following.
   * Pitch day and webinar date both set when the cart opens.
   */
  derives?: FieldExtraDerive;
}

/** What an extra's answer is. */
export type FieldExtraType = "text" | "number" | "date";

export const FIELD_EXTRA_TYPES: readonly FieldExtraType[] = Object.freeze(["text", "number", "date"]);

/** The universal answers an extra may stand in for. Both are cart dates. */
export type FieldExtraBind = "cart.opens" | "dates.close";

export const FIELD_EXTRA_BINDS: readonly FieldExtraBind[] = Object.freeze(["cart.opens", "dates.close"]);

/** The universal answers an extra may prefill. */
export type FieldExtraDerive = "cart.opens";

export const FIELD_EXTRA_DERIVES: readonly FieldExtraDerive[] = Object.freeze(["cart.opens"]);

/** An extra's type, with the absent-means-text rule applied. */
export const fieldExtraType = (extra: Pick<FieldExtra, "type">): FieldExtraType => extra.type ?? "text";

/**
 * Who the partner block asks about, and whether it asks about booking.
 *
 * TWO INDEPENDENT GATES, NOT ONE. The spec is emphatic. `host` collects who
 * owns the audience; `booking` collects whether the slot is confirmed. A
 * networking initiative has a host (the event) but no booking to confirm, so
 * Networking sets `booking: false`.
 *
 * AND WHERE BOOKING IS SUPPRESSED, `booking_status` NEVER GETS A VALUE. This
 * is the part that is easy to get wrong: the task templates swap on booking
 * status (pitching tasks before the slot is confirmed, delivery tasks after),
 * and a default of "confirmed" written for a record that never asked would
 * fire the swap and generate the wrong task list. So booking is NOT modelled
 * as suppressed-with-a-silent-value — it is modelled as absent, and
 * `resolveFormLayout` reports `bookingStatusWritten: false` so the writer
 * cannot fill it in by accident.
 */
export interface PartnerBlockConfig {
  host: boolean;
  booking: boolean;
}

/** Both true unless the record says otherwise. */
export const DEFAULT_PARTNER_BLOCK: Readonly<PartnerBlockConfig> = Object.freeze({
  host: true,
  booking: true,
});

/**
 * Everything an admin may set for one `initiative_key`.
 *
 * KEYED BY `initiative_key`, NEVER BY `workbook_id`. The workbook's ID column
 * has 76 distinct values over 87 rows, two coexisting formats (`IN001` and
 * `IN11`) and the collision `IN010` vs `IN10`. It is not a key and must not be
 * used as one.
 *
 * NOT PART OF THE WORKBOOK. wb_initiative_library is replaced wholesale on
 * every upload (see migration 040), so this configuration has to live
 * somewhere an upload does not touch, joined on initiative_key with no foreign
 * key — the same arrangement `initiatives.library_key` already uses.
 */
export interface LibraryRecordConfig {
  /** wb_initiative_library.initiative_key. */
  initiativeKey: string;
  /**
   * Does this record appear in the picker at all?
   *
   * THE OWNER'S REQUESTED CONTROL over which initiatives are offered, and the
   * flag that today's /admin/initiatives toggle was supposed to be but is not
   * — that toggle sits on `initiative_types`, which the AI never reads. No
   * such flag exists anywhere in the workbook.
   */
  isLaunch: boolean;
  /**
   * The kinds this record may be.
   *
   * ONE ENTRY SUPPRESSES THE QUESTION and the value is set silently. Most
   * records are one kind only, which is why the Kind section is absent from
   * most forms.
   */
  allowedKinds: readonly InitiativeKind[];
  /** Filtered further by audience and stage rules — see availableConversionPaths. */
  allowedPaths: readonly ConversionPath[];
  /**
   * Whose audience, for this record.
   *
   * Resolved, never mixed: see RecordAudienceSource. Defaults from the
   * category where the category decides, which is what `resolveRecordAudience`
   * is for.
   */
  audienceSource: RecordAudienceSource;
  /**
   * The word shown for the `ongoing` kind on this record.
   *
   * PER RECORD BECAUSE THE WORD IS THE CLIENT'S DOMAIN LANGUAGE, not a
   * synonym: a webinar that runs permanently is "Evergreen", ads that run
   * permanently are "Ongoing", and showing a webinar customer "Ongoing" reads
   * as a different product than the one they were sold. Absent when `ongoing`
   * is not an allowed kind, and validation refuses it being set then.
   */
  ongoingLabel?: string;
  /**
   * This record's format, overriding whatever its category does.
   *
   * THE HYBRID RECORDS ARE WHY THIS EXISTS. The spec pins "Hybrid Events" to
   * hybrid and does not ask — but hybrid is not a property of a CATEGORY,
   * it is a property of four individual records, one sitting inside each of
   * the four event categories. Putting `pinned-hybrid` on a category would
   * pin every record under it; putting it here pins the one record that is
   * actually hybrid and leaves its neighbours alone.
   *
   * BEATS ALL FOUR CATEGORY BEHAVIOURS, `not-asked` INCLUDED. A record that
   * declares a format needs that format stored even where its category would
   * never raise the question — see resolveFormLayout, which checks this first.
   * The result is always `suppressed`: off screen, value still written.
   *
   * CLIENT DATA GAP, for whoever configures these four records: the client's
   * workbook holds only THREE rows named "Hybrid Events" (workbook ID IN15, in
   * Other People's Stages In-Person, Other People's Stages Virtual, and Your
   * Own Event Virtual). The spec expects four, one per event category, so the
   * Your Own Event — In-Person hybrid record appears to be missing from the
   * library. That is the client's data to fix, not something this module can
   * or should paper over.
   */
  formatOverride?: InitiativeFormat;
  /** Defaults to DEFAULT_PARTNER_BLOCK when absent. */
  partnerBlock?: PartnerBlockConfig;
  revenueLines: readonly RevenueLine[];
  /** At most three. */
  fieldExtras: readonly FieldExtra[];
  /**
   * Which frequencies a recurring run may use.
   *
   * MOST RECORDS ALLOW EXACTLY ONE, which suppresses the Frequency question
   * the same way a single allowed kind suppresses Kind. Only meaningful when
   * `recurring` is an allowed kind; validation refuses it otherwise.
   */
  allowedFrequencies: readonly RecurrenceFrequency[];
  /**
   * Does the form ask for a start date? From the workbook's "Start Date"
   * column (Yes / No) ONLY — there is no admin input and no
   * initiative_library_config column for it (see deriveConfig).
   *
   * ABSENT MEANS ASK, today's behaviour: a blank or unreadable cell, a
   * database without migration 054, or a workbook without the column. Only an
   * explicit `false` hides the field, and even then resolveFormLayout keeps it
   * for an ongoing run with no event date (it needs a launch date).
   */
  askStartDate?: boolean;
  /**
   * Does the form ask for an event date? From the workbook's "Event Date"
   * column, with the same rules as askStartDate. `false` makes the event date
   * absent whatever the kind.
   */
  askEventDate?: boolean;
}

/**
 * Resolve the workbook's three-valued `own_or_ops` to a record audience.
 *
 * "OWN & OPS" (3 rows, Affiliate Launch among them) CANNOT STAY AMBIGUOUS:
 * the partner block and the contract-terms window both branch on this, and
 * leaving it unresolved would mean two code paths each guessing. The spec
 * rules that Affiliate Launch resolves to `borrowed`, and the general rule
 * follows it — an initiative that can reach someone else's audience has a
 * counterparty, so resolving mixed to `borrowed` keeps the partner block and
 * contract terms available rather than removing what the record supports.
 *
 * Falls back to the category where the column is blank or unreadable, and to
 * `own` where the category does not decide either (Webinars, Paid Ads, Email,
 * Text & Mail, Partnerships & Referrals): the conservative end, since a
 * wrongly-`borrowed` own-audience record asks "who's hosting?" about a
 * campaign nobody hosts.
 */
export function resolveRecordAudience(
  ownOrOps: unknown,
  category: CanonicalCategory
): RecordAudienceSource {
  const value = normalizeKey(ownOrOps);
  if (value === "own") return "own";
  if (value === "ops") return "borrowed";
  // "OWN & OPS" normalises to "own-ops": the ampersand becomes a separator.
  // Both orderings, since nothing guarantees which half the client types first.
  if (value === "own-ops" || value === "ops-own") return "borrowed";
  if (category.audienceSource === "own") return "own";
  if (category.audienceSource === "borrowed") return "borrowed";
  return "own";
}

/**
 * The paths actually offerable for a record, in CONVERSION_PATHS order.
 *
 * The restriction applied in one place, so the form, the validator and the
 * admin editor cannot disagree about whether `speaker-fee` is on the menu.
 * Order is the contract's, not the config's, so the radio list does not
 * reshuffle when an admin reorders `allowedPaths`.
 *
 * `leads` IS NOT FILTERED BY AUDIENCE: the owner's designs offer it on
 * own-audience categories (see ConversionPath). `audienceSource` stays in the
 * signature so callers need not change, and so a future audience rule has
 * somewhere to go.
 */
export function availableConversionPaths(
  config: Pick<LibraryRecordConfig, "allowedPaths" | "audienceSource">,
  category: CanonicalCategory
): readonly ConversionPath[] {
  const allowed = new Set(config.allowedPaths);
  return CONVERSION_PATHS.filter((path) => {
    if (!allowed.has(path)) return false;
    if (path === "speaker-fee") return isStageCategory(category.id);
    return true;
  });
}

/** The partner block config for a record, defaults applied. */
export const partnerBlockOf = (
  config: Pick<LibraryRecordConfig, "partnerBlock">
): PartnerBlockConfig => config.partnerBlock ?? DEFAULT_PARTNER_BLOCK;

/* ------------------------------------------------------------------ *
 * Form layout
 * ------------------------------------------------------------------ */

/**
 * The nine universal sections, in render order.
 *
 * Every initiative form is these nine, with the category schema spliced in
 * BETWEEN `shape` AND `dates` — early enough that the category's own questions
 * inform the dates, late enough that the universal shape of the thing is
 * already settled.
 *
 * INFERRED NAMES. The spec fixes the count at nine, the order, and that the
 * schema slot sits between Shape and Dates; the brief this module was built
 * from names only `kind`, `shape`, `dates`, `timing`, `conversion-path` and
 * `revenue` explicitly. The remaining three are the obvious complement and are
 * flagged in the report. The structure is what downstream depends on; renaming
 * a section id is a one-line edit here.
 */
export const FORM_SECTIONS = Object.freeze([
  /** Which library record this is, and what the user calls it. */
  "initiative",
  /** The product or offer it feeds. */
  "product",
  /** One-time / recurring / ongoing. */
  "kind",
  /** Format, scale, and the record's own shape questions. */
  "shape",
  /** Event, registration and cart dates. */
  "dates",
  /** Where in the year it runs, and how often. */
  "timing",
  /** How attention becomes money. */
  "conversion-path",
  /** Price lines and their windows. */
  "revenue",
  /** The record's up-to-three extras. */
  "extras",
] as const);

export type FormSectionId = (typeof FORM_SECTIONS)[number];

/** The category schema's slot. Not one of the nine; it sits between two of them. */
export const CATEGORY_SCHEMA_SLOT = "category-schema" as const;

export type FormSlotId = FormSectionId | typeof CATEGORY_SCHEMA_SLOT;

/**
 * The render order including the schema slot. Derived, not written out again,
 * so the slot cannot drift away from "between shape and dates".
 */
export const FORM_SLOT_ORDER: readonly FormSlotId[] = Object.freeze(
  FORM_SECTIONS.flatMap((id): FormSlotId[] =>
    id === "dates" ? [CATEGORY_SCHEMA_SLOT, id] : [id]
  )
);

/**
 * THE DISTINCTION THIS MODULE EXISTS TO KEEP STRAIGHT.
 *
 * A question that is not on screen is in one of two completely different
 * states, and treating them as one is how a silently-set value goes missing:
 *
 *   `rendered`   On screen. The user answers it.
 *   `suppressed` NOT on screen, AND A VALUE IS STILL WRITTEN. There was only
 *                one possible answer, so asking would be theatre — but the
 *                record is wrong without the answer. The caller MUST persist
 *                `value`. See `FormLayout.silentValues`, which collects every
 *                one of these so a writer cannot forget a field it never saw.
 *   `absent`     NOT on screen AND NOTHING IS WRITTEN. The concept does not
 *                apply. Writing a default here is a bug, not a convenience:
 *                a `booking_status` on a record that never asked about booking
 *                fires the task-template swap (see PartnerBlockConfig).
 */
export type SettingState<T> =
  | { state: "rendered" }
  | { state: "suppressed"; value: T; reason: string }
  | { state: "absent"; reason: string };

export const isRendered = <T>(s: SettingState<T>): boolean => s.state === "rendered";

/** The value a suppressed setting carries, or null for the other two states. */
export const silentValue = <T>(s: SettingState<T>): T | null =>
  s.state === "suppressed" ? s.value : null;

/** A conditional block, attached or not, with the reason either way. */
export interface BlockPlan {
  id: ConditionalBlockId;
  attached: boolean;
  reason: string;
}

export type ConditionalBlockId =
  /** Cart open/close dates. Attaches on the `offer` path. */
  | "cart"
  /** Who owns the audience. */
  | "partner-host"
  /** Is the slot confirmed. Gated separately from the host. */
  | "partner-booking"
  /** Many-partner plays. */
  | "affiliate"
  /** Where collected leads go. Attaches on the `leads` path. */
  | "lead-handoff";

/** One of the nine sections (or the schema slot) and whether it renders. */
export interface SlotPlan {
  id: FormSlotId;
  rendered: boolean;
  reason: string;
}

/** What the user has answered so far. Partial: the form resolves as it fills. */
export interface FormAnswers {
  kind?: InitiativeKind | null;
  /**
   * A path, or ASK_UNDECIDED ("I don't know yet"). Undecided resolves exactly
   * like no answer: `effectivePath` stays null.
   */
  conversionPath?: ConversionPath | AskUndecided | null;
}

export interface FormLayout {
  category: CanonicalCategory;
  /** Sections in render order, schema slot included. */
  slots: readonly SlotPlan[];
  kind: SettingState<InitiativeKind>;
  /** The kind in force: the answer, or the silently-set one. */
  effectiveKind: InitiativeKind | null;
  format: SettingState<InitiativeFormat>;
  /**
   * The value to preselect when `format` renders, or null.
   *
   * SEPARATE FIELD RATHER THAN A PAYLOAD ON `rendered`, because a default is
   * not a silent value and must not end up looking like one: `silentValues`
   * stays the list of things the writer was never shown, and a default is a
   * thing the user WAS shown and can change. Null whenever format does not
   * render, so a renderer cannot preselect a field that is not there.
   */
  formatDefault: InitiativeFormat | null;
  conversionPath: SettingState<ConversionPath>;
  effectivePath: ConversionPath | null;
  /** The options for the conversion-path question, after the two spec rules. */
  availablePaths: readonly ConversionPath[];
  frequency: SettingState<RecurrenceFrequency>;
  /**
   * Absent on an `ongoing` record (there is no event), and wherever the
   * workbook says the record does not ask for one (askEventDate === false).
   */
  eventDate: SettingState<never>;
  /**
   * The start date (activation_date). Rendered unless the workbook says the
   * record does not ask for one (askStartDate === false) — except that an
   * ongoing run with no event date keeps it, because it needs a launch date.
   * Absent means: no "Enter a start date" error, no "before the start date"
   * checks, and activation_date written as null.
   */
  activationDate: SettingState<never>;
  /**
   * The close-date field. ALWAYS PRESENT — only its wording and whether it
   * is required change (CLOSE_DATE_COPY[variant]).
   */
  closeDate: { rendered: true; variant: CloseDateVariant; label: string; required: boolean };
  /** The word to show for the `ongoing` kind on this record. */
  ongoingLabel: string;
  blocks: readonly BlockPlan[];
  /**
   * Every field the caller must write WITHOUT having shown it.
   *
   * The whole reason `suppressed` is distinct from `absent`. A writer that
   * persists the form's visible answers and ignores this map produces records
   * with no format and no kind, and nothing in the UI shows the omission.
   * Values are strings because they go straight into columns.
   */
  silentValues: Readonly<Record<string, string>>;
}

/** Attached, not stored: which blocks are on screen. */
export const attachedBlocks = (layout: FormLayout): readonly ConditionalBlockId[] =>
  layout.blocks.filter((b) => b.attached).map((b) => b.id);

/** The format a `pinned-*` category writes, or null when it is not pinned. */
const PINNED_FORMAT: Readonly<Record<CategoryFormatBehaviour, InitiativeFormat | null>> =
  Object.freeze({
    asked: null,
    "pinned-in-person": "in-person",
    "pinned-digital": "digital",
    "pinned-hybrid": "hybrid",
    "not-asked": null,
  });

/** The default word for `ongoing` where a record does not give one. */
export const DEFAULT_ONGOING_LABEL = "Ongoing";

/**
 * Which wording the one close-date field uses: a path's, the ongoing
 * override, or the neutral one (no path yet, or "I don't know yet").
 */
export type CloseDateVariant = ConversionPath | "ongoing" | "undecided";

/** Everything the close-date field says: its label, whether it is required, and its errors. */
export interface CloseDateCopy {
  label: string;
  required: boolean;
  /** Shown when a required close date is blank. */
  empty: string;
  invalid: string;
  beforeStart: string;
}

/**
 * The close date's wording per variant.
 *
 * ALWAYS ATTACHED, NEVER SUPPRESSED: every initiative has a point after which
 * it stops producing revenue, and the forecast needs it whatever the path. Only
 * the wording and whether it is required change.
 *
 * offer, calls, leads and ongoing are the spec's exact labels. `leads` is
 * OPTIONAL: a lead magnet may never expire. `speaker-fee` is not in the spec;
 * it keeps its earlier wording and stays required (the fee is a dated deal).
 * `undecided` covers both "no path answered yet" and ASK_UNDECIDED: neutral
 * and optional, because the user has said they do not know what the ask is.
 */
export const CLOSE_DATE_COPY: Readonly<Record<CloseDateVariant, CloseDateCopy>> = Object.freeze({
  offer: {
    label: "Cart closes",
    required: true,
    empty: "Enter the cart close date.",
    invalid: "Enter a valid cart close date.",
    beforeStart: "The cart can't close before the start date.",
  },
  calls: {
    label: "When does this round of calls close?",
    required: true,
    empty: "Enter when this round of calls closes.",
    invalid: "Enter a valid date for when this round of calls closes.",
    beforeStart: "This round of calls can't close before the start date.",
  },
  leads: {
    label: "Does this offer expire?",
    required: false,
    empty: "Enter when this offer expires.",
    invalid: "Enter a valid expiry date.",
    beforeStart: "The offer can't expire before the start date.",
  },
  "speaker-fee": {
    label: "Final payment due",
    required: true,
    empty: "Enter the final payment date.",
    invalid: "Enter a valid final payment date.",
    beforeStart: "Final payment can't be due before the start date.",
  },
  ongoing: {
    label: "When does this initiative end?",
    required: true,
    empty: "Enter when this initiative ends.",
    invalid: "Enter a valid end date.",
    beforeStart: "This initiative can't end before the start date.",
  },
  undecided: {
    label: "When does it close?",
    required: false,
    empty: "Enter when it closes.",
    invalid: "Enter a valid close date.",
    beforeStart: "It can't close before the start date.",
  },
});

/** The close date's label per conversion path (from CLOSE_DATE_COPY). */
export const CLOSE_DATE_LABELS: Readonly<Record<ConversionPath, string>> = Object.freeze({
  offer: CLOSE_DATE_COPY.offer.label,
  calls: CLOSE_DATE_COPY.calls.label,
  leads: CLOSE_DATE_COPY.leads.label,
  "speaker-fee": CLOSE_DATE_COPY["speaker-fee"].label,
});

/**
 * The label that is not a path's.
 *
 * `kind = ongoing` OVERRIDES THE PATH RULE. An ongoing initiative has no run
 * that closes, so a cart or call-round close would be asking for a date that
 * does not exist; what is wanted instead is when it ends, which defaults to
 * the end of the plan year (see ongoingCloseDefault in universal-form.ts).
 * The override is why `effectiveKind` is computed before the label.
 */
export const CLOSE_DATE_LABEL_ONGOING = CLOSE_DATE_COPY.ongoing.label;

/** The neutral label: no path answered yet, or "I don't know yet". */
export const CLOSE_DATE_LABEL_UNDECIDED = CLOSE_DATE_COPY.undecided.label;

/**
 * What renders, what is silently set, and what does not apply.
 *
 * PURE AND TOTAL. Given a config, its category and the answers so far, this is
 * the single answer to "what does the form look like now" — the renderer does
 * not get to add a rule, and neither does the writer. The alternative, which
 * this project has already paid for once in the admin-toggle/library split, is
 * two components each applying four of the five rules.
 *
 * SAFE ON A HALF-FILLED FORM. Every answer is optional and an unanswered
 * conditional simply does not attach; nothing here throws. The form calls it on
 * every keystroke.
 */
export function resolveFormLayout(args: {
  config: LibraryRecordConfig;
  category: CanonicalCategory;
  answers?: FormAnswers;
}): FormLayout {
  const { config, category } = args;
  const answers = args.answers ?? {};
  const silentValues: Record<string, string> = {};

  /* ---- Kind ---------------------------------------------------- */
  // One allowed kind suppresses the question and sets the value. This is the
  // common case: most of the 87 records are one kind only.
  const kind: SettingState<InitiativeKind> =
    config.allowedKinds.length === 1
      ? {
          state: "suppressed",
          value: config.allowedKinds[0],
          reason: "Only one kind is allowed, so there is nothing to choose.",
        }
      : { state: "rendered" };

  const effectiveKind =
    kind.state === "suppressed"
      ? kind.value
      : answers.kind && config.allowedKinds.includes(answers.kind)
        ? answers.kind
        : null;
  if (kind.state === "suppressed") silentValues.kind = kind.value;

  const isOngoing = effectiveKind === "ongoing";

  /* ---- Format -------------------------------------------------- */
  // THE RECORD'S OVERRIDE IS CHECKED FIRST and beats all four category
  // behaviours, `not-asked` included: the point of the override is to express
  // an exception, and an exception that the category could veto would not be
  // one. This is how the four "Hybrid Events" records pin hybrid without
  // their eleven neighbours in the same category going hybrid with them.
  const pinned = config.formatOverride ?? PINNED_FORMAT[category.formatBehaviour];
  const format: SettingState<InitiativeFormat> = pinned
    ? {
        state: "suppressed",
        value: pinned,
        reason: config.formatOverride
          ? `This initiative is always ${pinned}, whatever ${category.label} does with the format question — the value is stored without asking.`
          : `${category.label} is always ${pinned}, so the question is not asked — but the value is still stored.`,
      }
    : category.formatBehaviour === "asked"
      ? { state: "rendered" }
      : { state: "absent", reason: `Format does not apply to ${category.label}.` };
  if (format.state === "suppressed") silentValues.format = format.value;
  // Only a rendered field has a default to preselect. `?? null` rather than
  // a guessed fallback: a category that asks without naming a default means
  // "no answer is the common one", which is a legitimate configuration.
  const formatDefault: InitiativeFormat | null =
    format.state === "rendered" ? (category.defaultFormat ?? null) : null;

  /* ---- Conversion path ----------------------------------------- */
  const availablePaths = availableConversionPaths(config, category);
  const conversionPath: SettingState<ConversionPath> =
    availablePaths.length === 1
      ? {
          state: "suppressed",
          value: availablePaths[0],
          reason: "Only one conversion path is available, so there is nothing to choose.",
        }
      : availablePaths.length === 0
        ? {
            // Only reachable from a config validateLibraryConfig rejects. Absent
            // rather than suppressed: there is no value to write, and writing a
            // guess would decide how the initiative makes money.
            state: "absent",
            reason:
              "No conversion path survives this record's audience and category rules. " +
              "The configuration is invalid — see validateLibraryConfig.",
          }
        : { state: "rendered" };

  // ASK_UNDECIDED is an answer meaning "path not decided", so it leaves the
  // path null: no cart, no lead handoff, a generic close-date label, and no
  // revenue guessed from a path the user has not chosen. It cannot override a
  // suppressed path — with one path there is no question to answer.
  const answeredPath: ConversionPath | null =
    answers.conversionPath && answers.conversionPath !== ASK_UNDECIDED
      ? answers.conversionPath
      : null;
  const effectivePath =
    conversionPath.state === "suppressed"
      ? conversionPath.value
      : answeredPath && availablePaths.includes(answeredPath)
        ? answeredPath
        : null;
  if (conversionPath.state === "suppressed") {
    silentValues.conversion_path = conversionPath.value;
  }

  /* ---- Frequency ----------------------------------------------- */
  // Mirrors Kind: one frequency means no question. Absent unless the run in
  // force is actually recurring — a one-time event has no frequency, and
  // storing one would make the forecast repeat it.
  const canRecur = effectiveKind === null || effectiveKind === "recurring";
  const frequency: SettingState<RecurrenceFrequency> = !canRecur
    ? { state: "absent", reason: `A ${effectiveKind} initiative does not repeat.` }
    : config.allowedFrequencies.length === 1
      ? {
          state: "suppressed",
          value: config.allowedFrequencies[0],
          reason: "Only one frequency is allowed, so there is nothing to choose.",
        }
      : config.allowedFrequencies.length === 0
        ? {
            state: "absent",
            reason: "This record declares no frequencies.",
          }
        : { state: "rendered" };
  if (frequency.state === "suppressed") silentValues.repeat_frequency = frequency.value;

  /* ---- Event date and Timing ----------------------------------- */
  // ONGOING MEANS NO EVENT. The field does not render and Timing goes with it:
  // there is no "when in the year" for something that runs permanently. Both
  // are `absent`, not `suppressed` — there is no date to invent.
  //
  // THE WORKBOOK'S "Event Date" / "Start Date" COLUMNS say which of the two
  // dates the record asks for. Only an explicit `false` removes a field; an
  // unset flag asks, as before the columns existed.
  const eventDate: SettingState<never> = isOngoing
    ? { state: "absent", reason: "An ongoing initiative has no event date." }
    : config.askEventDate === false
      ? { state: "absent", reason: "The workbook says this initiative does not ask for an event date." }
      : { state: "rendered" };
  // An ongoing run with no event date would be left with no date to launch
  // on, so it keeps the start date whatever the workbook says.
  const activationDate: SettingState<never> =
    config.askStartDate !== false
      ? { state: "rendered" }
      : isOngoing && eventDate.state !== "rendered"
        ? { state: "rendered" }
        : { state: "absent", reason: "The workbook says this initiative does not ask for a start date." };

  /* ---- Sections ------------------------------------------------ */
  const slots: SlotPlan[] = FORM_SLOT_ORDER.map((id) => {
    if (id === "kind") {
      return {
        id,
        rendered: kind.state === "rendered",
        reason: kind.state === "rendered" ? "More than one kind is allowed." : kind.reason,
      };
    }
    if (id === "timing") {
      return isOngoing
        ? { id, rendered: false, reason: "Hidden: an ongoing initiative has no event date." }
        : { id, rendered: true, reason: "The initiative has an occurrence to place in the year." };
    }
    if (id === "conversion-path") {
      return {
        id,
        rendered: conversionPath.state === "rendered",
        reason:
          conversionPath.state === "rendered"
            ? `${availablePaths.length} conversion paths are available.`
            : conversionPath.reason,
      };
    }
    if (id === "extras") {
      // Bound extras render as the universal field they bind, not here.
      const own = config.fieldExtras.filter((e) => !e.binds).length;
      return {
        id,
        rendered: own > 0,
        reason:
          own > 0
            ? `${own} extra field(s).`
            : config.fieldExtras.length > 0
              ? "This record's extras are all asked on universal fields."
              : "This record has no extras.",
      };
    }
    return { id, rendered: true, reason: "Universal." };
  });

  /* ---- Conditional blocks -------------------------------------- */
  const partner = partnerBlockOf(config);
  // The partner block attaches on the RECORD's borrowed audience, whatever the
  // category — the owner's designs: "What calls for the block is a named
  // partner on a set date, not the format." That covers stage gigs, bought ad
  // placements (Paid Ads) and sponsored sends (Email, Text & Mail).
  //
  // Own-audience records never get it (Your Own Event: "No partner block, no
  // booking status"; Sales & Outreach: "no Partner block"). Partnerships &
  // Referrals is the one borrowed exception: many partners at once, so it gets
  // the affiliate block instead.
  const partnerExcluded = PARTNER_BLOCK_EXCLUDED_CATEGORY_IDS.includes(category.id);
  const partnerApplies = config.audienceSource === "borrowed" && !partnerExcluded;
  const partnerReason = partnerApplies
    ? "Borrowed audience: a named partner on a set date."
    : config.audienceSource !== "borrowed"
      ? "Own-audience record: there is no partner."
      : `${category.label} runs many partners at once, so it gets the affiliate block instead.`;

  const blocks: BlockPlan[] = [
    {
      id: "cart",
      attached: effectivePath === "offer",
      reason:
        effectivePath === "offer"
          ? "The offer path sells from a cart."
          : "Only the offer path has a cart.",
    },
    {
      id: "partner-host",
      attached: partnerApplies && partner.host,
      reason: !partnerApplies
        ? partnerReason
        : partner.host
          ? "Partner block, host half enabled."
          : "Host is switched off for this record.",
    },
    {
      id: "partner-booking",
      attached: partnerApplies && partner.booking,
      reason: !partnerApplies
        ? partnerReason
        : partner.booking
          ? "Partner block, booking half enabled."
          : // Networking is the spec's example. Nothing may write booking_status
            // here — see bookingStatusWritten below.
            "Booking is switched off for this record, so booking_status stays unset.",
    },
    {
      id: "affiliate",
      attached: AFFILIATE_BLOCK_CATEGORY_IDS.includes(category.id),
      reason: AFFILIATE_BLOCK_CATEGORY_IDS.includes(category.id)
        ? `${category.label} runs many-partner plays.`
        : `${category.label} does not run many-partner plays.`,
    },
    {
      id: "lead-handoff",
      attached: effectivePath === "leads",
      reason:
        effectivePath === "leads"
          ? "Collected leads have to go somewhere."
          : "Only the leads path hands leads on.",
    },
  ];

  /* ---- Close date ---------------------------------------------- */
  // Ongoing overrides the path rule, so it is checked first.
  const closeVariant: CloseDateVariant = isOngoing
    ? "ongoing"
    : effectivePath
      ? effectivePath
      : // Before the path is answered, or answered ASK_UNDECIDED. The neutral wording rather than a
        // guessed one, so the label does not jump to a wrong word and back.
        "undecided";
  const closeCopy = CLOSE_DATE_COPY[closeVariant];

  return {
    category,
    slots,
    kind,
    effectiveKind,
    format,
    formatDefault,
    conversionPath,
    effectivePath,
    availablePaths,
    frequency,
    eventDate,
    activationDate,
    closeDate: { rendered: true, variant: closeVariant, label: closeCopy.label, required: closeCopy.required },
    ongoingLabel: config.ongoingLabel?.trim() || DEFAULT_ONGOING_LABEL,
    blocks,
    silentValues: Object.freeze({ ...silentValues }),
  };
}

/**
 * May `booking_status` be written for this layout?
 *
 * SEPARATE FROM THE BLOCK LIST because it is the thing that must not be got
 * wrong: the task templates swap on booking status, so a value written for a
 * record that never asked (Networking) swaps in the wrong task list. False
 * means leave the column null — not "default it to pending".
 */
export const bookingStatusWritten = (layout: FormLayout): boolean =>
  layout.blocks.some((b) => b.id === "partner-booking" && b.attached);

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/** The hard ceiling on per-record extras. */
export const MAX_FIELD_EXTRAS = 3;

/**
 * Why a configuration is refused. Stable codes: shown in the admin editor and
 * logged by the importer, so they are matched on, not reworded in place.
 */
export type ConfigProblemCode =
  | "no_kinds"
  | "unknown_kind"
  | "no_paths"
  | "unknown_path"
  | "speaker_fee_off_stage"
  | "no_paths_available"
  | "too_many_extras"
  | "duplicate_extra_key"
  | "unknown_extra_type"
  | "invalid_extra_link"
  | "duplicate_revenue_line_id"
  | "impossible_revenue_window"
  | "ongoing_label_without_ongoing"
  | "frequencies_without_recurring"
  | "recurring_without_frequency"
  | "unknown_format"
  | "redundant_format_override"
  | "missing_initiative_key";

export interface ConfigProblem {
  code: ConfigProblemCode;
  /** Which part of the config, for the admin editor to highlight. */
  field: string;
  message: string;
}

export type ConfigValidation =
  | { ok: true }
  /** Non-empty, in the order the checks run — stable for snapshotting. */
  | { ok: false; problems: readonly ConfigProblem[] };

/**
 * Which named dates a record can actually have.
 *
 * THE POINT OF THE WINDOW CHECK. A revenue line is configuration: it names a
 * date, and the forecast resolves that name against the user's answers later.
 * If the record can never produce the date, the line never earns anything —
 * and it does so silently, as a forecast that is simply low. Catching it here
 * is the only place it is cheap.
 *
 *   cart_opens/cart_closes  need the `offer` path; the cart block attaches
 *                           nowhere else.
 *   event_date, registration_*  need an event, so they are impossible on a
 *                           record whose only kind is `ongoing` (see
 *                           resolveFormLayout: no event date, no Timing).
 *   contract_terms          needs a counterparty, i.e. a borrowed audience.
 *   close_date              always available — see CLOSE_DATE_LABELS.
 */
function availableNamedDates(
  config: LibraryRecordConfig,
  category: CanonicalCategory
): ReadonlySet<NamedDate> {
  const paths = new Set(availableConversionPaths(config, category));
  // "Only ongoing" rather than "ongoing is allowed": a record that may be
  // one-time OR ongoing does have an event date on its one-time runs.
  const onlyOngoing =
    config.allowedKinds.length === 1 && config.allowedKinds[0] === "ongoing";

  const dates = new Set<NamedDate>(["close_date"]);
  if (paths.has("offer")) {
    dates.add("cart_opens");
    dates.add("cart_closes");
  }
  if (!onlyOngoing) {
    dates.add("event_date");
    dates.add("registration_opens");
    dates.add("registration_closes");
  }
  if (config.audienceSource === "borrowed") dates.add("contract_terms");
  return dates;
}

const WHY_DATE_UNAVAILABLE: Readonly<Record<NamedDate, string>> = Object.freeze({
  cart_opens: "there is no cart without the offer path",
  cart_closes: "there is no cart without the offer path",
  event_date: "an ongoing-only initiative has no event",
  registration_opens: "an ongoing-only initiative has nothing to register for",
  registration_closes: "an ongoing-only initiative has nothing to register for",
  close_date: "every initiative has a close date",
  contract_terms: "there is no counterparty on an own-audience initiative",
});

/**
 * Is this configuration coherent?
 *
 * RETURNS EVERY PROBLEM, NOT THE FIRST. The caller is an admin editing 87
 * records; reporting one error per save turns a five-minute edit into five
 * round trips. The one-problem-at-a-time shape is right for a request handler
 * (see decidePortalAccessChange) and wrong for a form.
 *
 * REFUSES RATHER THAN REPAIRING. Dropping `speaker-fee` from an off-stage
 * record and saving the rest would look like a success and quietly change what the
 * admin configured; the editor says what is wrong and the admin decides.
 */
export function validateLibraryConfig(
  config: LibraryRecordConfig,
  category: CanonicalCategory
): ConfigValidation {
  const problems: ConfigProblem[] = [];
  const add = (code: ConfigProblemCode, field: string, message: string) =>
    problems.push({ code, field, message });

  if (!config.initiativeKey || config.initiativeKey.trim() === "") {
    // Keyed by initiative_key and nothing else: the workbook's ID column is
    // not unique (76 distinct over 87 rows) and has two formats.
    add(
      "missing_initiative_key",
      "initiativeKey",
      "A configuration must name the wb_initiative_library.initiative_key it belongs to."
    );
  }

  /* ---- Kinds --------------------------------------------------- */
  if (config.allowedKinds.length === 0) {
    // Not a cosmetic emptiness: with no kinds, Kind renders as a choice of
    // nothing and `effectiveKind` can never resolve, so Timing and the close
    // date label are stuck forever.
    add(
      "no_kinds",
      "allowedKinds",
      "At least one kind must be allowed, otherwise the form has no occurrence to describe."
    );
  }
  for (const kind of config.allowedKinds) {
    if (!INITIATIVE_KINDS.includes(kind)) {
      add("unknown_kind", "allowedKinds", `"${kind}" is not one of ${INITIATIVE_KINDS.join(", ")}.`);
    }
  }

  /* ---- Paths --------------------------------------------------- */
  if (config.allowedPaths.length === 0) {
    add(
      "no_paths",
      "allowedPaths",
      "At least one conversion path must be allowed, otherwise the initiative cannot make money."
    );
  }
  for (const path of config.allowedPaths) {
    if (!CONVERSION_PATHS.includes(path)) {
      add("unknown_path", "allowedPaths", `"${path}" is not one of ${CONVERSION_PATHS.join(", ")}.`);
    }
  }
  // No audience check on `leads`: the owner's designs offer it on own-audience
  // categories (see ConversionPath), so there is nothing to refuse.
  if (config.allowedPaths.includes("speaker-fee") && !isStageCategory(category.id)) {
    add(
      "speaker_fee_off_stage",
      "allowedPaths",
      `The speaker fee path is for stage initiatives only, and ${category.label} is not one ` +
        `(${STAGE_CATEGORY_IDS.join(", ")}).`
    );
  }
  // Distinct from `no_paths`: the admin DID allow paths, and the stage rule
  // removed all of them (today: only `speaker-fee`, off a stage category). Without this the record saves and the form
  // renders a conversion-path section with no options.
  if (config.allowedPaths.length > 0 && availableConversionPaths(config, category).length === 0) {
    add(
      "no_paths_available",
      "allowedPaths",
      "Every allowed path is removed by this record's audience and category rules, " +
        "so no path can be offered."
    );
  }

  /* ---- Format override ----------------------------------------- */
  // WHAT "AN OVERRIDE THAT CANNOT APPLY" MEANS, decided here once.
  //
  // It does NOT mean "an override on a category that does not ask". An
  // override is the mechanism for expressing an exception, and the strongest
  // exception of all is a record with a fixed format inside a category that
  // never raises the question — so an override is legal on all four
  // behaviours, including `not-asked`.
  //
  // It DOES mean an override that changes nothing: one equal to the format
  // the category already pins. That record would behave identically with the
  // field blank, so the field is not configuration, it is noise — and noise
  // is expensive here, because the admin data is read by a human deciding
  // which records are exceptions. Worse, it survives a change of mind: pin
  // Webinars to hybrid tomorrow and every redundant `digital` override
  // silently becomes a live one nobody chose. Flagged rather than tolerated,
  // for the same reason as `ongoing_label_without_ongoing` — a setting that
  // does nothing is usually a copied config.
  if (config.formatOverride !== undefined) {
    if (!INITIATIVE_FORMATS.includes(config.formatOverride)) {
      add(
        "unknown_format",
        "formatOverride",
        `"${config.formatOverride}" is not one of ${INITIATIVE_FORMATS.join(", ")}.`
      );
    } else if (PINNED_FORMAT[category.formatBehaviour] === config.formatOverride) {
      add(
        "redundant_format_override",
        "formatOverride",
        `${category.label} already pins the format to ${config.formatOverride}, so this override ` +
          "changes nothing. Remove it, so that the records carrying an override are the ones " +
          "that are genuinely exceptions."
      );
    }
  }

  /* ---- Extras -------------------------------------------------- */
  if (config.fieldExtras.length > MAX_FIELD_EXTRAS) {
    add(
      "too_many_extras",
      "fieldExtras",
      `At most ${MAX_FIELD_EXTRAS} extra fields; this record has ${config.fieldExtras.length}. ` +
        "An extra is only for a field something downstream reads."
    );
  }
  const extraKeys = new Set<string>();
  for (const extra of config.fieldExtras) {
    const key = extra.key.trim();
    if (extraKeys.has(key)) {
      add("duplicate_extra_key", "fieldExtras", `Two extras both write to "${key}".`);
    }
    extraKeys.add(key);

    if (extra.type !== undefined && !FIELD_EXTRA_TYPES.includes(extra.type)) {
      add(
        "unknown_extra_type",
        "fieldExtras",
        `Extra "${key}" has type "${String(extra.type)}", not one of ${FIELD_EXTRA_TYPES.join(", ")}.`
      );
    }
  }
  // Binds and derives. Both target cart dates, so both need the offer path:
  // without it the cart never attaches and the link would be inert, which is
  // the same silent failure the revenue-window check below exists to catch.
  const offerAvailable = availableConversionPaths(config, category).includes("offer");
  const linked = new Map<string, string>();
  for (const extra of config.fieldExtras) {
    const key = extra.key.trim();
    if (extra.binds === undefined && extra.derives === undefined) continue;
    if (extra.binds !== undefined && extra.derives !== undefined) {
      add("invalid_extra_link", "fieldExtras", `Extra "${key}" cannot both bind and derive a field.`);
      continue;
    }
    const target = (extra.binds ?? extra.derives) as string;
    const known =
      extra.binds !== undefined
        ? FIELD_EXTRA_BINDS.includes(extra.binds)
        : FIELD_EXTRA_DERIVES.includes(extra.derives as FieldExtraDerive);
    if (!known) {
      add("invalid_extra_link", "fieldExtras", `Extra "${key}" links to "${target}", which is not a field it can set.`);
      continue;
    }
    if (fieldExtraType(extra) !== "date") {
      add("invalid_extra_link", "fieldExtras", `Extra "${key}" sets ${target}, a date, so it must be a date extra.`);
    }
    const other = linked.get(target);
    if (other !== undefined) {
      add("invalid_extra_link", "fieldExtras", `Extras "${other}" and "${key}" both set ${target}.`);
    }
    linked.set(target, key);
    if (!offerAvailable) {
      add(
        "invalid_extra_link",
        "fieldExtras",
        `Extra "${key}" sets a cart date, but this record has no offer path, so there is no cart.`
      );
    }
  }

  /* ---- Revenue lines ------------------------------------------- */
  const lineIds = new Set<string>();
  const dates = availableNamedDates(config, category);
  for (const line of config.revenueLines) {
    if (lineIds.has(line.id)) {
      // The user answers per line; two lines sharing an id means one answer
      // for two prices.
      add("duplicate_revenue_line_id", "revenueLines", `Two revenue lines share the id "${line.id}".`);
    }
    lineIds.add(line.id);

    for (const [edge, date] of [
      ["windowOpens", line.windowOpens],
      ["windowCloses", line.windowCloses],
    ] as const) {
      if (!dates.has(date)) {
        add(
          "impossible_revenue_window",
          `revenueLines.${line.id}.${edge}`,
          `Revenue line "${line.id}" opens or closes on ${date}, which this record can never ` +
            `have: ${WHY_DATE_UNAVAILABLE[date] ?? "the date does not apply"}.`
        );
      }
    }
  }

  /* ---- Ongoing label and frequencies -------------------------- */
  if (config.ongoingLabel !== undefined && !config.allowedKinds.includes("ongoing")) {
    // A word for a kind the record cannot be. Harmless on screen and a sign
    // that someone copied a config from a record that could be ongoing, which
    // is worth catching while the copy is still fresh.
    add(
      "ongoing_label_without_ongoing",
      "ongoingLabel",
      `"${config.ongoingLabel}" is the word for the ongoing kind, but this record does not allow ongoing.`
    );
  }
  if (config.allowedFrequencies.length > 0 && !config.allowedKinds.includes("recurring")) {
    add(
      "frequencies_without_recurring",
      "allowedFrequencies",
      "Frequencies only apply to a recurring record, and this record does not allow recurring."
    );
  }
  if (config.allowedKinds.includes("recurring") && config.allowedFrequencies.length === 0) {
    // The mirror image, and the one that shows up as a missing question rather
    // than a stray setting: the Frequency section renders nothing and the
    // forecast has no interval.
    add(
      "recurring_without_frequency",
      "allowedFrequencies",
      "A recurring record must allow at least one frequency, otherwise there is no interval to forecast."
    );
  }
  for (const frequency of config.allowedFrequencies) {
    if (!REPEAT_FREQUENCIES.includes(frequency)) {
      add(
        "frequencies_without_recurring",
        "allowedFrequencies",
        `"${frequency}" is not one of ${REPEAT_FREQUENCIES.join(", ")}.`
      );
    }
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}
