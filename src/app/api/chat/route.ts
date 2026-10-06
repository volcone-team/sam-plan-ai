import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import Anthropic from "@anthropic-ai/sdk";
import { buildChatSystemPrompt, trimHistory, deriveTitle, MAX_MESSAGE_CHARS } from "@/lib/chat-context";
import { evaluateBudget, sumTokens, effectiveCap, startOfUtcDayISO } from "@/lib/chat-budget";
import { estimateCostUsd, resolveChatModel } from "@/lib/ai-pricing";
import { checkEntitlement, statusForCode } from "@/lib/billing/enforce";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_OUTPUT_TOKENS = 1500;

/**
 * POST /api/chat
 *
 * One chat turn: persist the user message, ask Claude (grounded in the workbook
 * library), persist the reply with its token cost, and return both.
 *
 * Uses ANTHROPIC_API_KEY_CHATBOT — a separate key from plan generation, so chat
 * spend is isolated in Anthropic's own console and a leaked/rotated chat key
 * cannot affect plan generation.
 *
 * ORDER OF CHECKS IS DELIBERATE. Everything that can refuse the request runs
 * BEFORE the paid API call: feature flag, then company budget, then grounding.
 * A refusal must never cost money.
 *
 * Body: { message: string, conversationId?: string }
 *
 * Responses:
 *   200 { conversationId, reply, usage: { remaining, dailyCap } }
 *   400 { error: "message" | "message_too_long" }
 *   401 { error: "Unauthorized" }
 *   403 { error: "chat_disabled" }
 *   429 { error: "budget_exhausted", contactEmail, dailyCap, usedToday }
 *   503 { error: "not_configured" | "workbook_empty" }
 *   500 { error: <message> }
 */
export async function POST(request: Request) {
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

    let body: { message?: unknown; conversationId?: unknown } = {};
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      body = {};
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) return NextResponse.json({ error: "message" }, { status: 400 });
    if (message.length > MAX_MESSAGE_CHARS) {
      return NextResponse.json({ error: "message_too_long" }, { status: 400 });
    }

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // --- Gate 1: is chat switched on at all? -------------------------------
    const { data: settings } = await db
      .from("app_settings")
      .select("chatbot_enabled, chat_daily_token_cap, chat_contact_email, chat_model")
      .eq("id", "global")
      .maybeSingle();

    if (!settings?.chatbot_enabled) {
      return NextResponse.json({ error: "chat_disabled" }, { status: 403 });
    }

    const contactEmail = settings.chat_contact_email ?? null;
    // Validated against the allowlist rather than trusted: the stored value goes
    // straight to the API, so a bad row must not send traffic to an arbitrary
    // (and arbitrarily priced) model.
    const model = resolveChatModel(settings.chat_model);

    // --- Gate 2: company budget -------------------------------------------
    // Company-scoped, so members share one pool. A user with no company still
    // gets a budget keyed on null, which groups them together; that is
    // acceptable because every real account has a company.
    const { data: profile } = await db
      .from("profiles")
      .select("company_id, first_name")
      .eq("id", user.id)
      .maybeSingle();

    const companyId = profile?.company_id ?? null;

    /**
     * Billing access. Checked WITHOUT a limit key: chat volume is governed by its
     * own pooled token budget below, which is a better fit than a monthly call
     * count. What matters here is only whether the account is entitled to the
     * product at all — an expired trial or a long-dead subscription should not
     * keep talking to a paid API.
     *
     * No-ops while billing is disabled.
     */
    const entitlement = await checkEntitlement(db, companyId, "chat_access");
    if (!entitlement.ok) {
      console.log("[chat] Blocked by billing:", entitlement.code);
      return NextResponse.json(
        { error: entitlement.code, message: entitlement.message },
        { status: statusForCode(entitlement.code) }
      );
    }

    const budget = await loadBudget(db, companyId, settings.chat_daily_token_cap);
    if (!budget.allowed) {
      console.log(
        "[chat] Budget refused for company", companyId,
        "| used:", budget.usedToday, "/", budget.dailyCap
      );
      return NextResponse.json(
        {
          error: "budget_exhausted",
          disabled: budget.disabled,
          contactEmail,
          dailyCap: budget.dailyCap,
          usedToday: budget.usedToday,
        },
        { status: 429 }
      );
    }

    // --- Gate 3: configuration + grounding --------------------------------
    const apiKey = process.env.ANTHROPIC_API_KEY_CHATBOT;
    if (!apiKey) {
      console.error("[chat] ANTHROPIC_API_KEY_CHATBOT is not set");
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }

    /**
     * `companyId` comes from the caller's PROFILE, resolved from their session
     * above — never from the request body. It is the only thing scoping the
     * account data in the prompt, so trusting a client-supplied id here would
     * let anyone read another company's revenue by passing its id.
     */
    const systemPrompt = await buildChatSystemPrompt(db, companyId);
    if (!systemPrompt) {
      // No workbook means no grounding. Refusing beats answering from the
      // model's own guesses, which would contradict the authored product.
      return NextResponse.json({ error: "workbook_empty" }, { status: 503 });
    }

    // --- Conversation ------------------------------------------------------
    const conversationId = await resolveConversation(
      db,
      typeof body.conversationId === "string" ? body.conversationId : null,
      { userId: user.id, companyId, firstMessage: message }
    );

    if (!conversationId) {
      return NextResponse.json({ error: "Could not start conversation" }, { status: 500 });
    }

    // Prior turns for context, oldest first, then trimmed to a bounded window.
    const { data: historyRows } = await db
      .from("chat_messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .is("error_message", null)
      .order("created_at", { ascending: true });

    const history = trimHistory(
      ((historyRows ?? []) as { role: string; content: string }[]).map((r) => ({
        role: r.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: r.content,
      }))
    );

    // Persist the user's message before calling out, so a failed or timed-out
    // reply still leaves a record of what was asked.
    await db.from("chat_messages").insert({
      conversation_id: conversationId,
      company_id: companyId,
      user_id: user.id,
      role: "user",
      content: message,
    });

    // --- The paid call ----------------------------------------------------
    const started = Date.now();
    let replyText = "";
    let tokensInput: number | null = null;
    let tokensOutput: number | null = null;

    try {
      const anthropic = new Anthropic({ apiKey });
      const response = await anthropic.messages.create({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: systemPrompt,
        messages: [...history, { role: "user" as const, content: message }],
      });

      const block = response.content.find((b) => b.type === "text");
      replyText = block && block.type === "text" ? block.text : "";
      tokensInput = response.usage?.input_tokens ?? null;
      tokensOutput = response.usage?.output_tokens ?? null;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[chat] Anthropic call failed:", msg);

      // Record the failure so it shows up in the tools page rather than looking
      // like a conversation that just stopped.
      await db.from("chat_messages").insert({
        conversation_id: conversationId,
        company_id: companyId,
        user_id: user.id,
        role: "assistant",
        content: "",
        model,
        duration_ms: Date.now() - started,
        error_message: msg.slice(0, 500),
      });

      return NextResponse.json(
        { error: "Assistant is unavailable right now. Please try again." },
        { status: 502 }
      );
    }

    const durationMs = Date.now() - started;
    const costUsd = estimateCostUsd(model, tokensInput, tokensOutput);

    await db.from("chat_messages").insert({
      conversation_id: conversationId,
      company_id: companyId,
      user_id: user.id,
      role: "assistant",
      content: replyText,
      model,
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
      cost_usd: costUsd,
      duration_ms: durationMs,
    });

    await db
      .from("chat_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    const spent = (tokensInput ?? 0) + (tokensOutput ?? 0);

    console.log(
      "[chat] Reply for", user.email,
      "| tokens:", spent,
      "| cost:", costUsd,
      "|", durationMs, "ms"
    );

    return NextResponse.json({
      conversationId,
      reply: replyText,
      usage: {
        remaining: Math.max(0, budget.remaining - spent),
        dailyCap: budget.dailyCap,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[chat] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}

/** Today's pooled spend for a company, against its effective cap. */
async function loadBudget(
  db: SupabaseClient,
  companyId: string | null,
  platformDefault: number | null
) {
  const { data: override } = companyId
    ? await db
        .from("chat_budgets")
        .select("daily_token_cap")
        .eq("company_id", companyId)
        .maybeSingle()
    : { data: null };

  const dailyCap = effectiveCap(override?.daily_token_cap ?? null, platformDefault);

  // Only assistant rows carry token counts.
  let query = db
    .from("chat_messages")
    .select("tokens_input, tokens_output")
    .eq("role", "assistant")
    .gte("created_at", startOfUtcDayISO());

  query = companyId
    ? query.eq("company_id", companyId)
    : query.is("company_id", null);

  const { data: rows, error } = await query;

  if (error) {
    // Fail CLOSED on an unreadable budget: treat the pool as spent rather than
    // letting unlimited paid calls through when accounting is broken.
    console.error("[chat] Budget query failed, refusing:", error.message);
    return { allowed: false, disabled: false, usedToday: dailyCap, dailyCap, remaining: 0 };
  }

  return evaluateBudget({
    usedToday: sumTokens((rows ?? []) as { tokens_input: number | null; tokens_output: number | null }[]),
    dailyCap,
  });
}

/**
 * Reuse the caller's conversation or start one.
 *
 * An id supplied by the client is verified to belong to this user — otherwise
 * anyone could append to, and read the history of, someone else's conversation
 * by guessing a UUID.
 */
async function resolveConversation(
  db: SupabaseClient,
  requestedId: string | null,
  ctx: { userId: string; companyId: string | null; firstMessage: string }
): Promise<string | null> {
  if (requestedId) {
    const { data } = await db
      .from("chat_conversations")
      .select("id")
      .eq("id", requestedId)
      .eq("user_id", ctx.userId)
      .is("closed_at", null)
      .maybeSingle();
    if (data?.id) return data.id as string;
    console.log("[chat] Ignoring unknown or foreign conversation id");
  }

  const { data, error } = await db
    .from("chat_conversations")
    .insert({
      user_id: ctx.userId,
      company_id: ctx.companyId,
      title: deriveTitle(ctx.firstMessage),
    })
    .select("id")
    .single();

  if (error) {
    console.error("[chat] Could not create conversation:", error.message);
    return null;
  }
  return data.id as string;
}
