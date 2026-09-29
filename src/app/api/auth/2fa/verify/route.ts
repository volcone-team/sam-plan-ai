import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  TWO_FACTOR_COOKIE,
  TWO_FACTOR_MAX_AGE_SECONDS,
  signDeviceToken,
} from "@/lib/two-factor";
import {
  normalizeCode,
  isValidCodeFormat,
  matchStoredCode,
  MAX_ATTEMPTS,
  type StoredCode,
} from "@/lib/two-factor-code";

export const runtime = "nodejs";

const COOLDOWN_COOKIE = "sam_2fa_sent";

/** Newest codes to consider. Bounded so a flood of rows cannot slow the check. */
const CANDIDATE_LIMIT = 10;

/**
 * POST /api/auth/2fa/verify
 *
 * Validates the emailed 8-digit code and, on success, sets the HMAC-signed
 * device-trust cookie that middleware checks for the next 30 days.
 *
 * Codes are validated against this app's own `two_factor_codes` table. This
 * previously delegated to Supabase `verifyOtp`, which failed whenever two
 * environments shared one Supabase project: Supabase keeps a single active
 * email OTP per user, so whichever environment requested a code last silently
 * invalidated the other's, surfacing here as "incorrect or has expired".
 *
 * ANY unconsumed, unexpired code for the user is accepted — not just the newest
 * — so concurrent logins from different environments or browsers each work with
 * the code they were actually emailed. Codes are single-use: the matched row is
 * stamped `consumed_at` so it cannot be replayed.
 *
 * The submitted code is never logged.
 *
 * Body: { code: string }  (spaces and dashes are stripped)
 *
 * Responses:
 *   200 { verified: true }                       + sets `sam_2fa` cookie
 *   401 { error: "Unauthorized" }
 *   400 { error: "invalid_code_format" }
 *   400 { error: "invalid_code", message }
 *   429 { error: "too_many_attempts", message }
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

    const code = normalizeCode(body.code);
    if (!isValidCodeFormat(code)) {
      console.log("[2fa/verify] Invalid code format from", user.email);
      return NextResponse.json({ error: "invalid_code_format" }, { status: 400 });
    }

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: rows, error: fetchErr } = await adminClient
      .from("two_factor_codes")
      .select("id, code_hash, expires_at, attempts, consumed_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(CANDIDATE_LIMIT);

    if (fetchErr) {
      console.error("[2fa/verify] Could not load codes for", user.email, fetchErr.message);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }

    const candidates = (rows ?? []) as StoredCode[];
    const result = await matchStoredCode(code, candidates);

    if (result.outcome !== "match") {
      // Charge a failed attempt against every live candidate. Without this a
      // wrong guess costs nothing and the attempt cap would never bite.
      const chargeable = candidates.filter(
        (row) =>
          row.consumed_at === null &&
          row.attempts < MAX_ATTEMPTS &&
          new Date(row.expires_at).getTime() > Date.now()
      );

      if (chargeable.length > 0) {
        await Promise.all(
          chargeable.map((row) =>
            adminClient
              .from("two_factor_codes")
              .update({ attempts: row.attempts + 1 })
              .eq("id", row.id)
          )
        );
      }

      if (result.outcome === "attempts_exceeded") {
        console.log("[2fa/verify] Attempt cap reached for", user.email);
        return NextResponse.json(
          {
            error: "too_many_attempts",
            message: "Too many incorrect attempts. Request a new code.",
          },
          { status: 429 }
        );
      }

      // 'already_used', 'expired' and 'no_match' collapse into one client-facing
      // message: telling an attacker that a guess was *once* a real code, or is
      // merely stale, is more information than they should get. The server log
      // keeps the distinction for debugging.
      console.log("[2fa/verify] Verification rejected for", user.email, "|", result.outcome);
      return NextResponse.json(
        { error: "invalid_code", message: "That code is incorrect or has expired." },
        { status: 400 }
      );
    }

    // Single-use: stamp the row, and only accept the stamp we applied. The
    // `is('consumed_at', null)` guard makes this a compare-and-set, so two
    // simultaneous submissions of the same code cannot both win.
    const { data: consumed, error: consumeErr } = await adminClient
      .from("two_factor_codes")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", result.row.id)
      .is("consumed_at", null)
      .select("id");

    if (consumeErr) {
      console.error("[2fa/verify] Could not consume code for", user.email, consumeErr.message);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }

    if (!consumed || consumed.length === 0) {
      // Lost the race: another request consumed this code first.
      console.log("[2fa/verify] Code already consumed concurrently for", user.email);
      return NextResponse.json(
        { error: "invalid_code", message: "That code is incorrect or has expired." },
        { status: 400 }
      );
    }

    const token = await signDeviceToken(user.id);

    console.log("[2fa/verify] Device trusted for", user.email);

    // Opportunistic cleanup of this user's dead rows so the table does not grow
    // without bound. Best-effort: a failure here must not fail the login, and
    // the row just consumed is preserved by the `expires_at` cutoff.
    void adminClient
      .from("two_factor_codes")
      .delete()
      .eq("user_id", user.id)
      .lt("expires_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .then(({ error }) => {
        if (error) console.log("[2fa/verify] Cleanup skipped:", error.message);
      });

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
