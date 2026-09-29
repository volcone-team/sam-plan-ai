/**
 * Two-factor code generation and hashing (app-owned OTP).
 *
 * Pure logic only — no database access, so this is unit-testable. The routes in
 * `src/app/api/auth/2fa/` own the persistence.
 *
 * Codes are hashed with HMAC-SHA256 using `TWO_FACTOR_SECRET` as the key, which
 * acts as a server-side pepper. This matters more than it looks: an 8-digit code
 * is only 10^8 candidates, so a plain SHA-256 of it can be reversed by
 * exhaustive search almost instantly. The pepper means a leaked `code_hash`
 * column is useless without also leaking the environment secret.
 *
 * Web Crypto is used rather than `node:crypto` to stay consistent with
 * `two-factor.ts`, which must run on the Edge runtime in middleware. Nothing
 * here runs in middleware today, but matching keeps the two modules
 * interchangeable and avoids a surprise if that changes.
 */

/** Digits in an emailed code. Matches CODE_LENGTH in the verify-code page. */
export const CODE_LENGTH = 8;

/** How long a code stays valid. */
export const CODE_TTL_SECONDS = 10 * 60;

/**
 * Failed attempts allowed per code before it is refused outright. Counted
 * per-code rather than per-user so one person fat-fingering a digit cannot lock
 * out a code that another (legitimate) session is about to use correctly.
 */
export const MAX_ATTEMPTS = 5;

/**
 * Codes a user may request inside RECENT_SEND_WINDOW_SECONDS. Multiple valid
 * codes are allowed by design, but unbounded sends would be a free Mailgun
 * relay, so the count is capped.
 */
export const MAX_RECENT_SENDS = 5;
export const RECENT_SEND_WINDOW_SECONDS = 15 * 60;

function getSecret(): string {
  const secret = process.env.TWO_FACTOR_SECRET;
  if (!secret) {
    throw new Error(
      'TWO_FACTOR_SECRET is not set. Add it to your environment before issuing two-factor codes.'
    );
  }
  return secret;
}

/**
 * Generate a cryptographically random code of exactly CODE_LENGTH digits.
 *
 * Rejection sampling, not `% 10`. Taking a byte modulo 10 biases toward the
 * digits 0-5 (256 is not a multiple of 10), and a biased OTP is meaningfully
 * easier to guess than a uniform one. Values in the unusable tail are discarded
 * and redrawn instead.
 */
export function generateCode(length = CODE_LENGTH): string {
  const LIMIT = 250; // largest multiple of 10 that fits in a byte
  let out = '';

  while (out.length < length) {
    const batch = new Uint8Array(length - out.length);
    globalThis.crypto.getRandomValues(batch);
    for (const byte of batch) {
      if (byte >= LIMIT) continue; // biased tail — redraw
      out += String(byte % 10);
      if (out.length === length) break;
    }
  }

  return out;
}

/** Strip the formatting users paste in (spaces, dashes) before comparing. */
export function normalizeCode(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[\s-]/g, '');
}

/** True only for a string of exactly CODE_LENGTH ASCII digits. */
export function isValidCodeFormat(code: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code);
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * Peppered HMAC-SHA256 of a code, hex-encoded for storage in `code_hash`.
 * Deterministic, so verification re-hashes the submitted code and compares.
 */
export async function hashCode(code: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(code)
  );
  return bytesToHex(new Uint8Array(signature));
}

/**
 * Constant-time comparison of two hex digests.
 *
 * Both inputs here are hashes rather than the secret itself, so a timing leak
 * would be hard to exploit — but comparing them in constant time costs nothing
 * and removes the question entirely.
 */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** ISO timestamp for a code minted now, for the `expires_at` column. */
export function codeExpiryISO(now: number = Date.now()): string {
  return new Date(now + CODE_TTL_SECONDS * 1000).toISOString();
}

/** Start of the send-throttle window, for counting recent rows. */
export function recentSendCutoffISO(now: number = Date.now()): string {
  return new Date(now - RECENT_SEND_WINDOW_SECONDS * 1000).toISOString();
}

/** A stored code row, narrowed to the columns the decision needs. */
export type StoredCode = {
  id: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  consumed_at: string | null;
};

export type CodeMatch =
  | { outcome: 'match'; row: StoredCode }
  | { outcome: 'no_match' }
  /** A code matched but was already used — a replay, or a double-submit. */
  | { outcome: 'already_used' }
  /** A code matched but its attempt budget is spent. */
  | { outcome: 'attempts_exceeded' }
  /** A code matched but its window has closed. */
  | { outcome: 'expired' };

/**
 * Decide whether `submitted` matches any of the user's stored codes.
 *
 * Every candidate is hashed and compared even after a match is found, so the
 * work done does not depend on WHICH row matched. Returning early would leak
 * position in the list by timing.
 *
 * A live match wins outright. Otherwise the most specific near-miss is
 * reported, so an expired-but-correct code can be distinguished from a wrong
 * one; the caller decides how much of that to tell the user.
 */
export async function matchStoredCode(
  submitted: string,
  rows: readonly StoredCode[],
  now: number = Date.now()
): Promise<CodeMatch> {
  const submittedHash = await hashCode(submitted);

  let live: StoredCode | null = null;
  let used = false;
  let exhausted = false;
  let expired = false;

  for (const row of rows) {
    if (!safeEqualHex(submittedHash, row.code_hash)) continue;

    if (row.consumed_at !== null) {
      used = true;
      continue;
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      exhausted = true;
      continue;
    }
    if (new Date(row.expires_at).getTime() <= now) {
      expired = true;
      continue;
    }
    // Keep the first live match; do not break, so timing stays flat.
    if (live === null) live = row;
  }

  if (live) return { outcome: 'match', row: live };
  if (exhausted) return { outcome: 'attempts_exceeded' };
  if (used) return { outcome: 'already_used' };
  if (expired) return { outcome: 'expired' };
  return { outcome: 'no_match' };
}
