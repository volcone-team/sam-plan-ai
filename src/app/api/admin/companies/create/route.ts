import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * POST /api/admin/companies/create
 *
 * Admin creates a new company + owner user.
 * Used for onboarding customers who need a ready-made dashboard.
 *
 * Body: { companyName, ownerEmail, ownerFirstName, ownerLastName, ownerPassword }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { companyName, ownerEmail, ownerFirstName, ownerLastName, ownerPassword } = body;

    console.log("[admin/companies/create] Creating:", companyName, "| owner:", ownerEmail);

    // Validate
    if (!companyName || !ownerEmail || !ownerFirstName || !ownerPassword) {
      return NextResponse.json(
        { error: "Company name, owner email, first name, and password are required." },
        { status: 400 }
      );
    }

    if (ownerPassword.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
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
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (!adminProfile?.is_admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    console.log("[admin/companies/create] Admin verified:", user.email);

    // 2. Service role client
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 3. Create the company
    const { data: company, error: compError } = await adminClient
      .from("companies")
      .insert({
        name: companyName,
        description: "",
        fiscal_year: new Date().getFullYear(),
        planning_year: new Date().getFullYear(),
        currency: "USD",
      })
      .select()
      .single();

    if (compError || !company) {
      console.error("[admin/companies/create] Company insert failed:", compError?.message);
      return NextResponse.json({ error: compError?.message || "Failed to create company" }, { status: 500 });
    }

    console.log("[admin/companies/create] Company created:", company.id, company.name);

    // 4. Create the auth user (skip email verification)
    const { data: newUser, error: authError } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
      user_metadata: {
        first_name: ownerFirstName,
        last_name: ownerLastName || "",
        company_name: companyName,
      },
    });

    if (authError || !newUser?.user) {
      // Clean up the company we just created
      await adminClient.from("companies").delete().eq("id", company.id);
      console.error("[admin/companies/create] Auth user failed:", authError?.message);

      if (authError?.message?.includes("already")) {
        return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
      }
      return NextResponse.json({ error: authError?.message || "Failed to create user" }, { status: 500 });
    }

    console.log("[admin/companies/create] Auth user created:", newUser.user.id);

    // 5. Wait for trigger, then fix the profile to point to our company
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Delete auto-created company from trigger (if different)
    const { data: autoProfile } = await adminClient
      .from("profiles")
      .select("company_id")
      .eq("id", newUser.user.id)
      .single();

    if (autoProfile?.company_id && autoProfile.company_id !== company.id) {
      console.log("[admin/companies/create] Cleaning up trigger-created company:", autoProfile.company_id);
      await adminClient.from("companies").delete().eq("id", autoProfile.company_id);
    }

    // Update profile to point to our company
    const { error: profileErr } = await adminClient
      .from("profiles")
      .update({
        company_id: company.id,
        first_name: ownerFirstName,
        last_name: ownerLastName || "",
        role: "owner",
        is_admin: false,
      })
      .eq("id", newUser.user.id);

    if (profileErr) {
      console.error("[admin/companies/create] Profile update failed:", profileErr.message);
    }

    // 6. Create default annual plan
    await adminClient.from("annual_plans").insert({
      company_id: company.id,
      year: new Date().getFullYear(),
      baseline_revenue: 0,
      stretch_revenue: 0,
      operating_budget: 0,
      status: "draft",
    });

    console.log("[admin/companies/create] Complete:", companyName, "| owner:", ownerEmail);

    return NextResponse.json({
      success: true,
      company: {
        id: company.id,
        name: company.name,
      },
      user: {
        id: newUser.user.id,
        email: ownerEmail,
        firstName: ownerFirstName,
        lastName: ownerLastName || "",
      },
    });
  } catch (err: any) {
    console.error("[admin/companies/create] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
