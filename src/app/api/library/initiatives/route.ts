import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { loadCustomerLibrary } from "@/lib/library/customer-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/library/initiatives — every ACTIVE library initiative, for the
 * in-app Add Initiative panel.
 *
 * Any signed-in user may read it: the library is one catalogue for every
 * company, so there is nothing to scope. Authentication is still required
 * because the library is the product's IP, not public reference data. Read via
 * the service role because the wb_* tables are not exposed to customers by
 * RLS; the response is narrowed to picker fields (see CustomerLibraryItem).
 *
 * Responses:
 *   200 { initiatives: CustomerLibraryItem[] }
 *   401 { error: "Unauthorized" }
 */
export async function GET() {
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
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const initiatives = await loadCustomerLibrary(db);
    return NextResponse.json({ initiatives });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[library/initiatives] GET failed:", message);
    return NextResponse.json({ error: "Could not load the initiative library." }, { status: 500 });
  }
}
