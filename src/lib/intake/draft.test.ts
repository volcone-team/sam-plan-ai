import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  serialiseAnswers,
  serialiseProduct,
  serialiseInitiative,
  serialiseFunnelStages,
  restoreDraft,
  statusUpdate,
  timestampColumnFor,
  INTAKE_VERSION,
  NOT_NULL_NUMBER_FALLBACKS,
  type IntakeDraft,
} from "./draft";
import { AUDIENCE_FIELDS } from "./schema";

/**
 * The round trip is what these tests protect. A null that comes back as 0, or a
 * "Not sure" that comes back as answered, changes what the generator plans
 * against and would only surface as a strange plan weeks later.
 */

function draft(overrides: Partial<IntakeDraft> = {}): IntakeDraft {
  return {
    answers: {},
    products: [],
    initiatives: [],
    resumeScreen: "start",
    ...overrides,
  };
}

/**
 * The partial-save contract, checked against the SCHEMA rather than against my
 * memory of it.
 *
 * This is the bug that shipped: `revenue_goal` has been NOT NULL DEFAULT 0
 * since migration 001, because the v1 questionnaire asked for it on its first
 * screen. The v2 intake asks on screen 4, so screens 0 to 3 tried to save a row
 * with no goal and Postgres rejected the whole insert — "null value in column
 * revenue_goal violates not-null constraint", on screen 0, with no way past it.
 *
 * Unit tests all passed, because none of them touched a real database. So this
 * reads the NOT NULL columns out of the migration and asserts the serialiser
 * never writes null to one.
 */
describe("partial saves satisfy every NOT NULL column", () => {
  const schema = readFileSync(
    join(process.cwd(), "supabase", "migrations", "001_initial_schema.sql"),
    "utf8"
  );

  /** NOT NULL column names from `CREATE TABLE planning_inputs (...)`. */
  function notNullColumns(): string[] {
    const table = schema.match(
      /CREATE TABLE planning_inputs\s*\(([\s\S]*?)\n\);/i
    );
    if (!table) throw new Error("could not find CREATE TABLE planning_inputs");

    return table[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /NOT NULL/i.test(line))
      .map((line) => line.match(/^([a-z_][a-z0-9_]*)/i)?.[1])
      .filter((name): name is string => Boolean(name));
  }

  /**
   * The empty draft is the worst case: it is what screen 0 posts, before the
   * user has answered anything at all.
   */
  it("writes no null to a NOT NULL column", () => {
    const row = serialiseAnswers(draft());
    const offenders: string[] = [];

    for (const column of notNullColumns()) {
      // Columns the serialiser does not touch keep their database default.
      if (!(column in row)) continue;
      if (row[column] === null) offenders.push(column);
    }

    expect(offenders).toEqual([]);
  });

  it("finds the NOT NULL columns it is meant to be checking", () => {
    // Guards the regex: a silently empty list would make the test above pass
    // for the wrong reason.
    const columns = notNullColumns();
    expect(columns).toContain("revenue_goal");
    expect(columns.length).toBeGreaterThan(3);
  });

  it("writes 0 for revenue_goal before the user reaches screen 4", () => {
    expect(serialiseAnswers(draft()).revenue_goal).toBe(0);
  });

  it("writes the real goal once given", () => {
    expect(
      serialiseAnswers(draft({ answers: { revenue_goal: 750_000 } })).revenue_goal
    ).toBe(750_000);
  });

  /**
   * The fallback must read back as UNANSWERED. Otherwise someone resuming at
   * screen 2 finds a "0" in the goal field they never typed and have to clear
   * before entering their own.
   */
  it("restores the fallback as null rather than as a zero the user never typed", () => {
    const row = serialiseAnswers(draft());
    expect(restoreDraft(row).answers.revenue_goal).toBeNull();
  });

  it("restores a real goal unchanged", () => {
    const row = serialiseAnswers(draft({ answers: { revenue_goal: 750_000 } }));
    expect(restoreDraft(row).answers.revenue_goal).toBe(750_000);
  });

  /**
   * Only `revenue_goal` is affected. Every other number keeps null, which is
   * what tells the generator to use benchmarks instead of planning against a
   * business with no budget or no team.
   */
  it("leaves the nullable numbers as null", () => {
    const row = serialiseAnswers(draft());
    expect(row.prior_period_revenue).toBeNull();
    expect(row.weekly_hours).toBeNull();
    expect(row.horizon_months).toBeNull();
    expect(Object.keys(NOT_NULL_NUMBER_FALLBACKS)).toEqual(["revenue_goal"]);
  });
});

describe("serialiseAnswers", () => {
  it("stamps the intake version so the generator knows which fields to read", () => {
    expect(serialiseAnswers(draft()).intake_version).toBe(INTAKE_VERSION);
  });

  it("stores the resume position as a slug", () => {
    expect(serialiseAnswers(draft({ resumeScreen: "goal" })).resume_screen).toBe("goal");
  });

  /**
   * Blanks are written rather than omitted: otherwise "the user cleared this"
   * and "the user has not reached this screen" are indistinguishable, and a
   * cleared answer would never actually clear.
   */
  it("writes every known column even when the draft is empty", () => {
    const row = serialiseAnswers(draft());
    expect(row.industry).toBeNull();
    expect(row.challenges).toEqual([]);
    // revenue_goal is the one exception: NOT NULL in the schema, so it takes
    // its fallback rather than a null. See the NOT NULL block above.
    expect(row.revenue_goal).toBe(0);
  });

  it("keeps a real zero as zero", () => {
    const row = serialiseAnswers(
      draft({ answers: { monthly_marketing_budget: 0, prior_period_revenue: 0 } })
    );
    expect(row.monthly_marketing_budget).toBe(0);
    expect(row.prior_period_revenue).toBe(0);
  });

  // Checked on a NULLABLE number, since revenue_goal is the NOT NULL exception.
  it("turns a blank number into null, not zero", () => {
    const row = serialiseAnswers(draft({ answers: { weekly_hours: "" } }));
    expect(row.weekly_hours).toBeNull();
  });

  it("strips the commas a number input renders", () => {
    const row = serialiseAnswers(draft({ answers: { revenue_goal: "750,000" } }));
    expect(row.revenue_goal).toBe(750_000);
  });

  it("trims text and treats whitespace as unanswered", () => {
    const row = serialiseAnswers(
      draft({ answers: { business_description: "  we coach  ", problem_solved: "   " } })
    );
    expect(row.business_description).toBe("we coach");
    expect(row.problem_solved).toBeNull();
  });

  it("drops unknown keys rather than writing them to the table", () => {
    const row = serialiseAnswers(draft({ answers: { company_id: "attacker", nonsense: 1 } }));
    expect(row.company_id).toBeUndefined();
    expect(row.nonsense).toBeUndefined();
  });

  it("normalises a month picker value to the first of the month", () => {
    expect(serialiseAnswers(draft({ answers: { plan_start_month: "2026-11" } })).plan_start_month)
      .toBe("2026-11-01");
  });

  it("keeps a full date as given", () => {
    expect(
      serialiseAnswers(draft({ answers: { plan_start_month: "2026-11-15" } })).plan_start_month
    ).toBe("2026-11-15");
  });

  // "Other" text left behind after switching industries would be read by the
  // generator as the real industry.
  it("clears the Other text when the industry is not Other", () => {
    const row = serialiseAnswers(
      draft({ answers: { industry: "E-commerce", industry_other: "Marine logistics" } })
    );
    expect(row.industry_other).toBeNull();
  });

  it("keeps the Other text when Other is chosen", () => {
    const row = serialiseAnswers(
      draft({ answers: { industry: "Other", industry_other: "Marine logistics" } })
    );
    expect(row.industry_other).toBe("Marine logistics");
  });
});

describe("audience figures and Not sure", () => {
  /** REQ-2.6 — the flag is what distinguishes unknown from unanswered. */
  it("stores null plus the flag when Not sure is ticked", () => {
    const row = serialiseAnswers(
      draft({ answers: { email_list_size: 5000, email_list_unknown: true } })
    );
    expect(row.email_list_size).toBeNull();
    expect(row.email_list_unknown).toBe(true);
  });

  it("stores the figure and clears the flag when answered", () => {
    const row = serialiseAnswers(draft({ answers: { email_list_size: 5000 } }));
    expect(row.email_list_size).toBe(5000);
    expect(row.email_list_unknown).toBe(false);
  });

  it("distinguishes a real zero from Not sure", () => {
    const zero = serialiseAnswers(draft({ answers: { past_customers: 0 } }));
    expect(zero.past_customers).toBe(0);
    expect(zero.past_customers_unknown).toBe(false);

    const unsure = serialiseAnswers(draft({ answers: { past_customers_unknown: true } }));
    expect(unsure.past_customers).toBeNull();
    expect(unsure.past_customers_unknown).toBe(true);
  });

  it("covers all five audience fields", () => {
    const row = serialiseAnswers(draft());
    for (const spec of AUDIENCE_FIELDS) {
      expect(row).toHaveProperty(spec.field);
      expect(row).toHaveProperty(spec.unknownField);
    }
  });
});

describe("serialiseProduct", () => {
  it("keeps the display order it was given", () => {
    expect(serialiseProduct({ name: "A" }, 3).display_order).toBe(3);
  });

  it("stores the price and units as numbers", () => {
    const row = serialiseProduct({ name: "A", average_price: "5,000", units_in_period: "20" }, 0);
    expect(row.average_price).toBe(5000);
    expect(row.units_in_period).toBe(20);
  });

  it("stores an unnamed product with an empty name rather than failing the NOT NULL", () => {
    expect(serialiseProduct({}, 0).name).toBe("");
  });

  it("keeps the interval for a recurring product", () => {
    const row = serialiseProduct(
      { name: "A", payment_type: "recurring", recurring_interval: "month" },
      0
    );
    expect(row.recurring_interval).toBe("month");
  });

  // A stale interval on a one-time product is contradictory data.
  it("clears the interval when the product is not recurring", () => {
    const row = serialiseProduct(
      { name: "A", payment_type: "one_time", recurring_interval: "month" },
      0
    );
    expect(row.recurring_interval).toBeNull();
  });
});

describe("serialiseInitiative", () => {
  it("defaults the source to planned", () => {
    expect(serialiseInitiative({ initiative_key: "x" }, 0).source).toBe("planned");
  });

  it("keeps the screen 6 sources", () => {
    expect(serialiseInitiative({ source: "failed", initiative_key: "x" }, 0).source)
      .toBe("failed");
  });

  // REQ-8.1 — a named "Something else" is a signal about a library gap.
  it("flags a custom label for review", () => {
    const row = serialiseInitiative({ initiative_key: "x", custom_label: "Direct mail" }, 0);
    expect(row.custom_label).toBe("Direct mail");
    expect(row.needs_review).toBe(true);
  });

  it("does not flag a library initiative for review", () => {
    expect(serialiseInitiative({ initiative_key: "live_webinar_own" }, 0).needs_review)
      .toBe(false);
  });

  it("keeps the frequency for a repeating initiative", () => {
    const row = serialiseInitiative(
      { initiative_key: "x", cadence: "repeat", repeat_frequency: "monthly" },
      0
    );
    expect(row.repeat_frequency).toBe("monthly");
  });

  it("clears the frequency for Once and Always on", () => {
    expect(
      serialiseInitiative(
        { initiative_key: "x", cadence: "once", repeat_frequency: "monthly" },
        0
      ).repeat_frequency
    ).toBeNull();
    expect(
      serialiseInitiative(
        { initiative_key: "x", cadence: "always_on", repeat_frequency: "weekly" },
        0
      ).repeat_frequency
    ).toBeNull();
  });

  it("keeps has_run_before as null when unanswered", () => {
    expect(serialiseInitiative({ initiative_key: "x" }, 0).has_run_before).toBeNull();
    expect(serialiseInitiative({ initiative_key: "x", has_run_before: false }, 0).has_run_before)
      .toBe(false);
  });

  it("stores the product ids it was given", () => {
    const row = serialiseInitiative({ initiative_key: "x", product_ids: ["a", "b"] }, 0);
    expect(row.product_ids).toEqual(["a", "b"]);
  });

  it("drops non-string product ids", () => {
    const row = serialiseInitiative({ initiative_key: "x", product_ids: ["a", 7, null] }, 0);
    expect(row.product_ids).toEqual(["a"]);
  });
});

describe("serialiseFunnelStages", () => {
  it("preserves order, which the arithmetic depends on", () => {
    const stages = serialiseFunnelStages([
      { key: "signed_up", label: "% registered", percent: 12 },
      { key: "showed", label: "% showed", percent: 30 },
      { key: "bought", label: "% bought", percent: 4 },
    ]);
    expect(stages.map((s) => s.key)).toEqual(["signed_up", "showed", "bought"]);
  });

  /**
   * A skipped stage stays as an explicit null so the stored array still
   * describes the whole funnel. `forecastPerRun` then returns no forecast
   * rather than a low one.
   */
  it("keeps a skipped stage as null rather than dropping it", () => {
    const stages = serialiseFunnelStages([
      { key: "signed_up", label: "a", percent: 12 },
      { key: "showed", label: "b", percent: null },
      { key: "bought", label: "c", percent: "" },
    ]);
    expect(stages).toHaveLength(3);
    expect(stages[1].percent).toBeNull();
    expect(stages[2].percent).toBeNull();
  });

  it("keeps a real zero percentage", () => {
    const stages = serialiseFunnelStages([{ key: "bought", label: "c", percent: 0 }]);
    expect(stages[0].percent).toBe(0);
  });

  it("stores the label the user was shown", () => {
    const stages = serialiseFunnelStages([
      { key: "showed", label: "% who booked a call", percent: 30 },
    ]);
    expect(stages[0].label).toBe("% who booked a call");
  });

  it("skips malformed entries instead of throwing", () => {
    expect(serialiseFunnelStages([null, 7, {}, { key: "" }])).toEqual([]);
    expect(serialiseFunnelStages("nonsense")).toEqual([]);
    expect(serialiseFunnelStages(undefined)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Round trip
 * ------------------------------------------------------------------ */

describe("restoreDraft", () => {
  it("returns an empty draft when nothing is saved yet", () => {
    const restored = restoreDraft(null);
    expect(restored.found).toBe(false);
    expect(restored.resumeScreen).toBe("start");
    expect(restored.path).toBeNull();
    expect(restored.products).toEqual([]);
  });

  /**
   * The property that matters: serialise then restore must not change an
   * answer. Checked as a round trip rather than per direction, because a column
   * present in one map and missing from the other would pass both halves
   * separately.
   */
  it("round-trips a complete set of answers", () => {
    const answers = {
      intake_path: "know_some",
      industry: "Coaching & Consulting",
      business_description: "We coach consultants",
      purchase_mode: "sales_call",
      growth_stage: "momentum",
      prior_period_revenue: 450000,
      team_size: 4,
      monthly_marketing_budget: 2000,
      sales_owner: "me",
      plan_owner: "both",
      weekly_hours: 20,
      horizon_months: 6,
      plan_start_month: "2026-11-01",
      revenue_goal: 292500,
      sells_to: "businesses",
      customer_industries: ["B2B SaaS & Tech"],
      problem_solved: "Lead flow",
      borrowed_audiences: ["partners"],
      challenges: ["need_leads", "limited_time"],
      challenge_notes: "Not enough pipeline",
    };

    const row = serialiseAnswers(draft({ answers, resumeScreen: "goal" }));
    const restored = restoreDraft(row);

    for (const [key, value] of Object.entries(answers)) {
      expect(restored.answers[key], key).toEqual(value);
    }
    expect(restored.resumeScreen).toBe("goal");
    expect(restored.path).toBe("know_some");
  });

  it("round-trips nulls as nulls, never as zeros", () => {
    const row = serialiseAnswers(draft());
    const restored = restoreDraft(row);

    expect(restored.answers.revenue_goal).toBeNull();
    expect(restored.answers.prior_period_revenue).toBeNull();
    expect(restored.answers.team_size).toBeNull();
    expect(restored.answers.industry).toBeNull();
  });

  it("round-trips Not sure as the flag with a null figure", () => {
    const row = serialiseAnswers(
      draft({ answers: { social_following: 999, social_following_unknown: true } })
    );
    const restored = restoreDraft(row);

    expect(restored.answers.social_following).toBeNull();
    expect(restored.answers.social_following_unknown).toBe(true);
  });

  it("round-trips a zero audience figure as zero, not unknown", () => {
    const row = serialiseAnswers(draft({ answers: { monthly_leads: 0 } }));
    const restored = restoreDraft(row);

    expect(restored.answers.monthly_leads).toBe(0);
    expect(restored.answers.monthly_leads_unknown).toBe(false);
  });

  /**
   * REQ-6.3's partial-save case: a user who abandons on screen 2 has only the
   * first screens answered, and the restore must not invent the rest.
   */
  it("restores a partial draft without filling in the unanswered screens", () => {
    const row = serialiseAnswers(
      draft({
        answers: { intake_path: "know_most", industry: "E-commerce", prior_period_revenue: 100000 },
        resumeScreen: "team",
      })
    );
    const restored = restoreDraft(row);

    expect(restored.answers.industry).toBe("E-commerce");
    expect(restored.answers.revenue_goal).toBeNull();
    expect(restored.answers.sells_to).toBeNull();
    expect(restored.resumeScreen).toBe("team");
  });

  /**
   * A stored screen the new path does not contain. Restarting is better than
   * landing on a question they never saw.
   */
  it("falls back to the start when the stored screen is off-path", () => {
    const restored = restoreDraft({
      intake_path: "recommend_all",
      resume_screen: "initiatives",
    });
    expect(restored.resumeScreen).toBe("start");
  });

  it("keeps a stored screen that is on the path", () => {
    expect(
      restoreDraft({ intake_path: "recommend_all", resume_screen: "audience" }).resumeScreen
    ).toBe("audience");
    expect(
      restoreDraft({ intake_path: "know_most", resume_screen: "initiatives" }).resumeScreen
    ).toBe("initiatives");
  });

  it("falls back to the start on a junk slug", () => {
    expect(restoreDraft({ resume_screen: "../../etc/passwd" }).resumeScreen).toBe("start");
    expect(restoreDraft({ resume_screen: null }).resumeScreen).toBe("start");
  });

  it("treats an unrecognised path as unanswered", () => {
    expect(restoreDraft({ intake_path: "something_else" }).path).toBeNull();
  });

  it("round-trips products", () => {
    const product = {
      name: "Coaching program",
      product_type: "coaching_service",
      price_level: "high",
      payment_type: "recurring",
      recurring_interval: "month",
      delivery_mode: "online",
      average_price: 5000,
      units_in_period: 20,
    };
    const row = serialiseProduct(product, 0);
    const [restored] = restoreDraft({}, [row]).products;

    expect(restored.name).toBe("Coaching program");
    expect(restored.average_price).toBe(5000);
    expect(restored.units_in_period).toBe(20);
    expect(restored.recurring_interval).toBe("month");
  });

  it("round-trips an initiative with its funnel intact", () => {
    const initiative = {
      initiative_key: "live_webinar_own",
      product_ids: ["p1", "p2"],
      cadence: "repeat",
      repeat_frequency: "monthly",
      has_run_before: true,
      audience_reached: 3000,
      average_price: 5000,
      funnel_stages: [
        { key: "signed_up", label: "% who registered", percent: 12 },
        { key: "showed", label: "% who showed up", percent: 30 },
        { key: "bought", label: "% who bought", percent: 4 },
      ],
    };
    const row = serialiseInitiative(initiative, 0);
    const [restored] = restoreDraft({}, [], [row]).initiatives;

    expect(restored.initiative_key).toBe("live_webinar_own");
    expect(restored.product_ids).toEqual(["p1", "p2"]);
    expect(restored.audience_reached).toBe(3000);
    expect(restored.funnel_stages).toEqual(initiative.funnel_stages);
  });

  it("round-trips a partially filled funnel without inventing percentages", () => {
    const row = serialiseInitiative(
      {
        initiative_key: "x",
        funnel_stages: [
          { key: "signed_up", label: "a", percent: 12 },
          { key: "showed", label: "b", percent: null },
          { key: "bought", label: "c", percent: null },
        ],
      },
      0
    );
    const [restored] = restoreDraft({}, [], [row]).initiatives;
    const stages = restored.funnel_stages as { percent: number | null }[];

    expect(stages.map((s) => s.percent)).toEqual([12, null, null]);
  });

  it("carries the row ids through so a save updates rather than duplicates", () => {
    const restored = restoreDraft({}, [{ id: "prod-1", name: "A" }], [{ id: "init-1" }]);
    expect(restored.products[0].id).toBe("prod-1");
    expect(restored.initiatives[0].id).toBe("init-1");
  });
});

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

describe("statusUpdate", () => {
  const now = "2026-10-07T12:00:00.000Z";

  it("sets the status and its timestamp on first arrival", () => {
    const update = statusUpdate(null, "intake_started", null, now);
    expect(update.onboarding_status).toBe("intake_started");
    expect(update.intake_started_at).toBe(now);
  });

  it("advances forward through the funnel", () => {
    const update = statusUpdate("intake_started", "intake_complete", null, now);
    expect(update.onboarding_status).toBe("intake_complete");
  });

  /**
   * Someone editing an answer after building a plan is still past
   * intake_complete. Letting the status slip back would show them dropping out
   * of a funnel they already finished.
   */
  it("never regresses to an earlier state", () => {
    const update = statusUpdate("plan_viewed", "intake_started", "earlier", now);
    expect(update.onboarding_status).toBeUndefined();
  });

  it("does not rewrite a timestamp that already exists", () => {
    const update = statusUpdate("intake_complete", "intake_complete", "2026-01-01T00:00:00Z", now);
    expect(update.intake_complete_at).toBeUndefined();
  });

  it("backfills a missing timestamp even when the status does not change", () => {
    const update = statusUpdate("plan_viewed", "intake_started", null, now);
    expect(update.onboarding_status).toBeUndefined();
    expect(update.intake_started_at).toBe(now);
  });

  it("maps every status to its own column", () => {
    const columns = (
      [
        "signed_up",
        "intake_started",
        "intake_complete",
        "plan_viewed",
        "first_actuals_entered",
      ] as const
    ).map(timestampColumnFor);
    expect(new Set(columns).size).toBe(5);
    expect(columns).toContain("intake_complete_at");
    expect(columns).toContain("first_actuals_at");
  });
});
