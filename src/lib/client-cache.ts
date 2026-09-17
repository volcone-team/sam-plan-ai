/**
 * Lightweight client-side cache with TTL and stale-while-revalidate.
 *
 * Why this exists: every Supabase query from the browser costs a full network
 * round trip (measured at 500-1000ms on slower connections). Re-fetching the
 * same profile/plan data on each navigation made the app feel sluggish.
 *
 * Two layers:
 *   1. In-memory  - instant, cleared on hard reload
 *   2. sessionStorage - survives reloads within the same tab session
 *
 * Deliberately NOT localStorage: cached data is per-session and per-user, and
 * we don't want it outliving a sign-out.
 */

const PREFIX = "sam-cache:";

interface Entry<T> {
  value: T;
  /** epoch ms when this entry was written */
  at: number;
}

const memory = new Map<string, Entry<unknown>>();

function readSession<T>(key: string): Entry<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as Entry<T>;
  } catch {
    return null;
  }
}

function writeSession<T>(key: string, entry: Entry<T>): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // Quota or serialization failure - memory cache still applies.
  }
}

/**
 * Read a cached value. Returns the value plus whether it is stale.
 * A stale value is still returned so callers can render immediately
 * and revalidate in the background.
 */
export function cacheGet<T>(key: string, ttlMs: number): { value: T; stale: boolean } | null {
  const entry = (memory.get(key) as Entry<T> | undefined) ?? readSession<T>(key);
  if (!entry) return null;
  // Re-seed memory from sessionStorage so later reads skip JSON parsing.
  if (!memory.has(key)) memory.set(key, entry);
  return { value: entry.value, stale: Date.now() - entry.at > ttlMs };
}

export function cacheSet<T>(key: string, value: T): void {
  const entry: Entry<T> = { value, at: Date.now() };
  memory.set(key, entry);
  writeSession(key, entry);
}

/** Remove one key. */
export function cacheInvalidate(key: string): void {
  memory.delete(key);
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {}
}

/** Remove every key that starts with the given prefix. */
export function cacheInvalidatePrefix(prefix: string): void {
  for (const k of Array.from(memory.keys())) {
    if (k.startsWith(prefix)) memory.delete(k);
  }
  if (typeof window === "undefined") return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(PREFIX + prefix)) toRemove.push(k);
    }
    toRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {}
}

/** Wipe everything. Call on sign-out so no user data leaks across sessions. */
export function cacheClearAll(): void {
  memory.clear();
  if (typeof window === "undefined") return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(PREFIX)) toRemove.push(k);
    }
    toRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {}
}

/** Common TTLs. Plan data changes rarely; profile almost never mid-session. */
export const TTL = {
  profile: 5 * 60 * 1000,   // 5 min
  planData: 60 * 1000,      // 1 min
  reference: 30 * 60 * 1000, // 30 min (initiative types, etc.)
} as const;

/** Cache keys, centralised so invalidation can't drift from writes. */
export const CacheKeys = {
  me: "me",
  dashboard: (companyId: string) => `dashboard:${companyId}`,
  planPrefix: "dashboard:",
} as const;
