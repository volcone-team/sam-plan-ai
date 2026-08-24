import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * POST /api/team/create-member
 *
 * Creates a new team member for the requesting user's company.
 * Only the company owner can create members.
 * Uses the service role key to bypass email verification.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { firstName, lastName, email, password, role } = body;

    // Validate inputs
    if (!firstName || !lastName || !email || !password) {
      return NextResponse.json(
        { error: "First name, last name, email, and password are required." },
        { status: 400 }
      );
    }

    if (!["operator", "viewer"].includes(role)) {
      return NextResponse.json(
        { error: "Role must be 'operator' or 'viewer'." },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters." },
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
      .select("company_id, role")
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

    // 3. Create the auth user with service role (skips email verification)
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Skip email verification
      user_metadata: {
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

    // 4. Fix the profile created by the handle_new_user trigger.
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
    const { error: profileError } = await adminClient
      .from("profiles")
      .update({
        company_id: companyId,
        first_name: firstName,
        last_name: lastName,
        role,
        is_admin: false,
      })
      .eq("id", newUser.user.id);

    // If update found no row (trigger didn't fire), insert it
    if (!autoProfile) {
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
      // Non-fatal: the profile might still be correct if trigger handled it
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
    });
  } catch (err: any) {
    console.error("[team/create-member] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
