import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cancelSubscriptionsForCompany } from "@/lib/billing/cancel-on-delete";
import {
  IMPERSONATION_MARKER_COOKIE,
  IMPERSONATION_RETURN_COOKIE,
  verifyImpersonationMarker,
  verifyImpersonationReturn,
} from "@/lib/admin/impersonation";
import {
  resolveImpersonationView,
  type ImpersonationView,
} from "@/lib/admin/impersonation-session";

export const runtime = "nodejs";

/**
 * Is a super admin currently signed in as this customer?
 *
 * SERVER-READ, and that is the whole point. The banner that offers the way
 * back used to decide this by parsing the readable marker cookie in the
 * browser, which failed silently and left admins with no exit. The signal now
 * comes from here, over the same `/api/me` call every page already makes.
 *
 * Both cookies are VERIFIED, not merely decoded: the marker's signature is the
 * reason the middleware is allowed to treat it as satisfying the 2FA gate, so
 * this must never report an unsigned one. A verification failure degrades to
 * "impersonating, details unknown" rather than to "not impersonating" — see
 * resolveImpersonationView.
 *
 * Never throws. An impersonation banner is worth a lot, but not worth taking
 * /api/me down with it: if TWO_FACTOR_SECRET is unset (verify throws by
 * design) every page would 500.
 */
async function readImpersonation(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  sessionUserId: string | null
): Promise<ImpersonationView | null> {
  try {
    const [ticket, marker] = await Promise.all([
      verifyImpersonationReturn(cookieStore.get(IMPERSONATION_RETURN_COOKIE)?.value ?? null),
      verifyImpersonationMarker(cookieStore.get(IMPERSONATION_MARKER_COOKIE)?.value ?? null),
    ]);

    return resolveImpersonationView({ ticket, marker, sessionUserId });
  } catch (err: unknown) {
    console.error(
      "[api/me] Impersonation cookie read failed:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/**
 * GET /api/me
 *
 * Returns the authenticated user's profile.
 *
 * Authenticates via cookies (anon key), then reads the profile with the
 * service role so RLS can never be the reason a user fails to load their
 * own profile. This is the single source of truth for AuthProvider.
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
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
     * Identity — fast path: `getClaims()` VERIFIES the access token's signature
     * (asymmetric ES256 signing keys, verified locally against a cached JWKS),
     * so its claims are authoritative proof of identity. That is why this is
     * safe where `getSession()` would not be: getSession returns cookie
     * contents unverified. Locally verifying costs ~1ms vs the ~324ms network
     * round trip `getUser()` makes to the Auth server.
     */
    let userId: string | null = null;
    let userEmail: string | null = null;
    let userMetadata: Record<string, unknown> | null = null;

    try {
      const { data: claimsData } = await supabase.auth.getClaims();
      const claims = claimsData?.claims;

      if (claims && typeof claims === "object") {
        const sub = (claims as { sub?: unknown }).sub;
        const email = (claims as { email?: unknown }).email;

        if (typeof sub === "string" && sub.length > 0) {
          userId = sub;
          userEmail = typeof email === "string" ? email : null;
        }
      }
    } catch {
      // Fall through to the getUser() path below.
    }

    // Slow path: claims unusable (no session, expired token, unexpected shape).
    // getUser() validates against the Auth server and lets @supabase/ssr write
    // refreshed session cookies.
    if (!userId) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log("[api/me] No session");
        /*
         * Impersonation is reported even with no session. If the customer's
         * session has gone but the admin's return ticket is still here, the
         * banner is the only thing that can spend it — withholding the signal
         * would strand them on a signed-out screen with no way home.
         */
        return NextResponse.json(
          { user: null, impersonation: await readImpersonation(cookieStore, null) },
          { status: 200 }
        );
      }
      userId = user.id;
      userEmail = user.email || null;
      userMetadata = (user.user_metadata as Record<string, unknown> | null) || null;
    }

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: profile, error } = await adminClient
      .from("profiles")
      .select("company_id, first_name, last_name, role, is_active, is_admin, admin_level")
      .eq("id", userId)
      .single();

    const impersonation = await readImpersonation(cookieStore, userId);

    if (error || !profile) {
      console.error("[api/me] Profile missing for", userEmail, error?.message);
      // No profile: report it rather than silently pointing at another company.
      return NextResponse.json({
        impersonation,
        user: {
          id: userId,
          email: userEmail,
          companyId: null,
          firstName: null,
          lastName: null,
          role: null,
          isActive: true,
          isAdmin: false,
          adminLevel: null,
          profileMissing: true,
        },
      });
    }

    // On the claims fast path there is no `user_metadata` object to fall back
    // to; the profile row is the source of truth for names anyway, so the
    // metadata fallbacks simply resolve to null there. The getUser() fallback
    // path keeps the original metadata behavior.
    const meta = userMetadata || {};
    const metaName = (key: string): string | null => {
      const value = meta[key];
      return typeof value === "string" && value.length > 0 ? value : null;
    };

    console.log(
      "[api/me]", userEmail,
      "| company:", profile.company_id,
      "| role:", profile.role,
      "| admin_level:", profile.admin_level,
      "| active:", profile.is_active,
      "| impersonated by:", impersonation ? impersonation.adminEmail || "(unknown admin)" : "no"
    );

    return NextResponse.json({
      impersonation,
      user: {
        id: userId,
        email: userEmail,
        companyId: profile.company_id,
        firstName: profile.first_name || metaName("first_name") || metaName("firstName") || null,
        lastName: profile.last_name || metaName("last_name") || metaName("lastName") || null,
        role: profile.role || null,
        isActive: profile.is_active ?? true,
        isAdmin: profile.is_admin ?? false,
        adminLevel: profile.admin_level ?? null,
        profileMissing: false,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/me] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}

/**
 * DELETE /api/me
 *
 * Self-service account deletion for the authenticated user.
 *
 * Body (JSON, optional): { deleteCompany?: boolean, confirm?: string }
 *
 * Behavior:
 *   - 401 if no session.
 *   - Normal self-delete: requires confirm === "DELETE" or the caller's email,
 *     then hard-deletes the caller's auth user (cascades to their profile).
 *   - deleteCompany === true: caller must be an owner; runs the company cascade
 *     (delete every member auth user, then delete the company row).
 *   - Last-owner guard: an owner who is the ONLY owner and whose company has
 *     OTHER members cannot self-delete without deleting/transferring the company.
 *
 * The client is responsible for calling supabase.auth.signOut() afterward.
 */
export async function DELETE(request: Request) {
  try {
    console.log("[api/me] DELETE account request");

    // Tolerant body parsing — treat empty/missing/invalid body as {}.
    let body: { deleteCompany?: boolean; confirm?: string } = {};
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object") {
        body = parsed as { deleteCompany?: boolean; confirm?: string };
      }
    } catch {
      body = {};
    }
    const deleteCompany = body.deleteCompany === true;
    const confirm = typeof body.confirm === "string" ? body.confirm : undefined;

    // 1. Authenticate via cookies (anon key).
    const cookieStore = await cookies();
    const supabase = createServerClient(
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

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.log("[api/me] DELETE unauthorized (no session)");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const callerEmail = user.email || null;

    // Confirmation helper: accept literal "DELETE" or the caller's own email.
    const confirmOk = confirm === "DELETE" || (!!callerEmail && confirm === callerEmail);

    // 2. Service role client for privileged reads/deletes.
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 3. Read caller's own profile.
    const { data: profile, error: profileErr } = await adminClient
      .from("profiles")
      .select("id, company_id, role")
      .eq("id", user.id)
      .single();

    // profileMissing case: no profile row — just delete the auth user.
    if (profileErr || !profile) {
      console.log("[api/me] DELETE profile missing for", callerEmail, "- deleting auth user only");
      if (!confirmOk) {
        return NextResponse.json({ error: "confirm" }, { status: 400 });
      }
      const { error: delErr } = await adminClient.auth.admin.deleteUser(user.id);
      if (delErr) {
        console.error("[api/me] DELETE auth user error (profileMissing):", delErr.message);
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }
      console.log("[api/me] DELETE account (profileMissing) deleted:", callerEmail);
      return NextResponse.json({ success: true, deleted: "account" });
    }

    const role = profile.role;
    const companyId = profile.company_id;

    // 4. deleteCompany branch — owner-only company cascade.
    if (deleteCompany) {
      if (role !== "owner") {
        console.log("[api/me] DELETE company forbidden — caller role:", role);
        return NextResponse.json(
          { error: "forbidden", message: "Only an owner can delete the company." },
          { status: 403 }
        );
      }
      if (!confirmOk) {
        return NextResponse.json({ error: "confirm" }, { status: 400 });
      }

      /**
       * Cancel Stripe BEFORE the cascade, while the subscription rows still
       * exist to find the customer by.
       *
       * Without this the subscription keeps billing an account that no longer
       * exists, and a later signup reusing the same email could adopt it —
       * reconcile recovers a lost customer link by email address.
       */
      const stripeCancel = await cancelSubscriptionsForCompany(adminClient, companyId);

      // Company cascade: delete every member auth user, then the company row.
      const { data: members } = await adminClient
        .from("profiles")
        .select("id, email")
        .eq("company_id", companyId);

      console.log("[api/me] DELETE company", companyId, "- deleting", members?.length || 0, "auth users");

      for (const member of members || []) {
        const { error: memberErr } = await adminClient.auth.admin.deleteUser(member.id);
        if (memberErr) {
          console.error("[api/me] Failed to delete member:", member.email, memberErr.message);
        } else {
          console.log("[api/me] Deleted member:", member.email);
        }
      }

      const { error: compErr } = await adminClient
        .from("companies")
        .delete()
        .eq("id", companyId);

      if (compErr) {
        console.error("[api/me] Company delete error:", compErr.message);
        return NextResponse.json({ error: compErr.message }, { status: 500 });
      }

      console.log(
        "[api/me] DELETE company complete:", companyId,
        "| stripe cancelled:", stripeCancel.cancelled.length,
        "| stripe failed:", stripeCancel.failed.length
      );
      return NextResponse.json({
        success: true,
        deleted: "company",
        stripeCancelled: stripeCancel.cancelled.length,
        stripeFailed: stripeCancel.failed,
      });
    }

    // 5. Last-owner guard (normal self-delete path for owners).
    if (role === "owner" && companyId) {
      const { count: ownerCount } = await adminClient
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
        .eq("role", "owner");

      const { count: memberCount } = await adminClient
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId);

      const onlyOwner = (ownerCount ?? 0) <= 1;
      const hasOtherMembers = (memberCount ?? 0) > 1;

      if (onlyOwner && hasOtherMembers) {
        console.log("[api/me] DELETE blocked — last owner of company", companyId, "with other members");
        return NextResponse.json(
          {
            error: "last_owner",
            message: "You are the only owner of this company. Delete the company (and all its data) instead, or transfer ownership first.",
          },
          { status: 409 }
        );
      }
    }

    // 6. Normal self-delete.
    if (!confirmOk) {
      return NextResponse.json({ error: "confirm" }, { status: 400 });
    }

    const { error: delErr } = await adminClient.auth.admin.deleteUser(user.id);
    if (delErr) {
      console.error("[api/me] DELETE auth user error:", delErr.message);
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    console.log("[api/me] DELETE account deleted:", callerEmail);
    return NextResponse.json({ success: true, deleted: "account" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/me] DELETE Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
