import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getInviteContext, sendMemberInvite } from "@/lib/team-invite";
import { LIMIT_KEYS } from "@/lib/billing/limits";
import { checkLiveLimit, liveLimitResponse } from "@/lib/billing/live-limits";

/**
 * POST /api/team/create-member
 *
 * Creates a new team member for the requesting user's company.
 * Only the company owner can create members.
 *
 * The member is created WITHOUT a password. They receive a branded invite
 * email with a link to set their own password. Member creation never fails
 * just because the invite email couldn't be sent — the response reports
 * whether the invite went out via the `invited` flag, and the UI offers a
 * resend option.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { firstName, lastName, email, role } = body;

    // Validate inputs
    if (!firstName || !lastName || !email) {
      return NextResponse.json(
        { error: "First name, last name, and email are required." },
        { status: 400 }
      );
    }

    if (!["operator", "team_member", "viewer"].includes(role)) {
      return NextResponse.json(
        { error: "Role must be 'operator', 'team_member', or 'viewer'." },
        { status: 400 }
      );
    }

    // 1. Authenticate the requesting user
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

    // 2. Verify the user is a company owner
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id, role, first_name, last_name")
      .eq("id", user.id)
      .single();

    if (!profile?.company_id) {
      return NextResponse.json({ error: "No company found." }, { status: 400 });
    }

    if (profile.role !== "owner") {
      return NextResponse.json(
        { error: "Only the company owner can add team members." },
        { status: 403 }
      );
    }

    const companyId = profile.company_id;

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    /**
     * 3. Plan limit: max_users, a LIVE count of every profile in the company
     * (owner, members, viewers and invites not yet accepted). Checked BEFORE
     * createUser, so a refusal leaves no auth user or trigger-made company
     * behind to clean up.
     */
    const limit = await checkLiveLimit(adminClient, companyId, LIMIT_KEYS.MAX_USERS, 1);
    if (!limit.ok) return liveLimitResponse(limit);

    // 4. Create the auth user with service role (no password — invite flow)
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      email_confirm: true, // Account usable; they'll set a password via invite link
      user_metadata: {
        // No password chosen yet — middleware confines this session to
        // /auth/set-password until they pick one.
        needs_password: true,
        first_name: firstName,
        last_name: lastName,
        company_name: null, // They're joining an existing company
      },
    });

    if (createError) {
      // Handle duplicate email
      if (createError.message?.includes("already been registered") || createError.message?.includes("already exists")) {
        return NextResponse.json(
          { error: "A user with this email already exists." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: createError.message }, { status: 400 });
    }

    if (!newUser?.user) {
      return NextResponse.json({ error: "Failed to create user." }, { status: 500 });
    }

    // 5. Fix the profile created by the handle_new_user trigger.
    // The trigger creates a NEW company + profile for the user. We need to:
    //   a) Wait briefly for the trigger to complete
    //   b) Find the auto-created company and delete it
    //   c) Update the profile to point to the owner's company

    // Give the trigger a moment to complete
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Find what the trigger created
    const { data: autoProfile } = await adminClient
      .from("profiles")
      .select("company_id")
      .eq("id", newUser.user.id)
      .single();

    if (autoProfile?.company_id && autoProfile.company_id !== companyId) {
      // Remove the auto-created company (cascade deletes annual_plan too)
      await adminClient
        .from("companies")
        .delete()
        .eq("id", autoProfile.company_id);
    }

    // Update the profile to the correct company (use update, not upsert)
    const { data: updatedRows, error: profileError } = await adminClient
      .from("profiles")
      .update({
        company_id: companyId,
        first_name: firstName,
        last_name: lastName,
        role,
        is_admin: false,
      })
      .eq("id", newUser.user.id)
      // Returned so the decision below rests on what the UPDATE actually did,
      // rather than on a SELECT taken a moment earlier.
      .select("id");

    /**
     * Insert only if the update genuinely matched nothing.
     *
     * This used to branch on `!autoProfile` — the result of a SELECT taken
     * before the update. Those can disagree: the trigger can commit in the gap,
     * so the SELECT sees no row, the UPDATE then succeeds, and the insert runs
     * anyway and fails on the duplicate primary key. The caller got a 500 and
     * the auth user was deleted, for a member who had in fact been created
     * correctly.
     */
    if (!profileError && (updatedRows?.length ?? 0) === 0) {
      const { error: insertError } = await adminClient
        .from("profiles")
        .insert({
          id: newUser.user.id,
          company_id: companyId,
          email,
          first_name: firstName,
          last_name: lastName,
          role,
          is_admin: false,
        });

      if (insertError) {
        await adminClient.auth.admin.deleteUser(newUser.user.id);
        return NextResponse.json(
          { error: "Failed to create member profile: " + insertError.message },
          { status: 500 }
        );
      }
    }

    if (profileError) {
      console.error("[team/create-member] Profile update error:", profileError.message);
    }

    /**
     * VERIFY THE ROLE LANDED, AND REFUSE TO LEAVE AN OWNER BEHIND.
     *
     * `handle_new_user` creates every auth user as the OWNER of a brand-new
     * company. This route's job is to overwrite that with the invited role and
     * the inviting company. The previous code logged a failed update and
     * carried on, commenting that "the profile might still be correct if
     * trigger handled it" — but the trigger's version is precisely the wrong
     * one. A failure there silently produced a full owner of someone else's
     * company, with billing access and the ability to delete the account, and
     * nothing anywhere would have said so.
     *
     * So the final state is read back and checked. If it is not what was asked
     * for, the auth user is removed and the request fails loudly: no member is
     * far better than an accidental owner, and the inviter can simply try
     * again.
     */
    const { data: finalProfile } = await adminClient
      .from("profiles")
      .select("role, company_id")
      .eq("id", newUser.user.id)
      .maybeSingle();

    if (finalProfile?.role !== role || finalProfile?.company_id !== companyId) {
      console.error(
        "[team/create-member] Profile did not take the invited role — rolling back.",
        "wanted role:", role, "got:", finalProfile?.role,
        "| wanted company:", companyId, "got:", finalProfile?.company_id
      );

      await adminClient.auth.admin.deleteUser(newUser.user.id);

      return NextResponse.json(
        {
          error:
            "Could not finish setting up that member, so nothing was created. " +
            "Please try again.",
        },
        { status: 500 }
      );
    }

    // 6. Generate the invite link and email it. This is best-effort — the
    // member is already created, so an email failure must NOT fail the request.
    let invited = false;
    try {
      const { inviterName, companyName } = await getInviteContext(
        adminClient,
        {
          first_name: profile.first_name ?? (user.user_metadata?.first_name as string | undefined) ?? null,
          last_name: profile.last_name ?? (user.user_metadata?.last_name as string | undefined) ?? null,
        },
        companyId
      );

      invited = await sendMemberInvite(adminClient, {
        createdBy: user.id,
        email,
        inviterName,
        companyName,
        role,
      });
    } catch (inviteErr: unknown) {
      const message = inviteErr instanceof Error ? inviteErr.message : String(inviteErr);
      console.error("[team/create-member] Invite send failed:", message);
      invited = false;
    }

    return NextResponse.json({
      success: true,
      member: {
        id: newUser.user.id,
        email,
        firstName,
        lastName,
        role,
      },
      invited,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[team/create-member] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
