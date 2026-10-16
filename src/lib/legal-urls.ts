/**
 * The Privacy Policy and Terms & Conditions links shown on the signup form.
 *
 * STORED IN `app_settings`, NOT HARDCODED. Same reasoning as the retention
 * booking URLs in migration 033: a policy gets rehosted, moves to a
 * third-party service, or changes domain, and none of that should need a
 * redeploy by a developer. The person who owns the policy can paste the link.
 *
 * ABSENT URLS DEGRADE TO PLAIN TEXT, they do not block signup. The required
 * checkbox still says what the user is agreeing to; what it loses is the
 * hyperlink. A dead `href` or an anchor pointing at "#" looks broken and
 * teaches people the product is shoddy, and blocking registration entirely
 * because an admin has not pasted a link yet would be far worse.
 *
 * No React, no database.
 */

/** What the signup form needs to render its legal checkbox. */
export interface LegalUrls {
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
}

export const NO_LEGAL_URLS: LegalUrls = {
  privacyPolicyUrl: null,
  termsUrl: null,
};

/**
 * Is this a link we are willing to render?
 *
 * HTTPS ONLY, and the reason is the same as `isUsableBookingUrl`: the value is
 * typed into an admin field and rendered as an anchor a customer clicks, so a
 * `javascript:` or `data:` URL would be a script-injection vector handed to us
 * by our own settings page. Rejecting plain http as well, because a policy
 * served over http can be rewritten in transit — and these are the two
 * documents whose exact wording is the whole point.
 */
export function isUsableLegalUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const trimmed = value.trim();
  if (!trimmed) return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;
  // A URL with no host ("https:///policy") parses but cannot resolve.
  return Boolean(parsed.hostname);
}

/**
 * Normalise an admin-entered value for storage.
 *
 * Returns null for anything unusable, so the column holds either a link we
 * would render or nothing at all — never a half-typed string that renders as a
 * broken anchor.
 */
export function normaliseLegalUrl(value: unknown): string | null {
  if (!isUsableLegalUrl(value)) return null;
  return (value as string).trim();
}

/**
 * Turn whatever is in `app_settings` into what the form should render.
 *
 * Re-validated on the way OUT as well as in. A row can predate the validation
 * above, or be edited directly in the SQL editor, and the signup page is a
 * public surface — it must not be the first place a bad value is discovered.
 */
export function resolveLegalUrls(row: {
  privacy_policy_url?: string | null;
  terms_url?: string | null;
} | null | undefined): LegalUrls {
  if (!row) return NO_LEGAL_URLS;

  return {
    privacyPolicyUrl: normaliseLegalUrl(row.privacy_policy_url),
    termsUrl: normaliseLegalUrl(row.terms_url),
  };
}

/**
 * What to tell an admin when a URL is refused.
 *
 * Names the rule rather than saying "invalid", because the most common mistake
 * is pasting an http link, and "must start with https://" is immediately
 * actionable in a way that "invalid URL" is not.
 */
export function describeLegalUrlProblem(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null; // Empty is allowed: it clears the link.
  if (isUsableLegalUrl(trimmed)) return null;

  if (/^http:\/\//i.test(trimmed)) {
    return "Use an https:// link. A policy served over http can be altered in transit.";
  }
  return "Enter a full link starting with https://, for example https://example.com/privacy.";
}
