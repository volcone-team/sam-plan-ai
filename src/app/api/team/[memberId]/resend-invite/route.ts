import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getInviteContext, sendMemberInvite } from "@/lib/team-invite";

/**
 * POST /api/team/[memberId]/resend-invite
 *
 * Regenerates and re-sends the invite email for a pending team member.
 * Only the company owner can resend invites, and only for members in their
 * own company.
 */
export async function POST(
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
      .select("company_id, role, first_name, last_name")
      .eq("id", user.id)
      .single();

    if (!profile?.company_id || profile.role !== "owner") {
      return NextResponse.json(
        { error: "Only the company owner can resend invites." },
        { status: 403 }
      );
    }

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Verify the member belongs to the same company and get their email
    const { data: memberProfile } = await adminClient
      .from("profiles")
      .select("company_id, email, role")
      .eq("id", memberId)
      .single();

    if (!memberProfile || memberProfile.company_id !== profile.company_id) {
      return NextResponse.json(
        { error: "Member not found in your company." },
        { status: 404 }
      );
    }

    if (!memberProfile.email) {
      return NextResponse.json(
        { error: "Member has no email address on file." },
        { status: 400 }
      );
    }

    // Personalize with the inviter's name + company name
    const { inviterName, companyName } = await getInviteContext(
      adminClient,
      {
        first_name: profile.first_name ?? (user.user_metadata?.first_name as string | undefined) ?? null,
        last_name: profile.last_name ?? (user.user_metadata?.last_name as string | undefined) ?? null,
      },
      profile.company_id
    );

    const sent = await sendMemberInvite(adminClient, {
      email: memberProfile.email,
      inviterName,
      companyName,
      role: memberProfile.role,
    });

    if (!sent) {
      return NextResponse.json(
        { error: "Failed to send invite email." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[team/resend-invite] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
