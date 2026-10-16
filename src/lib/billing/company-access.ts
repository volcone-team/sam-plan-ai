import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBillingConfig } from "./stripe-client";
import { evaluateAccess, type AccessDecision } from "./entitlement";

/**
 * Read a company's subscription and decide access — the shared first half of
 * `checkEntitlement` (./enforce), extracted unchanged so features that only
 * need "which plan, and is access allowed" (e.g. SAM University) reuse the
 * exact same select and the exact same `evaluateAccess` call rather than a
 * near-copy that could drift.
 *
 * Server-only. Pass a service-role client: `subscriptions` and `app_settings`
 * are read without relying on the caller's RLS.
 */

/** The `subscriptions` columns read for an access decision. */
export interface CompanySubscriptionRow {
  plan_id: string | null;
  status: string | null;
  stripe_status: string | null;
  is_comped: boolean;
  comped_until: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  past_due_since: string | null;
  cancel_at_period_end: boolean;
  is_paused: boolean | null;
  pause_resumes_at: string | null;
}

export const COMPANY_SUBSCRIPTION_SELECT =
  "plan_id, status, stripe_status, is_comped, comped_until, trial_ends_at, " +
  "current_period_start, current_period_end, past_due_since, cancel_at_period_end, " +
  "is_paused, pause_resumes_at";

/**
 * The subscription row (or `null`) and the access decision for `companyId`.
 * A `null` companyId skips the query and evaluates as "no subscription"
 * (which still resolves to allowed when billing is switched off).
 */
export async function loadSubscriptionAccess(
  db: SupabaseClient,
  companyId: string | null
): Promise<{ row: CompanySubscriptionRow | null; access: AccessDecision }> {
  const config = await loadBillingConfig(db);

  const { data: sub } = companyId
    ? await db
        .from("subscriptions")
        .select(COMPANY_SUBSCRIPTION_SELECT)
        .eq("company_id", companyId)
        .maybeSingle()
    : { data: null };

  const row = sub as CompanySubscriptionRow | null;

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
          isPaused: row.is_paused ?? false,
          pauseResumesAt: row.pause_resumes_at,
        }
      : null
  );

  return { row, access };
}

/**
 * Which plan a company is on, and whether it may use the product.
 *
 * `planId` is `subscriptions.plan_id` as stored — comp and trial write it too.
 * It is returned even when `access.allowed` is false; callers that gate on the
 * plan must check `access` as well (see `UniversityViewer`).
 */
export async function loadCompanyAccess(
  db: SupabaseClient,
  companyId: string | null
): Promise<{ planId: string | null; access: AccessDecision }> {
  const { row, access } = await loadSubscriptionAccess(db, companyId);
  return { planId: row?.plan_id ?? null, access };
}
