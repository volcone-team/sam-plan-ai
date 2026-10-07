import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { isIntakeEvent } from "@/lib/intake/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/intake/events — the analytics sink (D5, REQ-14.1).
 *
 * SECURITY. `company_id` and `user_id` are stamped from the SESSION, never read
 * from the body. A client-supplied company id would let anyone write rows
 * against another account and corrupt the funnel the business is about to make
 * decisions from.
 *
 * ALWAYS RETURNS 2xx on a recognised event, even when the insert fails. The
 * caller is `trackIntakeEvent`, which ignores the response — a 500 here would
 * only produce console noise during an intake, and a lost analytics row must
 * never look like a broken form. Failures are logged server-side instead.
 *
 * An UNRECOGNISED event name is rejected with 400, because that is a code bug
 * worth surfacing rather than a row worth storing: silently accepting
 * "intake_screen_complete" would leave a funnel with a missing step and no
 * indication why.
 *
 * Responses:
 *   202 { recorded: true }   — stored, or dropped without blocking the user
 *   400 { error }            — unknown event name or malformed body
 */
export async function POST(request: NextRequest) {
  let body: {
    event?: unknown;
    screen?: unknown;
    plan_path?: unknown;
    properties?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isIntakeEvent(body.event)) {
    return NextResponse.json(
      { error: `Unknown intake event: ${String(body.event)}` },
      { status: 400 }
    );
  }

  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {}
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // An unauthenticated event is dropped rather than refused: screen 0 can
    // fire before a session settles, and a 401 would make trackIntakeEvent
    // retry-less noise. Nothing to attribute it to, so nothing to store.
    if (!user) {
      return NextResponse.json({ recorded: false }, { status: 202 });
    }

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: profile } = await db
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .maybeSingle();

    const { error } = await db.from("intake_events").insert({
      // company_id is nullable: a brand-new signup may have no company yet, and
      // losing that event would bias the very funnel being measured.
      company_id: (profile?.company_id as string | null) ?? null,
      user_id: user.id,
      event: body.event,
      screen: asText(body.screen),
      plan_path: asText(body.plan_path),
      properties: isRecord(body.properties) ? body.properties : {},
    });

    if (error) {
      console.error("[intake/events] insert failed:", error.message);
      return NextResponse.json({ recorded: false }, { status: 202 });
    }

    return NextResponse.json({ recorded: true }, { status: 202 });
  } catch (err: unknown) {
    // Swallowed on purpose. See the note above: analytics must not be able to
    // interrupt someone filling in the intake.
    console.error(
      "[intake/events] Error:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json({ recorded: false }, { status: 202 });
  }
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
