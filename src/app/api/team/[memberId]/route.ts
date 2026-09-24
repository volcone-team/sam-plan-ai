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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[team/remove] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}

/**
 * PATCH /api/team/[memberId]
 *
 * Edits a team member's first name, last name, and/or role.
 * Only the company owner can edit members. Owner rows' roles cannot be
 * changed here, and the owner cannot demote themselves away from Owner.
 */
export async function PATCH(
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
        { error: "Only the company owner can edit team members." },
        { status: 403 }
      );
    }

    // Parse body, tolerating a missing/empty body
    let body: { firstName?: unknown; lastName?: unknown; role?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const hasFirstName = body.firstName !== undefined;
    const hasLastName = body.lastName !== undefined;
    const hasRole = body.role !== undefined;

    if (!hasFirstName && !hasLastName && !hasRole) {
      return NextResponse.json({ error: "no_changes" }, { status: 400 });
    }

    let firstName: string | undefined;
    let lastName: string | undefined;
    let role: string | undefined;

    if (hasFirstName) {
      if (typeof body.firstName !== "string" || body.firstName.trim().length === 0) {
        return NextResponse.json({ error: "firstName" }, { status: 400 });
      }
      firstName = body.firstName.trim();
    }

    if (hasLastName) {
      if (typeof body.lastName !== "string" || body.lastName.trim().length === 0) {
        return NextResponse.json({ error: "lastName" }, { status: 400 });
      }
      lastName = body.lastName.trim();
    }

    if (hasRole) {
      const allowedRoles = ["operator", "team_member", "viewer"];
      if (typeof body.role !== "string" || !allowedRoles.includes(body.role)) {
        return NextResponse.json(
          { error: "role", message: "Role must be operator, team_member, or viewer." },
          { status: 400 }
        );
      }
      role = body.role;
    }

    // Verify the target member belongs to the caller's company (service-role read)
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: memberProfile } = await adminClient
      .from("profiles")
      .select("company_id, role")
      .eq("id", memberId)
      .single();

    if (!memberProfile || memberProfile.company_id !== profile.company_id) {
      return NextResponse.json(
        { error: "Member not found in your company." },
        { status: 404 }
      );
    }

    // Ownership guards: never strand ownership, never modify owner rows' roles here.
    if (hasRole) {
      if (memberId === user.id && role !== "owner") {
        return NextResponse.json(
          { error: "cannot_demote_self", message: "You can't change your own role away from Owner." },
          { status: 400 }
        );
      }
      if (memberProfile.role === "owner") {
        return NextResponse.json(
          { error: "cannot_change_owner", message: "Owner role can't be changed here." },
          { status: 400 }
        );
      }
    }

    // Build the patch with only the provided fields
    const patch: { first_name?: string; last_name?: string; role?: string } = {};
    if (firstName !== undefined) patch.first_name = firstName;
    if (lastName !== undefined) patch.last_name = lastName;
    if (role !== undefined) patch.role = role;

    console.log("[team/edit] Updating member", memberId, "fields:", Object.keys(patch).join(", "));

    const { data: updated, error: updateError } = await adminClient
      .from("profiles")
      .update(patch)
      .eq("id", memberId)
      .select("id, email, first_name, last_name, role")
      .single();

    if (updateError) {
      console.error("[team/edit] Update error:", updateError.message);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      member: {
        id: updated.id,
        email: updated.email,
        firstName: updated.first_name,
        lastName: updated.last_name,
        role: updated.role,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[team/edit] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
