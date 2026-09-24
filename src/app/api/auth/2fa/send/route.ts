import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { sendTwoFactorCodeEmail } from "@/lib/mailgun";

export const runtime = "nodejs";

const COOLDOWN_COOKIE = "sam_2fa_sent";
const COOLDOWN_SECONDS = 45;

/**
 * POST /api/auth/2fa/send
 *
 * Emails the authenticated ADMIN user an 8-digit verification code.
 *
 * The code itself is generated and later validated by Supabase — we ask for a
 * magiclink and pull `properties.email_otp` off the response, then deliver it
 * ourselves via Mailgun. No OTP is stored anywhere in our database, and the
 * code is never returned to the client or written to logs.
 *
 * Responses:
 *   200 { sent: true }
 *   401 { error: "Unauthorized" }
 *   400 { error: "not_required", message }      - caller is not an admin
 *   429 { error: "cooldown", message, retryAfter }
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

    const { data: profile, error: profileErr } = await adminClient
      .from("profiles")
      .select("is_admin, first_name")
      .eq("id", user.id)
      .single();

    if (profileErr) {
      console.log("[2fa/send] Profile lookup failed for", user.email, profileErr.message);
    }

    // Two-factor is admin-only. Everyone else is already fully signed in.
    if (!profile?.is_admin) {
      console.log("[2fa/send] Not required for", user.email);
      return NextResponse.json(
        { error: "not_required", message: "Two-factor verification is not required for this account." },
        { status: 400 }
      );
    }

    // Cooldown: cheap anti-spam so a stuck client can't hammer Mailgun.
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

    const { data, error } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: user.email!,
    });

    const emailOtp = data?.properties?.email_otp;
    if (error || !emailOtp) {
      console.error("[2fa/send] Code generation failed for", user.email, error?.message || "no email_otp");
      return NextResponse.json({ error: "code_generation_failed" }, { status: 500 });
    }

    const messageId = await sendTwoFactorCodeEmail(user.email!, String(emailOtp), {
      firstName: profile.first_name,
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
