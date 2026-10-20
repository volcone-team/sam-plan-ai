/**
 * "This column does not exist."
 *
 * Its own module because the middleware needs it.
 *
 * Migrations in this project are applied BY HAND, so a release routinely runs
 * against a database that does not yet have the columns it knows about. The
 * house pattern is to select them anyway and read this error as "the migration
 * is not applied yet, use the default" (see `loadLibrary`, and
 * `loadCallGateSettings` for migration 043).
 *
 * It USED TO LIVE in src/lib/workbook/read.ts, which re-exports it so every
 * existing import keeps working. The onboarding call gate runs in the
 * middleware — Edge, on every request — and importing it from there dragged
 * the whole workbook/metrics dictionary graph into the Edge bundle for the
 * sake of six lines of regex. Pure, import-free, Edge-safe.
 *
 * PGRST204 is PostgREST's own "column not found in schema cache"; 42703 is
 * Postgres's undefined_column. The message patterns are the belt-and-braces
 * case for a client that reports neither code.
 */
export function isMissingColumnError(
  err: { code?: string | null; message?: string | null } | null
): boolean {
  if (!err) return false;
  if (err.code === "PGRST204" || err.code === "42703") return true;
  const msg = err.message ?? "";
  return /could not find the '.*' column/i.test(msg) || /column .* does not exist/i.test(msg);
}
