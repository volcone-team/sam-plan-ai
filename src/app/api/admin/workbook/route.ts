import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * GET /api/admin/workbook
 *
 * Returns the current workbook data (if any).
 * Admin-only.
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
      console.log("[admin/workbook] GET - No user session");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    console.log("[admin/workbook] GET - User:", user.email, "| is_admin:", profile?.is_admin);

    if (!profile?.is_admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // Get latest workbook
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: workbook, error } = await adminClient
      .from("workbook_data")
      .select("*")
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows (not an error for us)
      console.error("[admin/workbook] GET - Query error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!workbook) {
      console.log("[admin/workbook] GET - No workbook found");
      return NextResponse.json({ workbook: null });
    }

    console.log("[admin/workbook] GET - Found workbook:", workbook.file_name, "sheets:", workbook.total_sheets);

    return NextResponse.json({
      workbook: {
        id: workbook.id,
        fileName: workbook.file_name,
        uploadedAt: workbook.uploaded_at,
        totalSheets: workbook.total_sheets,
        sheets: workbook.sheets,
      },
    });
  } catch (err: any) {
    console.error("[admin/workbook] GET Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}

/**
 * POST /api/admin/workbook
 *
 * Replaces the workbook data with new parsed content.
 * Expects JSON body: { fileName, sheets: [{ name, headers, rows, rowCount }] }
 * Admin-only.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { fileName, sheets } = body;

    console.log("[admin/workbook] POST - fileName:", fileName, "sheets:", sheets?.length);

    if (!fileName || !sheets || !Array.isArray(sheets)) {
      return NextResponse.json({ error: "fileName and sheets array are required" }, { status: 400 });
    }

    // Auth + admin
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

    console.log("[admin/workbook] POST - User:", user.email, "| is_admin:", profile?.is_admin);

    if (!profile?.is_admin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Delete existing workbook(s) — only one allowed
    console.log("[admin/workbook] POST - Deleting existing workbooks...");
    await adminClient.from("workbook_data").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    // Insert new
    const { data, error } = await adminClient
      .from("workbook_data")
      .insert({
        file_name: fileName,
        uploaded_at: new Date().toISOString(),
        total_sheets: sheets.length,
        sheets: sheets,
      })
      .select()
      .single();

    if (error) {
      console.error("[admin/workbook] POST - Insert error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("[admin/workbook] POST - Saved workbook:", data.id, "| sheets:", data.total_sheets);

    return NextResponse.json({
      success: true,
      workbook: {
        id: data.id,
        fileName: data.file_name,
        uploadedAt: data.uploaded_at,
        totalSheets: data.total_sheets,
      },
    });
  } catch (err: any) {
    console.error("[admin/workbook] POST Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/workbook
 *
 * Deletes the workbook data.
 */
export async function DELETE() {
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
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (!profile?.is_admin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    console.log("[admin/workbook] DELETE - Removing all workbook data");

    await adminClient.from("workbook_data").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    console.log("[admin/workbook] DELETE - Done");

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[admin/workbook] DELETE Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
