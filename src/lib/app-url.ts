/**
 * Canonical application URL resolution.
 *
 * Email links, callbacks and anything else that must point back at the app
 * need one agreed-upon base URL. Previously this was hardcoded in a couple of
 * places, so links could point at the wrong environment.
 *
 * Precedence (first match wins):
 *   1. NEXT_PUBLIC_APP_URL           - explicit override, set this in production
 *   2. VERCEL_PROJECT_PRODUCTION_URL - stable production domain on Vercel
 *   3. VERCEL_URL                    - per-deployment URL (preview builds)
 *   4. window.location.origin        - whatever host the browser is on
 *   5. http://localhost:3000         - local development
 *
 * Note: VERCEL_URL / VERCEL_PROJECT_PRODUCTION_URL are server-only and are not
 * prefixed with the scheme, so https:// is added here.
 */

const LOCAL_FALLBACK = "http://localhost:3000";

function withScheme(host: string): string {
  if (!host) return "";
  if (host.startsWith("http://") || host.startsWith("https://")) return host;
  return `https://${host}`;
}

/** Strip any trailing slash so callers can safely append paths. */
function normalize(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Resolve the base URL of the app. Safe to call on both server and client.
 */
export function getAppUrl(): string {
  // 1. Explicit override
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return normalize(withScheme(explicit));

  // 2 & 3. Vercel-provided (server-side only)
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProd) return normalize(withScheme(vercelProd));

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return normalize(withScheme(vercelUrl));

  // 4. Client-side: trust the current origin
  if (typeof window !== "undefined" && window.location?.origin) {
    return normalize(window.location.origin);
  }

  // 5. Local development
  return LOCAL_FALLBACK;
}

/**
 * Build an absolute URL for a path within the app.
 * @example absoluteUrl("/year-at-a-glance")
 */
export function absoluteUrl(path = "/"): string {
  const base = getAppUrl();
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}
