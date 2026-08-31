import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * GET /api/admin/initiative-types
 *
 * Returns ALL initiative types (including inactive).
 * Admin-only.
 */
export async function GET() {
  try {
    // 1. Auth + admin check
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
      console.log("[admin/initiative-types] No user session");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    console.log("[admin/initiative-types] User:", user.email, "| is_admin:", profile?.is_admin);

    if (!profile?.is_admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // 2. Service role to get all (including inactive)
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: types, error } = await adminClient
      .from("initiative_types")
      .select("*")
      .order("tier", { ascending: true })
      .order("display_order", { ascending: true });

    if (error) {
      console.error("[admin/initiative-types] Query error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("[admin/initiative-types] Found", types?.length || 0, "types");

    const result = (types || []).map((t) => ({
      id: t.id,
      name: t.name,
      channel: t.channel,
      description: t.description,
      owner: t.owner,
      benchmarks: t.benchmarks,
      projectTemplate: t.project_template,
      difficulty: t.difficulty,
      aiContext: t.ai_context,
      tier: t.tier,
      displayOrder: t.display_order,
      isActive: t.is_active,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    }));

    return NextResponse.json({ types: result });
  } catch (err: any) {
    console.error("[admin/initiative-types] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}

/**
 * POST /api/admin/initiative-types
 *
 * Creates a new initiative type.
 * Admin-only.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log("[admin/initiative-types] POST body:", JSON.stringify(body).slice(0, 200));

    // Auth + admin check
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
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (!profile?.is_admin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

    // Validate
    if (!body.name || !body.channel) {
      return NextResponse.json({ error: "Name and channel are required" }, { status: 400 });
    }

    // Insert
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const insertData = {
      name: body.name,
      channel: body.channel,
      description: body.description || "",
      owner: body.owner || "system",
      benchmarks: body.benchmarks || {},
      project_template: body.projectTemplate || { tasks: [], totalEstimatedHours: 0 },
      difficulty: body.difficulty || { effortToImplement: 5, skillExpertiseRequired: 5, timeToResults: 5, costToRun: 5 },
      ai_context: body.aiContext || { description: "", sizingGuidance: "", recommendationWeights: {} },
      tier: body.tier || 1,
      display_order: body.displayOrder ?? 0,
      is_active: body.isActive !== false,
    };

    console.log("[admin/initiative-types] Inserting:", insertData.name, "channel:", insertData.channel);

    const { data, error } = await adminClient
      .from("initiative_types")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error("[admin/initiative-types] Insert error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("[admin/initiative-types] Created:", data.id, data.name);

    return NextResponse.json({
      type: {
        id: data.id,
        name: data.name,
        channel: data.channel,
        description: data.description,
        owner: data.owner,
        benchmarks: data.benchmarks,
        projectTemplate: data.project_template,
        difficulty: data.difficulty,
        aiContext: data.ai_context,
        tier: data.tier,
        displayOrder: data.display_order,
        isActive: data.is_active,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    });
  } catch (err: any) {
    console.error("[admin/initiative-types] POST Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
