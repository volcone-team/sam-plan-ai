import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureSubscriptionRow } from "./subscription-row";

/**
 * Complimentary access ("comp"): a super admin grants a plan with no payment.
 *
 * Shared by POST /api/admin/subscribers (action 'comp') and the "Grant full
 * access" option on POST /api/admin/companies/create, so both write exactly
 * the same fields and enforce the same refusal.
 */

export const DEFAULT_COMP_REASON = "Granted by super admin";

export interface CompInput {
  planId: string;
  /** ISO timestamp, or null for no expiry. */
  until: string | null;
  reason: string;
}

export type ParsedCompInput =
  | { ok: true; value: CompInput }
  | { ok: false; error: "planId" | "until" };

/**
 * Validate the comp fields. Pure.
 *
 * `until` blank or absent means no expiry; anything else must parse as a date.
 * `reason` is trimmed, capped at 300 characters, and defaults when blank.
 */
export function parseCompInput(raw: {
  planId?: unknown;
  until?: unknown;
  reason?: unknown;
}): ParsedCompInput {
  if (typeof raw.planId !== "string" || !raw.planId.trim()) {
    return { ok: false, error: "planId" };
  }

  let until: string | null = null;
  if (typeof raw.until === "string" && raw.until.trim()) {
    const t = new Date(raw.until).getTime();
    if (!Number.isFinite(t)) return { ok: false, error: "until" };
    until = new Date(t).toISOString();
  } else if (raw.until !== undefined && raw.until !== null && typeof raw.until !== "string") {
    return { ok: false, error: "until" };
  }

  const reason =
    typeof raw.reason === "string" && raw.reason.trim()
      ? raw.reason.trim().slice(0, 300)
      : DEFAULT_COMP_REASON;

  return { ok: true, value: { planId: raw.planId.trim(), until, reason } };
}

export type ParsedCreateGrant =
  | { ok: true; grant: null }
  | { ok: true; grant: CompInput }
  | { ok: false; error: "grantAccess" | "planId" | "until" };

/**
 * The optional grant fields on the admin create request. Pure.
 *
 * Body: { grantAccess?: boolean, planId?: string, compUntil?: string|null,
 *         compReason?: string }
 *
 * Absent or false → no grant, the route behaves as it always did. Anything
 * other than a boolean is refused rather than coerced: "false" as a string is
 * truthy, and guessing would grant access nobody asked for.
 */
export function parseCreateGrant(body: Record<string, unknown>): ParsedCreateGrant {
  const flag = body.grantAccess;
  if (flag === undefined || flag === null || flag === false) {
    return { ok: true, grant: null };
  }
  if (flag !== true) return { ok: false, error: "grantAccess" };

  const parsed = parseCompInput({
    planId: body.planId,
    until: body.compUntil,
    reason: body.compReason,
  });
  if (!parsed.ok) return parsed;
  return { ok: true, grant: parsed.value };
}

/** Admin-facing wording for a refused grant field on the create request. */
export function createGrantErrorMessage(
  error: "grantAccess" | "planId" | "until"
): string {
  switch (error) {
    case "planId":
      return "Choose a plan to grant access to.";
    case "until":
      return "The access end date is not a valid date.";
    default:
      return "grantAccess must be true or false.";
  }
}

export type ApplyCompResult =
  | { ok: true; until: string | null; rowCreated: boolean }
  | { ok: false; status: number; error: string; message?: string };

/**
 * Comp a company. Ensures the subscriptions row exists first, so a company
 * created without one (the admin create route, before this fix) can be
 * granted access instead of the update silently matching nothing.
 */
export async function applyComp(
  db: SupabaseClient,
  args: { companyId: string; actorUserId: string; input: CompInput; now?: Date }
): Promise<ApplyCompResult> {
  const { companyId, actorUserId, input } = args;
  const now = (args.now ?? new Date()).toISOString();

  const ensured = await ensureSubscriptionRow(db, companyId);
  if (!ensured.ok) {
    return { ok: false, status: 500, error: ensured.error };
  }

  /**
   * Refuse to comp a PAYING customer.
   *
   * Enforced here and not only by hiding the button, because a hidden button
   * is not a control. Comping an active subscriber would grant free access
   * while Stripe keeps charging their card, and would also corrupt the comped
   * flag — which is how "who is not paying" is answered.
   */
  const { data: existing } = await db
    .from("subscriptions")
    .select("stripe_subscription_id, stripe_status")
    .eq("company_id", companyId)
    .maybeSingle();

  if (
    existing?.stripe_subscription_id &&
    ["active", "trialing", "past_due"].includes(existing.stripe_status ?? "")
  ) {
    return {
      ok: false,
      status: 400,
      error: "has_paid_subscription",
      message:
        "This account has an active paid subscription. Cancel it in Stripe " +
        "before granting complimentary access.",
    };
  }

  const { data: updated, error } = await db
    .from("subscriptions")
    .update({
      is_comped: true,
      comped_until: input.until,
      comped_reason: input.reason,
      comped_by: actorUserId,
      plan_id: input.planId,
      updated_at: now,
    })
    .eq("company_id", companyId)
    .select("id");

  if (error) return { ok: false, status: 500, error: error.message };
  if (!Array.isArray(updated) || updated.length === 0) {
    return { ok: false, status: 500, error: "no_subscription_row" };
  }

  return { ok: true, until: input.until, rowCreated: ensured.created };
}
