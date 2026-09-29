import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { evaluateBudget, sumTokens, effectiveCap, startOfUtcDayISO } from "@/lib/chat-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/chat/session
 *
 * Everything the widget needs on mount: whether chat is available, the caller's
 * most recent open conversation with its messages, and the company's remaining
 * budget.
 *
 * This is what makes "minimise without losing the conversation" survive a page
 * reload or a move to another device — history lives server-side, not in
 * component state.
 *
 * DELETE /api/chat/session
 *
 * Closes the caller's open conversations (soft: sets closed_at). Transcripts are
 * retained for cost reporting; the next message starts a fresh thread.
 *
 * Responses (GET):
 *   200 { enabled, conversationId, messages[], usage: { usedToday, dailyCap,
 *         remaining, exhausted, disabled }, contactEmail }
 *   401 { error: "Unauthorized" }
 */
export async function GET() {
  try {
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

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: settings } = await db
      .from("app_settings")
      .select("chatbot_enabled, chat_daily_token_cap, chat_contact_email")
      .eq("id", "global")
      .maybeSingle();

    // Not enabled: answer plainly so the widget renders nothing at all.
    if (!settings?.chatbot_enabled) {
      return NextResponse.json({ enabled: false });
    }

    const { data: profile } = await db
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .maybeSingle();

    const companyId = profile?.company_id ?? null;

    const { data: override } = companyId
      ? await db
          .from("chat_budgets")
          .select("daily_token_cap")
          .eq("company_id", companyId)
          .maybeSingle()
      : { data: null };

    const dailyCap = effectiveCap(
      override?.daily_token_cap ?? null,
      settings.chat_daily_token_cap
    );

    let usageQuery = db
      .from("chat_messages")
      .select("tokens_input, tokens_output")
      .eq("role", "assistant")
      .gte("created_at", startOfUtcDayISO());

    usageQuery = companyId
      ? usageQuery.eq("company_id", companyId)
      : usageQuery.is("company_id", null);

    const { data: usageRows } = await usageQuery;

    const decision = evaluateBudget({
      usedToday: sumTokens(
        (usageRows ?? []) as { tokens_input: number | null; tokens_output: number | null }[]
      ),
      dailyCap,
    });

    // Most recent open conversation, with its transcript.
    const { data: conversation } = await db
      .from("chat_conversations")
      .select("id")
      .eq("user_id", user.id)
      .is("closed_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let messages: { role: string; content: string; createdAt: string }[] = [];

    if (conversation?.id) {
      const { data: rows } = await db
        .from("chat_messages")
        .select("role, content, created_at, error_message")
        .eq("conversation_id", conversation.id)
        .is("error_message", null)
        .order("created_at", { ascending: true });

      messages = ((rows ?? []) as { role: string; content: string; created_at: string }[])
        // Drop empty assistant rows (failed turns recorded for reporting).
        .filter((r) => r.content.trim().length > 0)
        .map((r) => ({ role: r.role, content: r.content, createdAt: r.created_at }));
    }

    return NextResponse.json({
      enabled: true,
      conversationId: conversation?.id ?? null,
      messages,
      usage: {
        usedToday: decision.usedToday,
        dailyCap: decision.dailyCap,
        remaining: decision.remaining,
        exhausted: !decision.allowed && !decision.disabled,
        disabled: decision.disabled,
      },
      contactEmail: settings.chat_contact_email ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[chat/session] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
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

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Soft close: the transcript stays for cost reporting.
    const { error } = await db
      .from("chat_conversations")
      .update({ closed_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("closed_at", null);

    if (error) {
      console.error("[chat/session] Close failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ closed: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[chat/session] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
