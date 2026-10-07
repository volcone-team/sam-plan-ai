import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  serialiseAnswers,
  serialiseProduct,
  serialiseInitiative,
  restoreDraft,
  statusUpdate,
  timestampColumnFor,
  type ProductDraft,
  type InitiativeDraft,
} from "@/lib/intake/draft";
import { resolveResumeScreen, type ScreenId } from "@/lib/intake/flow";
import type { IntakeAnswers } from "@/lib/intake/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/intake/draft — the caller's saved intake, or an empty draft.
 * POST /api/intake/draft — save the current answers and resume position.
 *
 * SECURITY. `company_id` is resolved from the authenticated session on every
 * request and is never read from the body. The same rule the chat account
 * context follows: a client-supplied company id would let anyone read or
 * overwrite another account's intake. The body is also filtered through the
 * serialisers in `lib/intake/draft.ts`, which write only known columns, so an
 * extra key cannot reach the table.
 *
 * Saves are PARTIAL by design (REQ-2.4). There is no "complete" requirement —
 * a user who abandons on screen 6 still leaves a usable row, and
 * `intake_abandoned` has something to attribute.
 *
 * Responses:
 *   GET  200 { found, answers, products, initiatives, resumeScreen, path }
 *   POST 200 { saved: true, planningInputId, resumeScreen }
 *        400 { error } — malformed body
 *        401 { error: "Unauthorized" }
 *        409 { error } — no company on the profile yet
 */

interface SaveBody {
  answers?: IntakeAnswers;
  products?: ProductDraft[];
  initiatives?: InitiativeDraft[];
  resumeScreen?: string;
}

/** Session user plus their company, or a response to return instead. */
async function resolveCaller() {
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
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
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

  const companyId = (profile?.company_id as string | null) ?? null;

  if (!companyId) {
    // The intake is company-scoped, so there is nowhere to put the answers.
    return {
      error: NextResponse.json(
        { error: "No company on this profile yet." },
        { status: 409 }
      ),
    };
  }

  return { user, db, companyId };
}

/**
 * The company's current v2 intake row.
 *
 * Most recent first so a company with history resumes the latest attempt
 * rather than an abandoned older one.
 */
async function currentInput(db: SupabaseClient, companyId: string) {
  const { data } = await db
    .from("planning_inputs")
    .select("*")
    .eq("company_id", companyId)
    .eq("intake_version", 2)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as Record<string, unknown> | null) ?? null;
}

export async function GET() {
  try {
    const caller = await resolveCaller();
    if ("error" in caller) return caller.error;
    const { db, companyId } = caller;

    const input = await currentInput(db, companyId);

    if (!input) {
      const empty = restoreDraft(null);
      return NextResponse.json({ ...empty, planningInputId: null });
    }

    const planningInputId = input.id as string;

    const [{ data: products }, { data: initiatives }] = await Promise.all([
      db
        .from("intake_products")
        .select("*")
        .eq("planning_input_id", planningInputId)
        .order("display_order", { ascending: true }),
      db
        .from("intake_initiatives")
        .select("*")
        .eq("planning_input_id", planningInputId)
        .order("display_order", { ascending: true }),
    ]);

    const restored = restoreDraft(
      input,
      (products ?? []) as Record<string, unknown>[],
      (initiatives ?? []) as Record<string, unknown>[]
    );

    return NextResponse.json({ ...restored, planningInputId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[intake/draft] GET failed:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const caller = await resolveCaller();
    if ("error" in caller) return caller.error;
    const { db, companyId } = caller;

    let body: SaveBody;
    try {
      body = (await request.json()) as SaveBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const answers = isRecord(body.answers) ? body.answers : {};
    const products = Array.isArray(body.products) ? body.products : [];
    const initiatives = Array.isArray(body.initiatives) ? body.initiatives : [];

    /**
     * Validate the resume slug against the path IN THE BODY rather than trusting
     * it: a junk or off-path slug falls back to the start, so a stored position
     * can never send a user to a screen their path does not contain.
     */
    const resumeScreen: ScreenId = resolveResumeScreen(
      asPath(answers.intake_path),
      typeof body.resumeScreen === "string" ? body.resumeScreen : null
    );

    const existing = await currentInput(db, companyId);

    const row = serialiseAnswers({ answers, products, initiatives, resumeScreen });

    // REQ-14.3. Reaching the draft endpoint at all means the intake started.
    Object.assign(
      row,
      statusUpdate(
        existing?.onboarding_status as string | null,
        "intake_started",
        existing?.[timestampColumnFor("intake_started")] as string | null
      )
    );

    let planningInputId: string;

    if (existing?.id) {
      planningInputId = existing.id as string;
      const { error } = await db
        .from("planning_inputs")
        .update(row)
        .eq("id", planningInputId)
        // Belt and braces: the id came from a company-filtered read, and this
        // keeps the write scoped even if that ever changes.
        .eq("company_id", companyId);

      if (error) {
        console.error("[intake/draft] update failed:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      const { data, error } = await db
        .from("planning_inputs")
        .insert({ ...row, company_id: companyId, intake_route: "full" })
        .select("id")
        .single();

      if (error || !data) {
        console.error("[intake/draft] insert failed:", error?.message);
        return NextResponse.json(
          { error: error?.message || "Could not start the draft." },
          { status: 500 }
        );
      }
      planningInputId = data.id as string;
    }

    const childError = await saveChildren(
      db,
      companyId,
      planningInputId,
      products,
      initiatives
    );
    if (childError) {
      return NextResponse.json({ error: childError }, { status: 500 });
    }

    return NextResponse.json({ saved: true, planningInputId, resumeScreen });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[intake/draft] POST failed:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}

/**
 * Replace the product and initiative rows for this draft.
 *
 * DELETE-THEN-INSERT rather than a per-row diff. The cards are a repeater the
 * user adds to, removes from and reorders, so matching rows up would need
 * stable client ids that survive a reorder — and getting that wrong leaves
 * orphaned rows that quietly inflate the plan's revenue. Replacing the set
 * cannot drift, and these are a handful of rows per company.
 *
 * The cost is that row ids change on every save, which is why nothing holds a
 * reference to them between saves.
 */
async function saveChildren(
  db: SupabaseClient,
  companyId: string,
  planningInputId: string,
  products: readonly ProductDraft[],
  initiatives: readonly InitiativeDraft[]
): Promise<string | null> {
  const { error: deleteProducts } = await db
    .from("intake_products")
    .delete()
    .eq("planning_input_id", planningInputId);
  if (deleteProducts) return deleteProducts.message;

  const { error: deleteInitiatives } = await db
    .from("intake_initiatives")
    .delete()
    .eq("planning_input_id", planningInputId);
  if (deleteInitiatives) return deleteInitiatives.message;

  if (products.length > 0) {
    const rows = products.map((product, index) => ({
      ...serialiseProduct(product, index),
      company_id: companyId,
      planning_input_id: planningInputId,
    }));
    const { error } = await db.from("intake_products").insert(rows);
    if (error) return error.message;
  }

  if (initiatives.length > 0) {
    // An initiative with no type chosen yet would violate the NOT NULL on
    // initiative_key, and a half-picked card is not an answer worth storing.
    const rows = initiatives
      .map<Record<string, unknown>>((initiative, index) => ({
        ...serialiseInitiative(initiative, index),
        company_id: companyId,
        planning_input_id: planningInputId,
      }))
      .filter((row) => row.initiative_key !== "");

    if (rows.length > 0) {
      const { error } = await db.from("intake_initiatives").insert(rows);
      if (error) return error.message;
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asPath(value: unknown): "know_most" | "know_some" | "recommend_all" | null {
  return value === "know_most" || value === "know_some" || value === "recommend_all"
    ? value
    : null;
}
