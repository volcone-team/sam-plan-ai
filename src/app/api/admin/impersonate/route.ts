import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import { decideImpersonationStart } from "@/lib/admin/impersonation-start";
import {
  IMPERSONATION_MARKER_COOKIE,
  IMPERSONATION_MAX_AGE_SECONDS,
  IMPERSONATION_RETURN_COOKIE,
  impersonationCookieOptions,
  signImpersonationMarker,
  signImpersonationReturn,
} from "@/lib/admin/impersonation";

/**
 * Node runtime, not Edge: this handler needs the service role key and the
 * admin auth API, neither of which belongs on the Edge.
 */
export const runtime = "nodejs";

/**
 * POST /api/admin/impersonate   { companyId }
 *
 * Signs the calling super admin in AS the target company's owner, for real.
 *
 * WHY A REAL SESSION
 * ------------------
 * The previous mechanism only changed which company id client code asked for.
 * Everything server-side still ran as the admin, so writes went to the ADMIN's
 * company and RLS — company-scoped, with no admin read policy on `initiatives`,
 * `products`, `results` or `annual_plans` — returned nothing for most of the
 * screen. Becoming the user is the only approach where every policy, route and
 * write behaves identically to the customer's own experience, which is the
 * entire point of looking.
 *
 * HOW THE SESSION IS MINTED
 * -------------------------
 * `auth.admin.generateLink({ type: 'magiclink' })` followed by
 * `auth.verifyOtp({ token_hash, type: 'magiclink' })`.
 *
 * `auth.admin.createSession()` does NOT exist in the installed
 * @supabase/auth-js (2.112.2) — checked against
 * node_modules/@supabase/auth-js/dist/module/GoTrueAdminApi.d.ts, which
 * exposes `generateLink` but no session-minting method. generateLink returns
 * `properties.hashed_token` WITHOUT sending an email (the email is only sent
 * by `signInWithOtp`/`inviteUserByEmail`), so the customer is never
 * contacted. Verifying that hash server-side on a cookie-writing client
 * exchanges it for a genuine session and writes the Supabase auth cookies.
 *
 * ORDERING IS SECURITY-CRITICAL
 * -----------------------------
 * The admin's return ticket is captured and signed BEFORE verifyOtp replaces
 * the session cookies. Minting first and saving afterwards would mean any
 * failure in between leaves the browser signed in as the customer with no way
 * back.
 *
 * Responses:
 *   200 { ok: true, companyId, companyName, targetEmail, expiresAt }
 *   400 { error: "companyId is required" }
 *   401/403 from requireSuperAdmin
 *   409 { error: "no_owner", message }      company has no owner to become
 *   500 { error: <message> }
 */
export async function POST(request: Request) {
  try {
    // 1. AUTHORIZATION — super admin only, server-side, via the existing helper.
    const auth = await requireSuperAdmin();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    let body: { companyId?: unknown } = {};
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object") body = parsed as { companyId?: unknown };
    } catch {
      body = {};
    }

    const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 2. The company must exist. Read the name now, for the banner and the log.
    const { data: company } = await admin
      .from("companies")
      .select("id, name")
      .eq("id", companyId)
      .maybeSingle();

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    /**
     * 3. WHO THEY BECOME — the company's OWNER, oldest first when there are
     *    several.
     *
     * Scoped to `company_id` AND `role = 'owner'`, so the chosen user can only
     * ever be an owner INSIDE the requested company. Refusing when there is no
     * owner is deliberate: silently falling back to any member, or to the
     * admin's own account, would make the feature lie about whose data is on
     * screen.
     */
    const { data: owners } = await admin
      .from("profiles")
      .select("id, email, created_at")
      .eq("company_id", companyId)
      .eq("role", "owner")
      .order("created_at", { ascending: true });

    /*
     * The role and owner-selection rules live in a pure function so their
     * refusal paths are covered by tests. `requireSuperAdmin` above is still
     * the primary gate; this re-states the same super_admin rule as defence in
     * depth and decides WHICH owner.
     */
    const decision = decideImpersonationStart(auth.adminLevel, company.name, owners);
    if (!decision.ok) {
      console.log("[impersonate] Refused:", company.name, "-", decision.error);
      return NextResponse.json(
        { error: decision.error, message: decision.message },
        { status: decision.status }
      );
    }

    const owner = { id: decision.targetUserId, email: decision.targetEmail };

    // 4. CAPTURE THE WAY BACK, BEFORE touching the session.
    const cookieStore = await cookies();
    const sessionClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {}
          },
        },
      }
    );

    const { data: { session: adminSession } } = await sessionClient.auth.getSession();
    const adminRefreshToken = adminSession?.refresh_token;
    const adminEmail = adminSession?.user?.email ?? null;

    if (!adminRefreshToken) {
      /*
       * No refresh token means no provable way back. Refuse rather than
       * proceed: being unable to return to your own account is worse than
       * being unable to start.
       */
      console.log("[impersonate] Refused: admin session has no refresh token");
      return NextResponse.json(
        {
          error: "no_return_path",
          message: "Could not capture a way back to your own account. Sign in again and retry.",
        },
        { status: 409 }
      );
    }

    const now = Date.now();
    const expiresAt = now + IMPERSONATION_MAX_AGE_SECONDS * 1000;

    const returnCookie = await signImpersonationReturn({
      adminUserId: auth.userId,
      adminEmail: adminEmail ?? "",
      refreshToken: adminRefreshToken,
      expiresAt,
    });

    const markerCookie = await signImpersonationMarker({
      companyId: company.id,
      companyName: company.name,
      adminUserId: auth.userId,
      adminEmail: adminEmail ?? "",
      targetUserId: owner.id,
      targetEmail: owner.email,
      startedAt: now,
      expiresAt,
    });

    /**
     * 5. MINT THE CUSTOMER'S SESSION.
     *
     * `generateLink` sends NO email — it returns the hashed token for us to
     * redeem directly. `verifyOtp` on a cookie-writing client then swaps it
     * for a real session and overwrites the Supabase auth cookies in the
     * response.
     */
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: owner.email,
    });

    const hashedToken = link?.properties?.hashed_token;
    if (linkError || !hashedToken) {
      console.error("[impersonate] generateLink failed:", linkError?.message);
      return NextResponse.json(
        {
          error: "session_mint_failed",
          message: "Could not create a session for that account. Your own session is unchanged.",
        },
        { status: 502 }
      );
    }

    const { error: verifyError } = await sessionClient.auth.verifyOtp({
      token_hash: hashedToken,
      type: "magiclink",
    });

    if (verifyError) {
      console.error("[impersonate] verifyOtp failed:", verifyError.message);
      return NextResponse.json(
        {
          error: "session_mint_failed",
          message: "Could not create a session for that account. Your own session is unchanged.",
        },
        { status: 502 }
      );
    }

    /**
     * 6. AUDIT. After the action succeeded, per the logActivity contract.
     * Never throws, and carries no token or password — only ids and the actor.
     */
    await logActivity(
      {
        actorUserId: auth.userId,
        actorEmail: adminEmail,
        action: "admin.impersonation_started",
        targetType: "company",
        targetId: company.id,
        targetLabel: company.name,
        companyId: company.id,
        metadata: {
          target_user_id: owner.id,
          target_user_email: owner.email,
          admin_user_id: auth.userId,
          expires_at: new Date(expiresAt).toISOString(),
        },
      },
      admin
    );

    console.log("[impersonate] Started:", adminEmail, "->", owner.email, "|", company.name);

    const response = NextResponse.json({
      ok: true,
      companyId: company.id,
      companyName: company.name,
      targetEmail: owner.email,
      expiresAt,
    });

    /*
     * Both cookies expire with the window. The marker is readable so the
     * banner can render it (it holds no credential); the return ticket is
     * httpOnly because it holds the admin's refresh token.
     */
    response.cookies.set(
      IMPERSONATION_RETURN_COOKIE,
      returnCookie,
      impersonationCookieOptions(true, IMPERSONATION_MAX_AGE_SECONDS)
    );
    response.cookies.set(
      IMPERSONATION_MARKER_COOKIE,
      markerCookie,
      impersonationCookieOptions(false, IMPERSONATION_MAX_AGE_SECONDS)
    );

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[impersonate] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
