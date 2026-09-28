import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getInviteContext, sendMemberInvite } from "@/lib/team-invite";
import { logActivity } from "@/lib/activity-log";

/**
 * POST /api/admin/users/create
 *
 * Admin creates a new user and assigns them to an existing company.
 *
 * The user is created WITHOUT a password. They receive a branded invite email
 * with a link to set their own password. Creation never fails just because the
 * invite email couldn't be sent — the response reports whether the invite went
 * out via the `invited` flag.
 *
 * Body: { companyId, email, firstName, lastName, role }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { companyId, email, firstName, lastName, role } = body;

    console.log("[admin/users/create] Creating user:", email, "for company:", companyId);

    // Validate
    if (!companyId || !email || !firstName || !role) {
      return NextResponse.json(
        { error: "Company, email, first name, and role are required." },
        { status: 400 }
      );
    }

    if (!["owner", "operator", "team_member", "viewer"].includes(role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }

    // 1. Auth check — only admins
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

    const { data: adminProfile } = await supabase
      .from("profiles")
      .select("is_admin, first_name, last_name")
      .eq("id", user.id)
      .single();

    if (!adminProfile?.is_admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // 2. Service role client
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 3. Verify company exists
    const { data: company } = await adminClient
      .from("companies")
      .select("id, name")
      .eq("id", companyId)
      .single();

    if (!company) {
      return NextResponse.json({ error: "Company not found." }, { status: 404 });
    }

    console.log("[admin/users/create] Company found:", company.name);

    // 4. Create auth user (no password — invite flow)
    const { data: newUser, error: authError } = await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        // No password chosen yet — middleware confines this session to
        // /auth/set-password until they pick one.
        needs_password: true,
        first_name: firstName,
        last_name: lastName || "",
      },
    });

    if (authError || !newUser?.user) {
      console.error("[admin/users/create] Auth error:", authError?.message);
      if (authError?.message?.includes("already")) {
        return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
      }
      return NextResponse.json({ error: authError?.message || "Failed to create user" }, { status: 500 });
    }

    console.log("[admin/users/create] Auth user created:", newUser.user.id);

    // 5. Wait for trigger, then fix profile
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Delete auto-created company from trigger
    const { data: autoProfile } = await adminClient
      .from("profiles")
      .select("company_id")
      .eq("id", newUser.user.id)
      .single();

    if (autoProfile?.company_id && autoProfile.company_id !== companyId) {
      await adminClient.from("companies").delete().eq("id", autoProfile.company_id);
      console.log("[admin/users/create] Cleaned up trigger company:", autoProfile.company_id);
    }

    // Update profile to target company
    const { error: profileErr } = await adminClient
      .from("profiles")
      .update({
        company_id: companyId,
        first_name: firstName,
        last_name: lastName || "",
        role,
        is_admin: false,
      })
      .eq("id", newUser.user.id);

    if (profileErr) {
      console.error("[admin/users/create] Profile update failed:", profileErr.message);
    }

    // 6. Generate the invite link and email it. Best-effort — the user is
    // already created, so an email failure must NOT fail the request.
    let invited = false;
    try {
      const { inviterName, companyName } = await getInviteContext(
        adminClient,
        {
          first_name:
            adminProfile.first_name ??
            (user.user_metadata?.first_name as string | undefined) ??
            null,
          last_name:
            adminProfile.last_name ??
            (user.user_metadata?.last_name as string | undefined) ??
            null,
        },
        companyId
      );

      invited = await sendMemberInvite(adminClient, {
        email,
        inviterName,
        companyName,
        role,
      });
    } catch (inviteErr: unknown) {
      const message = inviteErr instanceof Error ? inviteErr.message : String(inviteErr);
      console.error("[admin/users/create] Invite send failed:", message);
      invited = false;
    }

    console.log("[admin/users/create] Done:", email, "→", company.name, "as", role, "| invited:", invited);

    // Audit trail — never throws, never affects this response.
    await logActivity(
      {
        actorUserId: user.id,
        actorEmail: user.email ?? null,
        action: "user.created",
        targetType: "user",
        targetId: newUser.user.id,
        targetLabel: email,
        companyId,
        metadata: { role, companyId, companyName: company.name, invited },
      },
      adminClient
    );

    return NextResponse.json({
      success: true,
      user: {
        id: newUser.user.id,
        email,
        firstName,
        lastName: lastName || "",
        role,
        companyName: company.name,
      },
      invited,
    });
  } catch (err: any) {
    console.error("[admin/users/create] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
