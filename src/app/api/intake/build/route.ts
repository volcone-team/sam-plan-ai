import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { checkEntitlement, statusForCode } from "@/lib/billing/enforce";
import { LIMIT_KEYS } from "@/lib/billing/limits";
import { statusUpdate, timestampColumnFor } from "@/lib/intake/draft";
import { toRevenueType, toTicketTier } from "@/lib/intake/product-mapping";
import {
  forecastForStoredInitiative,
  scenariosFor,
  planTargets,
  type RevenueScenarios,
} from "@/lib/intake/build-forecast";
import { productGoal } from "@/lib/intake-forecast";
import { loadTaskTemplates } from "@/lib/workbook/read";
import {
  materialiseTasks,
  templateRunwayDays,
  type MaterialisedTask,
} from "@/lib/workbook/materialise";
import { sequenceEventDates } from "@/lib/plan-schedule";
import { toDateOnly } from "@/lib/plan-dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/intake/build — turn the intake into a real plan.
 *
 * REQ-13.1: THIS IS THE SINGLE COMMIT POINT. Nothing before it writes to
 * `products` or `initiatives`; the intake tables are a draft. That is why the
 * recommendations screen can let someone accept, dismiss and swap freely — none
 * of it is real until this route runs.
 *
 * REQ-13.15: the plan's `max_initiatives` is re-checked HERE as well as on the
 * screen. The screen's check is a courtesy so the user is not surprised; this
 * one is the actual enforcement, because a client can always post whatever it
 * likes.
 *
 * Writes are ordered so a failure leaves the account usable rather than half
 * migrated: products first (initiatives reference them), then initiatives, then
 * the lifecycle stamp last. Supabase gives no transaction across statements
 * from the client, so the ordering is the safety mechanism — a crash after
 * products leaves products with no initiatives, which the intake can be re-run
 * over, whereas the reverse would leave initiatives pointing at nothing.
 *
 * Responses:
 *   200 { built: true, productCount, initiativeCount }
 *   400 { error } — malformed body
 *   401 { error: "Unauthorized" }
 *   402/403 { error, code } — billing refused
 *   409 { error } — no company, or no saved intake
 *   422 { error, limit } — over max_initiatives
 */

interface BuildBody {
  /** Library keys the user accepted from the recommendations screen. */
  acceptedKeys?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const caller = await resolveCaller();
    if ("error" in caller) return caller.error;
    const { db, companyId } = caller;

    let body: BuildBody = {};
    try {
      body = (await request.json()) as BuildBody;
    } catch {
      // An empty body is legitimate: Path A users may accept nothing and build
      // only what they entered themselves.
    }

    const acceptedKeys = Array.isArray(body.acceptedKeys)
      ? body.acceptedKeys.filter((k): k is string => typeof k === "string")
      : [];

    const { data: input } = await db
      .from("planning_inputs")
      .select("*")
      .eq("company_id", companyId)
      .eq("intake_version", 2)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!input) {
      return NextResponse.json({ error: "No intake answers saved yet." }, { status: 409 });
    }

    const planningInputId = input.id as string;

    const [{ data: productRows }, { data: initiativeRows }] = await Promise.all([
      db
        .from("intake_products")
        .select("*")
        .eq("planning_input_id", planningInputId)
        .order("display_order"),
      db
        .from("intake_initiatives")
        .select("*")
        .eq("planning_input_id", planningInputId)
        .eq("source", "planned")
        .order("display_order"),
    ]);

    const intakeProducts = (productRows ?? []) as Record<string, unknown>[];
    const plannedInitiatives = (initiativeRows ?? []) as Record<string, unknown>[];

    const totalInitiatives = plannedInitiatives.length + acceptedKeys.length;

    /* ---- REQ-13.15: the real limit check ---- */

    const entitlement = await checkEntitlement(
      db,
      companyId,
      LIMIT_KEYS.MAX_INITIATIVES,
      totalInitiatives
    );

    if (!entitlement.ok) {
      // 402 or 403 depending on why; `statusForCode` owns that mapping.
      return NextResponse.json(
        {
          error: entitlement.message,
          code: entitlement.code,
          limit: entitlement.limit?.limit ?? null,
        },
        { status: statusForCode(entitlement.code) }
      );
    }

    if (
      entitlement.limit &&
      !entitlement.limit.unlimited &&
      totalInitiatives > entitlement.limit.limit
    ) {
      /**
       * 422 rather than 403: the request is well-formed and the account is in
       * good standing — there are simply too many initiatives in it. The screen
       * should have prevented this, so reaching here means a stale client, and
       * the message names the number so it can correct itself.
       */
      return NextResponse.json(
        {
          error:
            `Your plan allows ${entitlement.limit.limit} initiatives. ` +
            `Deselect ${totalInitiatives - entitlement.limit.limit} to continue.`,
          limit: entitlement.limit.limit,
          requested: totalInitiatives,
        },
        { status: 422 }
      );
    }

    /* ---- Products ---- */

    const planStart = str(input.plan_start_month) ?? todayIso();
    const productIdByIntakeId = new Map<string, string>();

    for (const [index, product] of intakeProducts.entries()) {
      const name = str(product.name);
      // An unnamed product card was never filled in; carrying it through would
      // put "Product 3" in the customer's live product list.
      if (!name) continue;

      const { data: created, error } = await db
        .from("products")
        .insert({
          company_id: companyId,
          name,
          price: num(product.average_price) ?? 0,
          // Both of these are TRANSLATED, not passed through: `products` has
          // CHECK constraints from migration 001 with a different vocabulary to
          // the intake's, so a raw value is rejected by the database.
          revenue_type: toRevenueType(product.payment_type),
          ticket_tier: toTicketTier(product.price_level),
          display_order: index,
          is_active: true,
        })
        .select("id")
        .single();

      if (error || !created) {
        console.error("[intake/build] product insert failed:", error?.message);
        return NextResponse.json(
          { error: error?.message || "Could not create your products." },
          { status: 500 }
        );
      }

      const intakeId = str(product.id);
      if (intakeId) productIdByIntakeId.set(intakeId, created.id as string);
    }

    /* ---- Initiatives ---- */

    const largestProductId = largestProduct(intakeProducts, productIdByIntakeId);

    /**
     * No product means no plan is possible: `initiatives.product_id` is NOT
     * NULL, so every initiative would be rejected and the user would land on an
     * empty dashboard believing their plan had been built.
     *
     * 409 and a plain explanation, pointing at the screen that fixes it. This
     * is reachable whenever screen 3 was left blank or its cards were never
     * named, so it is a real user state rather than a defensive check.
     */
    if (productIdByIntakeId.size === 0) {
      return NextResponse.json(
        {
          error:
            "Your plan needs at least one product before it can be built. " +
            "Go back to Products and add what you sell.",
          screen: "products",
        },
        { status: 409 }
      );
    }

    /**
     * Both sources are collected BEFORE anything is written, because the dates
     * cannot be decided one initiative at a time.
     *
     * `sequenceEventDates` needs the whole set: its job is to stop two launches
     * landing on the same day and to stop one initiative's preparation window
     * starting before the previous launch. Inserting as we go would mean each
     * initiative is dated in ignorance of the others, which is the pile-up
     * generate-plan already had to solve.
     */
    const pending: {
      libraryKey: string;
      name: string;
      /** The date the user asked for, or the plan start as a fallback. */
      desiredEvent: string;
      productIds: string[];
      displayOrder: number;
      /** good/better/best, so the dashboard has revenue to show. */
      revenue: RevenueScenarios;
    }[] = [];

    // The horizon the funnel figures are projected over. Defaults to 12 so a
    // missing answer does not silently zero every forecast.
    const horizonMonths = num(input.horizon_months) ?? 12;

    for (const [index, initiative] of plannedInitiatives.entries()) {
      const key = str(initiative.initiative_key);
      if (!key) continue;

      /**
       * Product chips are stored as `intake_products` ids, which have to be
       * translated to the live `products` ids created above.
       *
       * Falling back to the largest product when that yields nothing, because
       * `initiatives.product_id` is NOT NULL: screen 5's product selection is
       * optional, and a draft saved before its products existed can carry
       * stale ids. Dropping the initiative instead would silently shrink the
       * plan the user just approved.
       */
      const mapped = toStringArray(initiative.product_ids)
        .map((id) => productIdByIntakeId.get(id))
        .filter((id): id is string => Boolean(id));

      const productIds =
        mapped.length > 0
          ? mapped
          : largestProductId
            ? [largestProductId]
            : [];

      pending.push({
        libraryKey: key,
        name:
          str(initiative.initiative_label) ??
          str(initiative.custom_label) ??
          "Initiative",
        // An exact date wins over a month: it is the more specific answer.
        desiredEvent:
          str(initiative.exact_date) ?? str(initiative.start_month) ?? planStart,
        productIds,
        displayOrder: index,
        /**
         * The forecast the user already saw on the recommendations screen,
         * recomputed from the same stored funnel. Without this the initiative
         * is created with no revenue and the dashboard reads $0 everywhere.
         */
        revenue: scenariosFor(
          forecastForStoredInitiative(initiative, horizonMonths)
        ),
      });
    }

    /**
     * A recommendation has no funnel of its own — the user never ran it — so
     * its forecast comes from the same benchmark the recommendations screen
     * used: a conservative third of the average product goal.
     *
     * Recomputed here rather than accepted from the client, which could send
     * any figure it liked.
     */
    const benchmarkRevenue = benchmarkPerInitiative(intakeProducts);

    // Accepted recommendations start a month apart as an opening intent;
    // sequencing below then spaces them by their real preparation windows.
    for (const [offset, key] of acceptedKeys.entries()) {
      pending.push({
        libraryKey: key,
        name: key,
        desiredEvent: addMonths(planStart, offset),
        productIds: largestProductId ? [largestProductId] : [],
        displayOrder: plannedInitiatives.length + offset,
        revenue: scenariosFor(benchmarkRevenue),
      });
    }

    /**
     * Task templates and runways come from the WORKBOOK, keyed by library key.
     *
     * This is what makes an intake-built plan equivalent to a generated one: an
     * initiative with no tasks looks planned but has no project plan behind it,
     * and the runway is also what `sequenceEventDates` uses to space launches.
     * Loaded in one query for every key rather than per initiative.
     */
    /**
     * Nothing to build.
     *
     * Path A and B users reach here with their own initiatives; a Path C user
     * who accepted no recommendations has none. Either way the dashboard would
     * be empty, so say so instead of reporting a successful build — that is
     * exactly the "it loaded, then there was nothing" failure.
     */
    if (pending.length === 0) {
      return NextResponse.json(
        {
          error:
            "There are no initiatives to build yet. Accept at least one " +
            "recommendation, or add what you are already planning.",
        },
        { status: 409 }
      );
    }

    const templatesByKey = await loadTaskTemplates(
      db,
      pending.map((p) => p.libraryKey)
    );

    const scheduled = sequenceEventDates(
      pending.map((p) => ({
        desiredEvent: p.desiredEvent,
        runwayDays: templateRunwayDays(templatesByKey.get(p.libraryKey) ?? []),
      }))
    );

    // Nothing may be dated before today, including tasks.
    const floor = toDateOnly(new Date());
    let initiativeCount = 0;

    for (const [index, item] of pending.entries()) {
      const slot = scheduled[index];
      const templates = templatesByKey.get(item.libraryKey) ?? [];

      const ok = await insertInitiative(db, {
        companyId,
        libraryKey: item.libraryKey,
        name: item.name,
        activationDate: toDateOnly(slot.activationDate),
        eventDate: toDateOnly(slot.eventDate),
        productIds: item.productIds,
        displayOrder: item.displayOrder,
        revenue: item.revenue,
        // Same date handling as generate-plan: counted back from the event,
        // floored at today.
        tasks:
          templates.length > 0
            ? materialiseTasks(templates, {
                eventDate: slot.eventDate,
                floor,
              })
            : [],
      });

      if (!ok) {
        return NextResponse.json(
          { error: "Could not create your initiatives." },
          { status: 500 }
        );
      }
      initiativeCount += 1;
    }

    /* ---- Annual plan targets ---- */

    /**
     * Without this the dashboard's goal tiles read "No target set for this year
     * yet" even though the user typed a revenue goal on screen 4 — the figure
     * was saved on `planning_inputs` and never copied to the plan the dashboard
     * actually reads.
     *
     * Baseline is the user's stated goal, NOT our forecast. Overwriting the
     * goal with the forecast would hide the gap between them, which is the one
     * thing the plan is meant to make visible.
     */
    const targets = planTargets(num(input.revenue_goal));

    if (targets.baseline > 0) {
      const planIds = [...new Set(scheduled.map((s) => s.eventDate.getUTCFullYear()))];

      for (const year of planIds) {
        await db
          .from("annual_plans")
          .update({
            baseline_revenue: targets.baseline,
            stretch_revenue: targets.stretch,
            status: "active",
          })
          .eq("company_id", companyId)
          .eq("year", year);
      }
    }

    /* ---- Lifecycle, last ---- */

    const update = statusUpdate(
      str(input.onboarding_status),
      "intake_complete",
      str(input[timestampColumnFor("intake_complete")])
    );

    await db
      .from("planning_inputs")
      .update({ ...update, completed_at: new Date().toISOString() })
      .eq("id", planningInputId)
      .eq("company_id", companyId);

    return NextResponse.json({
      built: true,
      productCount: productIdByIntakeId.size,
      initiativeCount,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[intake/build] failed:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}

/* ------------------------------------------------------------------ *
 * Initiative creation
 * ------------------------------------------------------------------ */

/**
 * `initiatives` has three NOT NULL foreign keys — annual plan, product and
 * initiative type — so each has to be resolved before an insert.
 *
 * `product_id` being NOT NULL is why an initiative with no product cannot be
 * created at all. Screen 5 requires at least one product per initiative for
 * exactly this reason, and a recommendation is attributed to the largest
 * product rather than being dropped.
 */
async function insertInitiative(
  db: SupabaseClient,
  args: {
    companyId: string;
    libraryKey: string;
    name: string;
    activationDate: string;
    /** When the initiative actually happens. Tasks count back from this. */
    eventDate: string;
    productIds: readonly string[];
    displayOrder: number;
    revenue: RevenueScenarios;
    tasks: readonly MaterialisedTask[];
  }
): Promise<boolean> {
  // Filed under the EVENT's year, not the activation year: an initiative
  // prepared in December and run in January belongs to January's plan.
  const annualPlanId = await resolveAnnualPlan(db, args.companyId, args.eventDate);
  if (!annualPlanId) {
    console.error("[intake/build] no annual plan for", args.companyId);
    return false;
  }

  const typeId = await resolveInitiativeType(db, args.libraryKey);
  if (!typeId) {
    console.error("[intake/build] no initiative type for", args.libraryKey);
    return false;
  }

  /**
   * One row per product.
   *
   * The schema allows a single `product_id`, while screen 5 lets one initiative
   * sell several (REQ-8.5). Splitting into one row per product keeps the
   * revenue attributable per product — which REQ-13.11's coverage rule depends
   * on — rather than silently discarding the extra products.
   *
   * `product_id` is NOT NULL, so an initiative with no product cannot be
   * written at all. This used to iterate `[null]` and `continue` past it,
   * returning TRUE having inserted nothing: the build reported success, the
   * plan_built event counted the initiative, and the dashboard was empty. A
   * caller that cannot supply a product needs to hear about it.
   */
  if (args.productIds.length === 0) {
    console.error(
      "[intake/build] no product for initiative", args.libraryKey,
      "— initiatives.product_id is NOT NULL, so there is nothing to attach it to"
    );
    return false;
  }

  for (const [index, productId] of args.productIds.entries()) {
    const { data: created, error } = await db
      .from("initiatives")
      .insert({
        company_id: args.companyId,
        annual_plan_id: annualPlanId,
        product_id: productId,
        initiative_type_id: typeId,
        name: args.name,
        description: "",
        kind: "one-time",
        status: "planned",
        activation_date: args.activationDate,
        event_date: args.eventDate,
        /**
         * Split across the product rows so the totals do not multiply.
         *
         * One initiative selling three products becomes three rows, and the
         * dashboard sums them — writing the full forecast on each would treble
         * the plan's revenue.
         */
        revenue_good: share(args.revenue.good, args.productIds.length),
        revenue_better: share(args.revenue.better, args.productIds.length),
        revenue_best: share(args.revenue.best, args.productIds.length),
        planned_budget: 0,
        actual_spend: 0,
        display_order: args.displayOrder * 10 + index,
      })
      .select("id")
      .single();

    if (error || !created) {
      console.error("[intake/build] initiative insert failed:", error?.message);
      return false;
    }

    /**
     * Tasks come from the workbook, so an intake-built initiative arrives with
     * the same project plan a generated one would have. Without this the plan
     * looks scheduled but has nothing to actually do.
     *
     * Fresh ids per row: `materialiseTasks` resolves dependencies to the ids it
     * generated, so reusing one set across several product rows would point
     * every copy's dependencies at the first row's tasks.
     */
    if (args.tasks.length > 0) {
      const rows = args.tasks.map((task) => ({
        id: task.id,
        initiative_id: created.id as string,
        company_id: args.companyId,
        name: task.name,
        description: task.description,
        due_date: task.dueDate,
        estimated_hours: task.estimatedHours,
        status: "not_started",
        priority: task.priority,
        display_order: task.displayOrder,
        dependency_ids: task.dependencyIds,
      }));

      // Only the first product row carries the task list. Duplicating it per
      // product would show the same work several times in the planner.
      if (index === 0) {
        const { error: taskError } = await db.from("tasks").insert(rows);
        if (taskError) {
          console.error("[intake/build] task insert failed:", taskError.message);
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * The annual plan the initiative belongs to, created if absent.
 *
 * Keyed on the activation YEAR rather than the current one: an 18-month plan
 * starting in November spills into the following year, and filing those
 * initiatives under this year's plan would put them on the wrong calendar.
 */
async function resolveAnnualPlan(
  db: SupabaseClient,
  companyId: string,
  activationDate: string
): Promise<string | null> {
  const year = Number(activationDate.slice(0, 4)) || new Date().getUTCFullYear();

  const { data: existing } = await db
    .from("annual_plans")
    .select("id")
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();

  if (existing?.id) return existing.id as string;

  const { data: created, error } = await db
    .from("annual_plans")
    .insert({ company_id: companyId, year, status: "active" })
    .select("id")
    .single();

  if (error) {
    console.error("[intake/build] annual plan insert failed:", error.message);
    return null;
  }

  return (created?.id as string) ?? null;
}

/**
 * The `initiative_types` row for a library key, created from the workbook if
 * missing.
 *
 * Same approach generate-plan takes: the workbook library is the source of
 * truth for what initiatives exist, and `initiative_types` is a projection of
 * it. Creating on demand keeps them aligned without a hand-maintained list that
 * drifts every time the workbook is re-uploaded.
 */
async function resolveInitiativeType(
  db: SupabaseClient,
  libraryKey: string
): Promise<string | null> {
  const { data: existing } = await db
    .from("initiative_types")
    .select("id")
    .eq("channel", libraryKey)
    .maybeSingle();

  if (existing?.id) return existing.id as string;

  const { data: entry } = await db
    .from("wb_initiative_library")
    .select("name, one_liner, difficulty")
    .eq("initiative_key", libraryKey)
    .maybeSingle();

  const difficulty = Number(entry?.difficulty) || 3;

  const { data: created, error } = await db
    .from("initiative_types")
    .insert({
      name: (entry?.name as string) ?? libraryKey,
      channel: libraryKey,
      description: (entry?.one_liner as string) ?? "",
      owner: "system",
      benchmarks: {},
      project_template: { tasks: [], totalEstimatedHours: 0 },
      difficulty: {
        effortToImplement: difficulty,
        skillExpertiseRequired: difficulty,
        timeToResults: difficulty,
        costToRun: difficulty,
      },
      ai_context: {},
      tier: 1,
      display_order: 99,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[intake/build] initiative type insert failed:", error.message);
    return null;
  }

  return (created?.id as string) ?? null;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * The product carrying the most revenue.
 *
 * Recommendations are attributed to it because `product_id` is NOT NULL and the
 * largest product is the one most likely to need extra coverage (REQ-13.11).
 * The user reassigns on the calendar if we guessed wrong.
 */
function largestProduct(
  intakeProducts: readonly Record<string, unknown>[],
  idMap: ReadonlyMap<string, string>
): string | null {
  let best: { id: string; goal: number } | null = null;

  for (const product of intakeProducts) {
    const intakeId = str(product.id);
    if (!intakeId) continue;
    const liveId = idMap.get(intakeId);
    if (!liveId) continue;

    const goal = productGoal(num(product.average_price), num(product.units_in_period));
    if (!best || goal > best.goal) best = { id: liveId, goal };
  }

  return best?.id ?? null;
}

/**
 * One product row's share of an initiative's forecast.
 *
 * Divided rather than repeated because the dashboard SUMS initiative rows: an
 * initiative selling three products becomes three rows, and writing the whole
 * forecast on each would report three times the revenue.
 */
function share(amount: number, rows: number): number {
  if (rows <= 1) return amount;
  return Math.round(amount / rows);
}

/**
 * Benchmark revenue for one recommended initiative.
 *
 * Mirrors `benchmarkRevenuePerProduct` in `/api/intake/recommend` so the figure
 * stored matches the figure the user was shown when they accepted it. A third
 * of the average product goal: deliberately conservative, since we have no
 * history for an initiative the business has never run.
 */
function benchmarkPerInitiative(
  intakeProducts: readonly Record<string, unknown>[]
): number {
  if (intakeProducts.length === 0) return 0;

  const total = intakeProducts.reduce(
    (sum, product) =>
      sum + productGoal(num(product.average_price), num(product.units_in_period)),
    0
  );

  if (total <= 0) return 0;
  return Math.round(total / intakeProducts.length / 3);
}

/** Add whole months to a `YYYY-MM-DD`, in UTC so no offset shifts the month. */
function addMonths(iso: string, months: number): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso;

  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1 + months, Number(match[3]))
  );
  return date.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function resolveCaller() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: profile } = await db
    .from("profiles")
    .select("company_id")
    .eq("id", user.id)
    .maybeSingle();

  const companyId = (profile?.company_id as string | null) ?? null;
  if (!companyId) {
    return {
      error: NextResponse.json({ error: "No company on this profile yet." }, { status: 409 }),
    };
  }

  return { user, db, companyId };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
