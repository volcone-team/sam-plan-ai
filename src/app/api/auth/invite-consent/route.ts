import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { isMissingColumnError } from "@/lib/supabase/missing-column";
import { enqueueInviteConsentEvent } from "@/lib/ghl/producers/invite-consent";

export const runtime = "nodejs";

async function sessionUserId(): Promise<string | null> {
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
  return user?.id ?? null;
}

const serviceClient = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/**
 * GET /api/auth/invite-consent -> { needed: boolean }
 *
 * Whether /auth/set-password should show the checkboxes: true until this
 * person has a terms acceptance on record. A public signup, and anyone who
 * already answered, gets false (a password reset never asks again). Fails
 * CLOSED to `needed: true`, because a missing answer is the worse outcome.
 */
export async function GET() {
  try {
    const userId = await sessionUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data, error } = await serviceClient()
      .from("profiles")
      .select("terms_accepted_at")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.error("[auth/invite-consent] status read failed:", error.message);
      return NextResponse.json({ needed: true });
    }
    return NextResponse.json({ needed: !data?.terms_accepted_at });
  } catch {
    return NextResponse.json({ needed: true });
  }
}

/**
 * POST /api/auth/invite-consent
 *
 * Body: { termsAccepted: true, promotionalConsent: boolean }
 *
 * The two signup checkboxes, answered by someone who was CREATED for them (an
 * admin-made company or user, or an owner's Settings invite) and so never saw
 * the signup form. Called by /auth/set-password just before the password is
 * set. Nobody else may consent on a person's behalf, which is why this is
 * asked here rather than on the admin's create form.
 *
 * WHO MAY CALL. The person themselves, on the session their invite link
 * minted. That session is link-only (no password yet), so the middleware lets
 * exactly this path through along with /api/me. It is refused while a super
 * admin is impersonating (impersonation-blocked.ts): consent is the person's.
 *
 * WRITES, ONLY TO THE CALLER'S OWN PROFILE:
 *   terms_accepted_at / terms_accepted_via = 'invite'   (needs migration 058)
 *   promotional_consent / promotional_consent_at
 *   marketing_consent / marketing_consent_at           (mirrors signup)
 *
 * ONCE. A profile that already has a terms acceptance is left alone, so the
 * public signup's record is never overwritten and a reused link changes
 * nothing. Answers 200 with `alreadyRecorded: true` in that case.
 *
 * FAILS OPEN on migration 058: without terms_accepted_via the terms stamp is
 * NOT written (it would make the owner look like a public signup to the GHL
 * "not paid" tag), but the promotional answer still is.
 */
export async function POST(request: Request) {
  try {
    let body: { termsAccepted?: unknown; promotionalConsent?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    if (body.termsAccepted !== true) {
      return NextResponse.json(
        { error: "Please agree to the Privacy Policy and Terms & Conditions." },
        { status: 400 }
      );
    }
    if (typeof body.promotionalConsent !== "boolean") {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    const promotionalConsent = body.promotionalConsent;

    const userId = await sessionUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const db = serviceClient();

    const { data: profile, error: readError } = await db
      .from("profiles")
      .select("id, company_id, role, is_admin, terms_accepted_at")
      .eq("id", userId)
      .maybeSingle();
    if (readError || !profile) {
      console.error("[auth/invite-consent] profile read failed:", readError?.message ?? "no profile");
      return NextResponse.json({ error: "Could not save your choices. Please try again." }, { status: 500 });
    }
    if (profile.terms_accepted_at) {
      return NextResponse.json({ saved: true, alreadyRecorded: true });
    }

    const now = new Date().toISOString();
    const consent = {
      promotional_consent: promotionalConsent,
      promotional_consent_at: now,
      marketing_consent: promotionalConsent,
      marketing_consent_at: now,
    };

    let termsRecorded = true;
    let { error: writeError } = await db
      .from("profiles")
      .update({ ...consent, terms_accepted_at: now, terms_accepted_via: "invite" })
      .eq("id", userId);
    if (writeError && isMissingColumnError(writeError)) {
      termsRecorded = false;
      console.warn(
        "[auth/invite-consent] migration 058 not applied: saving the promotional answer only."
      );
      ({ error: writeError } = await db.from("profiles").update(consent).eq("id", userId));
    }
    if (writeError) {
      console.error("[auth/invite-consent] profile write failed:", writeError.message);
      return NextResponse.json({ error: "Could not save your choices. Please try again." }, { status: 500 });
    }

    // Tagging never affects the answer: the choice is already saved.
    const tagged = await enqueueInviteConsentEvent(db, {
      userId,
      companyId: profile.company_id ?? null,
      role: profile.role ?? null,
      isAdmin: profile.is_admin === true,
      promotionalConsent,
    });
    if (!tagged.ok) console.error("[auth/invite-consent] tag not queued:", tagged.message);

    return NextResponse.json({ saved: true, termsRecorded });
  } catch (err: unknown) {
    console.error("[auth/invite-consent] failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Could not save your choices. Please try again." }, { status: 500 });
  }
}
