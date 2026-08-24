import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * DELETE /api/team/[memberId]
 *
 * Removes a team member from the company.
 * Only the company owner can remove members.
 * Cannot remove yourself.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const { memberId } = await params;

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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify the requesting user is the company owner
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id, role")
      .eq("id", user.id)
      .single();

    if (!profile?.company_id || profile.role !== "owner") {
      return NextResponse.json(
        { error: "Only the company owner can remove team members." },
        { status: 403 }
      );
    }

    // Prevent removing yourself
    if (memberId === user.id) {
      return NextResponse.json(
        { error: "You cannot remove yourself from the team." },
        { status: 400 }
      );
    }

    // Verify the member belongs to the same company
    const { data: memberProfile } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", memberId)
      .single();

    if (!memberProfile || memberProfile.company_id !== profile.company_id) {
      return NextResponse.json(
        { error: "Member not found in your company." },
        { status: 404 }
      );
    }

    // Delete the auth user (this cascades to delete the profile via FK)
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(memberId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[team/remove] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
