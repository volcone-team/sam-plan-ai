import type { SupabaseClient } from "@supabase/supabase-js";
import { getAppUrl } from "./app-url";
import { sendMemberInviteEmail } from "./mailgun";

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
  }
): Promise<boolean> {
  const actionLink = await generateMemberInviteLink(adminClient, params.email);
  if (!actionLink) {
    console.error("[team-invite] Could not generate invite link for", params.email);
    return false;
  }

  const messageId = await sendMemberInviteEmail(params.email, {
    inviterName: params.inviterName,
    companyName: params.companyName,
    inviteUrl: actionLink,
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
