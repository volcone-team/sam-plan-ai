/**
 * Library entry -> metrics -> metric set. The ONE place every server path
 * that creates an initiative from the library resolves its metric set:
 * POST /api/initiatives, intake build, generate-plan and accepted plan
 * suggestions. Also what the customer library API exposes, so the picker
 * shows exactly what the server will build.
 *
 * SOURCE OF THE METRICS, in order:
 *   1. The stored parse (`wb_initiative_library.metrics`, written by ingest).
 *   2. A live `parseMetricsCell(metrics_raw)` — the column is `[]` until the
 *      workbook is re-uploaded after migration 040.
 *   3. Nothing: the initiative gets no metric set (null).
 */

import { parseMetricsCell, toStoredMetrics, type StoredMetrics } from "@/lib/metrics/parse-metrics";
import {
  buildMetricSet,
  validateMetricSelection,
  type InitiativeMetricSet,
  type MetricSelection,
} from "@/lib/metrics/metric-set";

/** The library fields this reads; LibraryEntry satisfies it. */
export interface MetricsSource {
  metrics: StoredMetrics | null;
  metricsRaw: string | null;
}

/** Stored parse, else live parse of the raw cell, else null. */
export function libraryMetricsFor(entry: MetricsSource | null | undefined): StoredMetrics | null {
  if (!entry) return null;
  if (entry.metrics && entry.metrics.groups.length > 0) return entry.metrics;
  const live = parseMetricsCell(entry.metricsRaw);
  if (live.groups.length > 0 || live.tags.length > 0) return toStoredMetrics(live);
  return entry.metrics;
}

export type MetricSetResolution =
  | { ok: true; metricSet: InitiativeMetricSet | null }
  | { ok: false; error: string };

/**
 * The metric set for a library pick. Without a selection: every group and
 * every optional metric (intake build, generate-plan, suggestions). With one:
 * validated against the library first, so an unknown group or metric is an
 * error rather than silently ignored.
 */
export function resolveLibraryMetricSet(
  libraryKey: string,
  entry: MetricsSource | null | undefined,
  selection?: MetricSelection
): MetricSetResolution {
  const metrics = libraryMetricsFor(entry);
  if (selection) {
    const error = validateMetricSelection(metrics, selection);
    if (error) return { ok: false, error };
  }
  return { ok: true, metricSet: buildMetricSet(libraryKey, metrics, selection ?? {}) };
}

/** Shorthand for the no-selection case. */
export function defaultLibraryMetricSet(
  libraryKey: string,
  entry: MetricsSource | null | undefined
): InitiativeMetricSet | null {
  const r = resolveLibraryMetricSet(libraryKey, entry);
  return r.ok ? r.metricSet : null;
}
