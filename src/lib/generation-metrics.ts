/**
 * AI generation metrics — pure math, no database.
 *
 * Kept separate from the API route so the arithmetic (windowing, success
 * rate, averaging) is unit-testable without a Supabase connection.
 *
 * DESIGN: every "no data" case returns `null`, never 0 and never NaN. A
 * success rate of 0% and "no generations recorded" are very different facts,
 * and the dashboard previously showed hardcoded numbers that made an empty
 * table look like a healthy one. `null` lets the UI render a dash.
 */

/** The subset of a `generation_events` row the metrics need. */
export interface GenerationEventRow {
  event_type: string;
  status: string;
  duration_ms: number | null;
  created_at: string;
}

export interface AiMetrics {
  /** All rows passed in, regardless of age or status. */
  totalGenerations: number;
  /** Rows in the trailing window divided by window length, 1 decimal. */
  generationsPerDay: number;
  /** Success share of the trailing window, 0-100 rounded; null with no rows. */
  successRatePct: number | null;
  /** Mean duration of successful rows that recorded one; null if none did. */
  avgDurationMs: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compute the AI dashboard metrics.
 *
 * @param rows        generation events, any order
 * @param now         evaluation time (injected so tests are deterministic)
 * @param windowDays  trailing window for rate + success rate
 */
export function computeAiMetrics(
  rows: GenerationEventRow[],
  now: Date,
  windowDays = 30
): AiMetrics {
  const totalGenerations = rows.length;

  // Guard: a zero/negative window would divide by zero below.
  const days = windowDays > 0 ? windowDays : 1;
  const cutoff = now.getTime() - days * MS_PER_DAY;

  // Inclusive at the boundary: an event exactly `windowDays` old counts as
  // inside the window. Unparseable timestamps are dropped rather than
  // silently treated as "now".
  const windowRows = rows.filter((r) => {
    const t = Date.parse(r.created_at);
    return Number.isFinite(t) && t >= cutoff && t <= now.getTime();
  });

  const generationsPerDay = Math.round((windowRows.length / days) * 10) / 10;

  const successRatePct =
    windowRows.length === 0
      ? null
      : Math.round(
          (windowRows.filter((r) => r.status === "success").length /
            windowRows.length) *
            100
        );

  // Average only over successful rows that actually recorded a duration.
  // A failed run's duration is not comparable, and null means "not measured",
  // not "instant".
  const durations = rows
    .filter((r) => r.status === "success" && typeof r.duration_ms === "number")
    .map((r) => r.duration_ms as number);

  const avgDurationMs =
    durations.length === 0
      ? null
      : Math.round(durations.reduce((s, d) => s + d, 0) / durations.length);

  return { totalGenerations, generationsPerDay, successRatePct, avgDurationMs };
}
