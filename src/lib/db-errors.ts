/**
 * Shared Postgres / PostgREST error classification.
 *
 * Used by features whose tables arrive in a hand-run migration (SAM University
 * 038, FAQ 039) so their routes can answer 503 `migration_not_applied` instead
 * of a generic 500 when the owner has not run it yet.
 */

interface DbErrorLike {
  code?: string | null;
  message?: string | null;
}

/**
 * Is this error "the table does not exist"? PostgREST reports PGRST205
 * "Could not find the table …"; a raw Postgres error is 42P01
 * "relation … does not exist".
 */
export function isMissingTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { code, message } = err as DbErrorLike;
  if (code === "PGRST205" || code === "42P01") return true;
  const msg = typeof message === "string" ? message : "";
  return /could not find the table/i.test(msg) || /relation .* does not exist/i.test(msg);
}
