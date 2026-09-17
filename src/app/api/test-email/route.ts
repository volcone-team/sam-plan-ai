import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/mailgun";

/**
 * POST /api/test-email
 *
 * Test endpoint to verify Mailgun configuration.
 * Body: { to: "recipient@example.com" }
 *
 * NOTE: For sandbox domains, the recipient must be in your
 * Mailgun Authorized Recipients list.
 */
export async function POST(request: Request) {
  try {
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
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
