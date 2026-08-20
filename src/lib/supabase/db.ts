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
  if (!client) throw new Error('Supabase not configured');
  return client;
}

/**
 * Check if Supabase is configured.
 * Used by services to decide mock vs real queries.
 */
export function isSupabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
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
