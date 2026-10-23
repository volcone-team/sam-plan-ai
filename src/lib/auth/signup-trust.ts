import { DIRECT_SIGNUP_SOURCE, DIRECT_SIGNUP_SOURCE_KEY } from "./direct-signup";

/**
 * May this session be given two-factor device trust straight after a direct
 * signup?
 *
 * The emailed code proves control of the inbox. With email verification OFF
 * nobody has proved that, so this is a deliberate product trade: a person who
 * has just created their own account is not asked for a code before paying.
 * Every condition below narrows that trade to exactly that person, so a
 * leaked password for an established account still meets the code challenge.
 *
 * Pure, so each refusal reason is tested.
 */

/** How long after creation the account may still claim trust this way. */
export const SIGNUP_TRUST_WINDOW_MS = 15 * 60 * 1000;

export type SignupTrustRefusal =
  | "verification_required"
  | "no_auth_user"
  | "not_direct_signup"
  | "account_too_old"
  | "no_profile"
  | "not_owner"
  | "admin";

export type SignupTrustDecision =
  | { grant: true }
  | { grant: false; reason: SignupTrustRefusal };

export interface SignupTrustFacts {
  /** readRequireEmailVerification(...).required */
  verificationRequired: boolean;
  /** From auth.admin.getUserById (service role), never from the client. */
  authUser: { created_at?: string | null; app_metadata?: Record<string, unknown> | null } | null;
  profile: { role?: string | null; is_admin?: boolean | null } | null;
  now?: number;
}

export function decideSignupTrust(facts: SignupTrustFacts): SignupTrustDecision {
  if (facts.verificationRequired) return { grant: false, reason: "verification_required" };

  const user = facts.authUser;
  if (!user) return { grant: false, reason: "no_auth_user" };

  if (user.app_metadata?.[DIRECT_SIGNUP_SOURCE_KEY] !== DIRECT_SIGNUP_SOURCE) {
    return { grant: false, reason: "not_direct_signup" };
  }

  const created = user.created_at ? Date.parse(user.created_at) : NaN;
  const now = facts.now ?? Date.now();
  const age = now - created;
  // A future timestamp (clock skew beyond a minute) is treated as invalid too.
  if (!Number.isFinite(created) || age > SIGNUP_TRUST_WINDOW_MS || age < -60_000) {
    return { grant: false, reason: "account_too_old" };
  }

  if (!facts.profile) return { grant: false, reason: "no_profile" };
  if (facts.profile.is_admin === true) return { grant: false, reason: "admin" };
  if (facts.profile.role !== "owner") return { grant: false, reason: "not_owner" };

  return { grant: true };
}
