import { NextResponse } from "next/server";
import { runInitiativeReminders } from "@/services/notifications.service";

// Node runtime: the service uses the Supabase service-role key and Node crypto.
export const runtime = "nodejs";
// Never cache: this endpoint performs sends on every invocation.
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/initiative-reminders
 *
 * Secured daily scheduler endpoint (Vercel Cron). Authorizes via
 * `Authorization: Bearer ${CRON_SECRET}`, then runs the reminder batch and
 * returns the run summary as JSON.
 *
 * On missing/invalid authorization it returns 401 with no body detail so the
 * response never discloses whether eligible initiatives exist (Req 6.1, 6.3).
 * If `CRON_SECRET` is unset, all requests are treated as unauthorized.
 */
export async function GET(req: Request) {
  // Authorization (Req 6.1, 6.3, 6.4): reject if the secret is unset or the
  // bearer token does not match. No body detail on failure — no disclosure.
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    const summary = await runInitiativeReminders();
    console.log("[cron/initiative-reminders]", JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[cron/initiative-reminders] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
