import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { FaqMigrationMissingError, loadPublicFaq } from "@/lib/faq/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Behind auth: no shared cache may keep it; admins expect edits to show at once. */
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/faq
 *
 * The published FAQ for any signed-in user. No plan gating. Built only by
 * buildPublicFaq (src/lib/faq/faq.ts): drafts, unpublished categories and
 * empty categories are absent.
 *
 * The FAQ tables have RLS on with no policies, so they are read with the
 * service-role client; the caller's session only proves they are signed in.
 *
 * Responses (all `Cache-Control: no-store`):
 *   200 FaqPublicResponse
 *   401 { error: "Unauthorized" }
 *   503 { error: "migration_not_applied" }   migration 039 not run yet
 *   500 { error: "internal_error" }
 */
export async function GET() {
  try {
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
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const body = await loadPublicFaq(db);
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (err: unknown) {
    if (err instanceof FaqMigrationMissingError) {
      console.warn("[faq] Migration 039 not applied:", err.message);
      return NextResponse.json({ error: "migration_not_applied" }, { status: 503, headers: NO_STORE });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[faq] Error:", message);
    return NextResponse.json({ error: "internal_error" }, { status: 500, headers: NO_STORE });
  }
}
