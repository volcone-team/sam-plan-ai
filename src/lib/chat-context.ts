import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLibrary, loadAiContext, renderLibraryForPrompt } from "@/lib/workbook/read";
import {
  loadAccountSnapshot,
  renderAccountSnapshot,
  hasUsableAccountData,
} from "@/lib/chat-account-context";

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
- Advice, tactics and benchmarks come ONLY from the INITIATIVE LIBRARY below. It is the authored source of truth for this product.
- If the library does not cover something, say so plainly and suggest what the user could ask instead. Never invent an initiative, a benchmark number, or a task list.
- When a benchmark is marked unverified, say it is an estimate rather than presenting it as measured data.
- Keep answers short and practical: a few sentences, or a short list. These are busy operators, not readers.
- You may explain, compare, sequence and prioritise initiatives from the library, and answer "how do I actually do this" questions using the authored guidance.
- Decline anything unrelated to revenue planning and this product, briefly and without lecturing.

USING THIS ACCOUNT'S DATA:
- When a THIS ACCOUNT section is present, it is the real, current data for the business you are talking to. Use it to make your answer specific: their targets, products, planned initiatives and recorded results.
- Recommend only initiatives that exist in the library, but choose and prioritise them for THIS business — its budget, team size, products, what has already worked, and the gap between its targets and recorded results.
- Quote their figures only as given. Never estimate, extrapolate or invent a number that is not in the data, and do not guess at data that is absent. If something you would need is missing, say which piece is missing and what it would let you work out.
- If the account section is absent or thin, answer generally from the library and say you would be able to be more specific once they have completed their plan.
- You can READ their data but cannot CHANGE anything. For edits, point them at the planner or plan generation.
- This data belongs to the person you are talking to. Never speculate about, compare against, or refer to any other company's data.`;

/**
 * Build the full system prompt: rules, the workbook library, and — when a
 * company is known — that company's own data.
 *
 * Returns null when the workbook is empty — the caller must then refuse to chat
 * rather than fall back to an ungrounded model, which would happily invent a
 * catalogue and undermine the entire product.
 *
 * `companyId` MUST come from the authenticated session, never from the request
 * body. It is the only thing scoping the account section, so accepting a
 * client-supplied value would let anyone read another company's revenue by
 * passing its id.
 *
 * A failure to load account data is non-fatal: the assistant falls back to
 * workbook-only answers rather than refusing to talk, since general advice is
 * still useful and the alternative is a dead chat window.
 */
export async function buildChatSystemPrompt(
  db: SupabaseClient,
  companyId?: string | null
): Promise<string | null> {
  const [library, context] = await Promise.all([loadLibrary(db), loadAiContext(db)]);

  if (library.length === 0) {
    console.error("[chat-context] Workbook library is empty — refusing to chat ungrounded");
    return null;
  }

  const rendered = renderLibraryForPrompt(library, context);

  let accountSection = "";
  if (companyId) {
    try {
      const snapshot = await loadAccountSnapshot(db, companyId);
      if (hasUsableAccountData(snapshot) && snapshot) {
        accountSection = `

THIS ACCOUNT — the real current data for the business you are advising:
${renderAccountSnapshot(snapshot)}`;
      }
    } catch (err) {
      // Degrade to workbook-only rather than failing the turn.
      console.error(
        "[chat-context] Could not load account data, continuing workbook-only:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return `${CHAT_SYSTEM_PREAMBLE}

INITIATIVE LIBRARY (${library.length} initiatives, authored by the SAM team):
${rendered}${accountSection}`;
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
