/**
 * Saving a draft before its newest columns exist.
 *
 * Migrations are applied by hand, so a release can run against a database
 * that lacks a column `serialiseAnswers` writes. PostgREST then refuses the
 * whole `planning_inputs` write (PGRST204, or Postgres 42703), and the user
 * loses every answer on that save, not just the new one.
 *
 * So the columns from not-yet-guaranteed migrations are listed here, and a
 * write refused for a missing column is retried ONCE without them. Only
 * these columns are ever dropped; any other error, or a missing-column error
 * on a row that carries none of them, is returned untouched.
 */

import { isMissingColumnError } from "@/lib/supabase/missing-column";

/** Columns a draft may write before their migration is applied. */
export const PENDING_INPUT_COLUMNS: readonly string[] = Object.freeze([
  // 053_customer_industries_other.sql
  "customer_industries_other",
]);

type WriteError = { code?: string | null; message?: string | null } | null;
type Row = Record<string, unknown>;

/**
 * The row to retry with after `error`, or null when there is nothing to retry
 * (not a missing-column error, or no pending column on the row).
 */
export function draftRetryRow(row: Row, error: WriteError | undefined): Row | null {
  if (!isMissingColumnError(error ?? null)) return null;
  const present = PENDING_INPUT_COLUMNS.filter((column) => column in row);
  if (present.length === 0) return null;
  const retry: Row = { ...row };
  for (const column of present) delete retry[column];
  return retry;
}

let warned = false;

/** Test hook: re-arm the once-per-process warning. */
export function resetDraftColumnWarning(): void {
  warned = false;
}

/**
 * Run a `planning_inputs` write; on a missing-column refusal retry once
 * without the pending columns. Warns the first time per process only, since
 * every save would otherwise log the same line until the migration lands.
 */
export async function withDraftColumnFallback<R extends { error: WriteError }>(
  row: Row,
  run: (row: Row) => PromiseLike<R>,
  label: string
): Promise<R> {
  const first = await run(row);
  const retry = draftRetryRow(row, first.error);
  if (retry === null) return first;
  if (!warned) {
    warned = true;
    console.warn(
      `${label} planning_inputs is missing ${PENDING_INPUT_COLUMNS.join(", ")} ` +
        "(migration 053 not applied?); saving without it.",
      first.error?.message ?? ""
    );
  }
  return run(retry);
}
