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
  opts: { inviterName?: string | null; companyName?: string | null; inviteUrl: string; role?: string | null }
): Promise<string | null> {
  const inviter = opts.inviterName || "Your team";
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
          This invite link expires soon — please accept it as soon as you can.
        </p>
        <p style="font-size: 14px; color: #666; margin-top: 32px;">— The SAM Plan AI Team</p>
      </div>
    `,
    text: `You're invited!\n\n${inviter} invited you to join ${company} on SAM Plan AI.${roleText}\n\nAccept your invite and set your password:\n${opts.inviteUrl}\n\nThis invite link expires soon — please accept it as soon as you can.\n\n— The SAM Plan AI Team`,
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
