import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { sendTwoFactorCodeEmail } from "@/lib/mailgun";
import {
  generateCode,
  hashCode,
  codeExpiryISO,
  recentSendCutoffISO,
  MAX_RECENT_SENDS,
} from "@/lib/two-factor-code";

export const runtime = "nodejs";

const COOLDOWN_COOKIE = "sam_2fa_sent";
const COOLDOWN_SECONDS = 45;

/**
 * POST /api/auth/2fa/send
 *
 * Emails the authenticated user an 8-digit verification code.
 *
 * Applies to ALL authenticated users — every account must pass the emailed code
 * challenge before using the app (customer app and admin panel alike). There is
 * no admin-only restriction here.
 *
 * The code is generated, hashed and stored by THIS app in `two_factor_codes`.
 * It used to be lifted off Supabase's `generateLink({ type: 'magiclink' })`
 * response, which broke in two ways: Supabase keeps only one active email OTP
 * per user (so a second environment sharing this project silently invalidated
 * the first environment's code), and a magiclink OTP is redeemable for a full
 * session (so the "second factor" was interchangeable with a complete login).
 * Neither is true now — see 019_two_factor_codes.sql.
 *
 * Only the HMAC hash is persisted; the plaintext code exists just long enough
 * to be emailed and is never logged or returned to the client.
 *
 * CONCURRENCY: this does NOT invalidate previously issued codes. Multiple codes
 * may be live at once so simultaneous logins (local + production against the
 * same database, two browsers, two devices) never break each other. Codes are
 * single-use and short-lived; see the design note in the migration.
 *
 * Responses:
 *   200 { sent: true }
 *   401 { error: "Unauthorized" }
 *   429 { error: "cooldown", message, retryAfter }
 *   429 { error: "too_many_requests", message }
 *   500 { error: "code_generation_failed" | "email_failed" | <message> }
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
      console.log("[2fa/send] Unauthorized (no session)");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Profile is fetched purely to personalise the email. It is NOT an
    // authorization check: two-factor applies to every authenticated user, so a
    // missing or unreadable profile must not block the code from being sent —
    // we just fall back to a null first name.
    const { data: profile, error: profileErr } = await adminClient
      .from("profiles")
      .select("first_name")
      .eq("id", user.id)
      .single();

    if (profileErr) {
      console.log("[2fa/send] Profile lookup failed for", user.email, profileErr.message);
    }

    const firstName = profile?.first_name ?? null;

    // Cooldown: cheap anti-spam so a stuck client can't hammer Mailgun.
    // Cookie-based, so it is per-browser and cannot be relied on alone — the
    // per-user database throttle below is the real limit.
    const lastSentRaw = cookieStore.get(COOLDOWN_COOKIE)?.value;
    if (lastSentRaw) {
      const lastSent = Number(lastSentRaw);
      if (Number.isFinite(lastSent) && lastSent > 0) {
        const elapsed = Date.now() - lastSent;
        if (elapsed >= 0 && elapsed < COOLDOWN_SECONDS * 1000) {
          const retryAfter = Math.ceil((COOLDOWN_SECONDS * 1000 - elapsed) / 1000);
          console.log("[2fa/send] Cooldown active for", user.email, "| retryAfter:", retryAfter);
          return NextResponse.json(
            {
              error: "cooldown",
              message: "Please wait a moment before requesting another code.",
              retryAfter,
            },
            { status: 429 }
          );
        }
      }
    }

    // Per-user throttle. Codes are intentionally NOT invalidated on send, so
    // without this a client that ignores the cookie could mint unlimited codes
    // and use us as a mail relay. Counting rows (rather than deleting them) is
    // what keeps concurrent logins working.
    const { count: recentCount, error: countErr } = await adminClient
      .from("two_factor_codes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", recentSendCutoffISO());

    if (countErr) {
      // Fail closed: if the throttle cannot be evaluated, do not issue a code.
      console.error("[2fa/send] Throttle check failed for", user.email, countErr.message);
      return NextResponse.json({ error: "code_generation_failed" }, { status: 500 });
    }

    if ((recentCount ?? 0) >= MAX_RECENT_SENDS) {
      console.log("[2fa/send] Per-user send limit reached for", user.email);
      return NextResponse.json(
        {
          error: "too_many_requests",
          message: "Too many codes requested. Please wait a few minutes and try again.",
        },
        { status: 429 }
      );
    }

    const code = generateCode();

    // Store the hash BEFORE emailing. If the insert fails we must not send a
    // code that could never verify; if the email fails afterwards the row is
    // harmless (it simply expires unused).
    const { error: insertErr } = await adminClient
      .from("two_factor_codes")
      .insert({
        user_id: user.id,
        code_hash: await hashCode(code),
        expires_at: codeExpiryISO(),
      });

    if (insertErr) {
      console.error("[2fa/send] Could not store code for", user.email, insertErr.message);
      return NextResponse.json({ error: "code_generation_failed" }, { status: 500 });
    }

    const messageId = await sendTwoFactorCodeEmail(user.email!, code, {
      firstName,
    });

    if (!messageId) {
      console.error("[2fa/send] Email delivery failed for", user.email);
      return NextResponse.json(
        { error: "email_failed", message: "Could not send the verification code." },
        { status: 500 }
      );
    }

    console.log("[2fa/send] Code sent to", user.email);

    const response = NextResponse.json({ sent: true });
    response.cookies.set(COOLDOWN_COOKIE, String(Date.now()), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 300,
    });
    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[2fa/send] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
