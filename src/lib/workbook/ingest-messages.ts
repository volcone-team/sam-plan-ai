import type { LibraryRow } from "@/lib/workbook/parse";
import { parseMetricsCell } from "@/lib/metrics/parse-metrics";

/**
 * Warning strings that ingest adds on top of the parser's.
 *
 * Kept in their own PURE module (no Supabase, no I/O) so the admin upload
 * preview can run in the browser and produce exactly the messages the server
 * will report, without bundling the ingest writer. ingest.ts re-exports both.
 */

export const MIGRATION_040_WARNING =
  "Migration 040 is not applied, so the library was stored WITHOUT its S/C/O/R/E " +
  "scores, ideal industries, CTA options, training, metrics or variant links. " +
  "Difficulty and speed were still derived from the scores and stored. Apply " +
  "supabase/migrations/040_library_scores_metrics.sql, then upload the workbook again.";

/**
 * One warning per initiative whose Metrics cell has tokens the dictionary
 * does not know, so the admin can fix the spelling or ask for a synonym.
 */
export function metricsWarnings(library: readonly LibraryRow[]): string[] {
  const out: string[] = [];
  for (const r of library) {
    const { unrecognised } = parseMetricsCell(r.metricsRaw ?? null);
    if (unrecognised.length > 0) {
      out.push(
        `Metrics for "${r.name}" (${r.initiativeKey}): unrecognised ` +
        `${unrecognised.map((u) => `"${u}"`).join(", ")}. These will not become trackable inputs.`
      );
    }
  }
  return out;
}
