import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { logActivity } from "@/lib/activity-log";
import { getInviteContext, sendMemberInvite } from "@/lib/team-invite";
import { stampCallUnlockForNewCompany } from "@/lib/access/call-gate-settings";
import { newCompanyGateAction } from "@/lib/access/portal-access";
import { isMissingColumnError } from "@/lib/supabase/missing-column";
import { ensureSubscriptionRow } from "@/lib/billing/subscription-row";
import { applyComp, parseCreateGrant, createGrantErrorMessage } from "@/lib/billing/comp";
import { ADMIN_CREATED_APP_METADATA } from "@/lib/auth/registration-setting";

/**
 * POST /api/admin/companies/create
 *
 * Admin creates a new company + owner user.
 * Used for onboarding customers who need a ready-made dashboard.
 *
 * The owner is created WITHOUT a password. They receive a branded invite email
 * with a link to set their own password. Creation never fails just because the
 * invite email couldn't be sent — the response reports whether the invite went
 * out via the `invited` flag.
 *
 * Body: { companyName, ownerEmail, ownerFirstName, ownerLastName,
 *         grantAccess?: boolean, planId?: string, compUntil?: string|null,
 *         compReason?: string }
 *
 * SUBSCRIPTIONS ROW. The signup trigger's subscriptions row belongs to the
 * company the trigger created, which this route deletes below. So the row for
 * OUR company is inserted here (ensureSubscriptionRow: the trigger's
 * trials-off default, never a trial). Without it every billing writer that
 * updates by company_id matched nothing, and a paying customer got no access.
 *
 * GRANT FULL ACCESS. With grantAccess true the company is comped exactly as
 * the table's "Grant access" action does (shared applyComp), and the
 * onboarding-call gate is NOT stamped: an admin set this account up, so there
 * is no call to wait for. The portal is recorded as open instead
 * (portal_access_granted_at), so the later backstop stamps see a decision. Comping is super-admin only, the same rule as
 * /api/admin/subscribers, and is checked before anything is created.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { companyName, ownerEmail, ownerFirstName, ownerLastName } = body;
    const grantParse = parseCreateGrant(
      body && typeof body === "object" ? (body as Record<string, unknown>) : {}
    );

    console.log("[admin/companies/create] Creating:", companyName, "| owner:", ownerEmail);

    // Validate
    if (!companyName || !ownerEmail || !ownerFirstName) {
      return NextResponse.json(
        { error: "Company name, owner email, and first name are required." },
        { status: 400 }
      );
    }
    if (!grantParse.ok) {
      return NextResponse.json(
        { error: createGrantErrorMessage(grantParse.error) },
        { status: 400 }
      );
    }
    const grant = grantParse.grant;

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
      .select("is_admin, admin_level, first_name, last_name")
      .eq("id", user.id)
      .single();

    if (!adminProfile?.is_admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // Comping is super-admin only (requireSuperAdmin on /api/admin/subscribers).
    // Refused up front so a plain admin's request creates nothing half-done.
    if (grant && adminProfile.admin_level !== "super_admin") {
      return NextResponse.json(
        {
          error:
            "Only a super admin can grant full access. Untick \u201cGrant full access\u201d " +
            "to create the company without it.",
        },
        { status: 403 }
      );
    }

    console.log("[admin/companies/create] Admin verified:", user.email);

    // 2. Service role client
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // A plan id that does not exist would only fail the comp AFTER the company
    // and owner exist. Checked first so it is a clean 400 instead.
    if (grant) {
      const { data: plan } = await adminClient
        .from("subscription_plans")
        .select("id")
        .eq("id", grant.planId)
        .maybeSingle();
      if (!plan) {
        return NextResponse.json({ error: "That plan does not exist." }, { status: 400 });
      }
    }

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

    /**
     * The company's own subscriptions row, right after the insert: the
     * trigger's row is about to be deleted along with the trigger's company.
     * Never overwrites. The row is the trials-off default (no access) until a
     * grant or a payment changes it.
     *
     * A failure is logged, not fatal: the admin table offers "Grant access" on
     * a row-less company, and that action, Checkout and the webhook all ensure
     * the row again.
     */
    const ensured = await ensureSubscriptionRow(adminClient, company.id);
    if (!ensured.ok) {
      console.error(
        "[admin/companies/create] Subscription row insert failed:",
        company.id,
        ensured.error
      );
    }

    /**
     * Onboarding call gate: snapshot the global switch onto the new company.
     *
     * SKIPPED when full access was requested: an admin set this account up,
     * so there is no onboarding call to wait for. Decided from the REQUEST,
     * before the grant runs, because the grant needs the owner to exist first;
     * if the grant later fails the admin is told and can grant from the table.
     *
     * This route is one of only two paths that create a company and it is the
     * one the application owns. `maxAgeMs: null` because we just created the
     * row, so the "is this really a new signup" age check has nothing to tell
     * us.
     *
     * Best-effort and never throws: a company that is not stamped is simply
     * not gated, which must not fail an admin's creation request. Before
     * migration 043 is applied the switch reads as off and this is a no-op.
     */
    /*
     * With a grant, skipping the stamp is not enough: a company with no flag
     * and no grant reads as UNDECIDED, and the backstop stamps (middleware,
     * /welcome) would flag it on the owner's first visit. So the decision is
     * recorded with the same columns the admin "Open portal" action writes,
     * before the owner exists. Before migration 043 the columns are missing
     * and there is no gate to decide, so that is a no-op. Any other failure is
     * logged, not fatal; the admin can open the portal from the table.
     */
    let portalOpened = false;
    const gateAction = newCompanyGateAction({
      grantRequested: !!grant,
      adminId: user.id,
      now: new Date().toISOString(),
    });
    if (gateAction.kind === "record_grant") {
      const { error: openErr } = await adminClient
        .from("companies")
        .update(gateAction.patch)
        .eq("id", company.id);
      if (!openErr) {
        portalOpened = true;
      } else if (!isMissingColumnError(openErr)) {
        console.error(
          "[admin/companies/create] Recording portal access failed:",
          company.id,
          openErr.message
        );
      }
    } else {
      const stamp = await stampCallUnlockForNewCompany(adminClient, company.id, {
        maxAgeMs: null,
      });
      if (stamp.requireCall) {
        console.log(
          "[admin/companies/create] Call gate:",
          stamp.reason,
          "| stamped:",
          stamp.stamped
        );
      }
    }

    // 4. Create the auth user (no password — invite flow, skip email verification)
    const { data: newUser, error: authError } = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      // Lets the account through while new registrations are closed (migration 062).
      app_metadata: { ...ADMIN_CREATED_APP_METADATA },
      email_confirm: true,
      user_metadata: {
        // No password chosen yet — middleware confines this session to
        // /auth/set-password until they pick one.
        needs_password: true,
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

    // 6b. Grant full access, if asked. After the owner exists, so a failed
    // user creation (which deletes the company) never runs it. A failure here
    // does NOT fail the request: the company and owner are real, the admin is
    // told via `grantError`, and can grant again from the companies table.
    let granted = false;
    let grantError: string | null = null;
    if (grant) {
      const result = await applyComp(adminClient, {
        companyId: company.id,
        actorUserId: user.id,
        input: grant,
      });
      if (result.ok) {
        granted = true;
      } else {
        grantError = result.message ?? result.error;
        console.error("[admin/companies/create] Grant failed:", company.id, grantError);
      }
    }

    // 7. Generate the invite link and email it. Best-effort — the company and
    // owner already exist, so an email failure must NOT fail the request.
    let invited = false;
    try {
      const { inviterName, companyName: contextCompanyName } = await getInviteContext(
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
        company.id
      );

      invited = await sendMemberInvite(adminClient, {
        createdBy: user.id,
        email: ownerEmail,
        inviterName,
        companyName: contextCompanyName ?? company.name,
        role: "owner",
      });
    } catch (inviteErr: unknown) {
      const message = inviteErr instanceof Error ? inviteErr.message : String(inviteErr);
      console.error("[admin/companies/create] Invite send failed:", message);
      invited = false;
    }

    console.log(
      "[admin/companies/create] Complete:",
      companyName,
      "| owner:",
      ownerEmail,
      "| invited:",
      invited
    );

    // Audit trail — never throws, never affects this response.
    await logActivity(
      {
        actorUserId: user.id,
        actorEmail: user.email ?? null,
        action: "company.created",
        targetType: "company",
        targetId: company.id,
        targetLabel: company.name,
        companyId: company.id,
        metadata: {
          ownerEmail,
          ownerUserId: newUser.user.id,
          invited,
          grantAccessRequested: !!grant,
          granted,
          portalOpened,
        },
      },
      adminClient
    );

    if (grant && granted) {
      // Same action name as the table's Grant access, so the audit log reads
      // the same whichever way access was given.
      await logActivity(
        {
          actorUserId: user.id,
          actorEmail: user.email ?? null,
          action: "billing.comped",
          targetType: "companies",
          targetId: company.id,
          targetLabel: company.name,
          companyId: company.id,
          metadata: {
            planId: grant.planId,
            until: grant.until,
            reason: grant.reason,
            source: "company.created",
          },
        },
        adminClient
      );
    }

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
      invited,
      grantAccessRequested: !!grant,
      granted,
      grantError,
    });
  } catch (err: any) {
    console.error("[admin/companies/create] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
