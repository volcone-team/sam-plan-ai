import { DIAL_CODES, composeE164, describeNationalNumberProblem } from "@/lib/phone";

/**
 * Direct signup: the account is created already confirmed by
 * POST /api/auth/signup, with no confirmation email, when the admin's
 * "require email verification" switch is OFF.
 *
 * Pure and free of server imports, so the route and the signup page share the
 * same rules: the request shape, the metadata written for handle_new_user, and
 * what the page does with each response.
 */

/** Body of POST /api/auth/signup. */
export interface DirectSignupInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  companyName: string;
  phoneE164: string;
  termsAccepted: boolean;
  promotionalConsent: boolean;
}

export type ParseResult =
  | { ok: true; honeypot: false; input: DirectSignupInput }
  | { ok: true; honeypot: true }
  | { ok: false; message: string };

/** Same shape check as /api/auth/forgot-password. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254;
/** The page's own rule (minLength 8). */
export const MIN_PASSWORD = 8;
/** bcrypt, which Supabase Auth uses, ignores anything past 72 bytes. */
export const MAX_PASSWORD = 72;
const MAX_TEXT = 200;

/**
 * Is this an E.164 number the signup form could have produced?
 *
 * The form composes `+<listed dial code><national number>` via composeE164,
 * so a valid value is one where SOME listed code is a prefix, the remainder
 * passes that code's length rule, and recomposing gives back the exact same
 * string (which rejects spaces, a kept trunk zero and similar).
 */
export function isFormPhone(phoneE164: string): boolean {
  if (!/^\+\d{4,16}$/.test(phoneE164)) return false;
  const digits = phoneE164.slice(1);
  return DIAL_CODES.some(
    (entry) =>
      digits.startsWith(entry.code) &&
      describeNationalNumberProblem(entry.code, digits.slice(entry.code.length)) === null &&
      composeE164(entry.code, digits.slice(entry.code.length)) === phoneE164
  );
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Validate the request body. Everything the page validates is checked again
 * here, because the route is public and the page is not the only possible
 * caller.
 *
 * The honeypot is checked FIRST: a bot that filled it gets the success
 * response without anything else being looked at.
 */
export function parseDirectSignup(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "Invalid request." };
  }
  const b = body as Record<string, unknown>;

  const website = b.website;
  if (website !== undefined && website !== null && website !== "") {
    return { ok: true, honeypot: true };
  }

  const email = text(b.email)?.trim().toLowerCase() ?? "";
  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return { ok: false, message: "Please enter a valid email address." };
  }

  const password = text(b.password);
  if (password === null || password.length < MIN_PASSWORD) {
    return { ok: false, message: `Password must be at least ${MIN_PASSWORD} characters.` };
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD) {
    return { ok: false, message: `Password must be at most ${MAX_PASSWORD} characters.` };
  }

  const firstName = text(b.firstName);
  const lastName = text(b.lastName);
  const companyName = text(b.companyName);
  for (const [label, value] of [
    ["First name", firstName],
    ["Last name", lastName],
    ["Company name", companyName],
  ] as const) {
    if (value === null || value.trim() === "") {
      return { ok: false, message: `${label} is required.` };
    }
    if (value.length > MAX_TEXT) {
      return { ok: false, message: `${label} is too long.` };
    }
  }

  const phoneE164 = text(b.phoneE164) ?? "";
  if (!isFormPhone(phoneE164)) {
    return { ok: false, message: "Please enter a valid phone number." };
  }

  if (b.termsAccepted !== true) {
    return {
      ok: false,
      message: "Please agree to the Privacy Policy and Terms & Conditions to continue.",
    };
  }

  if (typeof b.promotionalConsent !== "boolean") {
    return { ok: false, message: "Invalid request." };
  }

  return {
    ok: true,
    honeypot: false,
    input: {
      email,
      password,
      firstName: firstName!,
      lastName: lastName!,
      companyName: companyName!,
      phoneE164,
      termsAccepted: true,
      promotionalConsent: b.promotionalConsent,
    },
  };
}

/**
 * user_metadata for auth.admin.createUser.
 *
 * EXACTLY the keys and string formats the page passes to signUp() in its
 * options.data, because handle_new_user (migration 037) reads them with ->>
 * and compares against the strings 'true' / 'false'. A real boolean here
 * would still read as 'true' via ->>, but matching the page byte for byte
 * removes the question.
 */
export function signupUserMetadata(input: DirectSignupInput): Record<string, string> {
  return {
    first_name: input.firstName,
    last_name: input.lastName,
    company_name: input.companyName,
    phone: input.phoneE164,
    marketing_consent: input.promotionalConsent ? "true" : "false",
    terms_accepted: input.termsAccepted ? "true" : "false",
    promotional_consent: input.promotionalConsent ? "true" : "false",
  };
}

/**
 * app_metadata marker set on accounts created by the direct signup route.
 *
 * app_metadata can only be written with the service role, so a user cannot
 * add it to their own account. /api/auth/2fa/signup-trust requires it, which
 * binds that endpoint to accounts this route created.
 */
export const DIRECT_SIGNUP_SOURCE_KEY = "signup_source";
export const DIRECT_SIGNUP_SOURCE = "direct_no_verify";

/** Does a createUser error mean the address is already registered? */
export function isAlreadyRegisteredError(
  error: { message?: string; status?: number; code?: string } | null | undefined
): boolean {
  if (!error) return false;
  if (error.code === "email_exists" || error.code === "user_already_exists") return true;
  return /already (been )?registered|already exists/i.test(error.message ?? "");
}

/* ------------------------------------------------------------------ *
 * The page's side: what to do with the route's answer
 * ------------------------------------------------------------------ */

export const EXISTS_MESSAGE =
  "An account with this email already exists. Please sign in instead.";
export const RATE_LIMITED_MESSAGE =
  "Too many attempts. Please wait a few minutes and try again.";

export type DirectSignupOutcome =
  /** Account created: sign in, request device trust, go to the destination. */
  | { kind: "sign_in" }
  /** Use the old supabase.auth.signUp path (confirmation email). */
  | { kind: "fallback" }
  /** Stop and show this message on the form. */
  | { kind: "error"; message: string };

/**
 * Map the route's response to the page's next step.
 *
 * `response` is null when the request never got an answer (network error,
 * route not deployed). Anything the page does not recognise as a definite
 * answer falls back to the old flow, so a fault in the new route costs the
 * user a confirmation email rather than their signup.
 */
export function decideDirectSignupOutcome(
  response: { status: number; body: unknown } | null
): DirectSignupOutcome {
  if (!response) return { kind: "fallback" };
  const { status } = response;
  const body = (response.body ?? {}) as { ok?: unknown; error?: unknown; message?: unknown };

  if (status === 200 && body.ok === true) return { kind: "sign_in" };
  if (status === 409 && body.error === "exists") return { kind: "error", message: EXISTS_MESSAGE };
  if (status === 409 && body.error === "verification_required") return { kind: "fallback" };
  if (status === 429) return { kind: "error", message: RATE_LIMITED_MESSAGE };
  if (status === 400 && typeof body.message === "string" && body.message) {
    return { kind: "error", message: body.message };
  }
  // 404 (route missing), 5xx, an unexpected shape: the old flow still works.
  return { kind: "fallback" };
}

/**
 * Where the page goes once the new account is signed in.
 *
 * Trusted: straight to the destination (checkout for the chosen plan, or the
 * onboarding hub). Not trusted: the emailed-code challenge, which returns to
 * the same destination afterwards. The 2FA gate would send them there anyway;
 * going directly saves a redirect.
 */
export function pathAfterSignupTrust(trusted: boolean, destination: string): string {
  return trusted ? destination : `/auth/verify-code?next=${encodeURIComponent(destination)}`;
}
