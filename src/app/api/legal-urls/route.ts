import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveLegalUrls, NO_LEGAL_URLS } from "@/lib/legal-urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/legal-urls — the Privacy Policy and Terms links for the signup form.
 *
 * DELIBERATELY UNAUTHENTICATED. The caller is someone who has not registered
 * yet; requiring a session to read the terms they are being asked to agree to
 * would be circular. Both values are public documents whose whole purpose is
 * to be read before signing up, so there is nothing here to protect.
 *
 * It returns ONLY these two fields. `app_settings` also holds trial
 * configuration, Stripe state and the contact address, none of which an
 * anonymous visitor has any business seeing — so the columns are named
 * explicitly rather than selected with `*` and filtered afterwards, which is
 * the pattern that leaks a new column the day someone adds one.
 *
 * NEVER FAILS. An unreadable settings row returns nulls, and the form renders
 * its checkbox label as plain text. Signup must not be blocked by the absence
 * of a hyperlink.
 *
 * Responses:
 *   200 { privacyPolicyUrl, termsUrl }  — either may be null
 */
export async function GET() {
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await db
      .from("app_settings")
      .select("privacy_policy_url, terms_url")
      .eq("id", "global")
      .maybeSingle();

    if (error) {
      // Most likely cause early on: migration 037 not yet applied.
      console.error("[legal-urls] Could not read settings:", error.message);
      return NextResponse.json(NO_LEGAL_URLS);
    }

    return NextResponse.json(resolveLegalUrls(data));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[legal-urls] GET failed:", message);
    return NextResponse.json(NO_LEGAL_URLS);
  }
}
