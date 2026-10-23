import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Every company must have exactly one `subscriptions` row.
 *
 * The signup trigger (handle_new_user, last restated in migration 037) inserts
 * it. Any path that creates a company WITHOUT that trigger owning it — the
 * admin create route inserts its own company and deletes the trigger's — ends
 * up with no row, and then every writer that does
 * `.update(...).eq("company_id", id)` silently matches nothing: Checkout
 * cannot store the customer id, the webhook cannot record a payment, and the
 * admin table hides "Grant access".
 *
 * THE DEFAULT ROW IS THE TRIGGER'S TRIALS-OFF ROW, never a trial. An admin or
 * repair path must not hand out free time by accident; a trial is a signup
 * decision. With trials off the trigger writes:
 *
 *   status 'cancelled', billing_cycle 'monthly', plan_id NULL,
 *   is_trial_active FALSE, trial_ends_at NULL, start_date NOW()
 *
 * which evaluateAccess reads as no access (cancelled → canceled → denied).
 *
 * `tier` is 'none' — the trigger's own fallback when no plan resolves. With
 * trials off it would otherwise copy the trial plan's name, which is
 * display-only and misleading on a row that has bought nothing.
 */
export function defaultSubscriptionRow(companyId: string, now: Date = new Date()) {
  const iso = now.toISOString();
  return {
    company_id: companyId,
    tier: "none",
    status: "cancelled",
    billing_cycle: "monthly",
    plan_id: null,
    is_trial_active: false,
    trial_ends_at: null,
    start_date: iso,
  };
}

export type EnsureResult =
  | { ok: true; created: boolean }
  | { ok: false; error: string };

/**
 * Insert the default row if the company has none. NEVER OVERWRITES.
 *
 * `subscriptions.company_id` is UNIQUE (migration 001), so this is
 * INSERT ... ON CONFLICT (company_id) DO NOTHING via an upsert with
 * `ignoreDuplicates`. That is race-free: a row written between any read and
 * this write is left exactly as it was. The returned rows tell us whether
 * anything was inserted (one row) or the row already existed (none).
 */
export async function ensureSubscriptionRow(
  db: SupabaseClient,
  companyId: string
): Promise<EnsureResult> {
  if (!companyId) return { ok: false, error: "companyId required" };
  const { data, error } = await db
    .from("subscriptions")
    .upsert(defaultSubscriptionRow(companyId), {
      onConflict: "company_id",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) return { ok: false, error: error.message };
  return { ok: true, created: Array.isArray(data) && data.length > 0 };
}

/**
 * What the webhook does after its subscription update.
 *
 * `matched` is the number of rows the update touched (counted with
 * `.select("id")`). Zero means the company has no row: ensure it and retry
 * ONCE. Still zero after the retry means something else is wrong, and the
 * caller logs it with the company and event ids rather than looping.
 */
export type UpdateFollowUp = "done" | "ensure_and_retry" | "give_up";

export function afterSubscriptionUpdate(matched: number, attempt: 1 | 2): UpdateFollowUp {
  if (matched > 0) return "done";
  return attempt === 1 ? "ensure_and_retry" : "give_up";
}
