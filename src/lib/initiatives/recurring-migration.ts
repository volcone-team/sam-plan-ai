/**
 * Is migration 046 (recurring instances) missing?
 *
 * Migrations are applied by hand, so this release can run against a database
 * without `initiative_instances` or `initiatives.correction_kept_at`. Every
 * read and write of either goes through this check, and a hit means "the
 * feature is off": the routes answer 200 `{ enabled: false }` and the page
 * shows no prompts. Never a 500.
 *
 *   Missing table:  PostgREST PGRST205, Postgres 42P01
 *   Missing column: PostgREST PGRST204, Postgres 42703
 *
 * Composes the two shared classifiers so the codes and message patterns stay
 * defined in one place each.
 */
import { isMissingTableError } from '@/lib/db-errors';
import { isMissingColumnError } from '@/lib/supabase/missing-column';

export function isRecurringMigrationMissing(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return isMissingTableError(err) || isMissingColumnError(err as { code?: string | null; message?: string | null });
}

/** The body every recurring route returns while migration 046 is not applied. */
export const RECURRING_DISABLED = Object.freeze({ enabled: false as const });
