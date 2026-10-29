import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import { isMissingColumnError } from "@/lib/supabase/missing-column";
import { sendPortalUnlockedEmail } from "@/lib/access/portal-unlock-email";
import { loadCallGateSettings } from "@/lib/access/call-gate-settings";
import {
  decidePortalAccessChange,
  derivePortalAccessState,
  portalAccessPatch,
  type PortalAccessCompany,
} from "@/lib/access/portal-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/companies/[id]/portal-access — open or re-close one
 * company's portal after the onboarding call (migration 043).
 *
 * Body: { action: 'grant' | 'revoke' }
 *
 * SUPER-ADMIN ONLY, matching /api/admin/subscribers and
 * /api/admin/subscribers/pause: this is the same family of "decide whether a
 * paying customer can use the product" actions, not day-to-day admin. Note the
 * neighbouring /api/admin/companies routes check `is_admin` inline instead;
 * `requireSuperAdmin` is the newer house helper and the stricter of the two,
 * which is the right direction for an access grant.
 *
 * THE GLOBAL SWITCH IS NOT CONSULTED. Whether a company is gated was decided
 * when it was created (`stampCallUnlockForNewCompany`), so an admin must still
 * be able to open an account that is waiting after the switch has been turned
 * off again — those customers are already behind the door.
 *
 * THE EMAIL IS NOT PART OF THE GRANT. It is sent after the write, best effort,
 * and its failure is reported rather than raised: the door is already open by
 * then, and failing the request would invite the admin to click again, which
 * is the one thing that could double-send.
 *
 * Responses:
 *   200 { ok, outcome, state, grantedAt, email? }
 *   400 { error: 'bad_action' | 'body' }
 *   401/403 — not a super admin
 *   404 { error } — no such company
 *   409 { error: 'not_gated' } — the company was never behind the gate
 *   409 { error: 'migration_required' } — migration 043 not applied
 */

function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Same body and reasoning as the sibling route's, so the UI can share the copy. */
const MIGRATION_REQUIRED = {
  error: "migration_required",
  migration: "043_call_before_access",
  message:
    "Migration 043 (043_call_before_access.sql) has not been applied to this " +
    "database yet, so portal access cannot be recorded. Run it in the " +
    "Supabase SQL editor, then reload this page.",
} as const;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const { id } = await params;

    let body: { action?: unknown } = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      return NextResponse.json({ error: "body" }, { status: 400 });
    }

    const db = adminClient();

    /*
     * The gate columns are named explicitly rather than taken from `*`, so an
     * unapplied 043 surfaces as a missing-column error here instead of as a row
     * that silently lacks the fields and reads as "never gated" — which would
     * turn every grant into a confusing 409 not_gated.
     */
    const { data, error: readError } = await db
      .from("companies")
      .select(
        "id, name, requires_call_unlock, portal_access_granted_at, portal_access_granted_by"
      )
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      if (isMissingColumnError(readError)) {
        return NextResponse.json(MIGRATION_REQUIRED, { status: 409 });
      }
      console.error("[admin/portal-access] Company read failed:", readError.message);
      return NextResponse.json({ error: readError.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const company = data as PortalAccessCompany & { id: string; name: string | null };

    // The global switch decides how an undecided company reads (waiting / open).
    const { requireCall } = await loadCallGateSettings(db);
    const decision = decidePortalAccessChange({
      action: typeof body.action === "string" ? body.action : "",
      company,
      requireCall,
    });

    if (!decision.ok) {
      return NextResponse.json(
        { error: decision.error, message: decision.message },
        { status: decision.status }
      );
    }

    // Nothing to do. Reported as a success with the outcome naming why, so the
    // admin is told "already open" rather than shown an error for a click that
    // asked for the state the company is already in.
    if (!decision.write) {
      return NextResponse.json({
        ok: true,
        outcome: decision.outcome,
        state: derivePortalAccessState(company, { requireCall }),
        grantedAt: company.portal_access_granted_at ?? null,
      });
    }

    const now = new Date().toISOString();
    const patch = portalAccessPatch(decision.outcome, check.userId, now);

    /*
     * The grant re-asserts "not yet granted" in the WHERE and asks which rows
     * it touched. Two admins on the call list at once would otherwise both
     * write a timestamp (moving the audit trail to the later click) and both
     * email the customer. An empty result means somebody got there first, and
     * is reported as `already_granted` — the truth, and not an error.
     */
    let query = db.from("companies").update(patch).eq("id", id);
    if (decision.outcome === "granted") {
      query = query.is("portal_access_granted_at", null);
    }

    const { data: updated, error: writeError } = await query.select("id");

    if (writeError) {
      if (isMissingColumnError(writeError)) {
        return NextResponse.json(MIGRATION_REQUIRED, { status: 409 });
      }
      console.error("[admin/portal-access] Update failed:", writeError.message);
      return NextResponse.json({ error: writeError.message }, { status: 500 });
    }

    if (!updated?.length) {
      return NextResponse.json({
        ok: true,
        outcome: "already_granted",
        state: "open",
        grantedAt: company.portal_access_granted_at ?? null,
      });
    }

    /*
     * The owner, not every member. The gate is about the person who paid and
     * attended the call; mailing a whole team that one of them had a call is
     * noise, and team members are not individually gated anyway.
     */
    let email: { attempted: boolean; sent: boolean; error?: string } | undefined;

    if (decision.notify) {
      const { data: owner } = await db
        .from("profiles")
        .select("email, first_name")
        .eq("company_id", id)
        .eq("role", "owner")
        .maybeSingle();

      const to = (owner as { email?: string | null } | null)?.email ?? null;

      if (!to) {
        // Possible: an admin-created company whose owner invite never landed,
        // or a company whose owner row was deleted. The grant stands; the admin
        // is told to tell them by hand.
        email = { attempted: false, sent: false, error: "no_owner_email" };
      } else {
        const result = await sendPortalUnlockedEmail({
          to,
          firstName: (owner as { first_name?: string | null } | null)?.first_name ?? null,
          companyName: company.name ?? null,
        });
        email = { attempted: true, sent: result.sent, error: result.error };
      }
    }

    const { data: actor } = await db
      .from("profiles")
      .select("email")
      .eq("id", check.userId)
      .maybeSingle();

    await logActivity(
      {
        companyId: id,
        actorUserId: check.userId,
        actorEmail: (actor as { email?: string } | null)?.email ?? null,
        action:
          decision.outcome === "granted"
            ? "company.portal_access_granted"
            : "company.portal_access_revoked",
        targetType: "company",
        targetId: id,
        targetLabel: company.name ?? null,
        // Whether the customer was actually TOLD is recorded, not just that the
        // grant happened: a silent grant leaves a paid account sitting idle,
        // and this is the only place that fact survives.
        metadata: {
          outcome: decision.outcome,
          emailSent: email?.sent ?? null,
          emailError: email?.error ?? null,
        },
      },
      db
    );

    console.log(
      "[admin/portal-access]", decision.outcome, "company", id,
      "| email sent:", email?.sent ?? "n/a"
    );

    return NextResponse.json({
      ok: true,
      outcome: decision.outcome,
      state: decision.outcome === "granted" ? "open" : "waiting",
      grantedAt: decision.outcome === "granted" ? now : null,
      email,
    });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/portal-access] Error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
