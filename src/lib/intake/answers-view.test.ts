import { describe, it, expect } from "vitest";
import { restoreDraft } from "./draft";
import {
  toAnswerSections,
  initiativeKeysNeedingNames,
  monthLabel,
  exactDate,
  NOT_ANSWERED,
  OTHER_CUSTOMER_INDUSTRY_LABEL,
  type AnswerSection,
  type AnswerField,
  type AnswerRecords,
} from "./answers-view";
import { FIELD_COPY, SCREEN_COPY, SOMETHING_ELSE_KEY } from "./schema";

/* ------------------------------------------------------------------ *
 * Fixture: rows as they come out of the database, run through the same
 * `restoreDraft` the draft route uses, so the test exercises the real shape.
 * ------------------------------------------------------------------ */

const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
const PRODUCT_B = "22222222-2222-4222-8222-222222222222";

function inputRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "pi-1",
    company_id: "co-1",
    intake_version: 2,
    resume_screen: "obstacles",
    intake_path: "know_some",
    industry: "Coaching & Consulting",
    industry_other: null,
    business_description: "We coach agents.\nAnd run a mastermind.",
    purchase_mode: "sales_call",
    prior_period_revenue: "450000.00",
    growth_stage: "momentum",
    team_size: 4,
    sales_owner: "me",
    plan_owner: "both",
    weekly_hours: 20,
    monthly_marketing_budget: "0.00",
    horizon_months: 6,
    plan_start_month: "2027-03-01",
    revenue_goal: "600000.00",
    what_worked_notes: "Podcast guesting.\n\nReferrals from past clients.",
    what_failed_notes: null,
    sells_to: "both",
    customer_industries: ["Real Estate & Investing", "Any industry"],
    ideal_customer_description: "Agents doing $1M+ in GCI.",
    problem_solved: "Inconsistent listings.",
    email_list_size: 12500,
    email_list_unknown: false,
    social_following: null,
    social_following_unknown: true,
    monthly_visitors: null,
    monthly_visitors_unknown: false,
    past_customers: 0,
    past_customers_unknown: false,
    monthly_leads: 40,
    monthly_leads_unknown: false,
    borrowed_audiences: ["podcast_guest", "partners"],
    challenges: ["need_leads", "limited_time"],
    challenge_notes: "Not enough time to follow up.",
    updated_at: "2027-02-10T15:30:00Z",
    ...overrides,
  };
}

const PRODUCTS = [
  {
    id: PRODUCT_A,
    name: "Group coaching",
    product_type: "coaching_service",
    price_level: "mid",
    payment_type: "one_time",
    recurring_interval: null,
    delivery_mode: "online",
    average_price: "3000.00",
    units_in_period: 25,
  },
  {
    id: PRODUCT_B,
    name: "Inner Circle",
    product_type: "membership",
    price_level: "low",
    payment_type: "recurring",
    recurring_interval: "month",
    delivery_mode: "hybrid",
    average_price: "97.00",
    units_in_period: 150,
  },
];

const INITIATIVES = [
  {
    id: "i-1",
    source: "planned",
    initiative_key: "webinar",
    initiative_label: "Webinar",
    custom_label: null,
    product_ids: [PRODUCT_A, PRODUCT_B],
    cadence: "repeat",
    repeat_frequency: "monthly",
    start_month: "2027-04-01",
    exact_date: null,
    has_run_before: true,
    audience_reached: 2000,
    funnel_stages: [
      { key: "signed_up", label: "% who registered", percent: 30 },
      { key: "showed", label: "% who showed up", percent: 12.5 },
      { key: "bought", label: "% who bought", percent: null },
    ],
    average_price: "3000.00",
  },
  {
    id: "i-2",
    source: "planned",
    initiative_key: "your-own-event",
    initiative_label: null,
    product_ids: [PRODUCT_A],
    cadence: "once",
    repeat_frequency: null,
    start_month: null,
    exact_date: "2027-06-01",
    has_run_before: false,
    funnel_stages: [],
  },
  {
    id: "i-3",
    source: "planned",
    initiative_key: SOMETHING_ELSE_KEY,
    custom_label: "Direct mail",
    product_ids: [],
    cadence: null,
    has_run_before: null,
    funnel_stages: [],
  },
  // Legacy screen-6 rows.
  {
    id: "i-4",
    source: "worked",
    initiative_key: "podcast-vodcast-guest",
    initiative_label: "Podcast Guest",
    funnel_stages: [],
  },
  {
    id: "i-5",
    source: "failed",
    initiative_key: "paid-ads",
    initiative_label: null,
    failure_reason: "Too expensive",
    funnel_stages: [],
  },
];

const LIBRARY = [
  { key: "your-own-event", name: "Your Own Event" },
  { key: "paid-ads", name: "Paid Ads" },
];

function sections(
  input: Record<string, unknown> | null = inputRow(),
  products = PRODUCTS,
  initiatives: Record<string, unknown>[] = INITIATIVES,
  library = LIBRARY
): AnswerSection[] {
  return toAnswerSections(restoreDraft(input, products, initiatives), library);
}

function section(all: AnswerSection[], id: string): AnswerSection {
  const found = all.find((s) => s.id === id);
  if (!found) throw new Error(`no section ${id}`);
  return found;
}

function value(s: AnswerSection, label: string): string | null | undefined {
  const item = s.items.find((i) => i.kind === "field" && i.label === label) as
    | AnswerField
    | undefined;
  return item?.value;
}

function records(s: AnswerSection) {
  const item = s.items.find((i) => i.kind === "records") as AnswerRecords | undefined;
  if (!item) throw new Error("no records");
  return item.records;
}

function recordValue(
  record: { items: AnswerField[] },
  label: string
): string | null | undefined {
  return record.items.find((i) => i.label === label)?.value;
}

/* ------------------------------------------------------------------ *
 * Structure
 * ------------------------------------------------------------------ */

describe("toAnswerSections — structure", () => {
  it("returns nothing when there is no saved intake", () => {
    expect(toAnswerSections(restoreDraft(null))).toEqual([]);
  });

  it("follows the path's screens in order, with the intake's titles", () => {
    const all = sections();
    expect(all.map((s) => s.id)).toEqual([
      "start",
      "business",
      "team",
      "products",
      "goal",
      "initiatives",
      "wins",
      "customer",
      "audience",
      "obstacles",
    ]);
    for (const s of all) expect(s.title).toBe(SCREEN_COPY[s.id].title);
  });

  it("omits the planned-initiatives section on Path C", () => {
    const all = sections(inputRow({ intake_path: "recommend_all" }));
    expect(all.map((s) => s.id)).not.toContain("initiatives");
    expect(all).toHaveLength(9);
  });

  it("produces plain serialisable data", () => {
    const all = sections();
    expect(JSON.parse(JSON.stringify(all))).toEqual(all);
  });
});

/* ------------------------------------------------------------------ *
 * Scalar screens
 * ------------------------------------------------------------------ */

describe("toAnswerSections — scalar answers", () => {
  it("maps option values to the labels the screens show", () => {
    const all = sections();
    expect(value(section(all, "start"), FIELD_COPY.intake_path.label)).toBe(
      "I have a few. Suggest the rest."
    );
    const business = section(all, "business");
    expect(value(business, FIELD_COPY.purchase_mode.label)).toBe(
      "On a sales call or in a conversation"
    );
    expect(value(business, FIELD_COPY.growth_stage.label)).toBe("Momentum");
    const team = section(all, "team");
    expect(value(team, FIELD_COPY.sales_owner.label)).toBe("I do");
    expect(value(team, FIELD_COPY.plan_owner.label)).toBe("Both of us");
  });

  it("formats money and counts, keeping a $0 budget as an answer", () => {
    const all = sections();
    expect(value(section(all, "business"), FIELD_COPY.prior_period_revenue.label)).toBe(
      "$450,000"
    );
    const team = section(all, "team");
    expect(value(team, FIELD_COPY.team_size.label)).toBe("4");
    expect(value(team, FIELD_COPY.weekly_hours.label)).toBe("20");
    expect(value(team, FIELD_COPY.monthly_marketing_budget.label)).toBe("$0");
    expect(value(section(all, "goal"), FIELD_COPY.revenue_goal.label)).toBe("$600,000");
  });

  it("treats the revenue-goal NOT NULL fallback as unanswered", () => {
    const all = sections(inputRow({ revenue_goal: 0 }));
    expect(value(section(all, "goal"), FIELD_COPY.revenue_goal.label)).toBeNull();
  });

  it("keeps line breaks in free text and flags it multiline", () => {
    const business = section(sections(), "business");
    const item = business.items.find(
      (i) => i.label === FIELD_COPY.business_description.label
    ) as AnswerField;
    expect(item.value).toBe("We coach agents.\nAnd run a mastermind.");
    expect(item.multiline).toBe(true);
  });

  it("shows the Other industry text only when Other is chosen", () => {
    const standard = section(sections(), "business");
    expect(value(standard, FIELD_COPY.industry.label)).toBe("Coaching & Consulting");
    expect(value(standard, FIELD_COPY.industry_other.label)).toBeUndefined();

    const other = section(
      sections(inputRow({ industry: "Other", industry_other: "Pet grooming" })),
      "business"
    );
    expect(value(other, FIELD_COPY.industry.label)).toBe("Other");
    expect(value(other, FIELD_COPY.industry_other.label)).toBe("Pet grooming");
  });

  it("shows the period and plan start month", () => {
    const products = section(sections(), "products");
    expect(value(products, FIELD_COPY.horizon_months.label)).toBe("6 months");
    expect(value(products, FIELD_COPY.plan_start_month.label)).toBe("March 2027");
  });

  it("shows customer industries only for businesses or both", () => {
    const both = section(sections(), "customer");
    expect(value(both, FIELD_COPY.sells_to.label)).toBe("Both");
    expect(value(both, FIELD_COPY.customer_industries.label)).toBe(
      "Real Estate & Investing, Any industry"
    );
    expect(value(both, FIELD_COPY.ideal_customer.label)).toBe("Agents doing $1M+ in GCI.");
    expect(value(both, FIELD_COPY.problem_solved.label)).toBe("Inconsistent listings.");

    const consumers = section(sections(inputRow({ sells_to: "consumers" })), "customer");
    expect(value(consumers, FIELD_COPY.customer_industries.label)).toBeUndefined();
  });

  it("shows the Other customer industry only when Other is among the picks", () => {
    const without = section(
      sections(inputRow({ customer_industries_other: "Veterinary clinics" })),
      "customer"
    );
    expect(value(without, OTHER_CUSTOMER_INDUSTRY_LABEL)).toBeUndefined();

    const withOther = section(
      sections(
        inputRow({
          customer_industries: ["Real Estate & Investing", "Other"],
          customer_industries_other: "Veterinary clinics",
        })
      ),
      "customer"
    );
    expect(value(withOther, OTHER_CUSTOMER_INDUSTRY_LABEL)).toBe("Veterinary clinics");

    // Shown but left blank reads as unanswered.
    const blank = section(
      sections(inputRow({ customer_industries: ["Other"], customer_industries_other: null })),
      "customer"
    );
    expect(value(blank, OTHER_CUSTOMER_INDUSTRY_LABEL)).toBeNull();

    // Hidden with the industries question for consumer-only sellers.
    const consumers = section(
      sections(inputRow({ sells_to: "consumers", customer_industries: ["Other"] })),
      "customer"
    );
    expect(value(consumers, OTHER_CUSTOMER_INDUSTRY_LABEL)).toBeUndefined();
  });

  it("shows the renamed speaking label for the unchanged stored value", () => {
    const audience = section(
      sections(inputRow({ borrowed_audiences: ["speaking_stages"] })),
      "audience"
    );
    expect(value(audience, FIELD_COPY.borrowed_audiences.label)).toBe("Speaking on Stages");
  });

  it("distinguishes a number, a zero, Not sure and unanswered on the audience screen", () => {
    const audience = section(sections(), "audience");
    expect(value(audience, "Email list size")).toBe("12,500");
    expect(value(audience, "Social following (all platforms combined)")).toBe("Not sure");
    expect(value(audience, "Website visitors per month")).toBeNull();
    expect(value(audience, "Past and current customers")).toBe("0");
    expect(value(audience, FIELD_COPY.borrowed_audiences.label)).toBe(
      "Podcast guest spots, Partners who promote me"
    );
  });

  it("joins obstacles and shows an unknown stored option raw", () => {
    const obstacles = section(sections(), "obstacles");
    expect(value(obstacles, FIELD_COPY.challenges.label)).toBe(
      "Need more leads, Limited time"
    );
    const odd = section(sections(inputRow({ challenges: ["retired_value"] })), "obstacles");
    expect(value(odd, FIELD_COPY.challenges.label)).toBe("retired_value");
  });

  it("shows every shown field as unanswered on a barely-started draft", () => {
    const all = sections(
      { id: "pi-2", intake_version: 2, intake_path: "know_most", resume_screen: "business" },
      [],
      []
    );
    const team = section(all, "team");
    expect(team.items.every((i) => i.kind === "field" && i.value === null)).toBe(true);
    expect(records(section(all, "products"))).toEqual([]);
    expect(records(section(all, "initiatives"))).toEqual([]);
    // Unanswered sells_to hides customer industries, as on the screen.
    expect(value(section(all, "customer"), FIELD_COPY.customer_industries.label)).toBeUndefined();
    expect(value(section(all, "audience"), FIELD_COPY.borrowed_audiences.label)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Products
 * ------------------------------------------------------------------ */

describe("toAnswerSections — products", () => {
  it("lists each product with its captured details", () => {
    const [coaching, membership] = records(section(sections(), "products"));

    expect(coaching.title).toBe("Group coaching");
    expect(recordValue(coaching, FIELD_COPY.product_type.label)).toBe("Coaching or service");
    expect(recordValue(coaching, FIELD_COPY.delivery_mode.label)).toBe("Online");
    expect(recordValue(coaching, FIELD_COPY.price_level.label)).toBe(
      "Mid ticket ($500 to $5,000)"
    );
    expect(recordValue(coaching, FIELD_COPY.payment_type.label)).toBe("One-time");
    expect(recordValue(coaching, "Billed")).toBeUndefined();
    expect(recordValue(coaching, FIELD_COPY.average_price.label)).toBe("$3,000");
    // The units question names the plan's period.
    expect(recordValue(coaching, "How many do you want to sell in the next 6 months?")).toBe(
      "25"
    );

    expect(recordValue(membership, FIELD_COPY.payment_type.label)).toBe("Recurring");
    expect(recordValue(membership, "Billed")).toBe("per month");
    expect(recordValue(membership, "How many active subscribers by the end?")).toBe("150");
  });

  it("names an unnamed product by position", () => {
    const [first] = records(
      section(sections(inputRow(), [{ ...PRODUCTS[0], name: "" }], []), "products")
    );
    expect(first.title).toBe("Product 1");
  });
});

/* ------------------------------------------------------------------ *
 * Planned initiatives
 * ------------------------------------------------------------------ */

describe("toAnswerSections — planned initiatives", () => {
  it("lists only planned rows", () => {
    const list = records(section(sections(), "initiatives"));
    expect(list.map((r) => r.title)).toEqual([
      "Webinar",
      "Your Own Event",
      "Something else: Direct mail",
    ]);
  });

  it("shows products, cadence, frequency, date and the funnel when run before", () => {
    const [webinar] = records(section(sections(), "initiatives"));
    expect(recordValue(webinar, FIELD_COPY.product_ids.label)).toBe(
      "Group coaching, Inner Circle"
    );
    expect(recordValue(webinar, FIELD_COPY.cadence.label)).toBe("On repeat");
    expect(recordValue(webinar, "How often?")).toBe("Monthly");
    expect(recordValue(webinar, FIELD_COPY.start_month.label)).toBe("April 2027");
    expect(recordValue(webinar, FIELD_COPY.has_run_before.label)).toBe("Yes");
    expect(recordValue(webinar, "Audience reached")).toBe("2,000");
    expect(recordValue(webinar, "% who registered")).toBe("30%");
    expect(recordValue(webinar, "% who showed up")).toBe("12.5%");
    expect(recordValue(webinar, "% who bought")).toBeNull();
    expect(recordValue(webinar, "Average price")).toBe("$3,000");
  });

  it("uses 'When is it?' and an exact date for a one-off, and hides the funnel when not run", () => {
    const [, event] = records(section(sections(), "initiatives"));
    expect(recordValue(event, "When is it?")).toBe("06/01/2027");
    expect(recordValue(event, "How often?")).toBeUndefined();
    expect(recordValue(event, FIELD_COPY.has_run_before.label)).toBe("No");
    expect(recordValue(event, "Audience reached")).toBeUndefined();
  });

  it("shows unanswered details on a sparse card", () => {
    const [, , custom] = records(section(sections(), "initiatives"));
    expect(recordValue(custom, FIELD_COPY.product_ids.label)).toBeNull();
    expect(recordValue(custom, FIELD_COPY.cadence.label)).toBeNull();
    expect(recordValue(custom, FIELD_COPY.start_month.label)).toBeNull();
    expect(recordValue(custom, FIELD_COPY.has_run_before.label)).toBeNull();
  });

  it("falls back to the raw key when neither the row nor the library names it", () => {
    const list = records(section(sections(inputRow(), PRODUCTS, INITIATIVES, []), "initiatives"));
    expect(list[1].title).toBe("your-own-event");
  });

  it("drops product ids that no longer resolve", () => {
    const [webinar] = records(
      section(
        sections(inputRow(), PRODUCTS, [
          { ...INITIATIVES[0], product_ids: ["33333333-3333-4333-8333-333333333333", PRODUCT_B] },
        ]),
        "initiatives"
      )
    );
    expect(recordValue(webinar, FIELD_COPY.product_ids.label)).toBe("Inner Circle");
  });
});

/* ------------------------------------------------------------------ *
 * Wins and legacy rows
 * ------------------------------------------------------------------ */

describe("toAnswerSections — wins", () => {
  it("shows both notes plus legacy worked / failed rows beside them", () => {
    const wins = section(sections(), "wins");
    expect(wins.items.map((i) => i.label)).toEqual([
      FIELD_COPY.what_worked_notes.label,
      "Initiatives that worked (earlier answer)",
      FIELD_COPY.what_failed_notes.label,
      "Initiatives that didn't work (earlier answer)",
    ]);
    expect(value(wins, FIELD_COPY.what_worked_notes.label)).toBe(
      "Podcast guesting.\n\nReferrals from past clients."
    );
    expect(value(wins, FIELD_COPY.what_failed_notes.label)).toBeNull();
    expect(value(wins, "Initiatives that worked (earlier answer)")).toBe("Podcast Guest");
    expect(value(wins, "Initiatives that didn't work (earlier answer)")).toBe(
      "Paid Ads: Too expensive"
    );
  });

  it("has no legacy rows for a user who never had them", () => {
    const wins = section(sections(inputRow(), PRODUCTS, [INITIATIVES[0]]), "wins");
    expect(wins.items.map((i) => i.label)).toEqual([
      FIELD_COPY.what_worked_notes.label,
      FIELD_COPY.what_failed_notes.label,
    ]);
  });

  it("still shows legacy rows on Path C", () => {
    const all = sections(inputRow({ intake_path: "recommend_all" }));
    expect(value(section(all, "wins"), "Initiatives that worked (earlier answer)")).toBe(
      "Podcast Guest"
    );
  });
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

describe("initiativeKeysNeedingNames", () => {
  it("lists only keys whose row has no captured name", () => {
    const restored = restoreDraft(inputRow(), PRODUCTS, INITIATIVES);
    expect(initiativeKeysNeedingNames(restored.initiatives).sort()).toEqual([
      "paid-ads",
      "your-own-event",
    ]);
  });
});

describe("date formatting", () => {
  it("reads the calendar month and day without a timezone shift", () => {
    expect(monthLabel("2027-01-01")).toBe("January 2027");
    expect(exactDate("2027-01-01")).toBe("01/01/2027");
    expect(monthLabel("nonsense")).toBeNull();
    expect(exactDate(null)).toBeNull();
  });
});

it("NOT_ANSWERED is the muted placeholder copy", () => {
  expect(NOT_ANSWERED).toBe("Not answered");
});
