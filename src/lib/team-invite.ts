import type { SupabaseClient } from "@supabase/supabase-js";
import { getAppUrl } from "./app-url";
import { sendMemberInviteEmail } from "./mailgun";
import { INVITE_TTL_DAYS, inviteExpiry, newInviteToken } from "./invite-token";
import { isMissingTableError } from "./db-errors";

/**
 * The link to email: OUR 7-day invite (migration 057), or — until that
 * migration is applied — a direct Supabase link, which expires with the
 * project's Email OTP setting (1 hour by default, 24 hours at most).
 *
 * A new invite REPLACES any earlier unused one for the same address, so after
 * a resend only the latest email works.
 */
export async function createInviteLink(
  adminClient: SupabaseClient,
  email: string,
  createdBy: string | null = null
): Promise<{ url: string; validDays: number | null } | null> {
  const legacy = async () => {
    const url = await generateMemberInviteLink(adminClient, address);
    return url ? { url, validDays: null } : null;
  };
  const address = email.trim().toLowerCase();
  const now = new Date().toISOString();
  const { error: revokeError } = await adminClient
    .from("account_invites")
    .update({ revoked_at: now })
    .eq("email", address)
    .is("accepted_at", null)
    .is("revoked_at", null);
  if (revokeError) {
    if (isMissingTableError(revokeError)) return legacy();
    console.error("[team-invite] could not replace earlier invites:", revokeError.message);
  }
  const { token, hash } = newInviteToken();
  const { error } = await adminClient.from("account_invites").insert({
    email: address,
    token_hash: hash,
    expires_at: inviteExpiry(),
    created_by: createdBy,
  });
  if (error) {
    if (isMissingTableError(error)) return legacy();
    console.error("[team-invite] could not store the invite:", error.message);
    return null;
  }
  return { url: `${getAppUrl()}/auth/invite?token=${encodeURIComponent(token)}`, validDays: INVITE_TTL_DAYS };
}

/**
 * Generate a password-set link for an invited member.
 *
 * Prefers an "invite" link, but that type fails if the user already exists /
 * is confirmed. In that case we fall back to a "recovery" link, which also lets
 * the user set a password. Both redirect to /auth/set-password.
 *
 * @returns the action link URL, or null if both attempts failed.
 */
export async function generateMemberInviteLink(
  adminClient: SupabaseClient,
  email: string
): Promise<string | null> {
  const redirectTo = `${getAppUrl()}/auth/set-password`;

  // Build OUR OWN link using the returned hashed_token rather than using
  // Supabase's action_link. The action_link routes through /auth/v1/verify,
  // which redirects back with an implicit-flow hash fragment
  // (#access_token=...). The browser client from @supabase/ssr defaults to the
  // PKCE flow, so it refuses to adopt those hash tokens AND clears the hash —
  // leaving the page with no session and a false "link expired" screen.
  //
  // A token_hash link is deterministic: /auth/set-password?token_hash=...&type=...
  // and the page calls verifyOtp() to establish the session.
  const buildUrl = (tokenHash: string, type: string) =>
    `${redirectTo}?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`;

  // Prefer an invite link.
  const invite = await adminClient.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo },
  });

  if (!invite.error && invite.data?.properties?.hashed_token) {
    return buildUrl(invite.data.properties.hashed_token, "invite");
  }

  if (invite.error) {
    console.error("[team-invite] invite link failed, trying recovery:", invite.error.message);
  }

  // Fall back to a recovery link (works for existing/confirmed users).
  const recovery = await adminClient.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });

  if (!recovery.error && recovery.data?.properties?.hashed_token) {
    return buildUrl(recovery.data.properties.hashed_token, "recovery");
  }

  if (recovery.error) {
    console.error("[team-invite] recovery link failed:", recovery.error.message);
  }

  return null;
}

/**
 * Generate an invite link and email it to the member.
 *
 * @returns true if the invite email was sent, false otherwise.
 */
export async function sendMemberInvite(
  adminClient: SupabaseClient,
  params: {
    email: string;
    inviterName?: string | null;
    companyName?: string | null;
    role?: string | null;
    /** profiles.id of whoever sent it, for the invite record. */
    createdBy?: string | null;
  }
): Promise<boolean> {
  const link = await createInviteLink(adminClient, params.email, params.createdBy ?? null);
  if (!link) {
    console.error("[team-invite] Could not generate invite link for", params.email);
    return false;
  }

  const messageId = await sendMemberInviteEmail(params.email, {
    inviterName: params.inviterName,
    companyName: params.companyName,
    inviteUrl: link.url,
    validDays: link.validDays,
    role: params.role,
  });

  if (!messageId) {
    console.error("[team-invite] Failed to send invite email to", params.email);
    return false;
  }

  return true;
}

/**
 * Look up the display name of the inviter and the company name for personalizing
 * invite emails. Best-effort — returns nulls on any lookup failure.
 */
export async function getInviteContext(
  adminClient: SupabaseClient,
  inviter: { first_name?: string | null; last_name?: string | null },
  companyId: string
): Promise<{ inviterName: string | null; companyName: string | null }> {
  let companyName: string | null = null;
  try {
    const { data: company } = await adminClient
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .single();
    companyName = company?.name ?? null;
  } catch {
    companyName = null;
  }

  const nameParts = [inviter.first_name, inviter.last_name].filter(Boolean);
  const inviterName = nameParts.length > 0 ? nameParts.join(" ") : null;

  return { inviterName, companyName };
}
