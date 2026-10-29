import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkInvite, hashInviteToken, isPlausibleInviteToken, type InviteRow } from "@/lib/invite-token";
import { generateMemberInviteLink } from "@/lib/team-invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /auth/invite?token=… — where invite emails land (migration 057).
 *
 * Checks our 7-day invite, then mints a FRESH Supabase set-password link and
 * forwards to it, so the short Supabase expiry never decides whether an
 * invite still works. The token is reusable until it expires, is replaced by
 * a resend, or the person has set their password — someone who opens it and
 * leaves before choosing a password can simply click it again.
 *
 * Failures go to /auth/set-password?error=…, which shows the "invite link
 * expired" screen; an invite already accepted goes to sign in.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/auth/set-password?error=invite_${reason}`);

  const token = request.nextUrl.searchParams.get("token");
  if (!isPlausibleInviteToken(token)) return fail("invalid");

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await db
    .from("account_invites")
    .select("id, email, expires_at, revoked_at, accepted_at")
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle();
  if (error) {
    console.error("[auth/invite] lookup failed:", error.message);
    return fail("invalid");
  }
  const row = data as (InviteRow & { id: string }) | null;
  const check = checkInvite(row);
  if (!check.ok) {
    if (check.reason === "accepted") return NextResponse.redirect(`${origin}/auth/login?invite=accepted`);
    return fail(check.reason);
  }

  // Already chose a password (accepted through an earlier click)? Record it
  // and send them to sign in rather than re-opening password setup.
  const { data: profile } = await db.from("profiles").select("id").ilike("email", check.email).maybeSingle();
  const userId = (profile as { id?: string } | null)?.id;
  if (userId) {
    const { data: authUser } = await db.auth.admin.getUserById(userId);
    const meta = authUser?.user?.user_metadata as { needs_password?: unknown } | undefined;
    if (authUser?.user && meta?.needs_password === false && authUser.user.last_sign_in_at) {
      await db.from("account_invites").update({ accepted_at: new Date().toISOString() }).eq("id", row!.id);
      return NextResponse.redirect(`${origin}/auth/login?invite=accepted`);
    }
  }

  const link = await generateMemberInviteLink(db, check.email);
  if (!link) {
    console.error("[auth/invite] could not mint a set-password link for", check.email);
    return fail("invalid");
  }
  return NextResponse.redirect(link);
}
