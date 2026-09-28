import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/mailgun";
import { requireAdmin } from "@/lib/require-admin";

/**
 * POST /api/test-email
 *
 * Test endpoint to verify Mailgun configuration.
 * Body: { to: "recipient@example.com" }
 *
 * Dev/debug only: disabled entirely in production and restricted to
 * authenticated admins elsewhere, so it cannot be used to send mail freely.
 *
 * NOTE: For sandbox domains, the recipient must be in your
 * Mailgun Authorized Recipients list.
 */
export async function POST(request: Request) {
  // Never available in production - this endpoint exists for local verification.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  try {
    const check = await requireAdmin();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    const body = await request.json();
    const to = body.to;

    if (!to) {
      return NextResponse.json({ error: "Missing 'to' email address" }, { status: 400 });
    }

    const messageId = await sendEmail({
      to,
      subject: "SAM Plan AI - Test Email",
      html: `
        <div style="font-family: sans-serif; max-width: 500px;">
          <h2>🎉 Mailgun is working!</h2>
          <p>This is a test email from SAM Plan AI.</p>
          <p>If you received this, your email configuration is correct.</p>
          <p style="color: #666; font-size: 14px;">Sent at: ${new Date().toISOString()}</p>
        </div>
      `,
      text: "Mailgun is working! This is a test email from SAM Plan AI.",
      tags: ["test"],
    });

    if (messageId) {
      return NextResponse.json({ success: true, messageId });
    } else {
      return NextResponse.json({ 
        error: "Failed to send - check server logs. For sandbox domains, make sure the recipient is authorized in Mailgun.",
      }, { status: 500 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
