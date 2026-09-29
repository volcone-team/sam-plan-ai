import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { estimateCostUsd, isKnownModel } from "@/lib/ai-pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ai-usage?days=30
 *
 * SUPER-ADMIN ONLY. Spend and volume across both AI surfaces:
 *   - plan generation / regeneration / enhancement (generation_events)
 *   - the workbook chatbot (chat_messages)
 *
 * Broken down by day, model, company and event type so a specific customer's
 * cost can be traced rather than only a platform total.
 *
 * COSTS ARE ESTIMATES computed from reported token counts times a static rate
 * table — they track the invoice closely but do not match it to the cent
 * (prompt caching and batch discounts are not modelled). See lib/ai-pricing.
 * `unknownModels` lists any model id priced with the fallback rate, so an
 * unrecognised model cannot silently understate spend without a warning.
 */

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

interface Bucket {
  calls: number;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
}

function emptyBucket(): Bucket {
  return { calls: 0, tokensInput: 0, tokensOutput: 0, costUsd: 0 };
}

function add(bucket: Bucket, tokensIn: number, tokensOut: number, cost: number): void {
  bucket.calls += 1;
  bucket.tokensInput += tokensIn;
  bucket.tokensOutput += tokensOut;
  bucket.costUsd = Math.round((bucket.costUsd + cost) * 1_000_000) / 1_000_000;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export async function GET(request: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      console.log("[admin/ai-usage] Denied:", check.error);
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const url = new URL(request.url);
    const requestedDays = Number(url.searchParams.get("days"));
    const days =
      Number.isFinite(requestedDays) && requestedDays > 0
        ? Math.min(Math.floor(requestedDays), MAX_DAYS)
        : DEFAULT_DAYS;

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const [genRes, chatRes] = await Promise.all([
      db
        .from("generation_events")
        .select("company_id, user_id, event_type, status, model, tokens_input, tokens_output, duration_ms, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false }),
      db
        .from("chat_messages")
        .select("company_id, user_id, conversation_id, model, tokens_input, tokens_output, cost_usd, duration_ms, error_message, created_at")
        .eq("role", "assistant")
        .gte("created_at", since)
        .order("created_at", { ascending: false }),
    ]);

    if (genRes.error) {
      console.error("[admin/ai-usage] generation_events query failed:", genRes.error.message);
    }
    if (chatRes.error) {
      console.error("[admin/ai-usage] chat_messages query failed:", chatRes.error.message);
    }

    type GenRow = {
      company_id: string | null; user_id: string | null; event_type: string;
      status: string | null; model: string | null;
      tokens_input: number | null; tokens_output: number | null;
      duration_ms: number | null; created_at: string;
    };
    type ChatRow = {
      company_id: string | null; user_id: string | null; conversation_id: string;
      model: string | null; tokens_input: number | null; tokens_output: number | null;
      cost_usd: number | null; duration_ms: number | null;
      error_message: string | null; created_at: string;
    };

    const genRows = (genRes.data ?? []) as GenRow[];
    const chatRows = (chatRes.data ?? []) as ChatRow[];

    const generation = emptyBucket();
    const chat = emptyBucket();
    const byDay = new Map<string, { generation: Bucket; chat: Bucket }>();
    const byModel = new Map<string, Bucket>();
    const byCompany = new Map<string | null, { generation: Bucket; chat: Bucket }>();
    const byEventType = new Map<string, Bucket>();
    const unknownModels = new Set<string>();

    let generationFailures = 0;
    let chatFailures = 0;

    const dayKey = (iso: string) => iso.slice(0, 10);

    const ensureDay = (key: string) => {
      let entry = byDay.get(key);
      if (!entry) { entry = { generation: emptyBucket(), chat: emptyBucket() }; byDay.set(key, entry); }
      return entry;
    };
    const ensureCompany = (key: string | null) => {
      let entry = byCompany.get(key);
      if (!entry) { entry = { generation: emptyBucket(), chat: emptyBucket() }; byCompany.set(key, entry); }
      return entry;
    };
    const ensureModel = (key: string) => {
      let entry = byModel.get(key);
      if (!entry) { entry = emptyBucket(); byModel.set(key, entry); }
      return entry;
    };

    for (const row of genRows) {
      const tokensIn = num(row.tokens_input);
      const tokensOut = num(row.tokens_output);
      // generation_events has no cost column, so it is derived here.
      const cost = estimateCostUsd(row.model, tokensIn, tokensOut);
      const model = row.model ?? "unknown";
      if (row.model && !isKnownModel(row.model)) unknownModels.add(row.model);
      if (row.status === "failed") generationFailures += 1;

      add(generation, tokensIn, tokensOut, cost);
      add(ensureDay(dayKey(row.created_at)).generation, tokensIn, tokensOut, cost);
      add(ensureCompany(row.company_id).generation, tokensIn, tokensOut, cost);
      add(ensureModel(model), tokensIn, tokensOut, cost);

      let typeBucket = byEventType.get(row.event_type);
      if (!typeBucket) { typeBucket = emptyBucket(); byEventType.set(row.event_type, typeBucket); }
      add(typeBucket, tokensIn, tokensOut, cost);
    }

    const conversations = new Set<string>();

    for (const row of chatRows) {
      const tokensIn = num(row.tokens_input);
      const tokensOut = num(row.tokens_output);
      // Prefer the cost stored at write time: it reflects the rates in force
      // then, so history does not shift when pricing changes.
      const cost = row.cost_usd !== null
        ? num(row.cost_usd)
        : estimateCostUsd(row.model, tokensIn, tokensOut);
      const model = row.model ?? "unknown";
      if (row.model && !isKnownModel(row.model)) unknownModels.add(row.model);
      if (row.error_message) chatFailures += 1;
      conversations.add(row.conversation_id);

      add(chat, tokensIn, tokensOut, cost);
      add(ensureDay(dayKey(row.created_at)).chat, tokensIn, tokensOut, cost);
      add(ensureCompany(row.company_id).chat, tokensIn, tokensOut, cost);
      add(ensureModel(model), tokensIn, tokensOut, cost);
    }

    // Resolve company names for the rows actually shown — batched, never per row.
    const companyIds = [...byCompany.keys()].filter((v): v is string => !!v);
    const nameById = await loadCompanyNames(db, companyIds);

    const companies = [...byCompany.entries()]
      .map(([id, buckets]) => ({
        companyId: id,
        companyName: id ? nameById.get(id) ?? null : null,
        generation: buckets.generation,
        chat: buckets.chat,
        totalCostUsd:
          Math.round((buckets.generation.costUsd + buckets.chat.costUsd) * 1_000_000) / 1_000_000,
      }))
      .sort((a, b) => b.totalCostUsd - a.totalCostUsd);

    return NextResponse.json({
      windowDays: days,
      totals: {
        generation,
        chat,
        combinedCostUsd:
          Math.round((generation.costUsd + chat.costUsd) * 1_000_000) / 1_000_000,
        generationFailures,
        chatFailures,
        chatConversations: conversations.size,
        chatMessages: chatRows.length,
      },
      byDay: [...byDay.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([date, buckets]) => ({ date, ...buckets })),
      byModel: [...byModel.entries()]
        .map(([model, bucket]) => ({ model, ...bucket }))
        .sort((a, b) => b.costUsd - a.costUsd),
      byEventType: [...byEventType.entries()]
        .map(([eventType, bucket]) => ({ eventType, ...bucket }))
        .sort((a, b) => b.costUsd - a.costUsd),
      companies,
      // Non-empty means spend is being priced with the fallback rate and the
      // rate table in lib/ai-pricing.ts needs updating.
      unknownModels: [...unknownModels],
      costsAreEstimates: true,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[admin/ai-usage] Error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}

async function loadCompanyNames(
  db: SupabaseClient,
  ids: string[]
): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await db.from("companies").select("id, name").in("id", ids);
  if (error) {
    console.error("[admin/ai-usage] Company lookup failed:", error.message);
    return new Map();
  }
  return new Map(
    ((data ?? []) as { id: string; name: string | null }[]).map((c) => [c.id, c.name])
  );
}
