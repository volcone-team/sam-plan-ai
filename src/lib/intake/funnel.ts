/**
 * The intake funnel — one shape for all 22 initiatives (decision D1).
 *
 * The client spec says the last-results fields "come from the initiative type's
 * input list in the library", but `wb_initiative_library` has no such column.
 * Rather than block on a workbook authoring pass, every initiative uses the
 * spec's own generic fallback:
 *
 *   audience reached -> % signed up -> % showed up or booked -> % bought
 *   x average price
 *
 * LABELS vary per initiative because the mockups show them varying — a webinar
 * asks "% who showed up", a podcast guest spot asks "% who booked a call". That
 * difference is PRESENTATION ONLY. The arithmetic, the field count and the
 * stored shape are identical, so there is one tested code path instead of a
 * variant per category, and adding a label override can never change a
 * forecast.
 *
 * The stored shape is the ordered `{key, label, percent}` array that
 * `intake_initiatives.funnel_stages` already holds, and the maths is the
 * already-tested `lib/intake-forecast.ts`.
 */

import type { FunnelStage, InitiativeFunnel } from "@/lib/intake-forecast";

/** The three conversion steps between an audience and a buyer. */
export type StageKey = "signed_up" | "showed" | "bought";

export interface StageDefinition {
  key: StageKey;
  /** Used unless the initiative overrides it. */
  defaultLabel: string;
}

/**
 * Order matters: each percentage applies to the people remaining after the
 * previous step, so reordering these would change every forecast.
 */
export const FUNNEL_STAGES: readonly StageDefinition[] = [
  { key: "signed_up", defaultLabel: "% who signed up" },
  { key: "showed", defaultLabel: "% who showed up or booked" },
  { key: "bought", defaultLabel: "% who bought" },
] as const;

/**
 * Per-initiative label overrides, keyed by library `initiative_key`.
 *
 * Deliberately a small, additive map rather than a required field on every
 * library row: an initiative with no entry here simply uses the default
 * labels, so the picker never breaks when the workbook gains a new initiative.
 *
 * Keys here must match `wb_initiative_library.initiative_key`. An unknown key
 * is harmless — it is only ever read as a lookup miss.
 */
export const LABEL_OVERRIDES: Record<string, Partial<Record<StageKey, string>>> = {
  // Virtual events: people register, then attend.
  webinar: { signed_up: "% who registered", showed: "% who showed up" },
  "evergreen-webinars": { signed_up: "% who registered", showed: "% who watched" },
  "challenge-bootcamp": { signed_up: "% who registered", showed: "% who showed up" },
  "online-workshops": { signed_up: "% who registered", showed: "% who showed up" },
  "social-media-lives": { signed_up: "% who tuned in", showed: "% who stayed to the end" },

  // Borrowed-audience media: people opt in, then book a call.
  "podcast-vodcast-guest": { signed_up: "% who opted in", showed: "% who booked a call" },
  "ops-in-person-other-peoples-stages": {
    signed_up: "% who opted in",
    showed: "% who booked a call",
  },

  // Owned digital: click, then book.
  "email-campaign": { signed_up: "% who clicked", showed: "% who booked a call" },
  "paid-ads": { signed_up: "% who clicked", showed: "% who booked a call" },
  "digital-marketing": { signed_up: "% who clicked", showed: "% who booked a call" },
  "content-organic-social": { signed_up: "% who clicked", showed: "% who booked a call" },
  "vsl-sales-page": { signed_up: "% who watched", showed: "% who booked a call" },
  "direct-message-reach-out": { signed_up: "% who replied", showed: "% who booked a call" },
  "internal-launch": { signed_up: "% who clicked", showed: "% who booked a call" },
  "affiliate-launches": { signed_up: "% who clicked", showed: "% who booked a call" },

  // In-person: register or get invited, then actually turn up.
  "your-own-event": { signed_up: "% who registered", showed: "% who attended" },
  "hybrid-events": { signed_up: "% who registered", showed: "% who attended" },
  "networking-events": { signed_up: "% who connected", showed: "% who booked a call" },
  dinners: { signed_up: "% who accepted", showed: "% who attended" },

  // Already a conversation, so the middle step is the meeting happening.
  "sales-calls": { signed_up: "% who booked", showed: "% who showed up" },
  referral: { signed_up: "% who were referred", showed: "% who booked a call" },

  // Recurring products: join, then stay.
  "courses-memberships": { signed_up: "% who joined", showed: "% who stayed active" },
};

export interface FunnelFieldSpec {
  key: StageKey;
  label: string;
}

/**
 * The three percentage fields to render for an initiative, in order.
 *
 * Always three, always the same keys — only the wording shifts.
 */
export function funnelFieldsFor(initiativeKey: string | null | undefined): FunnelFieldSpec[] {
  const overrides = (initiativeKey && LABEL_OVERRIDES[initiativeKey]) || {};
  return FUNNEL_STAGES.map((stage) => ({
    key: stage.key,
    label: overrides[stage.key] ?? stage.defaultLabel,
  }));
}

/** Labels for the two fields that bracket the percentages. */
export const AUDIENCE_LABEL = "Audience reached";
export const AVERAGE_PRICE_LABEL = "Average price";

/** Shown under the funnel, per the spec. */
export const FUNNEL_SKIP_HELPER =
  "Your best guess helps. We'll use our benchmarks for anything you skip.";

/** What the form holds while the user is typing. Percentages are 0-100. */
export interface FunnelAnswers {
  audienceReached: number | null;
  percents: Partial<Record<StageKey, number | null>>;
  averagePrice: number | null;
}

export function emptyFunnelAnswers(): FunnelAnswers {
  return { audienceReached: null, percents: {}, averagePrice: null };
}

/**
 * Convert form answers into the shape the forecast and the database expect.
 *
 * The LABEL is stored alongside each percentage on purpose: it is what the user
 * was actually asked. If an override is later reworded, a historic answer still
 * reads back with the question it was given, rather than being retroactively
 * relabelled.
 */
export function toInitiativeFunnel(
  initiativeKey: string | null | undefined,
  answers: FunnelAnswers
): InitiativeFunnel {
  const fields = funnelFieldsFor(initiativeKey);
  const stages: FunnelStage[] = fields.map((field) => ({
    key: field.key,
    label: field.label,
    percent: answers.percents[field.key] ?? null,
  }));

  return {
    audienceReached: answers.audienceReached,
    stages,
    averagePrice: answers.averagePrice,
  };
}

/** Read stored `funnel_stages` back into form answers. */
export function fromStoredStages(
  audienceReached: number | null,
  stored: readonly { key: string; percent: number | null }[] | null | undefined,
  averagePrice: number | null
): FunnelAnswers {
  const percents: Partial<Record<StageKey, number | null>> = {};
  for (const stage of stored ?? []) {
    if (isStageKey(stage.key)) percents[stage.key] = stage.percent;
  }
  return { audienceReached, percents, averagePrice };
}

function isStageKey(value: string): value is StageKey {
  return value === "signed_up" || value === "showed" || value === "bought";
}

/**
 * Is this funnel complete enough to forecast from?
 *
 * All five inputs are required. A partially-filled funnel produces NO forecast
 * rather than a low one — see `forecastPerRun`, which returns null for exactly
 * this case, and REQ-13.6, where the card then says the figure came from
 * benchmarks.
 *
 * The distinction matters: a forecast of zero tells a customer the initiative
 * is worthless, while an absent forecast tells them we do not know yet.
 */
export function isFunnelComplete(answers: FunnelAnswers): boolean {
  if (answers.audienceReached === null || answers.audienceReached <= 0) return false;
  if (answers.averagePrice === null || answers.averagePrice <= 0) return false;
  return FUNNEL_STAGES.every((stage) => {
    const value = answers.percents[stage.key];
    return value !== null && value !== undefined && Number.isFinite(value);
  });
}

/** How many of the five inputs are filled, for a progress hint. */
export function funnelCompletedCount(answers: FunnelAnswers): number {
  let count = 0;
  if (answers.audienceReached !== null) count += 1;
  if (answers.averagePrice !== null) count += 1;
  for (const stage of FUNNEL_STAGES) {
    const value = answers.percents[stage.key];
    if (value !== null && value !== undefined) count += 1;
  }
  return count;
}

export const FUNNEL_FIELD_COUNT = FUNNEL_STAGES.length + 2;
