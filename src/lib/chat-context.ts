import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLibrary, loadAiContext, renderLibraryForPrompt } from "@/lib/workbook/read";

/**
 * Workbook grounding for the chatbot.
 *
 * The assistant answers from the SAME authored workbook tables (migration 018)
 * that plan generation uses, so advice in chat cannot contradict advice in a
 * user's plan. It reuses `renderLibraryForPrompt` for exactly that reason —
 * two renderings of the same catalogue would drift apart over time.
 *
 * The whole library is sent as system context on every turn. That is affordable
 * because the catalogue is small (tens of initiatives, a few thousand tokens)
 * and it keeps answers accurate: with retrieval, a question spanning several
 * channels can silently miss the row that mattered. If the catalogue grows to
 * where this is expensive, switch to retrieval then — not pre-emptively.
 */

export const CHAT_SYSTEM_PREAMBLE = `You are the SAM Plan AI assistant. You help business owners and their teams understand revenue initiatives, how to execute them, and what results to expect.

GROUNDING RULES — these matter more than being helpful:
- Answer from the INITIATIVE LIBRARY below. It is the authored source of truth for this product.
- If the library does not cover something, say so plainly and suggest what the user could ask instead. Never invent an initiative, a benchmark number, or a task list.
- When a benchmark is marked unverified, say it is an estimate rather than presenting it as measured data.
- Keep answers short and practical: a few sentences, or a short list. These are busy operators, not readers.
- You may explain, compare, sequence and prioritise initiatives from the library, and answer "how do I actually do this" questions using the authored guidance.
- You cannot see or change the user's plan, tasks or numbers. If asked to modify their plan, explain that they need to use the planner or plan generation, and point them at it.
- Decline anything unrelated to revenue planning and this product, briefly and without lecturing.`;

/**
 * Build the full system prompt: rules plus the rendered library.
 *
 * Returns null when the workbook is empty — the caller must then refuse to chat
 * rather than fall back to an ungrounded model, which would happily invent a
 * catalogue and undermine the entire product.
 */
export async function buildChatSystemPrompt(
  db: SupabaseClient
): Promise<string | null> {
  const [library, context] = await Promise.all([loadLibrary(db), loadAiContext(db)]);

  if (library.length === 0) {
    console.error("[chat-context] Workbook library is empty — refusing to chat ungrounded");
    return null;
  }

  const rendered = renderLibraryForPrompt(library, context);

  return `${CHAT_SYSTEM_PREAMBLE}

INITIATIVE LIBRARY (${library.length} initiatives, authored by the SAM team):
${rendered}`;
}

/**
 * Trim history so a long conversation cannot grow the prompt without bound.
 *
 * Keeps the most recent turns. Older context is dropped rather than summarised:
 * summarising costs an extra paid call per turn, and for short operator
 * questions the recent window is almost always sufficient.
 */
export const MAX_HISTORY_MESSAGES = 20;

export function trimHistory<T>(messages: readonly T[]): T[] {
  if (messages.length <= MAX_HISTORY_MESSAGES) return [...messages];
  return messages.slice(messages.length - MAX_HISTORY_MESSAGES);
}

/** Cap a single user message. Generous for a question, bounded against abuse. */
export const MAX_MESSAGE_CHARS = 4000;

/** First user message, trimmed into a conversation title for the admin view. */
export function deriveTitle(firstMessage: string): string {
  const clean = firstMessage.replace(/\s+/g, " ").trim();
  return clean.length <= 80 ? clean : `${clean.slice(0, 77)}...`;
}
