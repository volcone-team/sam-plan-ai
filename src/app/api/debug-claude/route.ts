import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAdmin } from "@/lib/require-admin";

export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

/**
 * GET /api/debug-claude
 *
 * Minimal Claude connectivity test. Returns timing + any error.
 * Use this to distinguish a timeout (empty body) from an API/key error
 * (structured error) in plan generation.
 *
 * Dev/debug only: disabled entirely in production and restricted to
 * authenticated admins elsewhere — matching /api/test-email.
 *
 * This route previously had NO authorization of any kind. Anyone on the
 * internet could call it and get back the first 7 characters of
 * ANTHROPIC_API_KEY plus the model name, and every call made a real (billed)
 * Anthropic request, so it doubled as an unauthenticated way to burn API
 * budget. The key prefix is no longer returned at all: it cannot help debug a
 * connectivity problem that the ok/error fields do not already cover.
 */
export async function GET() {
  // Never available in production - this endpoint exists for local verification.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const started = Date.now();
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ ok: false, reason: "ANTHROPIC_API_KEY missing", model: MODEL });
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 50,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
    });

    const textBlock = res.content.find((b) => b.type === "text");
    const text = textBlock && textBlock.type === "text" ? textBlock.text : "(no text)";

    return NextResponse.json({
      ok: true,
      model: MODEL,
      elapsedMs: Date.now() - started,
      reply: text.slice(0, 100),
    });
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number; name?: string; error?: { type?: string } };
    return NextResponse.json({
      ok: false,
      model: MODEL,
      elapsedMs: Date.now() - started,
      error: e?.message || String(err),
      status: e?.status,
      type: e?.error?.type ?? e?.name,
    });
  }
}
