import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ResponseCookies, RequestCookies } from "next/dist/compiled/@edge-runtime/cookies";
import {
  IMPERSONATION_MARKER_COOKIE,
  IMPERSONATION_MAX_AGE_SECONDS,
  IMPERSONATION_RETURN_COOKIE,
  impersonationCookieOptions,
  signImpersonationMarker,
  signImpersonationReturn,
  verifyImpersonationMarker,
  verifyImpersonationReturn,
  type ImpersonationMarker,
} from "./impersonation";

/**
 * THE TEST THAT WAS MISSING.
 *
 * The banner never rendered on any page, through two different mount points,
 * because nothing exercised the signed value as it actually travels: signed ->
 * serialized into a Set-Cookie header -> read back out of a Cookie header ->
 * decoded. Each half was tested in isolation and the seam between them was
 * where the bug lived.
 *
 * THE BUG: the client decoder took everything after the FIRST "." as JSON,
 * while `signPayload` prefixes the body with the purpose
 * `sam.impersonation.marker.v1` — three dots. `JSON.parse` threw on every
 * marker ever issued, the decoder's catch returned null, and the component
 * rendered nothing. `verifyImpersonationMarker` was always correct (it slices
 * by the prefix's LENGTH), which is why impersonation itself worked: the
 * middleware honoured the marker, the session was real, and only the way back
 * was invisible.
 *
 * Nothing is mocked: real Web Crypto HMAC, and the real cookie serializer Next
 * uses (next/dist/compiled/@edge-runtime/cookies, which is what backs both
 * `NextResponse.cookies` and `cookies()` from next/headers).
 */

const SECRET = "test-secret-cookie-roundtrip-aaaaaaaaaaaa";
const NOW = 1_760_000_000_000;

function marker(overrides: Partial<ImpersonationMarker> = {}): ImpersonationMarker {
  return {
    companyId: "11111111-1111-1111-1111-111111111111",
    // Punctuation and a non-ASCII character on purpose: these are the values
    // most likely to be mangled by an encode/decode round trip.
    companyName: "O'Brien & Sons — Café (UK), Ltd.",
    adminUserId: "22222222-2222-2222-2222-222222222222",
    adminEmail: "admin+super@volcone.com",
    targetUserId: "33333333-3333-3333-3333-333333333333",
    targetEmail: "owner@acme.test",
    startedAt: NOW,
    expiresAt: NOW + IMPERSONATION_MAX_AGE_SECONDS * 1000,
    ...overrides,
  };
}

/**
 * Put a value through the exact transport a route handler uses.
 *
 * `response.cookies.set(...)` serializes with `encodeURIComponent` into a
 * Set-Cookie header; the browser stores it and sends it back on the Cookie
 * header; `request.cookies.get(...)` parses and decodes it. This helper is
 * that whole journey, so what comes out is byte-for-byte what a server
 * actually receives on the next request.
 */
function throughCookieTransport(name: string, value: string, httpOnly: boolean): string {
  const setCookieHeaders = new Headers();
  const response = new ResponseCookies(setCookieHeaders);
  response.set(name, value, impersonationCookieOptions(httpOnly, IMPERSONATION_MAX_AGE_SECONDS));

  const serialized = setCookieHeaders.getSetCookie();
  expect(serialized).toHaveLength(1);

  // What the browser sends back: `name=<value-as-serialized>`.
  const nameValue = serialized[0].split(";")[0];
  const requestHeaders = new Headers();
  requestHeaders.set("cookie", nameValue);

  const received = new RequestCookies(requestHeaders).get(name)?.value;
  expect(received).toBeDefined();
  return received as string;
}

let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env.TWO_FACTOR_SECRET;
  process.env.TWO_FACTOR_SECRET = SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.TWO_FACTOR_SECRET;
  else process.env.TWO_FACTOR_SECRET = originalSecret;
});

describe("marker cookie: sign -> Set-Cookie -> Cookie -> verify", () => {
  it("survives the full transport with every field intact", async () => {
    const original = marker();
    const signed = await signImpersonationMarker(original);
    const received = throughCookieTransport(IMPERSONATION_MARKER_COOKIE, signed, false);

    const decoded = await verifyImpersonationMarker(received);

    expect(decoded).not.toBeNull();
    expect(decoded?.companyName).toBe(original.companyName);
    expect(decoded?.targetEmail).toBe(original.targetEmail);
    expect(decoded?.adminEmail).toBe(original.adminEmail);
    expect(decoded?.targetUserId).toBe(original.targetUserId);
    expect(decoded?.expiresAt).toBe(original.expiresAt);
  });

  it("also verifies when the value arrives percent-encoded", async () => {
    /*
     * Belt and braces. base64url's alphabet (A-Za-z0-9-_) and the "." joiner
     * are all unreserved, so encodeURIComponent leaves the value untouched and
     * the double-decode in Next's own Set-Cookie parser is a no-op for it.
     * Asserting it explicitly means a future change to the payload encoding
     * that introduces reserved characters fails here rather than in production.
     */
    const signed = await signImpersonationMarker(marker());

    expect(encodeURIComponent(signed)).toBe(signed);
    expect(await verifyImpersonationMarker(encodeURIComponent(signed))).not.toBeNull();
    expect(await verifyImpersonationMarker(decodeURIComponent(signed))).not.toBeNull();
  });

  it("REGRESSION: the payload cannot be split on the first dot", async () => {
    /*
     * This is the bug, stated as an assertion. The old client decoder did
     * exactly what the second half of this test does.
     */
    const signed = await signImpersonationMarker(marker());

    const encodedBody = signed.slice(0, signed.lastIndexOf("."));
    const body = Buffer.from(encodedBody, "base64url").toString("utf8");

    // The prefix really does contain dots — three of them.
    expect(body.startsWith("sam.impersonation.marker.v1.")).toBe(true);
    expect(body.split(".").length).toBeGreaterThan(4);

    // Splitting on the FIRST dot yields something that is not JSON.
    const naive = body.slice(body.indexOf(".") + 1);
    expect(() => JSON.parse(naive)).toThrow();

    // Slicing by the prefix's LENGTH — what verifyImpersonationMarker does —
    // yields the payload.
    const correct = body.slice("sam.impersonation.marker.v1.".length);
    expect(JSON.parse(correct)).toMatchObject({ targetEmail: "owner@acme.test" });
  });
});

describe("return ticket cookie: sign -> Set-Cookie -> Cookie -> verify", () => {
  it("survives the full transport", async () => {
    const signed = await signImpersonationReturn({
      adminUserId: "22222222-2222-2222-2222-222222222222",
      adminEmail: "admin+super@volcone.com",
      // Shaped like a real Supabase refresh token.
      refreshToken: "p4k2vq7zxv3b-_abcDEF123456",
      expiresAt: NOW + IMPERSONATION_MAX_AGE_SECONDS * 1000,
    });

    const received = throughCookieTransport(IMPERSONATION_RETURN_COOKIE, signed, true);
    const decoded = await verifyImpersonationReturn(received);

    expect(decoded?.refreshToken).toBe("p4k2vq7zxv3b-_abcDEF123456");
    expect(decoded?.adminUserId).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("is serialized HttpOnly, and the marker is not", async () => {
    // The marker is readable by design (it carries no credential); the ticket
    // holds the admin's refresh token and must never be script-readable.
    const headers = new Headers();
    const jar = new ResponseCookies(headers);
    jar.set(IMPERSONATION_RETURN_COOKIE, "x", impersonationCookieOptions(true, 60));
    jar.set(IMPERSONATION_MARKER_COOKIE, "y", impersonationCookieOptions(false, 60));

    const [ticket, markerCookie] = headers.getSetCookie();
    expect(ticket).toContain("HttpOnly");
    expect(markerCookie).not.toContain("HttpOnly");
  });
});

describe("cookie size", () => {
  /**
   * Browsers enforce ~4096 bytes per cookie and will silently drop one that
   * exceeds it. Both of these sit alongside the chunked `sb-*` session cookies,
   * so an oversized impersonation cookie would not just fail to set — on a
   * browser near its per-domain limit it could evict the session itself.
   */
  it("keeps both cookies far under the 4096-byte limit", async () => {
    const signedMarker = await signImpersonationMarker(
      marker({ companyName: "A".repeat(200) }) // a generously long company name
    );
    const signedTicket = await signImpersonationReturn({
      adminUserId: "22222222-2222-2222-2222-222222222222",
      adminEmail: "a".repeat(80) + "@volcone.com",
      refreshToken: "r".repeat(256), // far longer than a real refresh token
      expiresAt: NOW,
    });

    const headers = new Headers();
    const jar = new ResponseCookies(headers);
    jar.set(IMPERSONATION_MARKER_COOKIE, signedMarker, impersonationCookieOptions(false, IMPERSONATION_MAX_AGE_SECONDS));
    jar.set(IMPERSONATION_RETURN_COOKIE, signedTicket, impersonationCookieOptions(true, IMPERSONATION_MAX_AGE_SECONDS));

    for (const header of headers.getSetCookie()) {
      expect(header.length).toBeLessThan(2048);
    }
  });
});
