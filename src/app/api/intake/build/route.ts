import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { checkEntitlement, recordUsage, statusForCode } from "@/lib/billing/enforce";
import { LIMIT_KEYS } from "@/lib/billing/limits";
import { UPGRADE_URL } from "@/lib/billing/limit-notice";
import {
  countLiveUsage,
  evaluateLiveLimit,
  initiativeUsageAfterWipe,
  liveLimitResponse,
  loadLiveLimitContext,
  productAdditions,
} from "@/lib/billing/live-limits";
import { statusUpdate, timestampColumnFor } from "@/lib/intake/draft";
import { toRevenueType, toTicketTier } from "@/lib/intake/product-mapping";
import {
  forecastForStoredInitiative,
  scenariosFor,
  planTargets,
  initiativeKindForCadence,
  toFrequency,
  type RevenueScenarios,
} from "@/lib/intake/build-forecast";
import type { RepeatFrequency } from "@/lib/intake-forecast";
import type { InitiativeKind } from "@/types";
import { productGoal } from "@/lib/intake-forecast";
import { MAX_RECOMMENDED_INITIATIVES } from "@/lib/recommend/sizing";
import { loadLibrary, type LibraryEntry } from "@/lib/workbook/read";
import {
  resolveTaskTemplates,
  runwayForUntemplated,
  type ResolvedTemplates,
} from "@/lib/workbook/tasks-for-initiatives";
import {
  insertWithLibraryKey,
  resolveInitiativeTypeId,
  supabaseTypeStore,
  type TypeSource,
} from "@/lib/workbook/initiative-type";
import { SOMETHING_ELSE_KEY } from "@/lib/intake/schema";
import { defaultLibraryMetricSet } from "@/lib/metrics/library-metric-set";
import type { InitiativeMetricSet } from "@/lib/metrics/metric-set";
import {
  materialiseTasks,
  templateRunwayDays,
  type MaterialisedTask,
} from "@/lib/workbook/materialise";
import { sequenceEventDates } from "@/lib/plan-schedule";
import { toDateOnly } from "@/lib/plan-dates";
import { snapshotProducts } from "@/lib/snapshot-products";
import { enqueueMilestoneEvent } from "@/lib/ghl/producers/milestone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Stated explicitly now that a build may make an AI call (task lists for
 * initiatives the workbook has no template for, ~30s worst case) on top of its
 * own database work. Without this the platform default applies, which is
 * shorter than the AI timeout — the build would be killed mid-flight rather
 * than falling back to the starter template.
 */
export const maxDuration = 120;

/**
 * POST /api/intake/build — turn the intake into a real plan.
 *
 * REQ-13.1: THIS IS THE SINGLE COMMIT POINT. Nothing before it writes to
 * `products` or `initiatives`; the intake tables are a draft. That is why the
 * recommendations screen can let someone accept, dismiss and swap freely — none
 * of it is real until this route runs.
 *
 * REQ-13.15: the plan's limits are re-checked HERE as well as on the screen.
 * The screen's check is a courtesy so the user is not surprised; this one is
 * the actual enforcement, because a client can always post whatever it likes.
 * `max_initiatives` (per plan year, after the rebuild's own wipe) and
 * `max_products` are live counts; a rebuild also spends one
 * `plan_regenerations`. All three are decided before anything is wiped or
 * written.
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
 *   402/403 { error, code, message } — billing refused, or over max_products /
 *           max_initiatives (code "limit_reached" / "not_included")
 *   429 { error, code: "limit_reached" } — no plan regenerations left this period
 *   409 { error } — no company, or no saved intake
 *   422 { error, limit } — over the five-initiative plan ceiling
 */

interface BuildBody {
  /** Library keys the user accepted from the recommendations screen. */
  acceptedKeys?: unknown;
  /**
   * `intake_initiatives` row ids the user DESELECTED on the recommendations
   * screen.
   *
   * The screen is now one pool of the user's own initiatives plus our
   * alternatives, capped at MAX_RECOMMENDED_INITIATIVES in total — so choosing a
   * recommendation can mean dropping one of their own. Identified by row id
   * rather than key, because two of a user's initiatives can share a library
   * key and an index would break if the draft were re-read in another order.
   */
  droppedOwnIds?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const caller = await resolveCaller();
    if ("error" in caller) return caller.error;
    const { db, companyId, user } = caller;

    let body: BuildBody = {};
    try {
      body = (await request.json()) as BuildBody;
    } catch {
      // An empty body is legitimate: Path A users may accept nothing and build
      // only what they entered themselves.
    }

    const droppedOwnIds = new Set(
      Array.isArray(body.droppedOwnIds)
        ? body.droppedOwnIds.filter((id): id is string => typeof id === "string")
        : []
    );

    const requestedKeys = Array.isArray(body.acceptedKeys)
      ? [...new Set(body.acceptedKeys.filter((k): k is string => typeof k === "string" && k !== ""))]
      : [];

    /**
     * The library, twice: the WHOLE of it to name and type whatever the user
     * entered (screen 5 can carry an admin-disabled initiative), and the ACTIVE
     * set to vet what they accepted on the recommendations screen.
     *
     * Accepted keys are now chosen from the full active list, not only the
     * server's shortlist, so the client is posting library keys of its own
     * choosing. Anything not active is dropped rather than built. When the
     * active library cannot be read at all, nothing is dropped — refusing the
     * whole plan over a transient read failure is the worse outcome.
     */
    const [fullLibrary, activeLibrary] = await Promise.all([
      loadLibrary(db, { includeInactive: true }),
      loadLibrary(db),
    ]);
    const libraryByKey = new Map<string, LibraryEntry>(
      fullLibrary.map((entry) => [entry.initiativeKey, entry])
    );
    const activeKeys = new Set(activeLibrary.map((entry) => entry.initiativeKey));

    const acceptedKeys =
      activeKeys.size > 0 ? requestedKeys.filter((key) => activeKeys.has(key)) : requestedKeys;
    if (acceptedKeys.length !== requestedKeys.length) {
      console.warn(
        "[intake/build] ignored accepted keys that are not active library initiatives:",
        requestedKeys.filter((key) => !activeKeys.has(key)).join(", ")
      );
    }

    const typeSourceFor = (key: string): TypeSource | null => {
      const entry = libraryByKey.get(key);
      return entry
        ? { name: entry.name, oneLiner: entry.oneLiner, difficulty: entry.difficulty }
        : null;
    };
    const typeCache = new Map<string, string>();

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

    /**
     * The user's own initiatives, MINUS the ones they deselected.
     *
     * The recommendations screen is a single pool capped at five, so dropping
     * one of their own is how they make room for an alternative. Filtered here
     * rather than trusted from a count, so the plan contains exactly what they
     * chose.
     */
    const allPlanned = (initiativeRows ?? []) as Record<string, unknown>[];
    const plannedInitiatives = allPlanned.filter(
      (row) => !droppedOwnIds.has(String(row.id ?? ""))
    );

    if (droppedOwnIds.size > 0) {
      console.log(
        "[intake/build] dropped", allPlanned.length - plannedInitiatives.length,
        "of", allPlanned.length, "own initiatives at the user's request"
      );
    }

    const totalInitiatives = plannedInitiatives.length + acceptedKeys.length;

    /**
     * THE HARD CEILING, enforced server-side.
     *
     * The screen blocks selection past the cap, but the screen is not
     * enforcement — a stale client or a direct post could exceed it. 422
     * rather than 403 for the same reason as the plan-limit check below: the
     * request is well formed and the account is fine, there are simply too
     * many initiatives in it.
     */
    if (totalInitiatives > MAX_RECOMMENDED_INITIATIVES) {
      return NextResponse.json(
        {
          error:
            `A plan can hold at most ${MAX_RECOMMENDED_INITIATIVES} initiatives, and this ` +
            `one has ${totalInitiatives}. Deselect ` +
            `${totalInitiatives - MAX_RECOMMENDED_INITIATIVES} to continue.`,
          limit: MAX_RECOMMENDED_INITIATIVES,
        },
        { status: 422 }
      );
    }

    /* ---- Work out everything the build will write, BEFORE any write ---- */

    /**
     * Every limit below has to be decided before the previous plan is wiped
     * or a single row is inserted: refusing half-way would leave a deleted
     * plan and nothing in its place. So the products that will exist, the
     * initiatives, their dates and therefore their plan years are all derived
     * from the draft first. Intake product ids stand in for the live product
     * ids until the products are written.
     *
     * A named intake card always becomes a live product (created or reused by
     * name), so the cards with a name AND an id are exactly the ones the
     * initiatives' product chips can resolve to later.
     */
    const namedIntakeIds = new Set<string>();
    for (const product of intakeProducts) {
      const intakeId = str(product.id);
      if (intakeId && str(product.name)) namedIntakeIds.add(intakeId);
    }
    const largestIntakeId = largestProduct(
      intakeProducts,
      new Map([...namedIntakeIds].map((id) => [id, id]))
    );

    /**
     * No product means no plan is possible: `initiatives.product_id` is NOT
     * NULL, so every initiative would be rejected and the user would land on an
     * empty dashboard believing their plan had been built.
     *
     * 409 and a plain explanation, pointing at the screen that fixes it. This
     * is reachable whenever screen 3 was left blank or its cards were never
     * named, so it is a real user state rather than a defensive check. Now
     * answered before anything is cleared, so the old plan survives it.
     */
    if (namedIntakeIds.size === 0) {
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

    const planStart = str(input.plan_start_month) ?? todayIso();

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
      /** `intake_products` ids; translated to live ids once products exist. */
      intakeProductIds: string[];
      displayOrder: number;
      /** good/better/best, so the dashboard has revenue to show. */
      revenue: RevenueScenarios;
      /**
       * one-time / recurring / evergreen, from the user's own cadence answer.
       *
       * ONE INITIATIVE, HOWEVER MANY RUNS. A business doing monthly webinars
       * has one webinar initiative marked recurring, not twelve initiatives —
       * which is what makes a cap of five initiatives per plan compatible with
       * running something every month.
       */
      kind: InitiativeKind;
      /** weekly / monthly / quarterly, or null when it does not repeat. */
      repeatFrequency: RepeatFrequency | null;
    }[] = [];

    // The horizon the funnel figures are projected over. Defaults to 12 so a
    // missing answer does not silently zero every forecast.
    const horizonMonths = num(input.horizon_months) ?? 12;

    for (const [index, initiative] of plannedInitiatives.entries()) {
      const key = str(initiative.initiative_key);
      if (!key) continue;

      /**
       * Product chips are stored as `intake_products` ids, translated to the
       * live `products` ids once those are written.
       *
       * Falling back to the largest product when that yields nothing, because
       * `initiatives.product_id` is NOT NULL: screen 5's product selection is
       * optional, and a draft saved before its products existed can carry
       * stale ids. Dropping the initiative instead would silently shrink the
       * plan the user just approved.
       */
      const mapped = toStringArray(initiative.product_ids).filter((id) =>
        namedIntakeIds.has(id)
      );

      const intakeProductIds =
        mapped.length > 0
          ? mapped
          : largestIntakeId
            ? [largestIntakeId]
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
        intakeProductIds,
        displayOrder: index,
        /**
         * The forecast the user already saw on the recommendations screen,
         * recomputed from the same stored funnel. Without this the initiative
         * is created with no revenue and the dashboard reads $0 everywhere.
         */
        revenue: scenariosFor(
          forecastForStoredInitiative(initiative, horizonMonths)
        ),
        /**
         * The cadence the user chose, carried through instead of discarded.
         *
         * These two lines are what stop the plan contradicting itself. The
         * revenue above is ALREADY multiplied by the number of runs the
         * cadence implies, so writing 'one-time' here claimed twelve monthly
         * webinars' revenue for a single dated webinar.
         */
        kind: initiativeKindForCadence(initiative.cadence),
        repeatFrequency: toFrequency(initiative.repeat_frequency),
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
        // The library's name, not the raw key: this used to write "webinar"
        // as the initiative's name on the customer's plan.
        name: libraryByKey.get(key)?.name ?? key,
        desiredEvent: addMonths(planStart, offset),
        intakeProductIds: largestIntakeId ? [largestIntakeId] : [],
        displayOrder: plannedInitiatives.length + offset,
        revenue: scenariosFor(benchmarkRevenue),
        /**
         * A RECOMMENDATION STARTS AS ONE-TIME, and that is honest rather than
         * lazy: the user has never run it and was never asked how often they
         * would. Its benchmark forecast is a single run's worth too, so
         * marking it recurring would promise a cadence nobody chose and a
         * revenue figure that does not match it.
         *
         * They can change it to recurring on the initiative itself once the
         * plan exists.
         */
        kind: "one-time",
        repeatFrequency: null,
      });
    }

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

    /**
     * Task templates and runways come from the WORKBOOK, keyed by library key.
     *
     * This is what makes an intake-built plan equivalent to a generated one: an
     * initiative with no tasks looks planned but has no project plan behind it,
     * and the runway is also what `sequenceEventDates` uses to space launches.
     * Loaded in one query for every key rather than per initiative.
     */
    const templatesByKey = await resolveTaskTemplates(
      db,
      pending.map((p) => p.libraryKey),
      { companyId, userId: user.id, logLabel: "[intake/build]" }
    );

    /**
     * RUNWAY FOR AN UNTEMPLATED INITIATIVE IS THE STARTER TEMPLATE'S, not its
     * AI-written task list's.
     *
     * `sequenceEventDates` spaces the launches by how long each takes to
     * prepare, and that spacing has to be stable: it decides every event date
     * in the plan, the plan years the initiatives are filed under, and
     * therefore which max_initiatives counts are checked below. Deriving it
     * from AI output would make all of that move with a call that is allowed
     * to fail — two builds of the same intake could land in different years.
     *
     * So an initiative with no workbook template is scheduled on the starter
     * template's known 30-day runway (runwayForUntemplated), whatever its
     * tasks turn out to be. The cost is small and bounded: an AI task with a
     * longer lead than the runway is floored at today by `materialiseTasks`
     * instead of moving the event.
     */
    const scheduled = sequenceEventDates(
      pending.map((p) => ({
        desiredEvent: p.desiredEvent,
        runwayDays: runwayFor(templatesByKey.get(p.libraryKey)),
      }))
    );

    /* ---- Plan limits: all decided before the wipe ---- */

    /**
     * max_initiatives is a LIVE count per plan year (src/lib/billing/live-limits.ts).
     *
     * Each initiative is filed under its EVENT's year (see insertInitiative),
     * and writes one row per product it sells. The year being rebuilt
     * (`wipeYear`, the same year clearPreviousPlan uses) is emptied first, so
     * it starts from 0; any other year the plan spills into keeps what it has.
     * This replaces the old check against a usage counter nothing wrote.
     */
    const wipeYear = Number(planStart.slice(0, 4)) || new Date().getUTCFullYear();

    const newByYear = new Map<number, number>();
    for (const [index, item] of pending.entries()) {
      const year = Number(toDateOnly(scheduled[index].eventDate).slice(0, 4)) || wipeYear;
      newByYear.set(year, (newByYear.get(year) ?? 0) + item.intakeProductIds.length);
    }

    const { data: planRows, error: planReadError } = await db
      .from("annual_plans")
      .select("id, year")
      .eq("company_id", companyId)
      .in("year", [...new Set([wipeYear, ...newByYear.keys()])]);

    if (planReadError) {
      return NextResponse.json(
        { error: "Could not check your plan limits, so nothing has been changed. Please try again." },
        { status: 500 }
      );
    }

    const existingByYear = new Map<number, number>();
    for (const row of (planRows ?? []) as { id: string; year: number }[]) {
      existingByYear.set(
        row.year,
        await countLiveUsage(db, companyId, LIMIT_KEYS.MAX_INITIATIVES, { annualPlanId: row.id })
      );
    }

    /**
     * A REBUILD is exactly when clearPreviousPlan will find something to
     * snapshot and wipe: the year's plan exists and holds initiatives. The
     * first build is free; a rebuild spends one plan_regenerations.
     */
    const isRebuild = (existingByYear.get(wipeYear) ?? 0) > 0;

    const limitCtx = await loadLiveLimitContext(db, companyId);

    /**
     * Products: read once here and reused by the products section below.
     * Reused-by-name products are not new; an inactive one that the build
     * switches back on does add to the active count.
     */
    const { data: existingProductRows, error: productReadError } = await db
      .from("products")
      .select("id, name, is_active")
      .eq("company_id", companyId);

    if (productReadError) {
      return NextResponse.json(
        { error: "Could not check your plan limits, so nothing has been changed. Please try again." },
        { status: 500 }
      );
    }

    const existingProducts = (existingProductRows ?? []) as {
      id: string; name: string; is_active: boolean | null;
    }[];

    const productLimit = evaluateLiveLimit(
      limitCtx,
      LIMIT_KEYS.MAX_PRODUCTS,
      existingProducts.filter((p) => p.is_active !== false).length,
      productAdditions(intakeProducts.map((p) => str(p.name)), existingProducts).adding
    );
    if (!productLimit.ok) return liveLimitResponse(productLimit);

    for (const year of initiativeUsageAfterWipe({ wipeYear, existingByYear, newByYear })) {
      const initiativeLimit = evaluateLiveLimit(
        limitCtx, LIMIT_KEYS.MAX_INITIATIVES, year.used, year.adding, { year: year.year }
      );
      if (!initiativeLimit.ok) return liveLimitResponse(initiativeLimit);
    }

    /**
     * plan_regenerations: a monthly counter (checkEntitlement), checked here
     * and recorded only after the rebuild succeeds.
     */
    let regenPeriod: { periodStart: string; periodEnd: string } | null = null;
    if (isRebuild) {
      const regen = await checkEntitlement(db, companyId, LIMIT_KEYS.PLAN_REGENERATIONS);
      if (!regen.ok) {
        return NextResponse.json(
          {
            error: regen.message,
            code: regen.code,
            message: regen.message,
            limitKey: LIMIT_KEYS.PLAN_REGENERATIONS,
            limit: regen.limit?.limit ?? null,
            upgradeUrl: UPGRADE_URL,
          },
          { status: statusForCode(regen.code) }
        );
      }
      regenPeriod = regen.period;
    }

    /* ---- Clear what a previous build left behind ---- */

    /**
     * REBUILDING REPLACES; IT DOES NOT ADD.
     *
     * This route used to be purely additive, and running the intake twice
     * stacked a second plan on top of the first. One account ended up with the
     * same product four times over and ten initiatives in a five-initiative
     * plan, with `webinar` appearing three times — because "Start from
     * Scratch" never called a reset and this endpoint never pruned.
     *
     * Done HERE rather than when the user clicks Regenerate, because this is
     * the single commit point. Clearing on the click would destroy a working
     * plan the moment someone opened the intake and then abandoned it halfway.
     *
     * Everything is snapshotted first, so a rebuild is recoverable from
     * Plan History rather than being a one-way door.
     */
    const wiped = await clearPreviousPlan(db, companyId, planStart);

    if (!wiped.ok) {
      return NextResponse.json(
        {
          error:
            "We could not clear your previous plan, so nothing has been " +
            "changed. Please try again.",
          detail: wiped.error,
        },
        { status: 500 }
      );
    }

    /* ---- Products ---- */

    /**
     * REUSED BY NAME, never blindly re-inserted.
     *
     * `initiatives.product_id` is `NOT NULL REFERENCES products(id) ON DELETE
     * RESTRICT`, so products cannot simply be deleted and recreated — any
     * initiative we keep still points at the existing row. Matching on name and
     * updating is what `generate-plan` already does, for the same reason, and
     * this route never received that fix.
     *
     * Case- and whitespace-insensitive, because "Executive Coaching" and
     * "executive coaching " are the same product to everyone except a string
     * comparison.
     */
    const productIdByIntakeId = new Map<string, string>();

    const productIdByName = new Map<string, string>();
    for (const row of existingProducts) {
      const key = row.name.trim().toLowerCase();
      // First wins, so an account that already accumulated duplicates settles
      // on one of them instead of picking a different row on every rebuild.
      if (!productIdByName.has(key)) productIdByName.set(key, row.id);
    }

    for (const [index, product] of intakeProducts.entries()) {
      const name = str(product.name);
      // An unnamed product card was never filled in; carrying it through would
      // put "Product 3" in the customer's live product list.
      if (!name) continue;

      const fields = {
        name,
        price: num(product.average_price) ?? 0,
        // Both of these are TRANSLATED, not passed through: `products` has
        // CHECK constraints from migration 001 with a different vocabulary to
        // the intake's, so a raw value is rejected by the database.
        revenue_type: toRevenueType(product.payment_type),
        ticket_tier: toTicketTier(product.price_level),
        display_order: index,
        is_active: true,
      };

      const existingId = productIdByName.get(name.trim().toLowerCase());
      let liveId: string | null = null;

      if (existingId) {
        const { error } = await db
          .from("products")
          .update(fields)
          .eq("id", existingId)
          .eq("company_id", companyId);

        if (error) {
          console.error("[intake/build] product update failed:", error.message);
          return NextResponse.json(
            { error: error.message || "Could not update your products." },
            { status: 500 }
          );
        }
        liveId = existingId;
      } else {
        const { data: created, error } = await db
          .from("products")
          .insert({ company_id: companyId, ...fields })
          .select("id")
          .single();

        if (error || !created) {
          console.error("[intake/build] product insert failed:", error?.message);
          return NextResponse.json(
            { error: error?.message || "Could not create your products." },
            { status: 500 }
          );
        }
        liveId = created.id as string;
        productIdByName.set(name.trim().toLowerCase(), liveId);
      }

      const intakeId = str(product.id);
      if (intakeId && liveId) productIdByIntakeId.set(intakeId, liveId);
    }

    /* ---- Initiatives ---- */

    /** Intake product ids -> the live ids just written. */
    const liveProductIds = (intakeIds: readonly string[]): string[] =>
      intakeIds
        .map((id) => productIdByIntakeId.get(id))
        .filter((id): id is string => Boolean(id));

    // Nothing may be dated before today, including tasks.
    const floor = toDateOnly(new Date());
    let initiativeCount = 0;

    for (const [index, item] of pending.entries()) {
      const slot = scheduled[index];
      const resolved = templatesByKey.get(item.libraryKey);

      const ok = await insertInitiative(db, {
        companyId,
        libraryKey: item.libraryKey,
        name: item.name,
        activationDate: toDateOnly(slot.activationDate),
        eventDate: toDateOnly(slot.eventDate),
        productIds: liveProductIds(item.intakeProductIds),
        displayOrder: item.displayOrder,
        revenue: item.revenue,
        kind: item.kind,
        repeatFrequency: item.repeatFrequency,
        typeSource: typeSourceFor(item.libraryKey),
        typeCache,
        // Every format and every optional metric: the intake asks no metric
        // questions. Null when the library row has no metrics.
        metricSet: item.libraryKey === SOMETHING_ELSE_KEY
          ? null
          : defaultLibraryMetricSet(item.libraryKey, libraryByKey.get(item.libraryKey)),
        /**
         * Always a real task list now. `resolveTaskTemplates` guarantees a
         * source for every key — workbook template, AI-written, or the generic
         * starter — so this can no longer save an initiative with no tasks,
         * which is what happened to every library key the workbook has no
         * template for (about 73 of them).
         *
         * Same date handling whichever source it came from: counted back from
         * the event, floored at today.
         */
        tasks: materialiseTasks(resolved?.templates ?? [], {
          eventDate: slot.eventDate,
          floor,
        }),
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

    // A rebuild that actually replaced a plan spends one regeneration — only
    // now that it has succeeded. recordUsage never throws.
    if (regenPeriod && wiped.deleted > 0) {
      await recordUsage(db, companyId, LIMIT_KEYS.PLAN_REGENERATIONS, regenPeriod);
    }

    /**
     * GoHighLevel: BOTH milestones, because this one route is both of them.
     *
     * This is the intake's single commit point AND the only way a customer
     * gets a plan in the current product — onboarding sends them to
     * /intake/start and the intake commits here (see onboarding/welcome), and
     * /api/generate-plan has no caller in the UI at all any more. Firing only
     * `finished intake` would mean no customer ever receives
     * `plan generated`, and the client's workflow for it would be dead.
     *
     * ONE-SHOT PER COMPANY, which is what makes it safe to fire both from a
     * route that is also the REBUILD path (it meters plan_regenerations, so
     * rebuilding is expected). The dedupe key is scoped to the company, so a
     * rebuild reports `duplicate` and writes nothing — the client's onboarding
     * email is not re-sent to a customer who tidied up their plan. See
     * producers/milestone.ts.
     *
     * AFTER EVERYTHING IS COMMITTED, AND WRAPPED, deliberately. The plan is on
     * disk, the lifecycle is stamped and the regeneration is metered by this
     * point, and the build may have spent an Anthropic call on task lists. A
     * throw here would report a finished plan as a 500 and the customer would
     * press the button again — spending the tokens twice for a marketing tag.
     * `enqueueMilestoneEvent` never throws by contract; the catch is for the
     * contract being wrong.
     *
     * Attributed to the company OWNER even when a member clicked. Deliberate
     * — only the owner is a GHL contact. The producer explains why.
     */
    try {
      for (const milestone of ["finished_intake", "plan_generated"] as const) {
        await enqueueMilestoneEvent(db, {
          milestone,
          companyId,
          userId: user.id,
          source: "intake_build",
          context: {
            initiativeCount,
            productCount: productIdByIntakeId.size,
            // Counts already in hand; nothing here costs a query.
            rebuild: wiped.deleted > 0,
          },
        });
      }
    } catch (err: unknown) {
      console.error(
        "[intake/build] GHL milestone enqueue failed (plan is already built):",
        err instanceof Error ? err.message : String(err)
      );
    }

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
 * Clearing a previous build
 * ------------------------------------------------------------------ */

/**
 * Remove the initiatives a previous build created for the plan year, so a
 * rebuild REPLACES rather than stacks.
 *
 * WHY THE WHOLE YEAR AND NOT JUST `planned` ROWS. The owner's instruction was
 * to clear existing initiatives on regenerate, and a half-clear is what
 * produced the reported state in the first place: `reset-scratch` pruned only
 * untouched rows, so anything the user had started survived and the new set
 * landed beside it. Scoped to the plan year, so a rebuild of next year cannot
 * touch this year's work.
 *
 * SNAPSHOT FIRST, ALWAYS. This deletes initiatives together with their tasks,
 * results and expenses — real execution history, not just scaffolding. The
 * snapshot is written before anything is removed and is the documented way
 * back, exactly as `/api/plan/reset` does it. If the snapshot cannot be
 * written the whole operation aborts and nothing is deleted.
 *
 * PRODUCTS ARE DELIBERATELY NOT TOUCHED. `initiatives.product_id` is
 * `ON DELETE RESTRICT`, and the caller reuses products by name instead — see
 * the products section above.
 */
async function clearPreviousPlan(
  db: SupabaseClient,
  companyId: string,
  planStart: string
): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  const year = Number(planStart.slice(0, 4)) || new Date().getUTCFullYear();

  const { data: plan } = await db
    .from("annual_plans")
    .select("id")
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();

  // No plan row yet means this is a first build: nothing to clear.
  if (!plan?.id) return { ok: true, deleted: 0 };

  const planId = plan.id as string;

  const { data: existing, error: loadError } = await db
    .from("initiatives")
    .select("id")
    .eq("annual_plan_id", planId);

  if (loadError) {
    return { ok: false, error: `could not read existing initiatives: ${loadError.message}` };
  }

  const ids = (existing ?? []).map((row) => row.id as string);
  if (ids.length === 0) return { ok: true, deleted: 0 };

  /* ---- Snapshot, before anything is destroyed ---- */

  try {
    const [
      { data: initiativesFull },
      { data: tasksFull },
      { data: projectionsFull },
      { data: resultsFull },
      { data: expensesFull },
      { data: annualPlanFull },
    ] = await Promise.all([
      db.from("initiatives").select("*").eq("annual_plan_id", planId),
      db.from("tasks").select("*").in("initiative_id", ids),
      db.from("projections").select("*").eq("annual_plan_id", planId),
      db.from("results").select("*").in("initiative_id", ids),
      db.from("expenses").select("*").in("initiative_id", ids),
      db.from("annual_plans").select("*").eq("id", planId).maybeSingle(),
    ]);

    const { count } = await db
      .from("plan_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId);

    const { error: snapshotError } = await db.from("plan_snapshots").insert({
      company_id: companyId,
      label: `Plan v${(count ?? 0) + 1} (before rebuilding ${year} from the intake)`,
      snapshot: {
        annualPlan: annualPlanFull ?? null,
        initiatives: initiativesFull ?? [],
        tasks: tasksFull ?? [],
        projections: projectionsFull ?? [],
        results: resultsFull ?? [],
        expenses: expensesFull ?? [],
        // Products are needed to restore initiatives (product_id is NOT NULL).
        products: await snapshotProducts(db, companyId),
        snapshotDate: new Date().toISOString(),
      },
    });

    /**
     * ABORTS on a failed snapshot, unlike reset-scratch which treats it as
     * non-fatal. That route only ever deleted untouched work; this one can
     * remove results, so losing the only copy is not an acceptable outcome of
     * a button labelled "regenerate".
     */
    if (snapshotError) {
      return { ok: false, error: `snapshot failed: ${snapshotError.message}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `snapshot failed: ${message}` };
  }

  /* ---- Delete children first, then the initiatives ---- */

  // `tasks` cascades on initiative delete, but results and expenses also
  // reference initiatives; clearing them explicitly keeps the order obvious
  // rather than relying on which constraints happen to cascade.
  for (const table of ["results", "expenses", "tasks"] as const) {
    const { error } = await db.from(table).delete().in("initiative_id", ids);
    if (error) {
      return { ok: false, error: `could not clear ${table}: ${error.message}` };
    }
  }

  const { error: deleteError } = await db.from("initiatives").delete().in("id", ids);
  if (deleteError) {
    return { ok: false, error: `could not clear initiatives: ${deleteError.message}` };
  }

  console.log(
    "[intake/build] cleared", ids.length,
    "initiative(s) from the", year, "plan before rebuilding (snapshot taken)"
  );

  return { ok: true, deleted: ids.length };
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
    /** one-time / recurring / evergreen, from the user's cadence answer. */
    kind: InitiativeKind;
    /** weekly / monthly / quarterly, or null when it does not repeat. */
    repeatFrequency: RepeatFrequency | null;
    /** Library fields for a type that has to be created; null if not in the library. */
    typeSource: TypeSource | null;
    /** Shared across the whole build so a repeated key resolves once. */
    typeCache: Map<string, string>;
    /** Stored on every product row (migration 040); null for none. */
    metricSet: InitiativeMetricSet | null;
  }
): Promise<boolean> {
  // Filed under the EVENT's year, not the activation year: an initiative
  // prepared in December and run in January belongs to January's plan.
  const annualPlanId = await resolveAnnualPlan(db, args.companyId, args.eventDate);
  if (!annualPlanId) {
    console.error("[intake/build] no annual plan for", args.companyId);
    return false;
  }

  const typeId = await resolveInitiativeTypeId(
    supabaseTypeStore(db, "[intake/build]"),
    args.libraryKey,
    args.typeSource,
    args.typeCache
  );
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
    // `library_key` (migration 040) rides along; omitted if the column is absent.
    const { data: created, error } = await insertWithLibraryKey(
      {
        company_id: args.companyId,
        annual_plan_id: annualPlanId,
        product_id: productId,
        initiative_type_id: typeId,
        name: args.name,
        description: "",
        kind: args.kind,
        /**
         * Migration 036. Recorded so "recurring" means something actionable —
         * without a frequency it is a word, not a schedule.
         *
         * `event_date` below is still a SINGLE date: this marks the initiative
         * as repeating and says how often, but does not generate a row per
         * occurrence. See recurring_templates (migration 001) for the
         * occurrence model, which is specified but not implemented.
         */
        repeat_frequency: args.repeatFrequency,
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
      },
      args.libraryKey === SOMETHING_ELSE_KEY ? null : args.libraryKey,
      (row) => db.from("initiatives").insert(row).select("id").single(),
      args.metricSet
    );

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

/**
 * Scheduling runway for one resolved initiative.
 *
 * The workbook's authored lead times where there are any; the starter
 * template's fixed runway otherwise (see the comment at the call site for why
 * AI lead times are deliberately not consulted here).
 */
function runwayFor(resolved: ResolvedTemplates | undefined): number {
  if (resolved && resolved.source === "template") return templateRunwayDays(resolved.templates);
  return runwayForUntemplated();
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
