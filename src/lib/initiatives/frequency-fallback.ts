/**
 * Writing a frequency the database may not accept yet.
 *
 * Migration 051 widens three CHECKs from weekly | monthly | quarterly to the
 * seven frequencies. Until it is applied, writing e.g. 'bi-weekly' to
 * `initiatives.repeat_frequency` or `intake_initiatives.repeat_frequency`
 * fails with a check violation (Postgres 23514). Rather than failing the
 * whole flow, the write is retried ONCE without the new value:
 *
 *   initiatives        — the column is set to null and the frequency kept in
 *                        attrs.repeat_frequency, which `frequencyOf`
 *                        (recurring-state.ts) reads when the column is null.
 *   intake_initiatives — no attrs column, so the new value is dropped (null).
 *                        The three legacy values are always kept.
 *
 * Only a value outside the legacy three is touched; when there is none the
 * original error is returned untouched, so an unrelated check violation is
 * never masked.
 */

/** What the CHECKs accepted before migration 051. */
export const LEGACY_FREQUENCIES: readonly string[] = Object.freeze(['weekly', 'monthly', 'quarterly']);

type WriteError = { code?: string | null; message?: string | null } | null;
type WriteResult = { error: WriteError };
type Row = Record<string, unknown>;

export function isCheckViolation(error: WriteError | undefined): boolean {
  return !!error && error.code === '23514';
}

function isNewFrequency(v: unknown): v is string {
  return typeof v === 'string' && v !== '' && !LEGACY_FREQUENCIES.includes(v);
}

function isObject(v: unknown): v is Row {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * An `initiatives` insert/update payload with a new frequency moved into
 * attrs, or null when the payload carries none.
 *
 * `baseAttrs` is the row's current attrs for an UPDATE: attrs is replaced
 * wholesale, so without it the update would wipe every other answer.
 */
export function initiativeFrequencyFallback(row: Row, baseAttrs?: Row | null): Row | null {
  const freq = row.repeat_frequency;
  if (!isNewFrequency(freq)) return null;
  const attrs = {
    ...(isObject(baseAttrs) ? baseAttrs : {}),
    ...(isObject(row.attrs) ? row.attrs : {}),
    repeat_frequency: freq,
  };
  return { ...row, repeat_frequency: null, attrs };
}

/** `intake_initiatives` rows with every new frequency nulled, or null when none has one. */
export function intakeFrequencyFallback(rows: readonly Row[]): Row[] | null {
  if (!rows.some((r) => isNewFrequency(r.repeat_frequency))) return null;
  return rows.map((r) => (isNewFrequency(r.repeat_frequency) ? { ...r, repeat_frequency: null } : r));
}

/**
 * Run a write; on a check violation retry once with `fallback(payload)` when
 * it returns something. Logged on every fallback.
 */
export async function withFrequencyFallback<P, R extends WriteResult>(
  payload: P,
  run: (payload: P) => PromiseLike<R>,
  fallback: (payload: P) => P | null,
  label: string
): Promise<R> {
  const first = await run(payload);
  if (!isCheckViolation(first.error)) return first;
  const retry = fallback(payload);
  if (retry === null) return first;
  console.warn(
    `${label} repeat_frequency rejected by the database CHECK (migration 051 not applied?); ` +
      'retrying without the new frequency value.',
    first.error?.message ?? ''
  );
  return run(retry);
}
