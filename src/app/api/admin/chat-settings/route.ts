import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import { DEFAULT_DAILY_TOKEN_CAP } from "@/lib/chat-budget";
import { CHAT_MODELS, DEFAULT_CHAT_MODEL, isAllowedChatModel } from "@/lib/ai-pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Chatbot controls. SUPER-ADMIN ONLY — these decide whether a paid API is
 * reachable by customers and how much they may spend, so plain admins are
 * excluded deliberately.
 *
 * GET → platform settings plus every per-company cap override.
 * PUT → update platform settings, and/or set/clear one company's override.
 *
 * Body (all optional):
 *   { chatbotEnabled?: boolean,
 *     chatDailyTokenCap?: number,     // platform default, >= 0
 *     chatContactEmail?: string|null, // shown when a pool is exhausted
 *     companyOverride?: { companyId: string, dailyTokenCap: number|null } }
 *
 * A cap of 0 turns chat off for that company specifically; null CLEARS the
 * override so the company falls back to the platform default.
 */

const MAX_TOKEN_CAP = 100_000_000;

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
    const check = await requireSuperAdmin();
    if (!check.ok) {
      console.log("[admin/chat-settings] Denied:", check.error);
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const db = adminClient();

    const { data: settings } = await db
      .from("app_settings")
      .select("chatbot_enabled, chat_daily_token_cap, chat_contact_email, chat_model")
      .eq("id", "global")
      .maybeSingle();

    const { data: overrides, error: overrideErr } = await db
      .from("chat_budgets")
      .select("company_id, daily_token_cap, updated_at");

    if (overrideErr) {
      console.error("[admin/chat-settings] Override query failed:", overrideErr.message);
    }

    const rows = (overrides ?? []) as {
      company_id: string; daily_token_cap: number; updated_at: string;
    }[];

    // Resolve names in one batched lookup so the UI shows companies, not UUIDs.
    let nameById = new Map<string, string | null>();
    if (rows.length > 0) {
      const { data: companies } = await db
        .from("companies")
        .select("id, name")
        .in("id", rows.map((r) => r.company_id));
      nameById = new Map(
        ((companies ?? []) as { id: string; name: string | null }[]).map((c) => [c.id, c.name])
      );
    }

    return NextResponse.json({
      chatbotEnabled: settings?.chatbot_enabled ?? false,
      chatDailyTokenCap: settings?.chat_daily_token_cap ?? DEFAULT_DAILY_TOKEN_CAP,
      chatContactEmail: settings?.chat_contact_email ?? null,
      chatModel: settings?.chat_model ?? DEFAULT_CHAT_MODEL,
      // Sent so the UI cannot drift from the server's allowlist.
      availableModels: CHAT_MODELS,
      overrides: rows.map((r) => ({
        companyId: r.company_id,
        companyName: nameById.get(r.company_id) ?? null,
        dailyTokenCap: r.daily_token_cap,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/chat-settings] GET error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      console.log("[admin/chat-settings] Denied:", check.error);
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    let body: {
      chatbotEnabled?: unknown;
      chatDailyTokenCap?: unknown;
      chatContactEmail?: unknown;
      chatModel?: unknown;
      companyOverride?: unknown;
    } = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      return NextResponse.json({ error: "body" }, { status: 400 });
    }

    const db = adminClient();
    const now = new Date().toISOString();
    const changed: Record<string, unknown> = {};

    // --- Platform settings -------------------------------------------------
    const patch: Record<string, unknown> = {};

    if (body.chatbotEnabled !== undefined) {
      if (typeof body.chatbotEnabled !== "boolean") {
        return NextResponse.json({ error: "chatbotEnabled" }, { status: 400 });
      }
      patch.chatbot_enabled = body.chatbotEnabled;
      changed.chatbotEnabled = body.chatbotEnabled;
    }

    if (body.chatDailyTokenCap !== undefined) {
      const cap = Number(body.chatDailyTokenCap);
      if (!Number.isFinite(cap) || cap < 0 || cap > MAX_TOKEN_CAP) {
        return NextResponse.json({ error: "chatDailyTokenCap" }, { status: 400 });
      }
      patch.chat_daily_token_cap = Math.floor(cap);
      changed.chatDailyTokenCap = Math.floor(cap);
    }

    if (body.chatModel !== undefined) {
      // Allowlist check, not a format check: this value is passed to the
      // Anthropic API and priced from the rate table, so only known ids are
      // acceptable.
      if (!isAllowedChatModel(body.chatModel)) {
        return NextResponse.json({ error: "chatModel" }, { status: 400 });
      }
      patch.chat_model = body.chatModel;
      changed.chatModel = body.chatModel;
    }

    if (body.chatContactEmail !== undefined) {
      const raw = body.chatContactEmail;
      if (raw === null || raw === "") {
        patch.chat_contact_email = null;
        changed.chatContactEmail = null;
      } else if (
        typeof raw === "string" &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim())
      ) {
        patch.chat_contact_email = raw.trim().toLowerCase();
        changed.chatContactEmail = patch.chat_contact_email;
      } else {
        return NextResponse.json({ error: "chatContactEmail" }, { status: 400 });
      }
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await db
        .from("app_settings")
        .upsert(
          { id: "global", ...patch, updated_by: check.userId, updated_at: now },
          { onConflict: "id" }
        );
      if (error) {
        console.error("[admin/chat-settings] Settings write failed:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    // --- Per-company override ---------------------------------------------
    if (body.companyOverride !== undefined) {
      const ov = body.companyOverride as { companyId?: unknown; dailyTokenCap?: unknown };
      if (typeof ov?.companyId !== "string" || !ov.companyId) {
        return NextResponse.json({ error: "companyOverride.companyId" }, { status: 400 });
      }

      if (ov.dailyTokenCap === null) {
        // Clear: fall back to the platform default.
        const { error } = await db
          .from("chat_budgets")
          .delete()
          .eq("company_id", ov.companyId);
        if (error) {
          console.error("[admin/chat-settings] Override delete failed:", error.message);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
        changed.companyOverrideCleared = ov.companyId;
      } else {
        const cap = Number(ov.dailyTokenCap);
        if (!Number.isFinite(cap) || cap < 0 || cap > MAX_TOKEN_CAP) {
          return NextResponse.json({ error: "companyOverride.dailyTokenCap" }, { status: 400 });
        }
        const { error } = await db
          .from("chat_budgets")
          .upsert(
            {
              company_id: ov.companyId,
              daily_token_cap: Math.floor(cap),
              updated_by: check.userId,
              updated_at: now,
            },
            { onConflict: "company_id" }
          );
        if (error) {
          console.error("[admin/chat-settings] Override write failed:", error.message);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
        changed.companyOverride = { companyId: ov.companyId, dailyTokenCap: Math.floor(cap) };
      }
    }

    if (Object.keys(changed).length === 0) {
      return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
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
        action: "chat_settings.updated",
        targetType: "app_settings",
        targetId: null,
        targetLabel: "chatbot",
        metadata: { changed, fields: Object.keys(changed) },
      },
      db
    );

    return NextResponse.json({ updated: true, changed });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/chat-settings] PUT error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
