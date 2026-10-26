/**
 * What the "Why This Initiative" card shows (src/components/initiatives/initiative-why.tsx).
 *
 * Only "When to use" is shown (client request): the workbook AI Context
 * sheet's when_to_use (wb_ai_context), keyed by the initiative's library key.
 * The old initiative_types.ai_context description is used only when there is
 * no workbook entry, or its when_to_use is blank. Best fit, min assets, why it
 * works, what to avoid, min budget and sequencing notes are not shown.
 * initiative_types.ai_context.sizingGuidance is deliberately never shown: it is
 * empty or placeholder text on the hand-made rows.
 */
import type { ContextEntry } from "@/lib/workbook/read";

export interface WhySection {
  heading: string;
  text: string;
  /** Long enough to clamp behind a "Show more" toggle. */
  long: boolean;
}

/** Above this many characters a field is clamped to 6 lines with "Show more". */
export const WHY_CLAMP_CHARS = 600;

const HEADING = "When to use";

function section(heading: string, raw: unknown): WhySection | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;
  return { heading, text, long: text.length > WHY_CLAMP_CHARS };
}

/**
 * The sections to render: at most one, "When to use". Empty array means hide
 * the card.
 *
 * @param entry    the workbook entry, or null when absent / the fetch failed
 * @param fallbackDescription initiative_types.ai_context.description
 */
export function whySections(
  entry: Partial<ContextEntry> | null | undefined,
  fallbackDescription: string | null | undefined
): WhySection[] {
  const chosen = section(HEADING, entry?.whenToUse) ?? section(HEADING, fallbackDescription);
  return chosen ? [chosen] : [];
}
