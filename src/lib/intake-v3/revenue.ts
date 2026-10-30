/**
 * Revenue scenarios for the Initiative Intake (v3).
 *
 * Turns one initiative's answers into Good / Better / Best revenue, in one of
 * three ways, and rolls a set of initiatives up against the company's annual
 * Baseline and Stretch targets.
 *
 *   Goal mode     The user types one number. Better and Best are fixed
 *                 multiples of it — EXACTLY the arithmetic of
 *                 src/components/initiatives/add-initiative-panel.tsx, so the
 *                 two forms can never show different figures for one target.
 *   Metrics mode  Three funnels, one per scenario, each through
 *                 `forecastPerRun`. A funnel that cannot forecast makes THAT
 *                 scenario unavailable — never a confident $0.
 *   Revenue lines The record's RevenueLines (library-config.ts), each priced
 *                 and windowed from the user's answers. A line that cannot be
 *                 resolved is REPORTED, never dropped: a silently missing VIP
 *                 line is a forecast that is just quietly low.
 *
 * The `leads` conversion path earns nothing by definition (the leads are
 * handed on), so it has no revenue and no target, and counts as 0 in the
 * roll-up rather than being excluded from it.
 *
 * PURE AND TOTAL. No React, no database, no network. Nothing here throws:
 * every outcome that could fail is a discriminated result.
 */

import { forecastPerRun, type InitiativeFunnel } from "../intake-forecast";
import type { ConversionPath, NamedDate, PriceSource, RevenueLine } from "./library-config";

/* ------------------------------------------------------------------ *
 * Shared shapes
 * ------------------------------------------------------------------ */

export type ScenarioId = "good" | "better" | "best";

export const SCENARIOS: readonly ScenarioId[] = Object.freeze(["good", "better", "best"]);

/** Three plain numbers: every scenario known. */
export interface ScenarioTriple {
  good: number;
  better: number;
  best: number;
}

/** One scenario's value where a scenario may be missing. */
export type ScenarioValue =
  | { status: "available"; revenue: number }
  | { status: "unavailable"; reason: string };

/* ------------------------------------------------------------------ *
 * 1. Goal mode
 * ------------------------------------------------------------------ */

/**
 * Better = Good + 10%, Best = Good + 20% (client, Oct 2026; Best was +25%).
 * Applied as `Math.round(good * 1.1)` everywhere, so every form rounds the
 * same way. These are suggestions: the forms fill them in and the user may
 * overwrite either.
 */
export const BETTER_MULTIPLIER = 1.1;
export const BEST_MULTIPLIER = 1.2;

/** The suggested Better figure for a Good figure. */
export function autoBetter(good: number): number {
  return Math.round(good * BETTER_MULTIPLIER);
}

/** The suggested Best figure for a Good figure. */
export function autoBest(good: number): number {
  return Math.round(good * BEST_MULTIPLIER);
}

export type GoalScenariosResult =
  | { ok: true; scenarios: ScenarioTriple }
  | { ok: false; reason: "missing" | "invalid"; message: string };

/**
 * Good = the entered figure, unrounded (the panel does not round it);
 * Better = Math.round(good * 1.1); Best = Math.round(good * 1.2).
 *
 * Strings are read with `parseFloat`, as the panel reads its input. Blank or
 * absent is `missing`; non-numeric or negative is `invalid`. Zero is a valid
 * (if unambitious) target and gives 0 / 0 / 0.
 */
export function goalScenarios(entered: number | string | null | undefined): GoalScenariosResult {
  if (entered === null || entered === undefined || (typeof entered === "string" && entered.trim() === "")) {
    return { ok: false, reason: "missing", message: "No revenue target was entered." };
  }
  const good = typeof entered === "string" ? parseFloat(entered) : entered;
  if (!Number.isFinite(good) || good < 0) {
    return { ok: false, reason: "invalid", message: `"${String(entered)}" is not a usable revenue target.` };
  }
  return {
    ok: true,
    scenarios: {
      good,
      better: Math.round(good * BETTER_MULTIPLIER),
      best: Math.round(good * BEST_MULTIPLIER),
    },
  };
}

/* ------------------------------------------------------------------ *
 * 2. Metrics mode
 * ------------------------------------------------------------------ */

/**
 * Metrics mode needs a library record's funnel stages and benchmarks; a custom
 * initiative has neither, so it is goal mode only.
 */
export const metricsModeAvailable = (initiative: { isCustom: boolean }): boolean =>
  !initiative.isCustom;

export type MetricsFunnels = Readonly<Record<ScenarioId, InitiativeFunnel>>;

export type MetricsScenariosResult =
  | { ok: true; good: ScenarioValue; better: ScenarioValue; best: ScenarioValue }
  | { ok: false; reason: "custom_initiative"; message: string };

/**
 * One `forecastPerRun` per scenario. Per RUN, unrounded: multiplying by runs
 * and rounding for display are the caller's.
 */
export function metricsScenarios(
  funnels: MetricsFunnels,
  initiative: { isCustom: boolean }
): MetricsScenariosResult {
  if (!metricsModeAvailable(initiative)) {
    return {
      ok: false,
      reason: "custom_initiative",
      message: "Metrics mode is not available for a custom initiative; enter a revenue goal instead.",
    };
  }
  const one = (id: ScenarioId): ScenarioValue => {
    const revenue = forecastPerRun(funnels[id]);
    return revenue === null
      ? {
          status: "unavailable",
          reason: `The ${id} funnel is incomplete (audience, price or a conversion rate is missing).`,
        }
      : { status: "available", revenue };
  };
  return { ok: true, good: one("good"), better: one("better"), best: one("best") };
}

/* ------------------------------------------------------------------ *
 * 3. Revenue lines
 * ------------------------------------------------------------------ */

/**
 * What the revenue lines read from the user's answers. Keys mirror the
 * PriceSource spellings so the mapping is obvious.
 *
 * `units` is the expected number of sales per line, keyed by RevenueLine.id
 * (IMPLICIT_LINE_ID for the implicit line). A line's target is price x units.
 */
export interface RevenueAnswers {
  product?: { price?: number | null } | null;
  attrs?: { entry_price?: number | null } | null;
  host_fee?: number | null;
  /** ISO dates (YYYY-MM-DD or full ISO), by name. */
  dates?: Readonly<Partial<Record<NamedDate, string | null>>>;
  /** When the initiative starts producing; opens the implicit line. */
  activation_date?: string | null;
  units?: Readonly<Record<string, number | null | undefined>>;
}

/** The id of the line synthesised when a record declares none. */
export const IMPLICIT_LINE_ID = "implicit";

/** The implicit line's window opens on the activation date, not a NamedDate. */
export type WindowDateName = NamedDate | "activation_date";

export type UnresolvedReason =
  | "missing_price"
  | "missing_window_opens"
  | "missing_window_closes"
  | "window_inverted"
  | "missing_units";

export interface ResolvedRevenueLine {
  status: "resolved";
  id: string;
  implicit: boolean;
  priceSource: PriceSource;
  price: number;
  units: number;
  /** price x units. Unrounded. */
  target: number;
  window: {
    opens: { name: WindowDateName; date: string };
    closes: { name: WindowDateName; date: string };
  };
  condition?: string;
}

export interface UnresolvedRevenueLine {
  status: "unresolved";
  id: string;
  implicit: boolean;
  priceSource: PriceSource;
  reason: UnresolvedReason;
  message: string;
  condition?: string;
}

export type RevenueLineOutcome = ResolvedRevenueLine | UnresolvedRevenueLine;

export interface RevenueLinesResult {
  /** Every line, in config order. Unresolved lines are here, not dropped. */
  lines: readonly RevenueLineOutcome[];
  /** Sum of resolved targets only. */
  total: number;
  /** good = total; better/best by the goal-mode multipliers. */
  scenarios: ScenarioTriple;
  /** False when any line is unresolved: the total is then a lower bound. */
  complete: boolean;
  unresolvedCount: number;
}

/** A positive finite price, or null. Zero is not a price. */
function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function resolvePrice(source: PriceSource, answers: RevenueAnswers): number | null {
  switch (source) {
    case "product.price":
      return positive(answers.product?.price);
    case "attrs.entry_price":
      return positive(answers.attrs?.entry_price);
    case "host_fee":
      return positive(answers.host_fee);
  }
}

/** A parseable date string, or null. */
function validDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function dateFor(name: WindowDateName, answers: RevenueAnswers): string | null {
  return validDate(name === "activation_date" ? answers.activation_date : answers.dates?.[name]);
}

/** Internal line shape: the implicit line's window opens on activation_date. */
interface LineSpec {
  id: string;
  implicit: boolean;
  priceSource: PriceSource;
  windowOpens: WindowDateName;
  windowCloses: WindowDateName;
  condition?: string;
}

function resolveLine(spec: LineSpec, answers: RevenueAnswers): RevenueLineOutcome {
  const base = {
    id: spec.id,
    implicit: spec.implicit,
    priceSource: spec.priceSource,
    ...(spec.condition !== undefined ? { condition: spec.condition } : {}),
  };
  const fail = (reason: UnresolvedReason, message: string): UnresolvedRevenueLine => ({
    status: "unresolved",
    ...base,
    reason,
    message,
  });

  const price = resolvePrice(spec.priceSource, answers);
  if (price === null) return fail("missing_price", `No price for ${spec.priceSource}.`);

  const opens = dateFor(spec.windowOpens, answers);
  if (opens === null) return fail("missing_window_opens", `No ${spec.windowOpens} date.`);
  const closes = dateFor(spec.windowCloses, answers);
  if (closes === null) return fail("missing_window_closes", `No ${spec.windowCloses} date.`);
  if (Date.parse(opens) > Date.parse(closes)) {
    return fail(
      "window_inverted",
      `${spec.windowOpens} (${opens}) is after ${spec.windowCloses} (${closes}).`
    );
  }

  const rawUnits = answers.units?.[spec.id];
  const units =
    typeof rawUnits === "number" && Number.isFinite(rawUnits) && rawUnits >= 0 ? rawUnits : null;
  if (units === null) return fail("missing_units", `No expected sales for line "${spec.id}".`);

  return {
    status: "resolved",
    ...base,
    price,
    units,
    target: price * units,
    window: {
      opens: { name: spec.windowOpens, date: opens },
      closes: { name: spec.windowCloses, date: closes },
    },
  };
}

/**
 * Resolve every revenue line and total them.
 *
 * ZERO LINES IS NOT ZERO REVENUE: one implicit line is synthesised at the
 * linked product's price over activation_date -> close_date.
 */
export function resolveRevenueLines(
  lines: readonly RevenueLine[],
  answers: RevenueAnswers
): RevenueLinesResult {
  const specs: LineSpec[] =
    lines.length === 0
      ? [
          {
            id: IMPLICIT_LINE_ID,
            implicit: true,
            priceSource: "product.price",
            windowOpens: "activation_date",
            windowCloses: "close_date",
          },
        ]
      : lines.map((l) => ({
          id: l.id,
          implicit: false,
          priceSource: l.priceSource,
          windowOpens: l.windowOpens,
          windowCloses: l.windowCloses,
          condition: l.condition,
        }));

  const outcomes = specs.map((s) => resolveLine(s, answers));
  const total = outcomes.reduce((sum, o) => (o.status === "resolved" ? sum + o.target : sum), 0);
  const unresolvedCount = outcomes.filter((o) => o.status === "unresolved").length;
  // total is always finite and >= 0, so goal-mode arithmetic cannot refuse it.
  const goal = goalScenarios(total);
  const scenarios = goal.ok ? goal.scenarios : { good: 0, better: 0, best: 0 };

  return { lines: outcomes, total, scenarios, complete: unresolvedCount === 0, unresolvedCount };
}

/* ------------------------------------------------------------------ *
 * 4. Leads path
 * ------------------------------------------------------------------ */

export interface LeadsRevenue {
  kind: "leads";
  revenue: null;
  target: null;
}

/** The leads path collects and hands on; it earns nothing itself. */
export const isLeadsPath = (path: ConversionPath | null | undefined): boolean => path === "leads";

export const leadsRevenue = (): LeadsRevenue => ({ kind: "leads", revenue: null, target: null });

/* ------------------------------------------------------------------ *
 * 5. Commission
 * ------------------------------------------------------------------ */

export type CommissionRule =
  | { type: "percent"; percent: number }
  | { type: "flat"; perSale: number };

export type CommissionValue =
  | { status: "available"; revenue: number; commission: number; sales: number | null }
  | { status: "unavailable"; reason: string };

export type CommissionResult =
  | { ok: true; good: CommissionValue; better: CommissionValue; best: CommissionValue }
  | { ok: false; reason: "invalid_rule" | "missing_price"; message: string };

/** Cents. */
const toCents = (n: number): number => Math.round(n * 100) / 100;

/**
 * Commission for each scenario.
 *
 *   percent  revenue x percent / 100, rounded to the cent. `sales` is null.
 *   flat     sales = Math.floor(revenue / price + 1e-9); commission =
 *            sales x perSale. WHOLE SALES ONLY, rounded DOWN: commission is
 *            not owed on a sale that did not happen, and goal-mode revenue
 *            (e.g. Better = 1.1 x Good) is rarely an exact multiple of the
 *            price. The 1e-9 absorbs float error so that revenue built as
 *            price x units (revenue lines) gives back exactly `units`.
 *
 * An unavailable scenario (metrics mode) stays unavailable; a null input
 * (the leads path) also comes back unavailable, never as $0 commission.
 */
export function commissionForScenarios(
  scenarios: Readonly<Record<ScenarioId, number | ScenarioValue | null>>,
  rule: CommissionRule,
  price?: number | null
): CommissionResult {
  if (rule.type === "percent") {
    if (!Number.isFinite(rule.percent) || rule.percent < 0 || rule.percent > 100) {
      return { ok: false, reason: "invalid_rule", message: "Commission percent must be 0-100." };
    }
  } else if (!Number.isFinite(rule.perSale) || rule.perSale < 0) {
    return { ok: false, reason: "invalid_rule", message: "Flat commission must be 0 or more." };
  }
  const unitPrice = positive(price);
  if (rule.type === "flat" && unitPrice === null) {
    return {
      ok: false,
      reason: "missing_price",
      message: "A flat per-sale commission needs a price to count sales.",
    };
  }

  const one = (id: ScenarioId): CommissionValue => {
    const input = scenarios[id];
    const revenue =
      input === null
        ? null
        : typeof input === "number"
          ? input
          : input.status === "available"
            ? input.revenue
            : null;
    if (revenue === null || !Number.isFinite(revenue) || revenue < 0) {
      return { status: "unavailable", reason: `No ${id} revenue to take commission on.` };
    }
    if (rule.type === "percent") {
      return { status: "available", revenue, commission: toCents((revenue * rule.percent) / 100), sales: null };
    }
    const sales = Math.floor(revenue / (unitPrice as number) + 1e-9);
    return { status: "available", revenue, commission: toCents(sales * rule.perSale), sales };
  };

  return { ok: true, good: one("good"), better: one("better"), best: one("best") };
}

/* ------------------------------------------------------------------ *
 * 6. Roll-up
 * ------------------------------------------------------------------ */

/**
 * One initiative's contribution. `null` on a scenario means it has no figure
 * (leads path, or an unavailable metrics scenario); it counts as 0 and is
 * tallied so the UI can say why.
 */
export interface RollupItem {
  id: string;
  good: number | null;
  best: number | null;
  /** Set for the leads path. */
  leads?: boolean;
}

/** Build a roll-up item from any of the per-initiative results. */
export function rollupItemFrom(
  id: string,
  source: ScenarioTriple | MetricsScenariosResult | RevenueLinesResult | LeadsRevenue
): RollupItem {
  if ("kind" in source) return { id, good: null, best: null, leads: true };
  if ("scenarios" in source) return { id, good: source.scenarios.good, best: source.scenarios.best };
  if ("ok" in source) {
    if (!source.ok) return { id, good: null, best: null };
    const v = (s: ScenarioValue) => (s.status === "available" ? s.revenue : null);
    return { id, good: v(source.good), best: v(source.best) };
  }
  return { id, good: source.good, best: source.best };
}

export type TargetComparison =
  | { status: "no_target"; planned: number }
  | {
      status: "compared";
      target: number;
      planned: number;
      /** Still needed. 0 once covered. */
      gap: number;
      /** Above target. 0 until covered. */
      surplus: number;
      covered: boolean;
    };

export interface RevenueRollup {
  /** Sum of Good vs the Baseline Target. */
  baseline: TargetComparison;
  /**
   * Sum of Best vs the Stretch Target. Better has NO annual counterpart and
   * is deliberately not rolled up.
   */
  stretch: TargetComparison;
  itemCount: number;
  /** Leads-path items, included at 0. */
  leadsCount: number;
  /** Non-leads items with no Good or no Best figure, included at 0. */
  incompleteCount: number;
}

function compare(planned: number, target: number | null | undefined): TargetComparison {
  if (typeof target !== "number" || !Number.isFinite(target) || target <= 0) {
    return { status: "no_target", planned };
  }
  const covered = planned >= target;
  return {
    status: "compared",
    target,
    planned,
    gap: covered ? 0 : target - planned,
    surplus: covered ? planned - target : 0,
    covered,
  };
}

const num = (v: number | null): number => (v !== null && Number.isFinite(v) ? v : 0);

export function rollUpRevenue(args: {
  items: readonly RollupItem[];
  baselineTarget: number | null | undefined;
  stretchTarget: number | null | undefined;
}): RevenueRollup {
  let good = 0;
  let best = 0;
  let leadsCount = 0;
  let incompleteCount = 0;
  for (const item of args.items) {
    if (item.leads) {
      leadsCount += 1;
      continue; // counts as 0, not excluded: it is still in itemCount
    }
    if (item.good === null || item.best === null) incompleteCount += 1;
    good += num(item.good);
    best += num(item.best);
  }
  return {
    baseline: compare(good, args.baselineTarget),
    stretch: compare(best, args.stretchTarget),
    itemCount: args.items.length,
    leadsCount,
    incompleteCount,
  };
}
