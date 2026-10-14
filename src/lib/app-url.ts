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

/**
 * Hosts where plain http is legitimate.
 *
 * Only loopback. A development machine has no certificate, so forcing https
 * there would break every local email link — but everything else is a real
 * deployment, and a real deployment serving http is either a misconfiguration
 * or a downgrade attack waiting to happen.
 */
function isLoopback(host: string): boolean {
  const withoutScheme = host.replace(/^https?:\/\//, "");
  const hostname = withoutScheme.split("/")[0].split(":")[0].toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

/**
 * Attach a scheme, UPGRADING http to https for anything that is not loopback.
 *
 * This used to return an explicit `http://…` value untouched, which is how a
 * confirmation email ends up carrying an insecure link: the base URL is
 * whatever NEXT_PUBLIC_APP_URL says, and one `http://` typo in an environment
 * variable silently downgrades every link we mail for the lifetime of that
 * deployment. Nothing legitimate is lost by refusing — a host that genuinely
 * cannot serve https cannot run Supabase auth either.
 *
 * NOT A COMPLETE FIX ON ITS OWN. The link a user clicks in a confirmation
 * email is built by Supabase from its own Site URL setting, with our value
 * passed as `redirect_to`. If that Site URL is http, the email is insecure no
 * matter what this function returns — that one lives in the Supabase
 * dashboard, not in this repo.
 */
function withScheme(host: string): string {
  if (!host) return "";

  if (host.startsWith("https://")) return host;

  if (host.startsWith("http://")) {
    return isLoopback(host) ? host : `https://${host.slice("http://".length)}`;
  }

  // Bare host, as Vercel supplies it. Loopback keeps http so local dev works.
  return isLoopback(host) ? `http://${host}` : `https://${host}`;
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

  /**
   * 4. Client-side: trust the current origin, but still insist on https.
   *
   * This is the branch the signup page actually uses — it is a client
   * component, so `emailRedirectTo` is built here. Passing the origin through
   * unchecked meant a page served over http produced an http confirmation
   * link, and the one place that is correct is a local dev server.
   */
  if (typeof window !== "undefined" && window.location?.origin) {
    return normalize(withScheme(window.location.origin));
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
