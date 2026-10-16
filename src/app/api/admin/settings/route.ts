import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import {
  resolveLegalUrls,
  normaliseLegalUrl,
  describeLegalUrlProblem,
} from "@/lib/legal-urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Platform settings API.
 *
 * GET → the 'global' app_settings row (coded defaults if it is somehow absent).
 * PUT → update supplied fields, stamping updated_by/updated_at.
 *
 * Reads are allowed for any authenticated user: the client layout needs
 * `deterDevtools` to decide whether to attach its listeners, and the value is
 * observable from the page's behaviour regardless. Writes require an admin.
 */

type Settings = {
  deterDevtools: boolean;
  /** Linked from the required consent checkbox on signup (migration 037). */
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
};

const DEFAULTS: Settings = {
  deterDevtools: false,
  privacyPolicyUrl: null,
  termsUrl: null,
};

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function GET() {
  try {
    const db = adminClient();
    const { data, error } = await db
      .from("app_settings")
      .select("deter_devtools, privacy_policy_url, terms_url")
      .eq("id", "global")
      .maybeSingle();

    if (error) {
      // Never fail the page over a settings read — fall back to defaults.
      console.error("[admin/settings] GET error:", error.message);
      return NextResponse.json(DEFAULTS);
    }

    return NextResponse.json({
      deterDevtools: data?.deter_devtools ?? DEFAULTS.deterDevtools,
      ...resolveLegalUrls(data),
    });
  } catch (err: unknown) {
    console.error("[admin/settings] GET error:", errMessage(err));
    return NextResponse.json(DEFAULTS);
  }
}

export async function PUT(req: Request) {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      console.log("[admin/settings] Denied:", check.error);
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    let body: {
      deterDevtools?: unknown;
      privacyPolicyUrl?: unknown;
      termsUrl?: unknown;
    } = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      return NextResponse.json({ error: "body" }, { status: 400 });
    }

    if (typeof body.deterDevtools !== "boolean") {
      return NextResponse.json({ error: "deterDevtools" }, { status: 400 });
    }

    /**
     * The legal URLs are OPTIONAL in the payload, so an older client that only
     * knows about `deterDevtools` cannot wipe them by omission.
     *
     * An explicit empty string DOES clear the link — that is how an admin
     * removes one — which is why absent and empty are treated differently
     * here rather than both falling through to null.
     */
    const patch: Record<string, unknown> = {
      id: "global",
      deter_devtools: body.deterDevtools,
      updated_by: check.userId,
      updated_at: new Date().toISOString(),
    };

    for (const [key, column] of [
      ["privacyPolicyUrl", "privacy_policy_url"],
      ["termsUrl", "terms_url"],
    ] as const) {
      const supplied = body[key];
      if (supplied === undefined) continue;

      if (typeof supplied !== "string") {
        return NextResponse.json({ error: key }, { status: 400 });
      }

      /*
       * Rejected with the REASON rather than silently stored as null. An admin
       * who pastes an http link and is told nothing would reasonably assume it
       * saved, and only discover otherwise when a customer reports a missing
       * link on the signup page.
       */
      const problem = describeLegalUrlProblem(supplied);
      if (problem) {
        return NextResponse.json({ error: key, message: problem }, { status: 400 });
      }

      patch[column] = normaliseLegalUrl(supplied);
    }

    const db = adminClient();
    const { error } = await db
      .from("app_settings")
      .upsert(patch, { onConflict: "id" });

    if (error) {
      console.error("[admin/settings] PUT error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Audit trail — best-effort, never affects the response.
    const { data: actor } = await db
      .from("profiles")
      .select("email")
      .eq("id", check.userId)
      .maybeSingle();

    await logActivity(
      {
        actorUserId: check.userId,
        actorEmail: actor?.email ?? null,
        action: "app_settings.updated",
        targetType: "app_settings",
        targetId: null,
        targetLabel: "global",
        /*
         * The URLs are recorded in the audit trail: "who changed the terms
         * link, and to what" is exactly the kind of question that gets asked
         * later.
         */
        metadata: {
          deterDevtools: body.deterDevtools,
          privacyPolicyUrl: patch.privacy_policy_url ?? undefined,
          termsUrl: patch.terms_url ?? undefined,
        },
      },
      db
    );

    return NextResponse.json({
      deterDevtools: body.deterDevtools,
      privacyPolicyUrl: (patch.privacy_policy_url as string | null) ?? null,
      termsUrl: (patch.terms_url as string | null) ?? null,
    });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/settings] PUT error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
