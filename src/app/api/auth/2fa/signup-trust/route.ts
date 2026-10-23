import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  TWO_FACTOR_COOKIE,
  TWO_FACTOR_MAX_AGE_SECONDS,
  signDeviceToken,
} from "@/lib/two-factor";
import { readRequireEmailVerification } from "@/lib/auth/email-verification-setting";
import { decideSignupTrust } from "@/lib/auth/signup-trust";

export const runtime = "nodejs";

/**
 * POST /api/auth/2fa/signup-trust
 *
 * Issues the same `sam_2fa` device-trust cookie as /api/auth/2fa/grant, for a
 * customer who has JUST created their account through POST /api/auth/signup
 * (email verification off) and signed in with their new password. Without it
 * they would be asked for an emailed code before they could pay.
 *
 * Under /api/auth/2fa/, which the middleware's 2FA gate exempts by prefix, and
 * under /api/auth, which the lockout and call gates allow. It is NOT public:
 * an unauthenticated request gets 401 from the middleware.
 *
 * Every fact is read server-side with the service role: the session only
 * names the user. See decideSignupTrust for the conditions.
 *
 * Responses:
 *   200 { granted: true }   + sets `sam_2fa`
 *   401 { error: "Unauthorized" }
 *   403 { reason }          see SignupTrustRefusal
 *   500 { error: "server_error" }
 */
export async function POST() {
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

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Service role WITHOUT the request cookies, so it never acts as the user.
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const [setting, authResult, profileResult] = await Promise.all([
      readRequireEmailVerification(adminClient),
      adminClient.auth.admin.getUserById(user.id),
      adminClient.from("profiles").select("role, is_admin").eq("id", user.id).maybeSingle(),
    ]);

    const decision = decideSignupTrust({
      verificationRequired: setting.required,
      authUser: authResult.error ? null : (authResult.data?.user ?? null),
      profile: profileResult.error ? null : (profileResult.data ?? null),
    });

    if (!decision.grant) {
      console.log("[2fa/signup-trust] Refused for", user.id, "—", decision.reason);
      return NextResponse.json({ reason: decision.reason }, { status: 403 });
    }

    const token = await signDeviceToken(user.id);
    console.log("[2fa/signup-trust] Device trusted for new signup", user.id);

    const response = NextResponse.json({ granted: true });
    response.cookies.set(TWO_FACTOR_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: TWO_FACTOR_MAX_AGE_SECONDS,
    });
    return response;
  } catch (err: unknown) {
    console.error("[2fa/signup-trust] Error:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
