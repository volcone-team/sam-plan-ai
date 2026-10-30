/**
 * One card per occurrence of a recurring initiative (client, Oct 2026: "if
 * an initiative is recurring it should create multiple initiative cards for
 * those upcoming dates").
 *
 * DISPLAY ONLY. The series stays ONE initiatives row, so it counts once
 * against the plan limit, is edited once, and its totals are unchanged.
 * Each card is that row seen at one of its dates, with the per-occurrence
 * target. Past occurrences stay on the page.
 *
 * Dates and figures come from revenue-spread (runDates / perRun), the same
 * source as the timeline, the planners and the overview. Pure.
 */
import { perRun, runSchedule, type SpreadRow } from "@/lib/planning/revenue-spread";
import type { DateOnly } from "@/lib/plan-dates";

export interface OccurrenceCard {
  date: DateOnly;
  /** The date the schedule calculated; differs from `date` when moved. */
  scheduled: DateOnly;
  /** The customer moved this one occurrence. */
  moved: boolean;
  /** 1-based. */
  index: number;
  total: number;
  /** Good / Better / Best for this one occurrence. */
  scenarios: { good: number; better: number; best: number };
  /** Before `today`. */
  past: boolean;
}

/** The cards for a recurring series, or [] when it is not one (or has one date). */
export function occurrenceCards(
  initiative: SpreadRow,
  planEnd: DateOnly | null,
  today: DateOnly
): OccurrenceCard[] {
  if (initiative.kind !== "recurring") return [];
  const slots = runSchedule(initiative, planEnd);
  if (slots.length < 2) return [];
  const per = perRun(initiative, planEnd);
  const round = (n: number) => Math.round(n * 100) / 100;
  const scenarios = per
    ? { good: round(per.good), better: round(per.better), best: round(per.best) }
    : { good: 0, better: 0, best: 0 };
  return slots.map(({ date, scheduled }, i) => ({
    date,
    scheduled,
    moved: date !== scheduled,
    index: i + 1,
    total: slots.length,
    scenarios,
    past: date < today,
  }));
}

/** "Occurrence 3 of 12". */
export function occurrenceLabel(card: Pick<OccurrenceCard, "index" | "total">): string {
  return `Occurrence ${card.index} of ${card.total}`;
}
