import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/**
 * Authenticate the request via the established cookie pattern (anon key).
 * Returns the user, or null if there is no session.
 */
async function getSessionUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {}
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/** Service-role client for the actual reads/writes (always scoped by user_id). */
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  metadata: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

/**
 * GET /api/notifications
 *
 * Returns the current user's notifications newest-first plus an unread count.
 * Query params:
 *   - limit  optional, default 20, capped at 50
 *   - unread optional; when "1" (or "true"), only unread notifications
 *
 * Always scoped to `user_id = user.id` so a user only ever sees their own feed.
 * Response: { notifications: [{ id, type, title, body, link, metadata, readAt, createdAt }], unreadCount }
 */
export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = new URL(request.url).searchParams;
    const rawLimit = Number(params.get("limit"));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;
    const unreadFilter = params.get("unread") === "1" || params.get("unread") === "true";

    const db = adminClient();

    let query = db
      .from("app_notifications")
      .select("id, type, title, body, link, metadata, read_at, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (unreadFilter) {
      query = query.is("read_at", null);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[api/notifications] GET query error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Unread badge count is always the total unread, independent of filters/limit.
    const { count, error: countErr } = await db
      .from("app_notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null);

    if (countErr) {
      console.error("[api/notifications] GET count error:", countErr.message);
      return NextResponse.json({ error: countErr.message }, { status: 500 });
    }

    const notifications = ((data as NotificationRow[]) || []).map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      link: row.link,
      metadata: row.metadata ?? {},
      readAt: row.read_at,
      createdAt: row.created_at,
    }));

    return NextResponse.json({ notifications, unreadCount: count ?? 0 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/notifications] GET Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}

/**
 * PATCH /api/notifications
 *
 * Mark the current user's notifications read. Body: { ids?: string[], all?: boolean }
 *   - all === true      : mark every unread notification read
 *   - ids (non-empty)   : mark those notifications read
 *
 * Always scoped to `user_id = user.id`, so a user can never mark someone else's
 * rows read even if they pass foreign ids. Returns { success: true }.
 */
export async function PATCH(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: { ids?: unknown; all?: unknown } = {};
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object") {
        body = parsed as { ids?: unknown; all?: unknown };
      }
    } catch {
      body = {};
    }

    const all = body.all === true;
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((v): v is string => typeof v === "string")
      : [];

    const db = adminClient();
    const now = new Date().toISOString();

    if (all) {
      const { error } = await db
        .from("app_notifications")
        .update({ read_at: now })
        .eq("user_id", user.id)
        .is("read_at", null);
      if (error) {
        console.error("[api/notifications] PATCH (all) error:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    if (ids.length > 0) {
      const { error } = await db
        .from("app_notifications")
        .update({ read_at: now })
        .eq("user_id", user.id)
        .in("id", ids);
      if (error) {
        console.error("[api/notifications] PATCH (ids) error:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "ids_or_all_required" }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/notifications] PATCH Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
