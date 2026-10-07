import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { checkEntitlement, statusForCode } from "@/lib/billing/enforce";
import { LIMIT_KEYS } from "@/lib/billing/limits";
import { statusUpdate, timestampColumnFor } from "@/lib/intake/draft";
import { productGoal } from "@/lib/intake-forecast";

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
          revenue_type: product.payment_type === "recurring" ? "recurring" : "one_time",
          ticket_tier: str(product.price_level),
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

    let initiativeCount = 0;

    // The user's own, with whatever timing they gave.
    for (const [index, initiative] of plannedInitiatives.entries()) {
      const key = str(initiative.initiative_key);
      if (!key) continue;

      const ok = await insertInitiative(db, {
        companyId,
        libraryKey: key,
        name:
          str(initiative.initiative_label) ??
          str(initiative.custom_label) ??
          "Initiative",
        // An exact date wins over a month: it is the more specific answer.
        activationDate:
          str(initiative.exact_date) ?? str(initiative.start_month) ?? planStart,
        productIds: toStringArray(initiative.product_ids)
          .map((id) => productIdByIntakeId.get(id))
          .filter((id): id is string => Boolean(id)),
        displayOrder: index,
      });

      if (!ok) {
        return NextResponse.json(
          { error: "Could not create your initiatives." },
          { status: 500 }
        );
      }
      initiativeCount += 1;
    }

    // Accepted recommendations. Sequenced one month apart from the plan start
    // so they do not all land in the same week — the calendar is where the user
    // refines this, but an unspaced default is unusable as a starting point.
    const largestProductId = largestProduct(intakeProducts, productIdByIntakeId);

    for (const [offset, key] of acceptedKeys.entries()) {
      const ok = await insertInitiative(db, {
        companyId,
        libraryKey: key,
        name: key,
        activationDate: addMonths(planStart, offset),
        productIds: largestProductId ? [largestProductId] : [],
        displayOrder: plannedInitiatives.length + offset,
      });

      if (!ok) {
        return NextResponse.json(
          { error: "Could not create the recommended initiatives." },
          { status: 500 }
        );
      }
      initiativeCount += 1;
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
    productIds: readonly string[];
    displayOrder: number;
  }
): Promise<boolean> {
  const annualPlanId = await resolveAnnualPlan(db, args.companyId, args.activationDate);
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
   */
  const products = args.productIds.length > 0 ? args.productIds : [null];

  for (const [index, productId] of products.entries()) {
    if (!productId) continue;

    const { error } = await db.from("initiatives").insert({
      company_id: args.companyId,
      annual_plan_id: annualPlanId,
      product_id: productId,
      initiative_type_id: typeId,
      name: args.name,
      description: "",
      kind: "one-time",
      status: "planned",
      activation_date: args.activationDate,
      display_order: args.displayOrder * 10 + index,
    });

    if (error) {
      console.error("[intake/build] initiative insert failed:", error.message);
      return false;
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
