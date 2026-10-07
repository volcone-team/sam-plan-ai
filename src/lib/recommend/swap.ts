/**
 * Swap: replace a recommendation with the next-best alternative (D3).
 *
 * Auto-replace rather than a picker. The user has already said "not this one"
 * — handing them the full 22-entry library to choose from turns one rejection
 * into a research task, and they chose Path B or C precisely to avoid that.
 *
 * Repeated swaps walk further down the ranked list, so swapping is also how
 * someone browses alternatives. When nothing eligible remains the control
 * DISABLES rather than silently doing nothing: a button that stops responding
 * reads as a bug, while a disabled one says there is nothing left.
 */

import { isEligible, type EligibilityContext } from "@/lib/recommend/eligibility";
import type { LibraryInitiative } from "@/lib/intake/library";

export interface SwapContext extends EligibilityContext {
  /**
   * Keys already on screen — accepted, pending, or swapped away from.
   *
   * One set rather than separate accepted/dismissed lists: the question each
   * candidate must answer is "has the user seen this already", and the reason
   * they have seen it does not change the answer.
   */
  alreadyShown: readonly string[];
}

/**
 * The next eligible initiative the user has not already seen.
 *
 * `ranked` is the AI's ordering, so "next best" means the model's own
 * preference filtered through our rules — not an alphabetical fallback. Returns
 * null when the list is exhausted.
 */
export function nextBestAlternative(
  ranked: readonly LibraryInitiative[],
  ctx: SwapContext
): LibraryInitiative | null {
  const shown = new Set(ctx.alreadyShown);

  for (const candidate of ranked) {
    if (shown.has(candidate.key)) continue;
    // Re-checked rather than trusted: the ranked list came from the model, and
    // the whole point of D3 is that a swap honours every rule in REQ-13.8 to
    // REQ-13.12 just as the original recommendation did.
    if (!isEligible(candidate, ctx).eligible) continue;
    return candidate;
  }

  return null;
}

/**
 * Can this card still be swapped?
 *
 * Checked separately from performing the swap so the control can be disabled
 * BEFORE the user clicks it, rather than appearing live and then doing nothing.
 */
export function canSwap(
  ranked: readonly LibraryInitiative[],
  ctx: SwapContext
): boolean {
  return nextBestAlternative(ranked, ctx) !== null;
}

/**
 * Swap one key for the next best, returning the new shortlist.
 *
 * The replacement takes the OUTGOING CARD'S POSITION rather than being appended.
 * The list is ranked, so appending would quietly demote the slot and reorder
 * the screen under the user mid-decision.
 *
 * The swapped-away key is added to `alreadyShown` by the caller, which owns
 * that set — doing it here would mean this function could not be called twice
 * with the same context in a test.
 */
export function swapInPlace(
  shortlist: readonly LibraryInitiative[],
  outgoingKey: string,
  ranked: readonly LibraryInitiative[],
  ctx: SwapContext
): { shortlist: LibraryInitiative[]; replacement: LibraryInitiative | null } {
  const index = shortlist.findIndex((entry) => entry.key === outgoingKey);
  if (index === -1) {
    return { shortlist: [...shortlist], replacement: null };
  }

  // Everything currently on screen counts as shown, so a swap cannot produce a
  // duplicate of a card sitting two rows down.
  const shown = new Set([...ctx.alreadyShown, ...shortlist.map((e) => e.key)]);

  const replacement = nextBestAlternative(ranked, {
    ...ctx,
    alreadyShown: [...shown],
  });

  if (!replacement) {
    // Nothing eligible left. The card stays rather than disappearing — losing
    // it would shrink the plan as a side effect of asking for an alternative.
    return { shortlist: [...shortlist], replacement: null };
  }

  const next = [...shortlist];
  next[index] = replacement;
  return { shortlist: next, replacement };
}
