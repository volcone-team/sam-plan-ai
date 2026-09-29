import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAppUrl } from "@/lib/app-url";
import { sendPasswordResetEmail } from "@/lib/mailgun";

export const runtime = "nodejs";

/**
 * POST /api/auth/forgot-password
 *
 * Emails a password reset link over the Mailgun HTTP API.
 *
 * Replaces the client-side `supabase.auth.resetPasswordForEmail()` call, which
 * delivered through Supabase's dashboard SMTP settings. Only DELIVERY moved:
 * the recovery token is still minted by Supabase via `generateLink`, so
 * /auth/reset-password verifies it exactly as before. Rolling our own token
 * would mean a second source of truth for password recovery, which is the same
 * mistake that broke two-factor.
 *
 * ALWAYS RESPONDS 200 { sent: true } — even for an unknown address, a failed
 * link generation, or a failed send. This endpoint is unauthenticated by
 * necessity (the caller has lost their password), so any difference in status,
 * message or timing would turn it into an account-enumeration oracle: an
 * attacker could discover which emails have accounts here. Real failures go to
 * the server log instead.
 *
 * Body: { email: string }
 */
export async function POST(request: Request) {
  let email = "";

  try {
    let body: { email?: unknown } = {};
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object") body = parsed as { email?: unknown };
    } catch {
      body = {};
    }

    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    // Shape check only. An invalid address still returns 200 below.
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.log("[forgot-password] Ignoring malformed address");
      return NextResponse.json({ sent: true });
    }

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const redirectTo = `${getAppUrl()}/auth/reset-password`;

    /**
     * Build our own link from `hashed_token` rather than using Supabase's
     * `action_link`. The action_link routes through /auth/v1/verify and comes
     * back with an implicit-flow hash fragment (#access_token=...), which the
     * @supabase/ssr browser client refuses to adopt because it defaults to PKCE
     * — and it clears the hash, leaving a false "link expired" screen.
     * /auth/reset-password already handles ?token_hash=...&type=recovery by
     * calling verifyOtp(). Same reasoning as generateMemberInviteLink().
     */
    const { data, error } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo },
    });

    const hashedToken = data?.properties?.hashed_token;

    if (error || !hashedToken) {
      // Most commonly: no account for this address. Not an error the caller may
      // see — that is precisely the fact being withheld.
      console.log(
        "[forgot-password] No reset link generated for this address:",
        error?.message ?? "no hashed_token"
      );
      return NextResponse.json({ sent: true });
    }

    const resetUrl =
      `${redirectTo}?token_hash=${encodeURIComponent(hashedToken)}&type=recovery`;

    // Personalise where possible; a missing profile must not stop the email.
    let firstName: string | null = null;
    try {
      const userId = data?.user?.id;
      if (userId) {
        const { data: profile } = await adminClient
          .from("profiles")
          .select("first_name")
          .eq("id", userId)
          .maybeSingle();
        firstName = profile?.first_name ?? null;
      }
    } catch {
      firstName = null;
    }

    const messageId = await sendPasswordResetEmail(email, resetUrl, { firstName });

    if (!messageId) {
      // Genuine delivery failure. Still a 200: distinguishing it would leak
      // that the address exists. Mailgun logs plus this line are the signal.
      console.error("[forgot-password] Mailgun delivery failed for", email);
      return NextResponse.json({ sent: true });
    }

    console.log("[forgot-password] Reset link sent to", email);
    return NextResponse.json({ sent: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[forgot-password] Error:", message);
    // Uniform response even on an unexpected fault, for the same reason.
    return NextResponse.json({ sent: true });
  }
}
