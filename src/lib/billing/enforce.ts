import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadBillingConfig } from "./stripe-client";
import { evaluateAccess, type AccessDecision } from "./entitlement";
import { checkLimit, resolveUsagePeriod, LIMIT_KEYS, type LimitCheck } from "./limits";

/**
 * Server-side enforcement: the bridge between billing state and paid features.
 *
 * Until now `plan_limits` (migration 004) has been data nothing read, so every
 * account had unlimited AI generations — which cost real money per call. This is
 * what finally reads it.
 *
 * TWO SEPARATE QUESTIONS, deliberately kept apart:
 *   1. May this company use the product at all?   -> access (subscription state)
 *   2. Have they used up this feature's allowance? -> limit (plan_limits + usage)
 *
 * A past-due customer inside their grace window passes (1) and should still be
 * subject to (2); a healthy subscriber who has burned their monthly generations
 * fails (2) while passing (1). Collapsing them into one boolean would produce
 * misleading errors in both directions.
 */

export interface EnforcementResult {
  ok: boolean;
  /** Present when access itself was refused. */
  access: AccessDecision;
  /** Present when a specific limit was checked. */
  limit: LimitCheck | null;
  /** Stable machine code for the client to branch on. */
  code:
    | "ok"
    | "no_subscription"
    | "trial_expired"
    | "past_due"
    | "canceled"
    | "comp_expired"
    | "incomplete"
    | "limit_reached"
    | "not_included";
  message: string;
  /** Echoed back so a route can increment the same period it checked. */
  period: { periodStart: string; periodEnd: string };
}

export function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Map an access refusal onto a response code and a message a user can act on. */
function accessFailure(access: AccessDecision): { code: EnforcementResult["code"]; message: string } {
  switch (access.reason) {
    case "no_subscription":
      return { code: "no_subscription", message: "This account does not have an active subscription." };
    case "trial_expired":
      return { code: "trial_expired", message: "Your free trial has ended. Choose a plan to continue." };
    case "past_due_expired":
      return { code: "past_due", message: "Your last payment failed. Update your card to restore access." };
    case "comp_expired":
      return { code: "comp_expired", message: "Your complimentary access has ended." };
    case "canceled":
      return { code: "canceled", message: "Your subscription has been cancelled." };
    default:
      return { code: "incomplete", message: "Your subscription is not active yet." };
  }
}

/**
 * Check whether `companyId` may consume `limitKey` right now.
 *
 * Does NOT record usage — callers increment only after the work succeeds, so a
 * failed generation does not burn an allowance the customer never received.
 */
export async function checkEntitlement(
  db: SupabaseClient,
  companyId: string | null,
  limitKey: string,
  requested = 1
): Promise<EnforcementResult> {
  const config = await loadBillingConfig(db);

  const { data: sub } = companyId
    ? await db
        .from("subscriptions")
        .select(
          "plan_id, status, stripe_status, is_comped, comped_until, trial_ends_at, " +
          "current_period_start, current_period_end, past_due_since, cancel_at_period_end"
        )
        .eq("company_id", companyId)
        .maybeSingle()
    : { data: null };

  const row = sub as {
    plan_id: string | null; status: string | null; stripe_status: string | null;
    is_comped: boolean; comped_until: string | null; trial_ends_at: string | null;
    current_period_start: string | null; current_period_end: string | null;
    past_due_since: string | null; cancel_at_period_end: boolean;
  } | null;

  const access = evaluateAccess(
    {
      stripeEnabled: config.stripeEnabled,
      trialEnabled: config.trialEnabled,
      trialDays: config.trialDays,
      dunningGraceDays: config.dunningGraceDays,
    },
    row
      ? {
          status: (row.stripe_status ?? row.status) as never,
          isComped: row.is_comped,
          compedUntil: row.comped_until,
          trialEndsAt: row.trial_ends_at,
          currentPeriodEnd: row.current_period_end,
          pastDueSince: row.past_due_since,
          cancelAtPeriodEnd: row.cancel_at_period_end,
        }
      : null
  );

  const period = resolveUsagePeriod(
    row?.current_period_start ?? null,
    row?.current_period_end ?? null
  );

  if (!access.allowed) {
    const failure = accessFailure(access);
    return { ok: false, access, limit: null, ...failure, period };
  }

  // Billing disabled: the app is open, so limits are not enforced either. Gating
  // usage while nobody can pay would restrict the product for no revenue.
  if (access.reason === "billing_disabled") {
    return {
      ok: true, access, limit: null, code: "ok", message: "",
      period,
    };
  }

  /**
   * A trial is NOT special-cased. It restricts by DAYS only (handled above by
   * evaluateAccess) and otherwise grants the limits of the trial plan — Starter —
   * through the same plan_limits lookup below as any paying customer. A separate
   * trial initiative cap was tried and removed: it added a second place for
   * limits to live and drift, when "a trial is just time-boxed Starter" is both
   * simpler and what was wanted.
   */

  // No company means no plan to read limits from. Allowed rather than blocked:
  // this is a data-shape problem, not a billing decision, and blocking would
  // break the product for an account that has merely lost its company link.
  if (!companyId || !row?.plan_id) {
    if (companyId && !row?.plan_id) {
      console.warn("[enforce] No plan_id for company", companyId, "— limits not enforced");
    }
    return { ok: true, access, limit: null, code: "ok", message: "", period };
  }

  const [{ data: limitRow }, { data: usageRow }] = await Promise.all([
    db
      .from("plan_limits")
      .select("limit_value, limit_label")
      .eq("plan_id", row.plan_id)
      .eq("limit_key", limitKey)
      .maybeSingle(),
    db
      .from("usage_counters")
      .select("used")
      .eq("company_id", companyId)
      .eq("limit_key", limitKey)
      .eq("period_start", period.periodStart)
      .maybeSingle(),
  ]);

  const limit = checkLimit(
    (limitRow?.limit_value as number) ?? null,
    (usageRow?.used as number) ?? 0,
    requested
  );

  if (!limit.allowed) {
    const label = (limitRow?.limit_label as string) ?? limitKey;
    return {
      ok: false,
      access,
      limit,
      code: limit.notIncluded ? "not_included" : "limit_reached",
      message: limit.notIncluded
        ? `${label} is not included in your plan. Upgrade to use it.`
        : `You have used all ${limit.limit} of your ${label} for this billing period.`,
      period,
    };
  }

  return { ok: true, access, limit, code: "ok", message: "", period };
}

/**
 * Record consumption AFTER the work succeeded.
 *
 * Uses the atomic increment_usage() function from migration 022 rather than a
 * read-then-write, which would race between two concurrent generations and let a
 * company exceed its cap.
 *
 * Never throws: metering must not turn a successful generation into an error
 * response. A lost increment is a smaller problem than a failed feature.
 */
export async function recordUsage(
  db: SupabaseClient,
  companyId: string | null,
  limitKey: string,
  period: { periodStart: string; periodEnd: string },
  amount = 1
): Promise<void> {
  if (!companyId) return;
  try {
    const { error } = await db.rpc("increment_usage", {
      p_company_id: companyId,
      p_limit_key: limitKey,
      p_period_start: period.periodStart,
      p_period_end: period.periodEnd,
      p_amount: amount,
    });
    if (error) {
      console.error("[enforce] increment_usage failed:", error.message);
    }
  } catch (err: unknown) {
    console.error(
      "[enforce] increment_usage threw:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/** HTTP status for an enforcement failure. */
export function statusForCode(code: EnforcementResult["code"]): number {
  switch (code) {
    case "limit_reached":
      return 429; // retryable next period
    case "not_included":
      return 403; // needs a different plan
    default:
      return 402; // Payment Required: billing state blocks this
  }
}
