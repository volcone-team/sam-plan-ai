/**
 * Mailgun email service for SAM Plan AI.
 *
 * Uses direct HTTP calls to the Mailgun API (no SDK dependencies).
 * Supabase auth emails are configured separately in dashboard SMTP settings.
 *
 * Environment variables:
 *   MAILGUN_API_KEY      - Your Mailgun API key
 *   MAILGUN_DOMAIN       - Your Mailgun domain
 *   MAILGUN_FROM         - Default "from" address
 *
 * Note: Sandbox domains can only send to authorized recipients.
 */

import { getAppUrl } from "./app-url";

const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY || "";
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || "";
const MAILGUN_FROM = process.env.MAILGUN_FROM || `SAM Plan AI <samai@${MAILGUN_DOMAIN}>`;
const MAILGUN_API_URL = process.env.MAILGUN_API_URL || "https://api.mailgun.net";

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  from?: string;
  replyTo?: string;
  tags?: string[];
}

/**
 * Send an email via Mailgun HTTP API.
 * @returns Message ID on success, null on failure
 */
export async function sendEmail(options: SendEmailOptions): Promise<string | null> {
  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
    console.error("[mailgun] MAILGUN_API_KEY or MAILGUN_DOMAIN not set");
    return null;
  }

  const toAddresses = Array.isArray(options.to) ? options.to.join(", ") : options.to;
  const url = `${MAILGUN_API_URL}/v3/${MAILGUN_DOMAIN}/messages`;

  // Build form data
  const formData = new URLSearchParams();
  formData.append("from", options.from || MAILGUN_FROM);
  formData.append("to", toAddresses);
  formData.append("subject", options.subject);
  if (options.text) formData.append("text", options.text);
  if (options.html) formData.append("html", options.html);
  if (options.replyTo) formData.append("h:Reply-To", options.replyTo);
  if (options.tags?.length) {
    options.tags.forEach(tag => formData.append("o:tag", tag));
  }

  try {
    console.log("[mailgun] Sending to:", toAddresses, "| subject:", options.subject);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`api:${MAILGUN_API_KEY}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("[mailgun] API error:", result.message || response.statusText);
      if (String(result.message || "").includes("not an authorized")) {
        console.error("[mailgun] Sandbox domains can only send to authorized recipients.");
      }
      return null;
    }

    console.log("[mailgun] Sent:", result.id);
    return result.id;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mailgun] Send failed:", message);
    return null;
  }
}

// ============================================================================
// Pre-built email templates
// ============================================================================


export async function sendPlanReadyEmail(
  to: string,
  userName: string,
  initiativeCount: number
): Promise<string | null> {
  return sendEmail({
    to,
    subject: "Your SAM Plan is Ready! 🎯",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a1a;">Hey ${userName}!</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">
          Great news — your personalized revenue plan is ready with 
          <strong>${initiativeCount} initiatives</strong> tailored to your goals.
        </p>
        <a href="${getAppUrl()}/year-at-a-glance" 
           style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; 
                  border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 16px;">
          View My Plan
        </a>
        <p style="font-size: 14px; color: #666; margin-top: 32px;">— The SAM Plan AI Team</p>
      </div>
    `,
    text: `Hey ${userName}!\n\nYour plan is ready with ${initiativeCount} initiatives.\n\nView: ${getAppUrl()}/year-at-a-glance`,
    tags: ["plan-ready"],
  });
}

export async function sendTaskReminderEmail(
  to: string,
  userName: string,
  taskName: string,
  initiativeName: string,
  dueDate: string
): Promise<string | null> {
  return sendEmail({
    to,
    subject: `Reminder: "${taskName}" is due soon`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a1a;">Hey ${userName}!</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">Your task is coming up:</p>
        <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p style="margin: 0 0 8px 0;"><strong>Task:</strong> ${taskName}</p>
          <p style="margin: 0 0 8px 0;"><strong>Initiative:</strong> ${initiativeName}</p>
          <p style="margin: 0;"><strong>Due:</strong> ${dueDate}</p>
        </div>
        <a href="${getAppUrl()}/planner/daily" 
           style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; 
                  border-radius: 6px; text-decoration: none; font-weight: 600;">
          View in Planner
        </a>
      </div>
    `,
    text: `Hey ${userName}!\n\nReminder: "${taskName}" for ${initiativeName} is due ${dueDate}.\n\nView: ${getAppUrl()}/planner/daily`,
    tags: ["task-reminder"],
  });
}

export async function sendWeeklySummaryEmail(
  to: string,
  userName: string,
  summary: { completedTasks: number; upcomingTasks: number; revenueProgress: number; revenueGoal: number }
): Promise<string | null> {
  const pct = summary.revenueGoal > 0 ? Math.round((summary.revenueProgress / summary.revenueGoal) * 100) : 0;
  return sendEmail({
    to,
    subject: `Your Weekly SAM Plan Summary 📊`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a1a;">Weekly Summary for ${userName}</h1>
        <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 16px 0;">
          <h3 style="margin: 0 0 16px 0;">This Week's Progress</h3>
          <p style="margin: 0 0 8px 0;">✅ <strong>${summary.completedTasks}</strong> tasks completed</p>
          <p style="margin: 0 0 8px 0;">📋 <strong>${summary.upcomingTasks}</strong> tasks upcoming</p>
          <p style="margin: 0;">💰 <strong>${pct}%</strong> toward revenue goal</p>
        </div>
        <a href="${getAppUrl()}/year-at-a-glance" 
           style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; 
                  border-radius: 6px; text-decoration: none; font-weight: 600;">
          View Full Dashboard
        </a>
      </div>
    `,
    text: `Weekly Summary\n\n✅ ${summary.completedTasks} completed\n📋 ${summary.upcomingTasks} upcoming\n💰 ${pct}% toward goal\n\nView: ${getAppUrl()}/year-at-a-glance`,
    tags: ["weekly-summary"],
  });
}

export async function sendMemberInviteEmail(
  to: string,
  opts: {
    inviterName?: string | null;
    companyName?: string | null;
    inviteUrl: string;
    role?: string | null;
    /** How long the link works; null = the short-lived legacy link. */
    validDays?: number | null;
  }
): Promise<string | null> {
  const inviter = opts.inviterName || "Your team";
  const expiryLine = opts.validDays
    ? `This invite link is valid for ${opts.validDays} days. If it has expired, ask for it to be resent.`
    : "This invite link expires soon — please accept it as soon as you can.";
  const company = opts.companyName || "their company";
  const companyForSubject = opts.companyName || "SAM Plan AI";

  const roleLabels: Record<string, string> = {
    operator: "Operator",
    team_member: "Team Member",
    viewer: "Viewer",
  };
  const roleLabel = opts.role ? roleLabels[opts.role] || null : null;
  const roleLine = roleLabel
    ? `<p style="font-size: 15px; line-height: 1.6; color: #555; margin: 0 0 16px 0;">Your role will be <strong>${roleLabel}</strong>.</p>`
    : "";
  const roleText = roleLabel ? `\nYour role will be ${roleLabel}.` : "";

  return sendEmail({
    to,
    subject: `You've been invited to join ${companyForSubject}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a1a;">You're invited! 🎉</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">
          <strong>${inviter}</strong> invited you to join <strong>${company}</strong> on SAM Plan AI.
        </p>
        ${roleLine}
        <p style="font-size: 16px; line-height: 1.6; color: #333;">
          Click the button below to accept your invite and set your own password.
        </p>
        <a href="${opts.inviteUrl}"
           style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px;
                  border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 8px;">
          Accept invite &amp; set your password
        </a>
        <p style="font-size: 14px; color: #666; margin-top: 24px;">
          Or copy and paste this link into your browser:<br />
          <a href="${opts.inviteUrl}" style="color: #2563eb; word-break: break-all;">${opts.inviteUrl}</a>
        </p>
        <p style="font-size: 13px; color: #999; margin-top: 24px;">
          ${expiryLine}
        </p>
        <p style="font-size: 14px; color: #666; margin-top: 32px;">— The SAM Plan AI Team</p>
      </div>
    `,
    text: `You're invited!\n\n${inviter} invited you to join ${company} on SAM Plan AI.${roleText}\n\nAccept your invite and set your password:\n${opts.inviteUrl}\n\n${expiryLine}\n\n— The SAM Plan AI Team`,
    tags: ["member-invite"],
  });
}
export async function sendTwoFactorCodeEmail(
  to: string,
  code: string,
  opts?: { firstName?: string | null }
): Promise<string | null> {
  const name = opts?.firstName || "there";

  return sendEmail({
    to,
    subject: "Your SAM Plan AI verification code",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a1a;">Hi ${name},</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">
          Someone signing in to SAM Plan AI requested a verification code. Enter the code below to finish signing in.
        </p>
        <div style="background: #f5f5f5; border-radius: 8px; padding: 24px; margin: 24px 0; text-align: center;">
          <div style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 28px; font-weight: 700; letter-spacing: 6px; color: #1a1a1a;">
            ${code}
          </div>
        </div>
        <p style="font-size: 15px; line-height: 1.6; color: #555;">
          This code expires shortly, so use it soon.
        </p>
        <p style="font-size: 14px; line-height: 1.6; color: #666;">
          If you didn't try to sign in, you can safely ignore this email — nobody can access your account without this code.
        </p>
        <p style="font-size: 14px; color: #666; margin-top: 32px;">— The SAM Plan AI Team</p>
      </div>
    `,
    text: `Hi ${name},\n\nSomeone signing in to SAM Plan AI requested a verification code.\n\nYour code: ${code}\n\nThis code expires shortly, so use it soon.\n\nIf you didn't try to sign in, you can safely ignore this email — nobody can access your account without this code.\n\n— The SAM Plan AI Team`,
    tags: ["two-factor"],
  });
}

/**
 * Password reset email.
 *
 * Sent by /api/auth/forgot-password over the Mailgun HTTP API, replacing
 * Supabase's `resetPasswordForEmail`, which delivered over dashboard SMTP. The
 * recovery TOKEN is still minted by Supabase — only the delivery moved — so
 * verification is unchanged and there is no second source of truth.
 *
 * `resetUrl` is a token_hash link, not Supabase's action_link. See
 * generatePasswordResetLink for why that distinction matters.
 */
export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
  opts?: { firstName?: string | null }
): Promise<string | null> {
  const name = opts?.firstName || "there";

  return sendEmail({
    to,
    subject: "Reset your SAM Plan AI password",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a1a;">Hi ${name},</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">
          Someone asked to reset the password for your SAM Plan AI account. Use the
          button below to choose a new one.
        </p>
        <a href="${resetUrl}"
           style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px;
                  border-radius: 6px; text-decoration: none; font-weight: 600; margin: 20px 0;">
          Set a new password
        </a>
        <p style="font-size: 14px; line-height: 1.6; color: #666;">
          This link can only be used once, and expires shortly. If the button does not
          work, copy and paste this address into your browser:
        </p>
        <p style="font-size: 13px; line-height: 1.5; color: #2563eb; word-break: break-all;">
          ${resetUrl}
        </p>
        <p style="font-size: 14px; line-height: 1.6; color: #666;">
          If you didn't request this, you can safely ignore this email — your password
          will not change until you use the link above.
        </p>
        <p style="font-size: 14px; color: #666; margin-top: 32px;">— The SAM Plan AI Team</p>
      </div>
    `,
    text: `Hi ${name},\n\nSomeone asked to reset the password for your SAM Plan AI account.\n\nSet a new password:\n${resetUrl}\n\nThis link can only be used once, and expires shortly.\n\nIf you didn't request this, you can safely ignore this email — your password will not change until you use the link above.\n\n— The SAM Plan AI Team`,
    tags: ["password-reset"],
  });
}

/**
 * Cancellation confirmation.
 *
 * Sent by /api/billing/cancel, NOT by the Stripe webhook. The webhook has no
 * user context — it resolves a company from a Stripe customer id and cannot
 * tell which person acted — and it must stay fast and idempotent, because a
 * duplicate delivery would re-send this. The route knows who clicked and runs
 * once.
 *
 * The receipt is the point: step 4 of the flow tells the customer "we've sent a
 * confirmation to <email>", and an unexplained end of service weeks later is
 * exactly what generates a chargeback. It states the access-until date and,
 * when there is one, the outstanding balance — a customer who cancelled while
 * past_due is still being invoiced by Stripe and must not be told otherwise.
 *
 * Returns the Mailgun message id, or null on any failure (sendEmail never
 * throws). Callers treat the send as best-effort: the subscription is already
 * cancelled by this point and a mail outage must not report that as a failure.
 */
export async function sendSubscriptionCancelledEmail(
  to: string,
  opts: {
    firstName?: string | null;
    planName?: string | null;
    /** Formatted date access stops, e.g. "Nov 12, 2026". */
    accessUntil?: string | null;
    /** True when an unpaid invoice is still outstanding. */
    balanceOutstanding?: boolean;
    /** Link back into settings, where they can reactivate. */
    settingsUrl: string;
  }
): Promise<string | null> {
  const name = opts.firstName || "there";
  const plan = opts.planName || "your plan";

  const accessLine = opts.accessUntil
    ? `You keep full access to ${plan} until <strong>${opts.accessUntil}</strong>. Nothing changes before then.`
    : `You keep full access to ${plan} for the rest of the period you have already paid for.`;
  const accessText = opts.accessUntil
    ? `You keep full access to ${plan} until ${opts.accessUntil}. Nothing changes before then.`
    : `You keep full access to ${plan} for the rest of the period you have already paid for.`;

  // Honest about money in both directions. Promising "no further charges" to
  // someone with an unpaid invoice is the one error here that becomes a dispute.
  const chargeLine = opts.balanceOutstanding
    ? `Your subscription will not renew. One earlier invoice is still unpaid, so you may see a further attempt to collect that balance.`
    : `You won't be charged again.`;

  return sendEmail({
    to,
    subject: "Your SAM Plan AI subscription is cancelled",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a1a;">Hi ${name},</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">
          Your SAM Plan AI subscription is cancelled. ${chargeLine}
        </p>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">
          ${accessLine}
        </p>
        <p style="font-size: 15px; line-height: 1.6; color: #555;">
          Your plan and history are kept, so if you come back everything is where
          you left it.
        </p>
        <a href="${opts.settingsUrl}"
           style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px;
                  border-radius: 6px; text-decoration: none; font-weight: 600; margin: 20px 0;">
          Reactivate my plan
        </a>
        <p style="font-size: 14px; line-height: 1.6; color: #666;">
          Thank you for building with us. If you cancelled by mistake, or there is
          something we could have done differently, just reply to this email.
        </p>
        <p style="font-size: 14px; color: #666; margin-top: 32px;">— The SAM Plan AI Team</p>
      </div>
    `,
    text: `Hi ${name},\n\nYour SAM Plan AI subscription is cancelled. ${chargeLine}\n\n${accessText}\n\nYour plan and history are kept, so if you come back everything is where you left it.\n\nReactivate any time:\n${opts.settingsUrl}\n\nThank you for building with us. If you cancelled by mistake, or there is something we could have done differently, just reply to this email.\n\n— The SAM Plan AI Team`,
    tags: ["subscription-cancelled"],
  });
}

/**
 * Reactivation confirmation.
 *
 * The counterpart to the email above, sent when a customer clears a pending
 * cancellation. Short on purpose: the only facts that matter are that billing
 * resumes and when the next charge lands, because someone who reactivates has
 * already decided and does not need persuading.
 */
export async function sendSubscriptionReactivatedEmail(
  to: string,
  opts: {
    firstName?: string | null;
    planName?: string | null;
    /** Formatted date of the next renewal, e.g. "Nov 12, 2026". */
    renewsOn?: string | null;
    settingsUrl: string;
  }
): Promise<string | null> {
  const name = opts.firstName || "there";
  const plan = opts.planName || "your plan";

  const renewLine = opts.renewsOn
    ? `${plan} continues as normal and renews on <strong>${opts.renewsOn}</strong>.`
    : `${plan} continues as normal and will renew at the end of your current period.`;
  const renewText = opts.renewsOn
    ? `${plan} continues as normal and renews on ${opts.renewsOn}.`
    : `${plan} continues as normal and will renew at the end of your current period.`;

  return sendEmail({
    to,
    subject: "Your SAM Plan AI subscription is back on",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a1a;">Hi ${name},</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">
          Good news — your cancellation is cancelled. ${renewLine}
        </p>
        <p style="font-size: 15px; line-height: 1.6; color: #555;">
          Nothing was lost. Your plan, initiatives and history are exactly as they
          were.
        </p>
        <a href="${opts.settingsUrl}"
           style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px;
                  border-radius: 6px; text-decoration: none; font-weight: 600; margin: 20px 0;">
          Go to my plan
        </a>
        <p style="font-size: 14px; color: #666; margin-top: 32px;">— The SAM Plan AI Team</p>
      </div>
    `,
    text: `Hi ${name},\n\nGood news — your cancellation is cancelled. ${renewText}\n\nNothing was lost. Your plan, initiatives and history are exactly as they were.\n\nGo to my plan:\n${opts.settingsUrl}\n\n— The SAM Plan AI Team`,
    tags: ["subscription-reactivated"],
  });
}

/**
 * Retention offer confirmation.
 *
 * Sent when a customer accepts a discount instead of cancelling. The screen
 * tells them "we've emailed you the details", and this is the email that makes
 * that true.
 *
 * IT EXISTS TO PREVENT A DISPUTE. The customer has just been told a payment is
 * being skipped or halved. If their next invoice does not match what they
 * remember agreeing to — and a discount is exactly the sort of thing people
 * misremember generously — a written record of the actual terms is the
 * difference between a question and a chargeback. So the amount, the number of
 * periods and the date normal billing resumes are all stated explicitly rather
 * than summarised as "your discount is active".
 */
export async function sendRetentionOfferEmail(
  to: string,
  opts: {
    firstName?: string | null;
    planName?: string | null;
    /** What they accepted, e.g. "Next month free". */
    offerTitle: string;
    /** One sentence describing the effect, built from the offer spec. */
    offerSummary: string;
    /** Formatted date full billing resumes, e.g. "Dec 12, 2026". */
    billingResumesOn?: string | null;
    /** Formatted normal price, e.g. "$49". */
    normalPrice?: string | null;
    settingsUrl: string;
  }
): Promise<string | null> {
  const name = opts.firstName || "there";
  const plan = opts.planName || "your plan";

  const resumeLine = opts.billingResumesOn
    ? opts.normalPrice
      ? `Normal billing of ${opts.normalPrice}/mo resumes on <strong>${opts.billingResumesOn}</strong>.`
      : `Normal billing resumes on <strong>${opts.billingResumesOn}</strong>.`
    : "Your normal billing resumes after that.";
  const resumeText = opts.billingResumesOn
    ? opts.normalPrice
      ? `Normal billing of ${opts.normalPrice}/mo resumes on ${opts.billingResumesOn}.`
      : `Normal billing resumes on ${opts.billingResumesOn}.`
    : "Your normal billing resumes after that.";

  return sendEmail({
    to,
    subject: `Your SAM Plan AI discount is applied — ${opts.offerTitle}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a1a;">Hi ${name},</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">
          Glad you're staying. Your discount is applied to ${plan} — nothing else
          about your account has changed.
        </p>
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <p style="font-size: 15px; font-weight: 600; color: #1a1a1a; margin: 0 0 8px 0;">
            ${opts.offerTitle}
          </p>
          <p style="font-size: 14px; line-height: 1.6; color: #555; margin: 0;">
            ${opts.offerSummary} ${resumeLine}
          </p>
        </div>
        <p style="font-size: 15px; line-height: 1.6; color: #555;">
          This was a one-time offer, so it won't repeat — but your plan, initiatives
          and history carry on exactly as they are.
        </p>
        <a href="${opts.settingsUrl}"
           style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px;
                  border-radius: 6px; text-decoration: none; font-weight: 600; margin: 8px 0 20px 0;">
          View my billing
        </a>
        <p style="font-size: 14px; line-height: 1.6; color: #666;">
          If any of this does not match what you expected, reply to this email and
          we'll sort it out.
        </p>
        <p style="font-size: 14px; color: #666; margin-top: 32px;">— The SAM Plan AI Team</p>
      </div>
    `,
    text: `Hi ${name},\n\nGlad you're staying. Your discount is applied to ${plan} — nothing else about your account has changed.\n\n${opts.offerTitle}\n${opts.offerSummary} ${resumeText}\n\nThis was a one-time offer, so it won't repeat — but your plan, initiatives and history carry on exactly as they are.\n\nView my billing:\n${opts.settingsUrl}\n\nIf any of this does not match what you expected, reply to this email and we'll sort it out.\n\n— The SAM Plan AI Team`,
    tags: ["retention-offer"],
  });
}

/**
 * Billing paused confirmation.
 *
 * Sent when a customer pauses from the cancellation flow.
 *
 * LEADS WITH THE ACCESS CONSEQUENCE. A pause stops billing AND access, and the
 * customer is about to be redirected out of the product. Someone who clicked a
 * reassuring green button and then found themselves locked out, with only this
 * email to explain it, needs the explanation in the first sentence rather than
 * buried under the good news.
 *
 * Also carries the resume link, because the paused screen is the only way back
 * in and a customer who changes their mind in a week should not have to go
 * looking for it.
 */
export async function sendBillingPausedEmail(
  to: string,
  opts: {
    firstName?: string | null;
    planName?: string | null;
    months: number;
    /** Formatted restart date, e.g. "Dec 12, 2026". */
    restartsOn?: string | null;
    resumeUrl: string;
  }
): Promise<string | null> {
  const name = opts.firstName || "there";
  const plan = opts.planName || "your plan";
  const duration = `${opts.months} month${opts.months === 1 ? "" : "s"}`;

  const restartLine = opts.restartsOn
    ? `Billing restarts on <strong>${opts.restartsOn}</strong>, and your access comes straight back with it.`
    : `Billing restarts in ${duration}, and your access comes straight back with it.`;
  const restartText = opts.restartsOn
    ? `Billing restarts on ${opts.restartsOn}, and your access comes straight back with it.`
    : `Billing restarts in ${duration}, and your access comes straight back with it.`;

  return sendEmail({
    to,
    subject: `Your SAM Plan AI billing is paused for ${duration}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a1a;">Hi ${name},</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">
          ${plan} is paused for ${duration}. You won't be charged during that
          time, and <strong>your access is on hold too</strong> — nothing has been
          deleted, and everything is waiting exactly as you left it.
        </p>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">
          ${restartLine}
        </p>
        <p style="font-size: 15px; line-height: 1.6; color: #555;">
          Want to come back sooner? You can restart your plan at any time — you
          don't have to wait for the date above.
        </p>
        <a href="${opts.resumeUrl}"
           style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px;
                  border-radius: 6px; text-decoration: none; font-weight: 600; margin: 8px 0 20px 0;">
          Restart my plan
        </a>
        <p style="font-size: 14px; line-height: 1.6; color: #666;">
          We'll email you a week before billing restarts, so there are no
          surprises.
        </p>
        <p style="font-size: 14px; color: #666; margin-top: 32px;">— The SAM Plan AI Team</p>
      </div>
    `,
    text: `Hi ${name},\n\n${plan} is paused for ${duration}. You won't be charged during that time, and your access is on hold too — nothing has been deleted, and everything is waiting exactly as you left it.\n\n${restartText}\n\nWant to come back sooner? You can restart your plan at any time — you don't have to wait for the date above:\n${opts.resumeUrl}\n\nWe'll email you a week before billing restarts, so there are no surprises.\n\n— The SAM Plan AI Team`,
    tags: ["billing-paused"],
  });
}

/**
 * "Billing restarts soon" warning, sent a week before a pause ends.
 *
 * KEEPS A PROMISE THE PAUSE SCREEN MAKES IN WRITING: "we'll email you a week
 * before billing restarts". Without it a card gets charged out of nowhere
 * weeks after the customer last thought about us, which is a dispute waiting to
 * happen — and the charge would be entirely legitimate, which makes it worse,
 * not better.
 *
 * Sent by /api/cron/resume-paused and made idempotent by
 * `subscriptions.pause_reminder_sent_at`, because a daily job would otherwise
 * send this on all seven days.
 */
export async function sendPauseEndingSoonEmail(
  to: string,
  opts: {
    firstName?: string | null;
    planName?: string | null;
    /** Formatted restart date, e.g. "Dec 12, 2026". */
    restartsOn?: string | null;
    /** Formatted normal price, e.g. "$49". */
    price?: string | null;
    settingsUrl: string;
  }
): Promise<string | null> {
  const name = opts.firstName || "there";
  const plan = opts.planName || "your plan";

  const when = opts.restartsOn ? `on ${opts.restartsOn}` : "in about a week";
  const amount = opts.price ? ` You'll be charged ${opts.price}.` : "";

  return sendEmail({
    to,
    subject: "Your SAM Plan AI billing restarts in a week",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a1a;">Hi ${name},</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #333;">
          A heads-up as promised: your pause on ${plan} ends ${when}, so billing
          and your access both start again then.${amount}
        </p>
        <p style="font-size: 15px; line-height: 1.6; color: #555;">
          Nothing to do if that suits you. If it doesn't, you can change or cancel
          your plan from your settings before then.
        </p>
        <a href="${opts.settingsUrl}"
           style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px;
                  border-radius: 6px; text-decoration: none; font-weight: 600; margin: 8px 0 20px 0;">
          Review my billing
        </a>
        <p style="font-size: 14px; color: #666; margin-top: 32px;">— The SAM Plan AI Team</p>
      </div>
    `,
    text: `Hi ${name},\n\nA heads-up as promised: your pause on ${plan} ends ${when}, so billing and your access both start again then.${amount}\n\nNothing to do if that suits you. If it doesn't, you can change or cancel your plan from your settings before then:\n${opts.settingsUrl}\n\n— The SAM Plan AI Team`,
    tags: ["pause-ending-soon"],
  });
}
