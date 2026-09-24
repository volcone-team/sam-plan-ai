import { createBrowserClient } from '@supabase/ssr';

/**
 * Get a Supabase client for service-layer queries.
 * Returns null if Supabase is not configured (allows fallback to mock).
 *
 * Usage in services:
 *   const supabase = getSupabase();
 *   if (!supabase) return fallbackToMock();
 *   const { data } = await supabase.from('companies').select();
 */
export function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return null;

  return createBrowserClient(url, key);
}

/**
 * Alias for backward compatibility with services that use getSupabase()
 */
export function getSupabase() {
  const client = getSupabaseClient();
  if (!client) throw new ConfigurationError();
  return client;
}

/**
 * Check if Supabase is configured.
 * Used by services to decide mock vs real queries.
 *
 * NOTE: this only verifies the env vars are PRESENT. It cannot tell whether
 * they point at the right project or carry a valid key - see
 * ConfigurationError / assertSupabaseConfigured below for how callers should
 * surface a genuine misconfiguration.
 */
export function isSupabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Raised when the app cannot talk to Supabase because it is not configured.
 *
 * This exists so callers (and the UI) can distinguish "the backend is
 * misconfigured" from "this query legitimately returned nothing". Previously
 * both looked identical: services either returned fabricated mock records or
 * an empty array, so a broken production deploy silently rendered as an empty
 * plan and users had no signal anything was wrong.
 */
export class ConfigurationError extends Error {
  readonly isConfigurationError = true;

  constructor(message = "Supabase is not configured on this environment.") {
    super(message);
    this.name = "ConfigurationError";
  }
}

/** Type guard so callers can branch without importing the class. */
export function isConfigurationError(err: unknown): err is ConfigurationError {
  return (
    err instanceof ConfigurationError ||
    (typeof err === "object" && err !== null && "isConfigurationError" in err)
  );
}

/**
 * True only when mock data has been explicitly opted into for local
 * development. Never true in production, regardless of the flag.
 *
 * Set SAM_USE_MOCK_DATA=1 (or NEXT_PUBLIC_SAM_USE_MOCK_DATA=1 for client
 * components) to enable.
 */
export function isMockDataEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const flag =
    process.env.SAM_USE_MOCK_DATA || process.env.NEXT_PUBLIC_SAM_USE_MOCK_DATA;
  const on = flag === "1" || flag === "true";
  if (on) warnMockModeOnce();
  return on;
}

let mockWarningShown = false;
function warnMockModeOnce(): void {
  if (mockWarningShown) return;
  mockWarningShown = true;
  console.warn(
    "\n*** MOCK DATA MODE ENABLED ***\n" +
      "Services are returning fabricated seed data, not real records.\n" +
      "Unset SAM_USE_MOCK_DATA to use the real database.\n"
  );
}

/**
 * Throws a ConfigurationError when Supabase is unusable and mock mode has not
 * been explicitly enabled. Services call this instead of silently falling back.
 */
export function assertSupabaseConfigured(): void {
  if (isSupabaseConfigured()) return;
  if (isMockDataEnabled()) return; // dev opt-in, caller may serve mock
  throw new ConfigurationError(
    "Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and/or " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY are missing. Refusing to return " +
      "placeholder data."
  );
}

/**
 * Maps snake_case DB columns to camelCase TypeScript properties.
 */
export function snakeToCamel<T extends Record<string, unknown>>(row: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result as T;
}

/**
 * Maps camelCase TypeScript properties to snake_case for DB inserts/updates.
 */
export function camelToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    result[snakeKey] = value;
  }
  return result;
}
