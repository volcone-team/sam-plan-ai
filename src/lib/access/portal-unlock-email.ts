/**
 * "Your portal is open" email, sent when an admin lifts the onboarding-call
 * gate for a company.
 *
 * THE ONLY NOTIFICATION THE CUSTOMER GETS. A gated customer has paid and then
 * been shown a thank-you page that tells them to book a call; nothing in the
 * product changes until an admin flips `companies.requires_call_unlock`. If
 * that grant is silent, the customer has no way of knowing the door opened
 * except by guessing and trying again — which is how a paid account sits idle.
 *
 * BEST-EFFORT, NEVER FATAL. The grant is already committed by the time this
 * runs, so a Mailgun outage must not make the admin's action look like it
 * failed. It therefore reports instead of throwing (see below).
 *
 * Template lives here rather than in src/lib/mailgun.ts, which is where the
 * other templates sit, because the caller wants one named function with a
 * result object and the gate's copy belongs with the rest of the gate. The
 * TRANSPORT is unchanged: it goes through the same `sendEmail`, so the
 * from-address, Mailgun domain and error logging are the house ones.
 */

import { getAppUrl } from "@/lib/app-url";
import { sendEmail } from "@/lib/mailgun";

export interface SendPortalUnlockedEmailParams {
  /** Recipient address. The owner's profile email. */
  to: string;
  /** Used for the greeting; falls back to "there", as the other senders do. */
  firstName?: string | null;
  /** Named in the body when known, so the email reads as being about them. */
  companyName?: string | null;
  /**
   * Base URL override. Defaults to getAppUrl(), which is correct in every
   * deployment; the parameter exists so a caller that has already resolved the
   * base (and tests) need not resolve it twice.
   */
  appUrl?: string | null;
}

/**
 * Outcome of the attempt.
 *
 * DIFFERENT SHAPE FROM THE NEIGHBOURS, deliberately. Every sender in
 * src/lib/mailgun.ts returns `Promise<string | null>` — the message id or
 * null — and callers like /api/billing/reactivate log on null. That is the
 * house style for templates. The caller here is an admin action that wants to
 * surface "access granted, but we could not email them", so a boolean plus a
 * reason is more useful than a bare null. `sent` is the only field a caller
 * must read; `error` is for logs and admin feedback, not for display to the
 * customer.
 */
export interface PortalUnlockedEmailResult {
  sent: boolean;
  error?: string;
}

/** Where the customer is sent. Signed-in users land on the dashboard; signed-out ones get the login screen and return here after. */
const DASHBOARD_PATH = "/year-at-a-glance";

function normalizeBase(appUrl?: string | null): string {
  const base = appUrl?.trim() || getAppUrl();
  return base.replace(/\/+$/, "");
}

/**
 * Email a customer that their portal is now open.
 *
 * NEVER THROWS. `sendEmail` already swallows its own failures and returns
 * null, but this adds a try/catch anyway: the input is assembled from database
 * rows, and a surprise from template interpolation or URL resolution must not
 * roll back a grant that has already happened.
 */
export async function sendPortalUnlockedEmail(
  params: SendPortalUnlockedEmailParams
): Promise<PortalUnlockedEmailResult> {
  const to = params.to?.trim();
  if (!to) {
    console.error("[portal-unlock-email] No recipient address; nothing sent");
    return { sent: false, error: "missing_recipient" };
  }

  const name = params.firstName?.trim() || "there";
  const dashboardUrl = `${normalizeBase(params.appUrl)}${DASHBOARD_PATH}`;

  // Only named when we have it, so the body never reads "for your company".
  const companyLine = params.companyName?.trim()
    ? `Everything in ${params.companyName.trim()}'s plan is now available to you.`
    : "Everything in your plan is now available to you.";

  try {
    const messageId = await sendEmail({
      to,
      subject: "Your SAM Plan AI portal is ready",
      html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a1a;">Hi ${name},</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">
          Your onboarding call is done, so we've opened up your portal. ${companyLine}
        </p>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">
          Sign in whenever you're ready and pick up where we left off.
        </p>
        <a href="${dashboardUrl}"
           style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px;
                  border-radius: 6px; text-decoration: none; font-weight: 600; margin: 20px 0;">
          Open my portal
        </a>
        <p style="font-size: 14px; color: #666; margin-top: 24px;">
          Or copy and paste this link into your browser:<br />
          <a href="${dashboardUrl}" style="color: #2563eb; word-break: break-all;">${dashboardUrl}</a>
        </p>
        <p style="font-size: 14px; line-height: 1.6; color: #666;">
          If anything looks off, just reply to this email.
        </p>
        <p style="font-size: 14px; color: #666; margin-top: 32px;">— The SAM Plan AI Team</p>
      </div>
    `,
      text: `Hi ${name},\n\nYour onboarding call is done, so we've opened up your portal. ${companyLine}\n\nSign in whenever you're ready and pick up where we left off:\n${dashboardUrl}\n\nIf anything looks off, just reply to this email.\n\n— The SAM Plan AI Team`,
      tags: ["portal-unlocked"],
    });

    if (!messageId) {
      console.error("[portal-unlock-email] Mailgun did not accept the message for", to);
      return { sent: false, error: "send_failed" };
    }

    return { sent: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[portal-unlock-email] Send failed:", message);
    return { sent: false, error: message || "send_failed" };
  }
}
