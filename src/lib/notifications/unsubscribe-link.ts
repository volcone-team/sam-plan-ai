/**
 * Unsubscribe link wiring for outbound reminder emails.
 *
 * Every reminder email must carry a per-recipient unsubscribe link (Req 5.1).
 * The link points at the unsubscribe route with a signed, opaque token so it
 * cannot be forged and user ids cannot be enumerated (see `unsubscribe-token`).
 *
 * This module keeps the pure, testable pieces of that wiring separate from the
 * DB/send orchestration in `notifications.service`:
 *  - `unsubscribeUrlFor(userId)` builds the absolute unsubscribe URL.
 *  - `buildEmailBody(baseHtml, unsubscribeUrl)` appends the unsubscribe block
 *    to a rendered email body, byte-for-byte.
 */

import { absoluteUrl } from "@/lib/app-url";
import { generateUnsubscribeToken } from "@/lib/notifications/unsubscribe-token";

/** Absolute unsubscribe URL carrying a signed token for the given user. */
export function unsubscribeUrlFor(userId: string): string {
  return absoluteUrl(
    "/api/notifications/unsubscribe?token=" + generateUnsubscribeToken(userId)
  );
}

/**
 * Append the unsubscribe footer to a rendered email body. The produced HTML is
 * identical for every send so recipients always get a working link.
 */
export function buildEmailBody(baseHtml: string, unsubscribeUrl: string): string {
  return (
    baseHtml +
    `<hr/><p style="font-size:12px;color:#888">` +
    `Don't want these reminders? <a href="${unsubscribeUrl}">Unsubscribe</a>.</p>`
  );
}
