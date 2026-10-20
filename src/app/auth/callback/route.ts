import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { stampCallUnlockForNewCompany } from "@/lib/access/call-gate-settings";
import {
  TWO_FACTOR_COOKIE,
  TWO_FACTOR_MAX_AGE_SECONDS,
  signDeviceToken,
} from "@/lib/two-factor";

/**
 * GET /auth/callback
 *
 * Supabase redirects here after email confirmation (or OAuth).
 * Exchanges the auth code for a session, then redirects the user
 * to their intended destination.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || "/year-at-a-glance";

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Can't set cookies in middleware redirect responses.
              // The session will be picked up on the next request.
            }
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const response = NextResponse.redirect(`${origin}${next}`);

      /**
       * Grant two-factor device trust here.
       *
       * Reaching this point means the user clicked a link sent to their own
       * inbox, which proves exactly what the emailed 8-digit code proves:
       * control of the email address. Re-challenging them would mean a second
       * email round trip immediately after the first.
       *
       * This is also what lets onboarding work. Onboarding calls
       * /api/generate-plan and /api/plan/reset*, and those are /api/* routes —
       * exempting the onboarding PAGES from the 2FA gate did nothing for the
       * APIs they depend on, so a brand-new user got 403 two_factor_required
       * the moment they pressed Generate Plan.
       *
       * Best-effort: if TWO_FACTOR_SECRET is unset, signing throws. Swallow it
       * and continue — the user simply gets challenged normally instead of the
       * callback 500ing and breaking signup entirely.
       */
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          const token = await signDeviceToken(user.id);
          response.cookies.set(TWO_FACTOR_COOKIE, token, {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
            maxAge: TWO_FACTOR_MAX_AGE_SECONDS,
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[auth/callback] could not grant device trust:", message);
      }

      /**
       * Onboarding call gate: stamp the company of a BRAND-NEW signup.
       *
       * This is the application's first chance. The public signup creates its
       * company inside the `handle_new_user` database trigger (migration 037),
       * which this code cannot run in, so there is no application-code moment
       * at the insert itself. Confirming the email is the next server-side
       * request the new account makes, and it is the same request that grants
       * device trust above for the same reason: this is someone who has just
       * registered.
       *
       * SAFE FOR EVERYONE ELSE WHO PASSES THROUGH HERE. Password-reset and
       * invite links also exchange a code here, and
       * stampCallUnlockForNewCompany only stamps a company created within
       * NEW_COMPANY_STAMP_GRACE_MS, never one that already has a grant, and
       * never at all while the switch is off. An established customer coming
       * back through a reset link is left untouched.
       *
       * Best-effort, after the response is built: a stamp that fails means a
       * company that is not gated, which must never break confirming an email.
       */
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("company_id")
            .eq("id", user.id)
            .maybeSingle();

          const companyId = (profile as { company_id?: string | null } | null)?.company_id;
          if (companyId) {
            /*
             * Service role: `companies.requires_call_unlock` is gate state, so
             * it is not writable from a customer session, and the customer
             * must not be able to clear their own gate.
             */
            const admin = createClient(
              process.env.NEXT_PUBLIC_SUPABASE_URL!,
              process.env.SUPABASE_SERVICE_ROLE_KEY!
            );
            const stamp = await stampCallUnlockForNewCompany(admin, companyId);
            if (stamp.requireCall) {
              console.log("[auth/callback] call gate:", stamp.reason, "| stamped:", stamp.stamped);
            }
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[auth/callback] could not apply the call gate:", message);
      }

      return response;
    }
  }

  // If no code or exchange failed, redirect to login
  return NextResponse.redirect(`${origin}/auth/login?error=auth_callback_failed`);
}
