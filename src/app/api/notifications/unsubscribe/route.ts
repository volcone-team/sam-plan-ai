import { createClient } from "@supabase/supabase-js";
import { verifyUnsubscribeToken } from "@/lib/notifications/unsubscribe-token";

// Node runtime: verifying the token uses Node crypto and the opt-out upsert
// uses the Supabase service-role key.
export const runtime = "nodejs";
// Never cache: this is a mutating link clicked from an email.
export const dynamic = "force-dynamic";

/** Minimal self-contained HTML page shell. */
function htmlPage(title: string, heading: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f5f5f7; color: #1d1d1f; margin: 0; padding: 0; }
  .card { max-width: 480px; margin: 12vh auto 0; background: #fff; border-radius: 12px; padding: 40px 32px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); text-align: center; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { font-size: 15px; line-height: 1.5; color: #4b4b4f; margin: 0; }
</style>
</head>
<body>
  <div class="card">
    <h1>${heading}</h1>
    <p>${body}</p>
  </div>
</body>
</html>`;
}

function htmlResponse(page: string): Response {
  return new Response(page, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// A generic page shown for missing/invalid/tampered tokens and any unexpected
// error. It intentionally reveals nothing about whether a user id is valid, and
// returns 200 so validity can't be inferred from the status code (Req 5).
const NEUTRAL_PAGE = htmlPage(
  "Unsubscribe",
  "Unable to process this request",
  "This unsubscribe link is invalid or has expired."
);

const CONFIRMATION_PAGE = htmlPage(
  "Unsubscribed",
  "You've been unsubscribed",
  "You will no longer receive initiative reminder emails."
);

/**
 * GET /api/notifications/unsubscribe?token=...
 *
 * Clicked directly from a reminder email — no login required (Req 5.5). It is
 * exempted from the auth redirect in `src/lib/supabase/middleware.ts`.
 *
 * On a valid, untampered token: upsert the recipient's opt-out row via the
 * service-role client and show a confirmation page. The upsert (not insert)
 * makes repeat clicks idempotent (Req 5.2). On a missing/invalid/tampered
 * token — or any unexpected DB error — show a neutral page and write nothing,
 * always returning 200 so token validity can't be inferred (Req 5.3, 5.5).
 */
export async function GET(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token");

  const payload = verifyUnsubscribeToken(token);
  if (!payload) {
    // Missing / invalid / tampered token: neutral page, nothing written.
    return htmlResponse(NEUTRAL_PAGE);
  }

  try {
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Upsert (not insert) so a second click on the same link doesn't error and
    // still lands on the confirmation page. user_id is the PK / conflict target.
    const { error } = await adminClient
      .from("notification_opt_outs")
      .upsert(
        { user_id: payload.userId, category: payload.category },
        { onConflict: "user_id" }
      );

    if (error) {
      console.error("[notifications/unsubscribe] Opt-out upsert failed:", error.message);
      // Don't 500 to an email click — show a graceful neutral page instead.
      return htmlResponse(NEUTRAL_PAGE);
    }

    return htmlResponse(CONFIRMATION_PAGE);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[notifications/unsubscribe] Unexpected error:", message);
    return htmlResponse(NEUTRAL_PAGE);
  }
}
