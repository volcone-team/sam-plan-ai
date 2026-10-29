/**
 * 7-day invite tokens (migration 057, `account_invites`).
 *
 * The emailed link carries a random token; only its SHA-256 is stored, so a
 * database read cannot reconstruct a working link. Pure apart from the
 * crypto calls: no database here (see team-invite.ts for that).
 */
import { createHash, randomBytes } from "node:crypto";

/** How long an invite link works. */
export const INVITE_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A fresh url-safe token and its stored hash. */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** created_at + 7 days, ISO. */
export function inviteExpiry(now: number = Date.now()): string {
  return new Date(now + INVITE_TTL_DAYS * DAY_MS).toISOString();
}

export interface InviteRow {
  email: string;
  expires_at: string;
  revoked_at: string | null;
  accepted_at: string | null;
}

export type InviteCheck =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid" | "expired" | "replaced" | "accepted" };

/**
 * May this invite still be used? `replaced` = a newer invite was sent to the
 * same address (resend); `accepted` = the person already set a password.
 */
export function checkInvite(row: InviteRow | null | undefined, now: number = Date.now()): InviteCheck {
  if (!row) return { ok: false, reason: "invalid" };
  if (row.accepted_at) return { ok: false, reason: "accepted" };
  if (row.revoked_at) return { ok: false, reason: "replaced" };
  const expires = Date.parse(row.expires_at);
  if (!Number.isFinite(expires) || expires <= now) return { ok: false, reason: "expired" };
  return { ok: true, email: row.email };
}

/** A token as it may appear in a link: base64url, 43 chars for 32 bytes. */
export function isPlausibleInviteToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(value);
}
