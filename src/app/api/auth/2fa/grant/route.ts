import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  TWO_FACTOR_COOKIE,
  TWO_FACTOR_MAX_AGE_SECONDS,
  signDeviceToken,
} from "@/lib/two-factor";

export const runtime = "nodejs";

/**
 * POST /api/auth/2fa/grant
 *
 * Grants two-factor device trust to a session that was created by clicking a
 * link we emailed to the user's own inbox (signup confirmation, team invite,
 * password recovery). Opening that link proves control of the email address —
 * which is exactly, and only, what the emailed 8-digit code proves. Making
 * such a user then type a second code into the same inbox is pure friction:
 * it re-verifies a fact already established seconds earlier, and for a
 * brand-new signup it blocks onboarding's own API calls (`/api/generate-plan`,
 * `/api/plan/reset*`) with `two_factor_required` before they ever see the app.
 *
 * NOTE ON ROUTING: this handler lives under `/api/auth/2fa/*`, which the
 * middleware 2FA gate already exempts (alongside send + verify). That exemption
 * is load-bearing here too — an endpoint whose whole job is to issue device
 * trust cannot itself require device trust, or it could never be reached.
 *
 * Responses:
 *   200 { granted: true }                        + sets `sam_2fa` cookie
 *   401 { error: "Unauthorized" }                no session
 *   403 { error: "not_email_verified_session" }  password session — see below
 *   500 { error: <message> }
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
      console.log("[2fa/grant] Unauthorized (no session)");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    /**
     * SECURITY GATE — the reason this endpoint is safe to expose.
     *
     * Only a session whose authentication method was an EMAIL LINK may award
     * itself device trust. If a plain password session could call this, the
     * universal 2FA gate would be worthless: anyone holding a leaked password
     * would POST here, collect a 30-day `sam_2fa` cookie, and walk straight
     * past the challenge the gate exists to impose. The emailed code is the
     * second factor precisely BECAUSE the password alone must not be enough.
     *
     * The `amr` (Authentication Methods References) claim inside the access
     * token records how this session was minted. Supabase reports 'password'
     * for a sign-in with credentials, and 'otp' for every email-link flow
     * (signup confirm / invite / recovery). We read the claim out of the token
     * payload; the token itself arrived in an httpOnly cookie and was just
     * validated against the Auth server by getUser() above, so its contents
     * are trustworthy at this point.
     */
    const { data: { session } } = await supabase.auth.getSession();
    const method = getAuthMethod(session?.access_token);

    if (method === "password") {
      console.log("[2fa/grant] Refused for", user.email, "— password session, not an email link");
      return NextResponse.json(
        { error: "not_email_verified_session" },
        { status: 403 }
      );
    }

    const token = await signDeviceToken(user.id);

    console.log("[2fa/grant] Device trusted for", user.email, "| amr method:", method ?? "unknown");

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
    const message = err instanceof Error ? err.message : String(err);
    console.error("[2fa/grant] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}

/**
 * Decode the `amr` claim from a JWT payload and reduce it to a single method
 * name.
 *
 * `amr` entries come in two shapes depending on issuer version: bare strings
 * (`['otp']`) or objects (`[{ method: 'otp', timestamp: ... }]`). Both are
 * handled. When several methods are present, 'password' wins — a session that
 * involved a password at any point is treated as a password session, which is
 * the conservative reading for a security gate. Otherwise the most recent
 * (last) entry is used.
 *
 * Returns null when there is no token, the token is malformed, or `amr` is
 * absent. Callers treat null as "not a password session", which is correct:
 * this endpoint is only reachable with a session at all, and an
 * indistinguishable session cannot be a credentialed one.
 */
function getAuthMethod(accessToken: string | undefined): string | null {
  if (!accessToken) return null;

  const segments = accessToken.split(".");
  if (segments.length < 2) return null;

  let payload: unknown;
  try {
    const base64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object") return null;
  const amr = (payload as { amr?: unknown }).amr;
  if (!Array.isArray(amr) || amr.length === 0) return null;

  const methods: string[] = [];
  for (const entry of amr) {
    if (typeof entry === "string") {
      methods.push(entry);
    } else if (entry && typeof entry === "object") {
      const value = (entry as { method?: unknown }).method;
      if (typeof value === "string") methods.push(value);
    }
  }

  if (methods.length === 0) return null;
  if (methods.includes("password")) return "password";
  return methods[methods.length - 1];
}
