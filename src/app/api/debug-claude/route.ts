import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

/**
 * GET /api/debug-claude
 *
 * Minimal Claude connectivity test. Returns timing + any error.
 * Use this to distinguish a timeout (empty body) from an API/key error
 * (structured error) in plan generation.
 */
export async function GET() {
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
    const ms = Date.now() - started;

    return NextResponse.json({
      ok: true,
      model: MODEL,
      elapsedMs: ms,
      reply: text.slice(0, 100),
      keyPrefix: process.env.ANTHROPIC_API_KEY.slice(0, 7),
    });
  } catch (err: any) {
    const ms = Date.now() - started;
    return NextResponse.json({
      ok: false,
      model: MODEL,
      elapsedMs: ms,
      error: err?.message || String(err),
      status: err?.status,
      type: err?.error?.type ?? err?.name,
    });
  }
}
