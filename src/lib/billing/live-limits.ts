import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { loadSubscriptionAccess } from "./company-access";
import { accessFailure, statusForCode, type EnforcementResult } from "./enforce";
import { checkLimit, LIMIT_KEYS } from "./limits";
import { UPGRADE_URL } from "./limit-notice";

/**
 * LIVE-COUNT plan limits: initiatives, products and team members.
 *
 * `checkEntitlement` (./enforce) meters things that are CONSUMED per billing
 * period (AI uses, regenerations) through `usage_counters`. These three are
 * different: they are things the account HOLDS, so the figure that matters is
 * how many rows exist right now. Deleting one frees a slot; nothing resets
 * monthly. A counter would drift the moment anything is deleted, so the rows
 * are counted instead.
 *
 * SAME DECISIONS AS checkEntitlement, deliberately:
 *   - access refused (trial over, past due, paused, …) refuses with the same
 *     code and words (`accessFailure`);
 *   - billing switched off enforces nothing;
 *   - no plan on the subscription enforces nothing (a data problem, not a
 *     billing decision);
 *   - a missing plan_limits row is unlimited, -1 is unlimited, 0 is "not
 *     included" (`checkLimit`);
 *   - super admins get no special treatment: limits belong to the COMPANY,
 *     and checkEntitlement does not exempt anyone either.
 *
 * Adding nothing is always allowed. An account that is already over a limit
 * (it was downgraded, or predates enforcement) keeps everything it has and is
 * only stopped from adding more.
 */

export type LiveLimitKey =
  | typeof LIMIT_KEYS.MAX_INITIATIVES
  | typeof LIMIT_KEYS.MAX_PRODUCTS
  | typeof LIMIT_KEYS.MAX_USERS;

export const LIVE_LIMIT_KEYS: readonly LiveLimitKey[] = [
  LIMIT_KEYS.MAX_INITIATIVES,
  LIMIT_KEYS.MAX_PRODUCTS,
  LIMIT_KEYS.MAX_USERS,
];

export function isLiveLimitKey(key: string): key is LiveLimitKey {
  return (LIVE_LIMIT_KEYS as readonly string[]).includes(key);
}

/** Everything about the plan a live check needs, read once per request. */
export interface LiveLimitContext {
  /** Set when access itself is refused. */
  refusal: { code: EnforcementResult["code"]; message: string } | null;
  /** False when billing is off or there is no plan: nothing is enforced. */
  enforced: boolean;
  planName: string | null;
  /** Raw `limit_value` per key; absent (or null) = no row = unlimited. */
  limits: Partial<Record<LiveLimitKey, number | null>>;
}

export interface LiveLimitResult {
  ok: boolean;
  code: EnforcementResult["code"];
  key: LiveLimitKey;
  /** null when unlimited or not enforced. 0 when not included. */
  limit: number | null;
  used: number;
  adding: number;
  /** null when unlimited or not enforced. */
  remaining: number | null;
  /** Empty when ok. */
  message: string;
}

/* ------------------------------------------------------------------ *
 * Pure parts
 * ------------------------------------------------------------------ */

const NOUNS: Record<LiveLimitKey, { one: string; many: string }> = {
  max_initiatives: { one: "initiative", many: "initiatives" },
  max_products: { one: "product", many: "products" },
  max_users: { one: "user", many: "users" },
};

function counted(n: number, key: LiveLimitKey): string {
  const noun = NOUNS[key];
  return `${n} ${n === 1 ? noun.one : noun.many}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The message for a refusal. Names the plan and the number, and says what to
 * do about it: "Your Starter plan allows 2 products. Upgrade to add more."
 */
export function liveLimitMessage(args: {
  key: LiveLimitKey;
  planName: string | null;
  limit: number;
  used: number;
  adding: number;
  notIncluded: boolean;
  /** For initiatives: the plan year being counted. */
  year?: number | null;
}): string {
  const plan = args.planName ? `Your ${args.planName} plan` : "Your plan";
  const noun = NOUNS[args.key];
  const where =
    args.key === "max_initiatives" && args.year ? ` in your ${args.year} plan` : "";

  if (args.notIncluded) {
    return `${capitalise(noun.many)} are not included in ${plan.charAt(0).toLowerCase()}${plan.slice(1)}. Upgrade to add them.`;
  }

  const allows = `${plan} allows ${counted(args.limit, args.key)}${where}.`;
  const remaining = Math.max(0, args.limit - args.used);

  // Asking for several when only some are left: say how many fit.
  if (args.adding > 1 && remaining > 0) {
    return (
      `${allows} You have ${args.used}, so only ${remaining} more can be added ` +
      `and this needs ${args.adding}. Upgrade to add more.`
    );
  }

  if (args.key === "max_users") {
    return `${allows} Upgrade to add more team members.`;
  }
  return `${allows} Upgrade to add more.`;
}

/**
 * Decide one live limit. `used` is what exists now (after anything the caller
 * is about to delete), `adding` is how many this request would create.
 */
export function evaluateLiveLimit(
  ctx: LiveLimitContext,
  key: LiveLimitKey,
  used: number,
  adding: number,
  opts: { year?: number | null } = {}
): LiveLimitResult {
  const usedSafe = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;
  const addingSafe = Number.isFinite(adding) && adding > 0 ? Math.floor(adding) : 0;
  const base = { key, used: usedSafe, adding: addingSafe };

  if (ctx.refusal) {
    return {
      ...base, ok: false, code: ctx.refusal.code, message: ctx.refusal.message,
      limit: null, remaining: null,
    };
  }

  if (!ctx.enforced) {
    return { ...base, ok: true, code: "ok", message: "", limit: null, remaining: null };
  }

  const check = checkLimit(ctx.limits[key] ?? null, usedSafe, Math.max(addingSafe, 1));
  const limit = check.unlimited ? null : check.limit;
  const remaining = check.unlimited ? null : check.remaining;

  // Nothing new: always fine, even over the limit or on a plan without it.
  if (addingSafe === 0 || check.unlimited) {
    return { ...base, ok: true, code: "ok", message: "", limit, remaining };
  }

  // checkLimit was asked for at least 1; re-test against the real number.
  const allowed = !check.notIncluded && (check.remaining ?? 0) >= addingSafe;
  if (allowed) {
    return { ...base, ok: true, code: "ok", message: "", limit, remaining };
  }

  return {
    ...base,
    ok: false,
    code: check.notIncluded ? "not_included" : "limit_reached",
    message: liveLimitMessage({
      key,
      planName: ctx.planName,
      limit: check.limit,
      used: usedSafe,
      adding: addingSafe,
      notIncluded: check.notIncluded,
      year: opts.year ?? null,
    }),
    limit,
    remaining,
  };
}

/** HTTP status for a live-limit refusal. */
export function liveLimitStatus(code: EnforcementResult["code"]): number {
  // 402, not checkEntitlement's 429: a held count does not reset next period,
  // so "too many requests, retry later" would be untrue.
  if (code === "limit_reached") return 402;
  return statusForCode(code);
}

/** The JSON body a refused request answers with. `error` carries the words. */
export function liveLimitBody(result: LiveLimitResult) {
  return {
    error: result.message,
    code: result.code,
    message: result.message,
    limitKey: result.key,
    limit: result.limit,
    used: result.used,
    adding: result.adding,
    upgradeUrl: UPGRADE_URL,
  };
}

export function liveLimitResponse(result: LiveLimitResult): NextResponse {
  return NextResponse.json(liveLimitBody(result), { status: liveLimitStatus(result.code) });
}

/** Lower-cased, trimmed: the product-name match every create path uses. */
export function productNameKey(name: unknown): string {
  return String(name ?? "").trim().toLowerCase();
}

/**
 * How many ACTIVE products a set of names would add, given what exists.
 *
 * Mirrors the reuse-by-name rule in intake build and generate-plan: a name
 * that matches an existing product (case/whitespace-insensitive, first match
 * wins) is reused, not created. Two candidates with the same name create one.
 * A reused product that is currently inactive is switched back on by those
 * routes, so it adds to the active count too (`reactivated`).
 */
export function productAdditions(
  candidateNames: readonly (string | null | undefined)[],
  existing: readonly { name: string; is_active?: boolean | null }[],
  opts: { reactivates?: boolean } = {}
): { created: number; reactivated: number; adding: number } {
  const reactivates = opts.reactivates ?? true;
  const firstByName = new Map<string, { active: boolean }>();
  for (const row of existing) {
    const key = productNameKey(row.name);
    if (!firstByName.has(key)) firstByName.set(key, { active: row.is_active !== false });
  }

  const seen = new Set<string>();
  let created = 0;
  let reactivated = 0;

  for (const name of candidateNames) {
    if (typeof name !== "string" || name.trim() === "") continue;
    const key = productNameKey(name);
    if (seen.has(key)) continue;
    seen.add(key);

    const match = firstByName.get(key);
    if (!match) created += 1;
    else if (reactivates && !match.active) reactivated += 1;
  }

  return { created, reactivated, adding: created + reactivated };
}

/**
 * Initiatives per plan year once a rebuild has wiped `wipeYear`.
 *
 * Intake build deletes every initiative in the year it rebuilds (snapshot
 * first), so that year starts from 0; any other year it spills into keeps
 * what it has. `newByYear` is how many initiative ROWS the build inserts per
 * year (one per product the initiative sells).
 */
export function initiativeUsageAfterWipe(args: {
  wipeYear: number | null;
  existingByYear: ReadonlyMap<number, number>;
  newByYear: ReadonlyMap<number, number>;
}): { year: number; used: number; adding: number }[] {
  return [...args.newByYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, adding]) => ({
      year,
      used: year === args.wipeYear ? 0 : args.existingByYear.get(year) ?? 0,
      adding,
    }));
}

/* ------------------------------------------------------------------ *
 * Database parts
 * ------------------------------------------------------------------ */

/** Read the plan and its live limits for `companyId`. Service-role client. */
export async function loadLiveLimitContext(
  db: SupabaseClient,
  companyId: string | null
): Promise<LiveLimitContext> {
  const { row, access } = await loadSubscriptionAccess(db, companyId);

  if (!access.allowed) {
    return { refusal: accessFailure(access), enforced: false, planName: null, limits: {} };
  }
  if (access.reason === "billing_disabled") {
    return { refusal: null, enforced: false, planName: null, limits: {} };
  }
  if (!companyId || !row?.plan_id) {
    if (companyId) {
      console.warn("[live-limits] No plan_id for company", companyId, "— limits not enforced");
    }
    return { refusal: null, enforced: false, planName: null, limits: {} };
  }

  const [{ data: limitRows }, { data: plan }] = await Promise.all([
    db
      .from("plan_limits")
      .select("limit_key, limit_value")
      .eq("plan_id", row.plan_id)
      .in("limit_key", [...LIVE_LIMIT_KEYS]),
    db.from("subscription_plans").select("name").eq("id", row.plan_id).maybeSingle(),
  ]);

  const limits: Partial<Record<LiveLimitKey, number | null>> = {};
  for (const r of (limitRows ?? []) as { limit_key: string; limit_value: number | null }[]) {
    if (isLiveLimitKey(r.limit_key)) limits[r.limit_key] = r.limit_value;
  }

  return {
    refusal: null,
    enforced: true,
    planName: typeof plan?.name === "string" ? plan.name : null,
    limits,
  };
}

/**
 * The live count for one key.
 *   max_initiatives: rows in one annual plan (a recurring initiative is one row)
 *   max_products:    the company's ACTIVE products
 *   max_users:       every profile in the company (owner, members, viewers,
 *                    and invites not yet accepted — an invite is a profile)
 *
 * Throws on a read error: guessing 0 would let an account past its limit.
 */
export async function countLiveUsage(
  db: SupabaseClient,
  companyId: string,
  key: LiveLimitKey,
  scope?: { annualPlanId: string | null }
): Promise<number> {
  let query;
  if (key === "max_initiatives") {
    if (!scope) throw new Error("countLiveUsage: max_initiatives needs an annual plan scope");
    // No plan row yet: nothing in it.
    if (!scope.annualPlanId) return 0;
    query = db
      .from("initiatives")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("annual_plan_id", scope.annualPlanId);
  } else if (key === "max_products") {
    query = db
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("is_active", true);
  } else {
    query = db
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId);
  }

  const { count, error } = await query;
  if (error) throw new Error(`could not count ${key}: ${error.message}`);
  return count ?? 0;
}

/**
 * The one-call check: may `companyId` add `adding` more of `key`?
 * `scope.annualPlanId` is required for initiatives (the plan year counted);
 * `scope.year` only improves the message.
 */
export async function checkLiveLimit(
  db: SupabaseClient,
  companyId: string,
  key: LiveLimitKey,
  adding: number,
  scope?: { annualPlanId: string | null; year?: number | null },
  ctx?: LiveLimitContext
): Promise<LiveLimitResult> {
  const context = ctx ?? (await loadLiveLimitContext(db, companyId));
  // Nothing to count when the answer cannot depend on it.
  const used =
    context.refusal || !context.enforced
      ? 0
      : await countLiveUsage(db, companyId, key, scope);
  return evaluateLiveLimit(context, key, used, adding, { year: scope?.year ?? null });
}
