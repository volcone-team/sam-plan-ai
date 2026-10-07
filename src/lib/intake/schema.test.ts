import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  INDUSTRIES,
  INDUSTRY_OPTIONS,
  INDUSTRY_OTHER,
  CUSTOMER_INDUSTRY_OPTIONS,
  ANY_INDUSTRY,
  isKnownIndustry,
  PLAN_PATH_OPTIONS,
  SALES_MODEL_OPTIONS,
  BUSINESS_STAGE_OPTIONS,
  WHO_CLOSES_OPTIONS,
  PLAN_OWNER_OPTIONS,
  PRODUCT_TYPE_OPTIONS,
  PRICE_TIER_OPTIONS,
  PRICING_MODEL_OPTIONS,
  RECURRING_INTERVAL_OPTIONS,
  DELIVERY_OPTIONS,
  CADENCE_OPTIONS,
  REPEAT_FREQUENCY_OPTIONS,
  CUSTOMER_TYPE_OPTIONS,
  OBSTACLE_OPTIONS,
  OTHER_AUDIENCE_OPTIONS,
  AUDIENCE_FIELDS,
  MAX_OBSTACLES,
  PLANNING_PERIODS,
  DEFAULT_PLANNING_PERIOD,
  isPlanningPeriod,
  REQUIRED_FIELDS,
  isRequired,
  VOICE_FIELDS,
  hasVoiceInput,
  SCREEN_COPY,
  FIELD_COPY,
  subtitleFor,
  unitsGoalLabel,
  showsCustomerIndustries,
  valuesOf,
} from "./schema";
import { screensFor } from "./flow";

/**
 * The expensive failure this file guards against: an option value the FORM
 * accepts and the DATABASE rejects. The CHECK constraints in migrations 025 and
 * 026 are the real contract, so the constraint lists are parsed out of the SQL
 * and compared, rather than being retyped here where they could drift.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const SQL_025 = readFileSync(join(MIGRATIONS, "025_intake_v2.sql"), "utf8");
const SQL_026 = readFileSync(join(MIGRATIONS, "026_intake_v2_remaining.sql"), "utf8");
const SQL = `${SQL_025}\n${SQL_026}`;

/** Pull the quoted values out of `CHECK (col IN ('a', 'b'))` for one column. */
function allowedValues(column: string): string[] {
  // Tolerates the newline-wrapped multi-line form used in both migrations.
  const pattern = new RegExp(`${column}\\s+IN\\s*\\(([^)]*)\\)`, "i");
  const match = SQL.match(pattern);
  if (!match) throw new Error(`no CHECK ... IN constraint found for "${column}"`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe("option values match the database CHECK constraints", () => {
  const cases: [string, readonly { value: string }[]][] = [
    ["intake_path", PLAN_PATH_OPTIONS],
    ["purchase_mode", SALES_MODEL_OPTIONS],
    ["growth_stage", BUSINESS_STAGE_OPTIONS],
    ["sales_owner", WHO_CLOSES_OPTIONS],
    ["plan_owner", PLAN_OWNER_OPTIONS],
    ["product_type", PRODUCT_TYPE_OPTIONS],
    ["price_level", PRICE_TIER_OPTIONS],
    ["payment_type", PRICING_MODEL_OPTIONS],
    ["delivery_mode", DELIVERY_OPTIONS],
    ["cadence", CADENCE_OPTIONS],
    ["repeat_frequency", REPEAT_FREQUENCY_OPTIONS],
    ["sells_to", CUSTOMER_TYPE_OPTIONS],
    ["recurring_interval", RECURRING_INTERVAL_OPTIONS],
  ];

  for (const [column, options] of cases) {
    it(`every ${column} option is accepted by the column`, () => {
      const allowed = allowedValues(column);
      for (const option of options) {
        expect(allowed, `${column} rejects "${option.value}"`).toContain(option.value);
      }
    });
  }

  it("horizon_months offers exactly the periods the column allows", () => {
    const allowed = SQL.match(/horizon_months\s+IN\s*\(([^)]*)\)/i);
    expect(allowed).not.toBeNull();
    const numbers = [...allowed![1].matchAll(/\d+/g)].map((m) => Number(m[0]));
    expect([...PLANNING_PERIODS].sort()).toEqual([...numbers].sort());
  });

  it("every audience field and its unknown flag exist in migration 025", () => {
    for (const spec of AUDIENCE_FIELDS) {
      expect(SQL_025).toContain(spec.field);
      expect(SQL_025).toContain(spec.unknownField);
    }
  });
});

describe("industries", () => {
  // The spec fixes the list at 13 plus Other.
  it("has 13 industries plus Other", () => {
    expect(INDUSTRIES).toHaveLength(13);
    expect(INDUSTRY_OPTIONS).toHaveLength(14);
  });

  it("puts Other last so the real industries read first", () => {
    expect(INDUSTRY_OPTIONS[INDUSTRY_OPTIONS.length - 1].value).toBe(INDUSTRY_OTHER);
  });

  /**
   * Values are the display strings on purpose: eligibility matches them against
   * the library's "Ideal Industries" column exactly, so a slug would need a
   * translation table that drifts on every workbook upload.
   */
  it("stores the display string as the value", () => {
    for (const option of INDUSTRY_OPTIONS) {
      expect(option.value).toBe(option.label);
    }
  });

  it("has no duplicates", () => {
    const values = valuesOf(INDUSTRY_OPTIONS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("adds Any industry only on the customer list", () => {
    expect(valuesOf(CUSTOMER_INDUSTRY_OPTIONS)).toContain(ANY_INDUSTRY);
    expect(valuesOf(INDUSTRY_OPTIONS)).not.toContain(ANY_INDUSTRY);
    expect(CUSTOMER_INDUSTRY_OPTIONS).toHaveLength(INDUSTRY_OPTIONS.length + 1);
  });

  it("recognises a real industry and rejects Other and free text", () => {
    expect(isKnownIndustry("Coaching & Consulting")).toBe(true);
    expect(isKnownIndustry(INDUSTRY_OTHER)).toBe(false);
    expect(isKnownIndustry("Underwater Basket Weaving")).toBe(false);
  });
});

describe("option lists are well formed", () => {
  const lists: [string, readonly { value: string; label: string }[]][] = [
    ["plan path", PLAN_PATH_OPTIONS],
    ["sales model", SALES_MODEL_OPTIONS],
    ["business stage", BUSINESS_STAGE_OPTIONS],
    ["who closes", WHO_CLOSES_OPTIONS],
    ["plan owner", PLAN_OWNER_OPTIONS],
    ["product type", PRODUCT_TYPE_OPTIONS],
    ["price tier", PRICE_TIER_OPTIONS],
    ["pricing model", PRICING_MODEL_OPTIONS],
    ["delivery", DELIVERY_OPTIONS],
    ["cadence", CADENCE_OPTIONS],
    ["repeat frequency", REPEAT_FREQUENCY_OPTIONS],
    ["customer type", CUSTOMER_TYPE_OPTIONS],
    ["obstacles", OBSTACLE_OPTIONS],
    ["other audiences", OTHER_AUDIENCE_OPTIONS],
  ];

  for (const [name, options] of lists) {
    it(`${name}: unique values, no blank labels`, () => {
      const values = options.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
      for (const option of options) {
        expect(option.label.trim()).not.toBe("");
        expect(option.value.trim()).not.toBe("");
      }
    });
  }

  it("offers the ten obstacles from the spec, capped at 3 selections", () => {
    expect(OBSTACLE_OPTIONS).toHaveLength(10);
    expect(MAX_OBSTACLES).toBe(3);
  });

  it("offers five audience numbers", () => {
    expect(AUDIENCE_FIELDS).toHaveLength(5);
  });

  it("gives the three path cards a sub-label each", () => {
    expect(PLAN_PATH_OPTIONS).toHaveLength(3);
    for (const option of PLAN_PATH_OPTIONS) {
      expect(option.subLabel).toBeTruthy();
    }
  });
});

describe("planning period", () => {
  // The doc overrode the earlier answer: 3/6/12/18, no 24.
  it("offers 3, 6, 12 and 18 months and not 24", () => {
    expect([...PLANNING_PERIODS]).toEqual([3, 6, 12, 18]);
    expect(isPlanningPeriod(24)).toBe(false);
  });

  it("defaults to 12", () => {
    expect(DEFAULT_PLANNING_PERIOD).toBe(12);
    expect(isPlanningPeriod(DEFAULT_PLANNING_PERIOD)).toBe(true);
  });

  it("accepts a numeric string and rejects junk", () => {
    expect(isPlanningPeriod("6")).toBe(true);
    expect(isPlanningPeriod(null)).toBe(false);
    expect(isPlanningPeriod("twelve")).toBe(false);
  });
});

describe("required fields", () => {
  it("covers every screen on every path", () => {
    for (const path of ["know_most", "know_some", "recommend_all"] as const) {
      for (const screen of screensFor(path)) {
        expect(REQUIRED_FIELDS[screen]).toBeDefined();
      }
    }
  });

  /**
   * REQ-2.5: only asterisked fields may block. These three screens are entirely
   * optional in the mockups, and a stray requirement here would strand users
   * who genuinely do not have the answer.
   */
  it("leaves the optional screens with nothing required", () => {
    expect(REQUIRED_FIELDS.initiatives).toEqual([]);
    expect(REQUIRED_FIELDS.wins).toEqual([]);
    expect(REQUIRED_FIELDS.audience).toEqual([]);
  });

  it("requires the asterisked business fields", () => {
    expect(isRequired("business", "industry")).toBe(true);
    expect(isRequired("business", "prior_period_revenue")).toBe(true);
    expect(isRequired("business", "growth_stage")).toBe(true);
  });

  it("does not require the optional business fields", () => {
    expect(isRequired("business", "business_description")).toBe(false);
    expect(isRequired("business", "purchase_mode")).toBe(false);
  });

  it("requires both long-text answers on the customer screen", () => {
    expect(isRequired("customer", "ideal_customer")).toBe(true);
    expect(isRequired("customer", "problem_solved")).toBe(true);
  });

  it("requires budget but not hours", () => {
    expect(isRequired("team", "monthly_marketing_budget")).toBe(true);
    expect(isRequired("team", "weekly_hours")).toBe(false);
  });
});

describe("voice fields", () => {
  // REQ-2.3 names exactly these five.
  it("covers the five long-text fields", () => {
    expect([...VOICE_FIELDS].sort()).toEqual([
      "business_description",
      "challenge_notes",
      "ideal_customer",
      "problem_solved",
      "what_worked_notes",
    ]);
  });

  it("does not claim a mic on short fields", () => {
    expect(hasVoiceInput("industry")).toBe(false);
    expect(hasVoiceInput("revenue_goal")).toBe(false);
    expect(hasVoiceInput("ideal_customer")).toBe(true);
  });

  it("gives every voice field a label to render", () => {
    for (const field of VOICE_FIELDS) {
      expect(FIELD_COPY[field]?.label).toBeTruthy();
    }
  });
});

describe("copy", () => {
  it("gives every screen a title", () => {
    for (const screen of screensFor("know_most")) {
      expect(SCREEN_COPY[screen].title.trim()).not.toBe("");
    }
  });

  // Path A and B read differently on screen 5; Path C never sees it.
  it("varies the initiatives subtitle by path", () => {
    const a = subtitleFor("initiatives", "know_most");
    const b = subtitleFor("initiatives", "know_some");
    expect(a).not.toBe(b);
    // Path A is told their own numbers get checked; Path B is told we fill in.
    expect(a).toContain("forecast each one");
    expect(b).toContain("suggest the rest");
  });

  it("returns an empty subtitle for a path that never sees the screen", () => {
    expect(subtitleFor("initiatives", "recommend_all")).toBe("");
    expect(subtitleFor("initiatives", null)).toBe("");
  });

  it("returns the shared subtitle for every other screen", () => {
    expect(subtitleFor("business", "know_most")).toBe(subtitleFor("business", "recommend_all"));
  });
});

describe("unitsGoalLabel", () => {
  /**
   * REQ-6.9. A hardcoded "in the next 12 months" on a 6-month plan is a figure
   * the user enters wrong, not a label they notice.
   */
  it("names the chosen period", () => {
    expect(unitsGoalLabel(6, "one_time")).toContain("6 months");
    expect(unitsGoalLabel(18, "one_time")).toContain("18 months");
  });

  it("asks about subscribers for a recurring product instead", () => {
    expect(unitsGoalLabel(12, "recurring")).toBe("How many active subscribers by the end?");
  });

  it("falls back to the default period when none is chosen yet", () => {
    expect(unitsGoalLabel(null, null)).toContain("12 months");
    expect(unitsGoalLabel(24, null)).toContain("12 months");
  });
});

describe("showsCustomerIndustries", () => {
  // REQ-1.4: the field appears only when the answer includes businesses.
  it("shows for businesses and both, hides for consumers", () => {
    expect(showsCustomerIndustries("businesses")).toBe(true);
    expect(showsCustomerIndustries("both")).toBe(true);
    expect(showsCustomerIndustries("consumers")).toBe(false);
    expect(showsCustomerIndustries(null)).toBe(false);
  });
});
