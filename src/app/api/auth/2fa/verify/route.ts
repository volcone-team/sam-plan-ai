import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  TWO_FACTOR_COOKIE,
  TWO_FACTOR_MAX_AGE_SECONDS,
  signDeviceToken,
} from "@/lib/two-factor";

export const runtime = "nodejs";

const COOLDOWN_COOKIE = "sam_2fa_sent";

/**
 * POST /api/auth/2fa/verify
 *
 * Validates the emailed 8-digit code and, on success, sets the HMAC-signed
 * device-trust cookie that middleware checks for the next 30 days.
 *
 * Validation is delegated to Supabase (`verifyOtp`) using a throwaway
 * non-persistent client so the caller's existing session cookies are left
 * untouched. The submitted code is never logged.
 *
 * Body: { code: string }  (spaces and dashes are stripped)
 *
 * Responses:
 *   200 { verified: true }                       + sets `sam_2fa` cookie
 *   401 { error: "Unauthorized" }
 *   400 { error: "invalid_code_format" }
 *   400 { error: "invalid_code", message }
 *   500 { error: <message> }
 */
export async function POST(request: Request) {
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
      console.log("[2fa/verify] Unauthorized (no session)");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Tolerant body parsing — treat empty/missing/invalid body as {}.
    let body: { code?: unknown } = {};
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object") {
        body = parsed as { code?: unknown };
      }
    } catch {
      body = {};
    }

    const rawCode = typeof body.code === "string" ? body.code : "";
    const code = rawCode.replace(/[\s-]/g, "");
    if (!code || !/^\d+$/.test(code)) {
      console.log("[2fa/verify] Invalid code format from", user.email);
      return NextResponse.json({ error: "invalid_code_format" }, { status: 400 });
    }

    // Separate client: verifyOtp issues a new session, and we do not want it
    // overwriting the caller's cookies.
    const verifyClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { error: verifyErr } = await verifyClient.auth.verifyOtp({
      email: user.email!,
      token: code,
      type: "email",
    });

    if (verifyErr) {
      console.log("[2fa/verify] Verification rejected for", user.email, "|", verifyErr.message);
      return NextResponse.json(
        { error: "invalid_code", message: "That code is incorrect or has expired." },
        { status: 400 }
      );
    }

    const token = await signDeviceToken(user.id);

    console.log("[2fa/verify] Device trusted for", user.email);

    const response = NextResponse.json({ verified: true });
    response.cookies.set(TWO_FACTOR_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: TWO_FACTOR_MAX_AGE_SECONDS,
    });
    response.cookies.set(COOLDOWN_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[2fa/verify] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
