import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * PUT /api/admin/initiative-types/[id]
 *
 * Updates an initiative type. Admin-only.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    console.log("[admin/initiative-types/id] PUT:", id, "body keys:", Object.keys(body).join(","));

    // Auth
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

    // Build update payload (only include provided fields)
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const updateData: Record<string, any> = { updated_at: new Date().toISOString() };

    if (body.name !== undefined) updateData.name = body.name;
    if (body.channel !== undefined) updateData.channel = body.channel;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.owner !== undefined) updateData.owner = body.owner;
    if (body.benchmarks !== undefined) updateData.benchmarks = body.benchmarks;
    if (body.projectTemplate !== undefined) updateData.project_template = body.projectTemplate;
    if (body.difficulty !== undefined) updateData.difficulty = body.difficulty;
    if (body.aiContext !== undefined) updateData.ai_context = body.aiContext;
    if (body.tier !== undefined) updateData.tier = body.tier;
    if (body.displayOrder !== undefined) updateData.display_order = body.displayOrder;
    if (body.isActive !== undefined) updateData.is_active = body.isActive;

    console.log("[admin/initiative-types/id] Updating fields:", Object.keys(updateData).join(","));

    const { data, error } = await adminClient
      .from("initiative_types")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[admin/initiative-types/id] Update error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Initiative type not found" }, { status: 404 });
    }

    console.log("[admin/initiative-types/id] Updated:", data.name);

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
    console.error("[admin/initiative-types/id] PUT Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/initiative-types/[id]
 *
 * Soft-deletes (deactivates) an initiative type. Admin-only.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    console.log("[admin/initiative-types/id] DELETE:", id);

    // Auth
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

    // Soft delete (set is_active = false)
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error } = await adminClient
      .from("initiative_types")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("[admin/initiative-types/id] Delete error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("[admin/initiative-types/id] Deactivated:", id);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[admin/initiative-types/id] DELETE Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
