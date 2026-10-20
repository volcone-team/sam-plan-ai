import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { logActivity } from "@/lib/activity-log";
import {
  IMPERSONATION_MARKER_COOKIE,
  IMPERSONATION_RETURN_COOKIE,
  verifyImpersonationMarker,
  verifyImpersonationReturn,
} from "@/lib/admin/impersonation";

export const runtime = "nodejs";

/**
 * POST /api/admin/impersonate/exit
 *
 * Puts the admin back in their own account and ends impersonation.
 *
 * AUTHORIZATION is the signed, httpOnly return ticket itself — not
 * `requireSuperAdmin`. This is deliberate and it is not a weakening: by the
 * time this runs, the SESSION belongs to the customer, so an is_admin check on
 * the session user would refuse the very admin who needs to get out. The
 * ticket is HMAC-signed with a server-only secret and was issued to this
 * browser by the start endpoint, so holding it is proof of having started this
 * impersonation. Nothing in it grants access to anything except returning to
 * the account named inside it.
 *
 * This route is exempted from the "/api/admin is blocked while impersonating"
 * rule (see `IMPERSONATION_EXIT_PATH`) for the same reason.
 *
 * THE ONE INVARIANT: this endpoint must NEVER leave the browser signed in as
 * the customer. Every path below either installs the admin's session or clears
 * the session entirely — there is no branch that returns with the customer's
 * cookies intact.
 *
 * Responses:
 *   200 { ok: true, restored: true }                 admin session is back
 *   200 { ok: true, restored: false, redirectTo }    signed out, must log in
 */
export async function POST() {
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

  /**
   * Give up and leave NOBODY signed in.
   *
   * `scope: 'local'` is important. A global sign-out would revoke the
   * CUSTOMER's refresh tokens on all of their own devices — punishing the
   * customer for an admin's failed exit. Local clears only this browser's
   * cookies, which is exactly what is wanted.
   */
  async function bailToLogin(reason: string) {
    try {
      await sessionClient.auth.signOut({ scope: "local" });
    } catch {
      // Cookie deletion below is the real guarantee; a failed network
      // sign-out must not stop us clearing this browser.
    }

    const response = NextResponse.json({
      ok: true,
      restored: false,
      reason,
      redirectTo: "/auth/login?notice=impersonation_ended",
      message:
        "Impersonation ended, but your own session could not be restored. " +
        "Please sign in again.",
    });
    clearImpersonationCookies(response);
    // Belt and braces: drop the Supabase auth cookies by name too, in case the
    // sign-out above could not write them.
    for (const cookie of cookieStore.getAll()) {
      if (cookie.name.startsWith("sb-")) {
        response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
      }
    }
    return response;
  }

  try {
    const returnTicket = await verifyImpersonationReturn(
      cookieStore.get(IMPERSONATION_RETURN_COOKIE)?.value ?? null
    );

    // Read the marker purely for the audit row; it is not authorization.
    const marker = await verifyImpersonationMarker(
      cookieStore.get(IMPERSONATION_MARKER_COOKIE)?.value ?? null
    );

    if (!returnTicket) {
      /*
       * No usable ticket: never issued, tampered with, or cleared. We cannot
       * know who to restore, so the only safe end state is signed out.
       */
      console.log("[impersonate/exit] No valid return ticket — signing out");
      return bailToLogin("no_return_ticket");
    }

    /**
     * RESTORE. `refreshSession({ refresh_token })` exchanges the admin's
     * refresh token for a fresh session and writes their auth cookies back,
     * replacing the customer's. Chosen over `setSession` because we only ever
     * stored a refresh token — deliberately, since storing the admin's access
     * token as well would put a live bearer credential in a second cookie for
     * no benefit.
     */
    const { data, error } = await sessionClient.auth.refreshSession({
      refresh_token: returnTicket.refreshToken,
    });

    if (error || !data.session) {
      /*
       * The token no longer works — expired, rotated by activity in another
       * tab, or revoked. Requirement 4's explicit instruction: clear
       * everything and send them to login.
       */
      console.log("[impersonate/exit] Refresh failed:", error?.message ?? "no session returned");
      return bailToLogin("refresh_failed");
    }

    /*
     * Sanity check: the restored session must be the admin named in the
     * ticket. If the auth server somehow returned someone else, sign out
     * rather than hand over an unexpected account.
     */
    if (data.session.user.id !== returnTicket.adminUserId) {
      console.error("[impersonate/exit] Restored user does not match ticket — signing out");
      return bailToLogin("identity_mismatch");
    }

    await logActivity(
      {
        actorUserId: returnTicket.adminUserId,
        actorEmail: returnTicket.adminEmail || data.session.user.email || null,
        action: "admin.impersonation_ended",
        targetType: "company",
        targetId: marker?.companyId ?? null,
        targetLabel: marker?.companyName ?? null,
        companyId: marker?.companyId ?? null,
        metadata: {
          target_user_id: marker?.targetUserId ?? null,
          admin_user_id: returnTicket.adminUserId,
          started_at: marker ? new Date(marker.startedAt).toISOString() : null,
          ended_at: new Date().toISOString(),
          expired: marker ? marker.expiresAt <= Date.now() : null,
        },
      },
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
    );

    console.log("[impersonate/exit] Restored admin:", data.session.user.email);

    const response = NextResponse.json({
      ok: true,
      restored: true,
      redirectTo: "/admin/companies",
    });
    clearImpersonationCookies(response);
    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[impersonate/exit] Error:", message);
    /*
     * Even an unexpected throw must not leave the customer's session in place.
     * Failing closed here means "signed out", not "still the customer".
     */
    return bailToLogin("error");
  }
}

/** Expire both impersonation cookies. Same path they were set with. */
function clearImpersonationCookies(response: NextResponse) {
  for (const name of [IMPERSONATION_RETURN_COOKIE, IMPERSONATION_MARKER_COOKIE]) {
    response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
}
