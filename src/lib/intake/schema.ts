/**
 * Intake v2 field definitions: options, required-ness and copy, in one place.
 *
 * WHY THIS FILE EXISTS. The ten screens are mostly selects over fixed lists,
 * and those lists have to agree with three separate things at once:
 *
 *   1. the CHECK constraints in migrations 025 and 026 — a mismatched option
 *      value is accepted by the form and rejected by the database, which
 *      surfaces as a failed save on the last screen rather than a bad field;
 *   2. the Initiative Library's "Ideal Industries" column, because the
 *      recommendation engine filters on an exact string match (REQ-4.1);
 *   3. the copy in the client spec, which is product-reviewed wording.
 *
 * Keeping the option VALUES next to their LABELS makes the first agreement
 * checkable, and keeping the copy here rather than inline in JSX means a
 * wording change is one edit instead of a hunt through ten components.
 *
 * Pure data, no React, so validation and the API routes can read the same
 * definitions the screens render.
 */

import type { ScreenId } from "@/lib/intake/flow";

/* ------------------------------------------------------------------ *
 * Option primitive
 * ------------------------------------------------------------------ */

export interface Option<V extends string = string> {
  /** Stored value. MUST match the column's CHECK constraint. */
  value: V;
  /** What the user reads. */
  label: string;
  /** Second line on card-style selects. */
  subLabel?: string;
}

/** Values only, for validation and for asserting against the DB constraints. */
export function valuesOf<V extends string>(options: readonly Option<V>[]): V[] {
  return options.map((o) => o.value);
}

/* ------------------------------------------------------------------ *
 * Industries (REQ-4.1, REQ-4.2)
 * ------------------------------------------------------------------ */

/**
 * The 13 industries plus Other.
 *
 * Stored as the LABEL, not a slug, because the Initiative Library's
 * "Ideal Industries" column holds these exact strings and eligibility is an
 * exact match against it (REQ-13.12). A slug would need a translation table
 * that silently drifts every time the workbook is re-uploaded.
 *
 * "Other" is the only value that is not in the library — initiatives tagged
 * "Broad fit" stay eligible for it (REQ-4.2).
 */
export const INDUSTRIES = [
  "Coaching & Consulting",
  "Course Creators",
  "Speakers & Authors",
  "Health & Wellness",
  "Financial Services",
  "Real Estate & Investing",
  "Network Marketing",
  "B2B Services & Agencies",
  "B2B SaaS & Tech",
  "E-commerce",
  "Local & Home Services",
  "Faith-Based & Ministry",
  "Nonprofit & Association",
] as const;

export type Industry = (typeof INDUSTRIES)[number];

export const INDUSTRY_OTHER = "Other";

/** Screen 1's dropdown: the 13, then Other last. */
export const INDUSTRY_OPTIONS: readonly Option[] = [
  ...INDUSTRIES.map((name) => ({ value: name, label: name })),
  { value: INDUSTRY_OTHER, label: INDUSTRY_OTHER },
];

/**
 * Screen 7 adds "Any industry" — a customer base spanning everything is a real
 * answer, and is different from leaving the field blank (REQ-10.2).
 */
export const ANY_INDUSTRY = "Any industry";

export const CUSTOMER_INDUSTRY_OPTIONS: readonly Option[] = [
  { value: ANY_INDUSTRY, label: ANY_INDUSTRY },
  ...INDUSTRY_OPTIONS,
];

/** The library's tag for an initiative that suits every industry (REQ-4.2). */
export const BROAD_FIT = "Broad fit";

export function isKnownIndustry(value: string): value is Industry {
  return (INDUSTRIES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ *
 * Screen 0 — starting point (REQ-3.1)
 * ------------------------------------------------------------------ */

/** Values match `planning_inputs.intake_path`. */
export const PLAN_PATH_OPTIONS: readonly Option<
  "know_most" | "know_some" | "recommend_all"
>[] = [
  {
    value: "know_most",
    label: "Yes, I know most of them",
    subLabel: "I'll enter them and you'll check the math.",
  },
  {
    value: "know_some",
    label: "I have a few. Suggest the rest.",
    subLabel: "I'll add what I know and you fill the gaps.",
  },
  {
    value: "recommend_all",
    label: "No. Recommend them for me.",
    subLabel: "Tell us about your business and we'll build a starting plan.",
  },
];

/** REQ-3.2 — attached to the word "initiative" on screen 0. */
export const INITIATIVE_TOOLTIP =
  "A specific sales or marketing push, like a webinar, a launch, a challenge, " +
  "or speaking on stages.";

/* ------------------------------------------------------------------ *
 * Screen 1 — business (REQ-4.4, REQ-4.6)
 * ------------------------------------------------------------------ */

/** Values match `planning_inputs.purchase_mode`. */
export const SALES_MODEL_OPTIONS: readonly Option<
  "self_serve" | "sales_call" | "in_person" | "mix"
>[] = [
  { value: "self_serve", label: "Online, without talking to anyone" },
  { value: "sales_call", label: "On a sales call or in a conversation" },
  { value: "in_person", label: "In person, at a location or event" },
  { value: "mix", label: "A mix" },
];

/**
 * Values match `planning_inputs.growth_stage`.
 *
 * No dollar thresholds shown or applied: revenue bands differ too much by
 * industry for a cut-off to mean anything, so the user self-selects. Stage then
 * sets how many initiatives get recommended (REQ-13.13).
 */
export const BUSINESS_STAGE_OPTIONS: readonly Option<
  "start" | "momentum" | "scale"
>[] = [
  {
    value: "start",
    label: "Start",
    subLabel: "Launching or early. Getting first clients, proof, and testimonials.",
  },
  {
    value: "momentum",
    label: "Momentum",
    subLabel: "Selling consistently and ready for more traction.",
  },
  {
    value: "scale",
    label: "Scale",
    subLabel: "Established, with a team, and ready to run several initiatives at once.",
  },
];

/* ------------------------------------------------------------------ *
 * Screen 2 — team and capacity (REQ-5.2, REQ-5.3)
 * ------------------------------------------------------------------ */

/**
 * Values match `planning_inputs.sales_owner`.
 *
 * `no_sales_calls` is load-bearing: it excludes every sales-call initiative
 * from the recommendations (REQ-13.10).
 */
export const WHO_CLOSES_OPTIONS: readonly Option<
  "me" | "salesperson" | "no_sales_calls" | "mix"
>[] = [
  { value: "me", label: "I do" },
  { value: "salesperson", label: "A salesperson or sales team" },
  { value: "no_sales_calls", label: "We don't do sales calls" },
  { value: "mix", label: "Mix" },
];

/** Values match `planning_inputs.plan_owner`. Stored for v1.5 team invites. */
export const PLAN_OWNER_OPTIONS: readonly Option<"me" | "team_member" | "both">[] = [
  { value: "me", label: "Me" },
  { value: "team_member", label: "Someone on my team" },
  { value: "both", label: "Both of us" },
];

/* ------------------------------------------------------------------ *
 * Screen 3 — products (REQ-6.1, REQ-6.4 to REQ-6.7)
 * ------------------------------------------------------------------ */

/** REQ-6.1 — four options, deliberately no 24. Matches `horizon_months`. */
export const PLANNING_PERIODS = [3, 6, 12, 18] as const;
export type PlanningPeriod = (typeof PLANNING_PERIODS)[number];
export const DEFAULT_PLANNING_PERIOD: PlanningPeriod = 12;

export function isPlanningPeriod(value: unknown): value is PlanningPeriod {
  return (PLANNING_PERIODS as readonly number[]).includes(Number(value));
}

/** Values match `intake_products.product_type`. */
export const PRODUCT_TYPE_OPTIONS: readonly Option<
  | "coaching_service"
  | "course"
  | "event"
  | "membership"
  | "physical_product"
  | "other"
>[] = [
  { value: "coaching_service", label: "Coaching or service" },
  { value: "course", label: "Course or digital product" },
  { value: "event", label: "Event" },
  { value: "membership", label: "Membership or subscription" },
  { value: "physical_product", label: "Physical product" },
  { value: "other", label: "Other" },
];

/**
 * The product type that unlocks Ticket Map initiatives in the picker
 * (REQ-8.3). Named so the picker does not hardcode the string.
 */
export const EVENT_PRODUCT_TYPE = "event";

/** Values match `intake_products.price_level`. Tooltips give example ranges. */
export const PRICE_TIER_OPTIONS: readonly Option<
  "low" | "mid" | "high" | "one_to_one"
>[] = [
  { value: "low", label: "Low ticket", subLabel: "Under $500" },
  { value: "mid", label: "Mid ticket", subLabel: "$500 to $5,000" },
  { value: "high", label: "High ticket", subLabel: "$5,000 and up" },
  { value: "one_to_one", label: "One-on-one", subLabel: "Priced per client" },
];

/** Values match `intake_products.payment_type`. Recurring reveals the interval. */
export const PRICING_MODEL_OPTIONS: readonly Option<
  "one_time" | "recurring" | "payment_plan"
>[] = [
  { value: "one_time", label: "One-time" },
  { value: "recurring", label: "Recurring" },
  { value: "payment_plan", label: "Payment plan" },
];

/** REQ-6.6 — revealed only by Recurring. Matches `recurring_interval`. */
export const RECURRING_INTERVAL_OPTIONS: readonly Option<"month" | "year">[] = [
  { value: "month", label: "per month" },
  { value: "year", label: "per year" },
];

export const PRICING_MODEL_RECURRING = "recurring";

/**
 * Values match `intake_products.delivery_mode`.
 *
 * Drives initiative matching (REQ-6.7): in_person surfaces Local Presence and
 * in-person events, shipped surfaces e-commerce and shipping lead times.
 */
export const DELIVERY_OPTIONS: readonly Option<
  "online" | "in_person" | "shipped" | "hybrid"
>[] = [
  { value: "online", label: "Online" },
  { value: "in_person", label: "In person" },
  { value: "shipped", label: "Shipped" },
  { value: "hybrid", label: "Hybrid" },
];

/* ------------------------------------------------------------------ *
 * Screen 5 — planned initiatives (REQ-8.6)
 * ------------------------------------------------------------------ */

/** Values match `intake_initiatives.cadence`. */
export const CADENCE_OPTIONS: readonly Option<"once" | "repeat" | "always_on">[] = [
  { value: "once", label: "Once", subLabel: "a launch or event" },
  { value: "repeat", label: "On repeat" },
  { value: "always_on", label: "Always on", subLabel: "evergreen" },
];

/** Revealed by "On repeat". Matches `intake_initiatives.repeat_frequency`. */
export const REPEAT_FREQUENCY_OPTIONS: readonly Option<
  "weekly" | "monthly" | "quarterly"
>[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
];

export const CADENCE_REPEAT = "repeat";

/** Sentinel for REQ-8.1's "Something else", which sets `needs_review`. */
export const SOMETHING_ELSE_KEY = "__something_else__";

/**
 * Library categories excluded from the picker.
 *
 * Maximizers attach to an existing initiative rather than standing alone, so
 * offering them here would let a user build a plan of nothing but add-ons
 * (REQ-8.2).
 */
export const EXCLUDED_PICKER_CATEGORIES = ["Maximizers"] as const;

/** Only shown when an Event product is selected (REQ-8.3). */
export const EVENT_ONLY_CATEGORIES = ["Ticket Map"] as const;

/** REQ-8.4 — disambiguates the OPS/OWN pairs in the picker. */
export const OWN_PLATFORM_SUFFIX = "on your own platform";
export const OPS_PLATFORM_SUFFIX = "on someone else's platform";

/* ------------------------------------------------------------------ *
 * Screen 7 — ideal customer (REQ-10.1)
 * ------------------------------------------------------------------ */

/** Values match `planning_inputs.sells_to`. */
export const CUSTOMER_TYPE_OPTIONS: readonly Option<
  "businesses" | "consumers" | "both"
>[] = [
  { value: "businesses", label: "Businesses" },
  { value: "consumers", label: "Consumers" },
  { value: "both", label: "Both" },
];

/** Customer-type values that reveal `customer_industries` (REQ-1.4). */
export const CUSTOMER_TYPES_WITH_INDUSTRIES = ["businesses", "both"] as const;

export function showsCustomerIndustries(customerType: string | null): boolean {
  return (CUSTOMER_TYPES_WITH_INDUSTRIES as readonly string[]).includes(
    customerType ?? ""
  );
}

/* ------------------------------------------------------------------ *
 * Screen 8 — audience today (REQ-11.1, REQ-11.2)
 * ------------------------------------------------------------------ */

export interface AudienceFieldSpec {
  /** Integer column on `planning_inputs`. */
  field: string;
  /** Paired boolean set by "Not sure". Null, not 0, goes in the number. */
  unknownField: string;
  label: string;
  /** Italic line under the label, where the spec gives one. */
  helper?: string;
}

/**
 * Five numbers, each with its own "Not sure".
 *
 * The paired `_unknown` flag is why this is a table rather than five inline
 * fields: NULL alone cannot distinguish "skipped" from "told us they don't
 * know", and the generator should treat an admitted unknown differently from an
 * unanswered field (REQ-2.6).
 */
export const AUDIENCE_FIELDS: readonly AudienceFieldSpec[] = [
  { field: "email_list_size", unknownField: "email_list_unknown", label: "Email list size" },
  {
    field: "social_following",
    unknownField: "social_following_unknown",
    label: "Social following (all platforms combined)",
  },
  {
    field: "monthly_visitors",
    unknownField: "monthly_visitors_unknown",
    label: "Website visitors per month",
  },
  {
    field: "past_customers",
    unknownField: "past_customers_unknown",
    label: "Past and current customers",
    helper: "People who have bought from you before.",
  },
  { field: "monthly_leads", unknownField: "monthly_leads_unknown", label: "New leads per month" },
];

export const NOT_SURE_LABEL = "Not sure";

/** REQ-11.2 — feeds OPS initiative recommendations. Stored in `borrowed_audiences`. */
export const OTHER_AUDIENCE_OPTIONS: readonly Option[] = [
  { value: "partners", label: "Partners who promote me" },
  { value: "speaking_stages", label: "Speaking stages" },
  { value: "podcast_guest", label: "Podcast guest spots" },
  { value: "affiliates", label: "Affiliates" },
  { value: "none_yet", label: "None yet" },
];

/* ------------------------------------------------------------------ *
 * Screen 9 — obstacles (REQ-12.1)
 * ------------------------------------------------------------------ */

/** Stored in `planning_inputs.challenges`. */
export const OBSTACLE_OPTIONS: readonly Option[] = [
  { value: "need_leads", label: "Need more leads" },
  { value: "low_conversion", label: "Low conversion rate" },
  { value: "weak_sales_process", label: "Weak sales process" },
  { value: "no_audience", label: "No audience yet" },
  { value: "limited_budget", label: "Limited budget" },
  { value: "limited_time", label: "Limited time" },
  { value: "team_capacity", label: "Team capacity" },
  { value: "unclear_strategy", label: "Unclear marketing strategy" },
  { value: "positioning", label: "Product positioning" },
  { value: "other", label: "Other" },
];

/**
 * REQ-12.1 — the cap.
 *
 * Enforced in the UI and re-checked server-side rather than by a CHECK
 * constraint, so changing the cap does not need a migration.
 */
export const MAX_OBSTACLES = 3;

/* ------------------------------------------------------------------ *
 * Required fields, per screen (REQ-2.5)
 * ------------------------------------------------------------------ */

/**
 * The asterisked fields from the mockups, by screen.
 *
 * ONLY these may block Next. Everything else is skippable by design — the
 * intake is a planning aid, and a user who cannot get past screen 8 because
 * they do not know their website traffic never reaches a plan at all.
 *
 * Repeating sections (products, initiatives) list the field names on an
 * individual row; `validation.ts` applies them per row.
 */
export const REQUIRED_FIELDS: Record<ScreenId, readonly string[]> = {
  start: ["intake_path"],
  business: ["industry", "prior_period_revenue", "growth_stage"],
  team: ["team_size", "monthly_marketing_budget"],
  // horizon_months and plan_start_month both have defaults, so they are
  // required in the sense that they must be set — never blank on arrival.
  products: ["horizon_months", "plan_start_month"],
  goal: ["revenue_goal"],
  initiatives: [],
  wins: [],
  customer: ["sells_to", "ideal_customer", "problem_solved"],
  audience: [],
  obstacles: [],
};

/** Required on each product card (REQ-6.3, REQ-6.8, REQ-6.9). */
export const REQUIRED_PRODUCT_FIELDS = [
  "name",
  "average_price",
  "units_in_period",
] as const;

/** Required on each planned-initiative card (REQ-8.1, REQ-8.5). */
export const REQUIRED_INITIATIVE_FIELDS = ["initiative_key", "product_ids"] as const;

/** Screen 3 needs at least one product; screen 5 at least one initiative. */
export const MIN_PRODUCTS = 1;
export const MIN_PLANNED_INITIATIVES = 1;

export function isRequired(screen: ScreenId, field: string): boolean {
  return REQUIRED_FIELDS[screen].includes(field);
}

/* ------------------------------------------------------------------ *
 * Long-text fields (REQ-2.3)
 * ------------------------------------------------------------------ */

/**
 * Every field that gets the dictation mic.
 *
 * Listed rather than decided per component so a new long-text field cannot
 * quietly ship without it — the spec says every one.
 */
export const VOICE_FIELDS = [
  "business_description",
  "ideal_customer",
  "problem_solved",
  "what_worked_notes",
  "challenge_notes",
] as const;

export type VoiceField = (typeof VOICE_FIELDS)[number];

export function hasVoiceInput(field: string): field is VoiceField {
  return (VOICE_FIELDS as readonly string[]).includes(field);
}

/* ------------------------------------------------------------------ *
 * Copy (REQ-2.9 and the per-screen titles)
 * ------------------------------------------------------------------ */

export interface ScreenCopy {
  title: string;
  /** Path-specific on `initiatives`; a single string everywhere else. */
  subtitle: string | Record<string, string>;
}

/**
 * Titles and subtitles, product-reviewed wording from the client spec.
 *
 * Here rather than in the components so a copy change is one edit and so the
 * strings can be checked against the spec without reading ten files.
 */
export const SCREEN_COPY: Record<ScreenId, ScreenCopy> = {
  start: {
    title: "Let's build your plan",
    subtitle:
      "Some people already know what sales and marketing initiatives they're " +
      "running this year. We recommend having at least 3-5 initiatives. Others " +
      "want us to recommend their plan. Either or a mix of both work.",
  },
  business: {
    title: "Your business",
    subtitle: "This tells us which strategies will get you the best results.",
  },
  team: {
    title: "Your team and time",
    subtitle: "We'll only recommend what you can actually run.",
  },
  products: {
    title: "What you sell",
    subtitle:
      "List what you'll focus on selling in this plan. Every initiative will " +
      "be tied to a product.",
  },
  goal: {
    title: "Your revenue goal",
    subtitle: "Set the number you want to plan toward.",
  },
  initiatives: {
    title: "What you're already planning",
    // Path C never reaches this screen, so it has no subtitle here.
    subtitle: {
      know_most:
        "Add the initiatives you know you're running. We'll forecast each one " +
        "and show whether they reach your goal.",
      know_some: "Add what you know. We'll suggest the rest.",
    },
  },
  wins: {
    title: "Your wins and your struggles",
    subtitle:
      "What's driven sales in the last 12 months, and what flopped? This keeps " +
      "us from recommending things that don't fit you.",
  },
  customer: {
    title: "Who you sell to",
    subtitle: "Tell us who you serve and the problem you solve for them.",
  },
  audience: {
    title: "What you already have",
    subtitle: "Your existing audience sets how fast each initiative can pay off.",
  },
  obstacles: {
    title: "What's held you back?",
    subtitle: "Pick your biggest challenges. We'll plan around them.",
  },
};

/** The subtitle for a screen, resolving the path-specific case. */
export function subtitleFor(screen: ScreenId, path: string | null): string {
  const { subtitle } = SCREEN_COPY[screen];
  if (typeof subtitle === "string") return subtitle;
  return subtitle[path ?? ""] ?? "";
}

/**
 * Question labels, helpers and placeholders.
 *
 * Keyed by column name so a component asks for the field it is rendering and
 * cannot drift from what gets stored.
 */
export const FIELD_COPY: Record<
  string,
  { label: string; helper?: string; placeholder?: string }
> = {
  // Screen 0
  intake_path: { label: "Do you already have sales and marketing initiatives planned?" },

  // Screen 1
  industry: { label: "What industry is your business in?" },
  industry_other: { label: "Tell us your industry" },
  business_description: {
    label: "In a sentence or two, what does your business do?",
    placeholder:
      "We help real estate agents get more listings through coaching and " +
      "done-for-you marketing.",
  },
  purchase_mode: { label: "How do your customers mostly buy from you?" },
  prior_period_revenue: { label: "What was your revenue over the last 12 months?" },
  growth_stage: { label: "Which best describes where you are?" },

  // Screen 2
  team_size: { label: "How many people work in the business, including you?" },
  sales_owner: { label: "Who handles sales conversations?" },
  plan_owner: { label: "Who will run this plan day to day?" },
  weekly_hours: {
    label: "How many hours a week can you or your team put into sales and marketing?",
    helper: "Growing businesses usually spend about half their time here.",
  },
  monthly_marketing_budget: {
    label: "What's your monthly marketing budget?",
    helper: "Ads, tools, and contractors. Not salaries.",
  },

  // Screen 3
  horizon_months: { label: "How far ahead are we planning?" },
  plan_start_month: { label: "When does this plan start?" },
  product_name: { label: "Product or service name" },
  product_type: { label: "Type" },
  price_level: { label: "Price level" },
  payment_type: { label: "How is it paid?" },
  delivery_mode: { label: "How is it delivered?" },
  average_price: {
    label: "What do customers actually pay on average?",
    helper: "The real average after discounts, not the list price.",
  },
  units_in_period: { label: "How many do you want to sell in this plan period?" },

  // Screen 4
  revenue_goal: { label: "What's your revenue goal for this period?" },

  // Screen 5
  initiative_key: { label: "What is it?" },
  product_ids: { label: "What does it sell?" },
  cadence: { label: "How often does it run?" },
  start_month: {
    label: "When does it start?",
    helper: "Optional. You can set dates on the calendar later.",
  },
  has_run_before: { label: "Have you run this before?" },

  // Screen 6
  worked_initiatives: { label: "What has driven real sales for you?" },
  what_worked_notes: { label: "What worked best, and why?" },
  didnt_work: { label: "What have you tried that didn't work?" },
  failure_reason: { label: "Why?" },

  // Screen 7
  sells_to: { label: "Do you sell to businesses, consumers, or both?" },
  customer_industries: { label: "What industries are your customers in?" },
  ideal_customer: {
    label: "Who do you serve?",
    placeholder:
      "Coaches and consultants doing $300,000 to $3 million who want more " +
      "clients without more ad spend.",
  },
  problem_solved: { label: "What problem do you solve for them?" },

  // Screen 8
  borrowed_audiences: { label: "Do you want to leverage other people's audiences?" },

  // Screen 9
  challenges: { label: "Select your biggest challenges.", helper: "Pick up to 3." },
  challenge_notes: { label: "Tell us more about your biggest challenge." },
};

/**
 * REQ-6.9 — the units label names the chosen period, and recurring products
 * ask a different question entirely.
 *
 * Built here because it depends on two other answers, and a hardcoded
 * "in the next 12 months" on a 6-month plan is a figure the user will enter
 * wrong rather than a label they will notice.
 */
export function unitsGoalLabel(
  periodMonths: number | null,
  pricingModel: string | null
): string {
  if (pricingModel === PRICING_MODEL_RECURRING) {
    return "How many active subscribers by the end?";
  }
  const months = isPlanningPeriod(periodMonths) ? periodMonths : DEFAULT_PLANNING_PERIOD;
  return `How many do you want to sell in the next ${months} months?`;
}

/** REQ-6.12 — shown only when every product shares one price tier. */
export const SINGLE_TIER_COACHING_LINE =
  "A strong lineup usually has a low, mid, and high-ticket offer.";

/** REQ-6.11 — the running total is a reference, never a cap. */
export const PRODUCTS_TOTAL_LABEL = "Products total";

/** REQ-13.6 — only on cards whose forecast came from benchmarks. */
export const BENCHMARK_NOTICE =
  "Based on industry averages. Add your real numbers to sharpen this.";

/** REQ-13.2 — under the gap bar. */
export const GAP_BAR_HELPER =
  "Revenue your plan still needs to reach your goal. It updates as you accept " +
  "or dismiss recommendations.";
