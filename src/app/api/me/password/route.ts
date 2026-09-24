import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const runtime = "nodejs";

/**
 * POST /api/me/password
 *
 * Lets a logged-in user change their own password after verifying their
 * CURRENT password.
 *
 * Why verify manually: Supabase's `updateUser({ password })` updates the
 * password for the current session WITHOUT checking the existing password.
 * To require the current password, we re-authenticate the user.
 *
 * Security notes:
 *   - The re-auth check uses a SEPARATE, non-persistent client
 *     (persistSession/autoRefreshToken disabled) so signing in to verify the
 *     current password never overwrites the caller's session cookies.
 *   - The actual password update uses the SERVICE ROLE admin client
 *     (updateUserById), so it is reliable and independent of the cookie
 *     session.
 *   - Password values are NEVER logged.
 */
export async function POST(request: Request) {
  try {
    // 1. Authenticate the caller via cookies (anon key), same pattern as /api/me.
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
      console.log("[api/me/password] Unauthorized (no session)");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse and validate the body.
    let body: { currentPassword?: unknown; newPassword?: unknown } = {};
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object") {
        body = parsed as { currentPassword?: unknown; newPassword?: unknown };
      }
    } catch {
      body = {};
    }

    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "missing_fields", message: "Both current and new password are required." },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "weak_password", message: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    if (newPassword === currentPassword) {
      return NextResponse.json(
        { error: "same_password", message: "New password must be different from your current password." },
        { status: 400 }
      );
    }

    // 3. Verify the CURRENT password by re-authenticating with a separate,
    //    non-persistent client so the caller's session cookies are untouched.
    const verifyClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { error: signInErr } = await verifyClient.auth.signInWithPassword({
      email: user.email!,
      password: currentPassword,
    });

    if (signInErr) {
      console.log("[api/me/password] Current password verification failed for", user.email);
      return NextResponse.json(
        { error: "invalid_current_password", message: "Your current password is incorrect." },
        { status: 400 }
      );
    }

    // 4. Verification passed — update the password via the service role admin
    //    client (reliable, independent of the cookie session).
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error: updateErr } = await adminClient.auth.admin.updateUserById(user.id, {
      password: newPassword,
    });

    if (updateErr) {
      console.error("[api/me/password] Update error for", user.email, updateErr.message);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    console.log("[api/me/password] Password updated for", user.email);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/me/password] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
