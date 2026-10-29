import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import { getInviteContext, sendMemberInvite } from "@/lib/team-invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/admin/users/[id]/resend-invite — email a fresh invite. ANY ADMIN.
 *
 * For someone an admin created (company owner or user) who has not set a
 * password yet. The new link is valid for 7 days (migration 057) and replaces
 * any earlier one, so only the latest email works.
 *
 *   200 { sent: true }
 *   400 { error }  already accepted (has set a password and signed in)
 *   404 / 500 { error }
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const check = await requireAdmin();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "User not found." }, { status: 404 });

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: profile } = await db
      .from("profiles")
      .select("id, email, role, company_id")
      .eq("id", id)
      .maybeSingle();
    const target = profile as { id: string; email: string | null; role: string | null; company_id: string | null } | null;
    if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });
    if (!target.email) return NextResponse.json({ error: "This user has no email address." }, { status: 400 });

    // Someone who has chosen a password and signed in has nothing to accept;
    // they can use Forgot password instead.
    const { data: authUser } = await db.auth.admin.getUserById(id);
    const meta = authUser?.user?.user_metadata as { needs_password?: unknown } | undefined;
    if (authUser?.user?.last_sign_in_at && meta?.needs_password !== true) {
      return NextResponse.json(
        { error: "This user has already accepted their invite. Send a password reset instead." },
        { status: 400 }
      );
    }

    const { data: admin } = await db
      .from("profiles")
      .select("first_name, last_name, email")
      .eq("id", check.userId)
      .maybeSingle();
    const adminRow = admin as { first_name?: string | null; last_name?: string | null; email?: string | null } | null;
    const context = target.company_id
      ? await getInviteContext(db, { first_name: adminRow?.first_name ?? null, last_name: adminRow?.last_name ?? null }, target.company_id)
      : { inviterName: null, companyName: null };

    const sent = await sendMemberInvite(db, {
      createdBy: check.userId,
      email: target.email,
      inviterName: context.inviterName,
      companyName: context.companyName,
      role: target.role,
    });
    if (!sent) return NextResponse.json({ error: "Could not send the invite email." }, { status: 500 });

    await logActivity(
      {
        actorUserId: check.userId,
        actorEmail: adminRow?.email ?? null,
        action: "user.invite_resent",
        targetType: "user",
        targetId: target.id,
        targetLabel: target.email,
      },
      db
    ).catch(() => undefined);

    return NextResponse.json({ sent: true });
  } catch (err: unknown) {
    console.error("[admin/resend-invite] failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Could not send the invite." }, { status: 500 });
  }
}
