import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readRequireEmailVerification } from "@/lib/auth/email-verification-setting";
import {
  DIRECT_SIGNUP_SOURCE,
  DIRECT_SIGNUP_SOURCE_KEY,
  isAlreadyRegisteredError,
  parseDirectSignup,
  signupUserMetadata,
} from "@/lib/auth/direct-signup";
import { RateLimiter, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/auth/signup
 *
 * Creates a customer account ALREADY CONFIRMED, with no confirmation email,
 * when the admin's "require email verification" switch is off. The signup page
 * calls this first and falls back to its old supabase.auth.signUp() path when
 * the answer is 409 verification_required or anything it does not recognise.
 *
 * PUBLIC: listed in the middleware's isPublicApiRoute, because the caller has
 * no account yet. Its own protection is the honeypot, the rate limits and the
 * full re-validation below.
 *
 * Supabase's "Confirm email" setting stays ON for the old flow. createUser with
 * email_confirm: true bypasses it for this one account only.
 *
 * Body: { email, password, firstName, lastName, companyName, phoneE164,
 *         termsAccepted, promotionalConsent, website (honeypot) }
 *
 * Responses:
 *   200 { ok: true }                         created (or honeypot tripped)
 *   400 { error: "invalid", message }        validation failed
 *   409 { error: "verification_required" }   switch is on: use the old flow
 *   409 { error: "exists" }                  address already registered
 *   429 { error: "rate_limited" }
 *   500 { error: "server_error" }
 *
 * The password is never logged.
 */

/**
 * Per instance, see src/lib/rate-limit.ts. Abuse dampening rather than a hard
 * quota; Supabase applies its own limits behind this.
 */
const TEN_MINUTES = 10 * 60 * 1000;
const byIp = new RateLimiter({ limit: 5, windowMs: TEN_MINUTES });
const byEmail = new RateLimiter({ limit: 3, windowMs: TEN_MINUTES });

function tooMany(retryAfterMs: number) {
  return NextResponse.json(
    { error: "rate_limited" },
    { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
  );
}

export async function POST(request: Request) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const parsed = parseDirectSignup(body);

  // Honeypot: look like success, do nothing, count nothing.
  if (parsed.ok && parsed.honeypot) {
    console.log("[auth/signup] Honeypot filled, ignoring");
    return NextResponse.json({ ok: true });
  }

  const ipLimit = byIp.hit(clientIp(request.headers));
  if (!ipLimit.allowed) {
    console.log("[auth/signup] Rate limited by IP");
    return tooMany(ipLimit.retryAfterMs);
  }

  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid", message: parsed.message }, { status: 400 });
  }

  const input = parsed.input;

  const emailLimit = byEmail.hit(input.email);
  if (!emailLimit.allowed) {
    console.log("[auth/signup] Rate limited by email");
    return tooMany(emailLimit.retryAfterMs);
  }

  try {
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const setting = await readRequireEmailVerification(adminClient);
    if (setting.required) {
      return NextResponse.json({ error: "verification_required" }, { status: 409 });
    }

    /*
     * handle_new_user (migration 037) runs on this INSERT into auth.users just
     * as it does for signUp(), reading the same raw_user_meta_data keys, so the
     * company, profile, consent stamps, phone and subscription row are created
     * identically.
     */
    const { data, error } = await adminClient.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: signupUserMetadata(input),
      app_metadata: { [DIRECT_SIGNUP_SOURCE_KEY]: DIRECT_SIGNUP_SOURCE },
    });

    if (error || !data?.user) {
      if (isAlreadyRegisteredError(error)) {
        return NextResponse.json({ error: "exists" }, { status: 409 });
      }
      if (error && error.status === 422) {
        // e.g. weak_password from the project's password policy.
        console.log("[auth/signup] createUser rejected:", error.code ?? "", error.message);
        return NextResponse.json(
          { error: "invalid", message: error.message || "Those details were not accepted." },
          { status: 400 }
        );
      }
      console.error("[auth/signup] createUser failed:", error?.code ?? "", error?.message ?? "no user");
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }

    console.log("[auth/signup] Created confirmed account", data.user.id);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[auth/signup] Error:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
