/**
 * The intake answers as read-only, human-readable sections (Settings →
 * "Intake answers").
 *
 * PURE: takes the `RestoredDraft` that `restoreDraft` produces (the same shape
 * the intake screens hydrate from) and returns plain, serialisable data. No
 * React, no database, so the whole mapping is unit-tested and the server can
 * hand the result straight to a client component.
 *
 * WHAT IT FOLLOWS. Labels, option lists and screen titles all come from
 * `schema.ts`, the same source the screens render, so a stored value reads
 * here exactly as the user picked it. Sections follow `screensFor(path)`, so
 * Path C has no "What you're already planning" section, matching the intake.
 *
 * UNANSWERED VERSUS NOT SHOWN. A field the user was shown but left blank comes
 * back with `value: null`, which the UI renders as "Not answered", so the user
 * sees the whole questionnaire. A field their answers never revealed (the
 * "Other" industry texts, customer industries for consumer-only sellers, the
 * repeat frequency on a one-off, the funnel when they have not run it before,
 * the billing interval on a non-recurring product) is left out, mirroring the
 * screens' own conditions.
 *
 * An option value that is no longer in the list is shown raw rather than
 * dropped: the user did answer, and hiding the answer would be worse than an
 * unpolished label.
 */

import type { RestoredDraft, InitiativeDraft, ProductDraft } from "@/lib/intake/draft";
import { screensFor, type PlanPath, type ScreenId } from "@/lib/intake/flow";
import { formatMoney, formatNumber } from "@/lib/format-money";
import { funnelFieldsFor, AUDIENCE_LABEL, AVERAGE_PRICE_LABEL } from "@/lib/intake/funnel";
import {
  AUDIENCE_FIELDS,
  BUSINESS_STAGE_OPTIONS,
  CADENCE_OPTIONS,
  CADENCE_REPEAT,
  CUSTOMER_INDUSTRY_OPTIONS,
  CUSTOMER_TYPE_OPTIONS,
  DELIVERY_OPTIONS,
  FIELD_COPY,
  INDUSTRY_OPTIONS,
  INDUSTRY_OTHER,
  NOT_SURE_LABEL,
  OBSTACLE_OPTIONS,
  OTHER_AUDIENCE_OPTIONS,
  PLAN_OWNER_OPTIONS,
  PLAN_PATH_OPTIONS,
  PRICE_TIER_OPTIONS,
  PRODUCT_TYPE_OPTIONS,
  REPEAT_FREQUENCY_OPTIONS,
  SALES_MODEL_OPTIONS,
  SCREEN_COPY,
  SOMETHING_ELSE_KEY,
  WHO_CLOSES_OPTIONS,
  includesIndustryOther,
  showsCustomerIndustries,
  unitsGoalLabel,
  type Option,
} from "@/lib/intake/schema";

/**
 * The screen asks "Which industry?" right under the pills; read on its own in
 * this view that would be ambiguous, so it is named in full here.
 */
export const OTHER_CUSTOMER_INDUSTRY_LABEL = "Other customer industry";

/* ------------------------------------------------------------------ *
 * Output shape
 * ------------------------------------------------------------------ */

/** One question and its answer. `value: null` means shown but not answered. */
export interface AnswerField {
  kind: "field";
  label: string;
  value: string | null;
  /** Free text that may contain line breaks the UI should keep. */
  multiline?: boolean;
}

/** A repeating answer (products, planned initiatives): one block per entry. */
export interface AnswerRecord {
  title: string;
  items: AnswerField[];
}

export interface AnswerRecords {
  kind: "records";
  label: string;
  /** Empty means the question was shown and nothing was added. */
  records: AnswerRecord[];
}

export type AnswerItem = AnswerField | AnswerRecords;

export interface AnswerSection {
  id: ScreenId;
  /** The intake's own screen title. */
  title: string;
  items: AnswerItem[];
}

/** Only `key` and `name` are needed, so any library shape will do. */
export interface LibraryName {
  key: string;
  name: string;
}

/** The muted placeholder the UI shows for `value: null`. */
export const NOT_ANSWERED = "Not answered";

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Ordered sections, one per screen on this user's path.
 *
 * Returns an empty array when no draft exists, so the caller renders its own
 * empty state rather than ten sections of "Not answered".
 */
export function toAnswerSections(
  draft: Pick<RestoredDraft, "answers" | "products" | "initiatives" | "path" | "found">,
  library: readonly LibraryName[] = []
): AnswerSection[] {
  if (!draft.found) return [];

  const ctx: Context = {
    answers: draft.answers,
    products: draft.products,
    initiatives: draft.initiatives,
    path: draft.path,
    libraryNames: new Map(library.map((entry) => [entry.key, entry.name])),
  };

  return screensFor(draft.path).map((id) => ({
    id,
    title: SCREEN_COPY[id].title,
    items: BUILDERS[id](ctx),
  }));
}

/**
 * Initiative keys whose name is not captured on the row, i.e. the ones the
 * caller needs a library lookup for. Lets the server skip loading the library
 * when every row already carries its `initiative_label`.
 */
export function initiativeKeysNeedingNames(
  initiatives: readonly InitiativeDraft[]
): string[] {
  const keys = new Set<string>();
  for (const row of initiatives) {
    const key = text(row.initiative_key);
    if (!key || key === SOMETHING_ELSE_KEY) continue;
    if (text(row.initiative_label)) continue;
    keys.add(key);
  }
  return [...keys];
}

/* ------------------------------------------------------------------ *
 * Per-screen builders
 * ------------------------------------------------------------------ */

interface Context {
  answers: Record<string, unknown>;
  products: readonly ProductDraft[];
  initiatives: readonly InitiativeDraft[];
  path: PlanPath | null;
  libraryNames: Map<string, string>;
}

const BUILDERS: Record<ScreenId, (ctx: Context) => AnswerItem[]> = {
  start: ({ answers }) => [
    field(FIELD_COPY.intake_path.label, option(PLAN_PATH_OPTIONS, answers.intake_path)),
  ],

  business: ({ answers }) => {
    const industry = text(answers.industry);
    const items: AnswerItem[] = [
      field(FIELD_COPY.industry.label, option(INDUSTRY_OPTIONS, industry)),
    ];
    // Revealed by "Other" only, as on the screen.
    if (industry === INDUSTRY_OTHER) {
      items.push(field(FIELD_COPY.industry_other.label, text(answers.industry_other)));
    }
    items.push(
      longText(FIELD_COPY.business_description.label, answers.business_description),
      field(FIELD_COPY.purchase_mode.label, option(SALES_MODEL_OPTIONS, answers.purchase_mode)),
      field(FIELD_COPY.prior_period_revenue.label, money(answers.prior_period_revenue)),
      field(FIELD_COPY.growth_stage.label, option(BUSINESS_STAGE_OPTIONS, answers.growth_stage))
    );
    return items;
  },

  team: ({ answers }) => [
    field(FIELD_COPY.team_size.label, count(answers.team_size)),
    field(FIELD_COPY.sales_owner.label, option(WHO_CLOSES_OPTIONS, answers.sales_owner)),
    field(FIELD_COPY.plan_owner.label, option(PLAN_OWNER_OPTIONS, answers.plan_owner)),
    field(FIELD_COPY.weekly_hours.label, count(answers.weekly_hours)),
    // $0 is a valid budget (REQ-5.5), so 0 reads as "$0", never as unanswered.
    field(FIELD_COPY.monthly_marketing_budget.label, money(answers.monthly_marketing_budget)),
  ],

  products: ({ answers, products }) => {
    const months = num(answers.horizon_months);
    return [
      field(FIELD_COPY.horizon_months.label, months === null ? null : `${months} months`),
      field(FIELD_COPY.plan_start_month.label, monthLabel(answers.plan_start_month)),
      {
        kind: "records",
        label: "Products",
        records: products.map((product, index) => productRecord(product, index, months)),
      },
    ];
  },

  goal: ({ answers }) => [
    field(FIELD_COPY.revenue_goal.label, money(answers.revenue_goal)),
  ],

  initiatives: (ctx) => {
    // Screen 5 owns 'planned' rows only; 'worked' / 'failed' belong to screen 6.
    const planned = ctx.initiatives.filter((row) => sourceOf(row) === "planned");
    return [
      {
        kind: "records",
        label: "Initiatives",
        records: planned.map((row, index) => initiativeRecord(row, index, ctx)),
      },
    ];
  },

  wins: (ctx) => {
    const { answers, initiatives } = ctx;
    const worked = initiatives.filter((row) => sourceOf(row) === "worked");
    const failed = initiatives.filter((row) => sourceOf(row) === "failed");

    const items: AnswerItem[] = [
      longText(FIELD_COPY.what_worked_notes.label, answers.what_worked_notes),
    ];
    // Rows from the earlier version of this screen, which picked initiatives
    // instead of taking free text. Shown only when present: a newer user was
    // never asked this way.
    if (worked.length > 0) {
      items.push(
        field("Initiatives that worked (earlier answer)", joined(worked.map((row) => initiativeName(row, ctx))))
      );
    }

    items.push(longText(FIELD_COPY.what_failed_notes.label, answers.what_failed_notes));
    if (failed.length > 0) {
      items.push(
        field(
          "Initiatives that didn't work (earlier answer)",
          joined(
            failed.map((row) => {
              const reason = text(row.failure_reason);
              const name = initiativeName(row, ctx);
              return reason ? `${name}: ${reason}` : name;
            })
          )
        )
      );
    }
    return items;
  },

  customer: ({ answers }) => {
    const sellsTo = text(answers.sells_to);
    const items: AnswerItem[] = [
      field(FIELD_COPY.sells_to.label, option(CUSTOMER_TYPE_OPTIONS, sellsTo)),
    ];
    // Only asked of businesses / both (REQ-1.4).
    if (showsCustomerIndustries(sellsTo)) {
      items.push(
        field(
          FIELD_COPY.customer_industries.label,
          options(CUSTOMER_INDUSTRY_OPTIONS, answers.customer_industries)
        )
      );
      // Revealed by "Other" among the customer industries only.
      if (includesIndustryOther(answers.customer_industries)) {
        items.push(field(OTHER_CUSTOMER_INDUSTRY_LABEL, text(answers.customer_industries_other)));
      }
    }
    items.push(
      // Stored as `ideal_customer_description`; the copy is keyed `ideal_customer`.
      longText(FIELD_COPY.ideal_customer.label, answers.ideal_customer_description),
      longText(FIELD_COPY.problem_solved.label, answers.problem_solved)
    );
    return items;
  },

  audience: ({ answers }) => [
    ...AUDIENCE_FIELDS.map((spec) =>
      field(
        spec.label,
        // "Not sure" is an answer (REQ-2.6), distinct from leaving it blank.
        answers[spec.unknownField] === true ? NOT_SURE_LABEL : count(answers[spec.field])
      )
    ),
    field(
      FIELD_COPY.borrowed_audiences.label,
      options(OTHER_AUDIENCE_OPTIONS, answers.borrowed_audiences)
    ),
  ],

  obstacles: ({ answers }) => [
    field(FIELD_COPY.challenges.label, options(OBSTACLE_OPTIONS, answers.challenges)),
    longText(FIELD_COPY.challenge_notes.label, answers.challenge_notes),
  ],
};

/* ------------------------------------------------------------------ *
 * Records
 * ------------------------------------------------------------------ */

function productRecord(
  product: ProductDraft,
  index: number,
  periodMonths: number | null
): AnswerRecord {
  const paymentType = text(product.payment_type);
  const items: AnswerField[] = [
    field(FIELD_COPY.product_type.label, option(PRODUCT_TYPE_OPTIONS, product.product_type)),
    field(FIELD_COPY.delivery_mode.label, option(DELIVERY_OPTIONS, product.delivery_mode)),
    field(FIELD_COPY.price_level.label, priceTier(product.price_level)),
  ];
  // "How is it paid?" and "Billed" are no longer asked, so not shown here.
  items.push(
    field(FIELD_COPY.average_price.label, money(product.average_price)),
    // The same period- and model-dependent wording the card used.
    field(unitsGoalLabel(periodMonths, paymentType), count(product.units_in_period))
  );
  return { title: text(product.name) ?? `Product ${index + 1}`, items };
}

function initiativeRecord(
  row: InitiativeDraft,
  index: number,
  ctx: Context
): AnswerRecord {
  const cadence = text(row.cadence);
  const items: AnswerField[] = [
    field(FIELD_COPY.product_ids.label, productNames(row.product_ids, ctx.products)),
    field(FIELD_COPY.cadence.label, option(CADENCE_OPTIONS, cadence)),
  ];
  if (cadence === CADENCE_REPEAT) {
    items.push(field("How often?", option(REPEAT_FREQUENCY_OPTIONS, row.repeat_frequency)));
  }
  items.push(
    field(
      cadence === "once" ? "When is it?" : FIELD_COPY.start_month.label,
      exactDate(row.exact_date) ?? monthLabel(row.start_month)
    ),
    field(FIELD_COPY.has_run_before.label, yesNo(row.has_run_before))
  );

  // The funnel appears only once they say they have run it (REQ-8.9).
  if (row.has_run_before === true) {
    items.push(field(AUDIENCE_LABEL, count(row.audience_reached)));
    const key = text(row.initiative_key);
    const stored = Array.isArray(row.funnel_stages)
      ? (row.funnel_stages as { key?: unknown; label?: unknown; percent?: unknown }[])
      : [];
    for (const spec of funnelFieldsFor(key)) {
      const entry = stored.find((stage) => stage?.key === spec.key);
      // The label stored with the answer is what the user was asked.
      const label = text(entry?.label) ?? spec.label;
      items.push(field(label, percent(entry?.percent)));
    }
    items.push(field(AVERAGE_PRICE_LABEL, money(row.average_price)));
  }

  return { title: initiativeName(row, ctx, index), items };
}

/**
 * The name the user picked.
 *
 * Preference order: their own words behind "Something else", the library name
 * captured when they picked it (so a later rename does not rewrite history),
 * the current library name, and finally the raw key.
 */
function initiativeName(row: InitiativeDraft, ctx: Context, index?: number): string {
  const key = text(row.initiative_key);
  if (key === SOMETHING_ELSE_KEY) {
    const custom = text(row.custom_label);
    return custom ? `Something else: ${custom}` : "Something else";
  }
  return (
    text(row.initiative_label) ??
    (key ? ctx.libraryNames.get(key) ?? key : null) ??
    (index === undefined ? "Initiative" : `Initiative ${index + 1}`)
  );
}

/**
 * Product names for an initiative's product ids.
 *
 * Restored drafts hold real ids. An id with no product behind it is dropped
 * rather than shown as a UUID; an index reference (an unsaved chip) resolves
 * by position, as the save path does.
 */
function productNames(value: unknown, products: readonly ProductDraft[]): string | null {
  const refs = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  const names: string[] = [];
  for (const ref of refs) {
    const byId = products.findIndex((product) => product.id === ref);
    const index = byId !== -1 ? byId : /^\d+$/.test(ref) ? Number(ref) : -1;
    const product = products[index];
    if (!product) continue;
    names.push(text(product.name) ?? `Product ${index + 1}`);
  }
  return joined(names);
}

/* ------------------------------------------------------------------ *
 * Value formatting
 * ------------------------------------------------------------------ */

function field(label: string, value: string | null): AnswerField {
  return { kind: "field", label, value };
}

/** Free text, kept verbatim (line breaks included). Blank is unanswered. */
function longText(label: string, value: unknown): AnswerField {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw === ""
    ? field(label, null)
    : { kind: "field", label, value: raw, multiline: true };
}

function option(list: readonly Option[], value: unknown): string | null {
  const stored = text(value);
  if (stored === null) return null;
  return list.find((o) => o.value === stored)?.label ?? stored;
}

/** A multi-select, joined in the order the user's answers are stored. */
function options(list: readonly Option[], value: unknown): string | null {
  const values = Array.isArray(value) ? value : [];
  return joined(values.map((v) => option(list, v)).filter((v): v is string => v !== null));
}

/** Tier plus its example range, which is what the pill's second line showed. */
function priceTier(value: unknown): string | null {
  const stored = text(value);
  if (stored === null) return null;
  const match = PRICE_TIER_OPTIONS.find((o) => o.value === stored);
  if (!match) return stored;
  return match.subLabel ? `${match.label} (${match.subLabel})` : match.label;
}

function joined(values: readonly string[]): string | null {
  return values.length === 0 ? null : values.join(", ");
}

function money(value: unknown): string | null {
  const n = num(value);
  return n === null ? null : formatMoney(n);
}

function count(value: unknown): string | null {
  const n = num(value);
  return n === null ? null : formatNumber(n);
}

function percent(value: unknown): string | null {
  const n = num(value);
  return n === null
    ? null
    : `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function yesNo(value: unknown): string | null {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return null;
}

/**
 * `YYYY-MM-DD` → "March 2027".
 *
 * Read from the string's own digits, never `new Date(string)`: a date-only
 * value parses as UTC midnight, which is the previous month for anyone west of
 * UTC once read with local getters.
 */
export function monthLabel(value: unknown): string | null {
  const match = typeof value === "string" ? value.match(/^(\d{4})-(\d{2})/) : null;
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** `YYYY-MM-DD` → "MM/DD/YYYY", the app's date format, without a timezone shift. */
export function exactDate(value: unknown): string | null {
  const match = typeof value === "string" ? value.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  return match ? `${match[2]}/${match[3]}/${match[1]}` : null;
}

function sourceOf(row: InitiativeDraft): string {
  return text(row.source) ?? "planned";
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
