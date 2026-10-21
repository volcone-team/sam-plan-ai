import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createGhlClient,
  normaliseGhlEmail,
  parseRetryAfterMs,
  scrubSecret,
  GHL_API_VERSION,
  GHL_BASE_URL,
  type GhlClientOptions,
} from "./client";

/* ── Injected fetch ──────────────────────────────────────────────────────────
 * Every test runs with no network and no environment: the client takes its
 * `fetch` as a constructor option, and these helpers are the only thing it
 * ever calls.
 */

type Recorded = { url: string; init: RequestInit };
let recorded: Recorded[] = [];

const LOCATION = "loc_abc123";
/** Long enough to be scrubbed — scrubSecret ignores anything under 8 chars. */
const TOKEN = "pit-0123456789abcdef";

function client(fetchImpl: typeof fetch, over?: Partial<GhlClientOptions>) {
  return createGhlClient({
    locationId: LOCATION,
    token: TOKEN,
    fetchImpl,
    ...over,
  });
}

/** Answers every call with one canned response, and records the request. */
function respondWith(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string>; raw?: string }
): typeof fetch {
  return (async (url: string, requestInit: RequestInit) => {
    recorded.push({ url: String(url), init: requestInit });
    const text = init?.raw ?? JSON.stringify(body);
    return new Response(text, {
      status: init?.status ?? 200,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
}

/** A fetch that throws, as a network failure does. */
function throwWith(err: unknown): typeof fetch {
  return (async (url: string, requestInit: RequestInit) => {
    recorded.push({ url: String(url), init: requestInit });
    throw err;
  }) as unknown as typeof fetch;
}

const CONTACT = { contact: { id: "ct_1" } };

beforeEach(() => {
  recorded = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------ */

describe("normaliseGhlEmail", () => {
  it("lowercases and trims", () => {
    expect(normaliseGhlEmail("  Owner@Example.COM \n")).toBe("owner@example.com");
  });

  it("gives an empty string for anything that is not a string", () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(normaliseGhlEmail(value)).toBe("");
    }
  });
});

describe("parseRetryAfterMs", () => {
  it("reads delta-seconds", () => {
    expect(parseRetryAfterMs("5")).toBe(5000);
    expect(parseRetryAfterMs(" 30 ")).toBe(30_000);
    expect(parseRetryAfterMs("0")).toBe(0);
  });

  /** The format a proxy in front of GHL may rewrite it into. */
  it("reads an HTTP date", () => {
    const now = Date.parse("2026-10-12T12:00:00Z");
    expect(parseRetryAfterMs("Mon, 12 Oct 2026 12:00:30 GMT", now)).toBe(30_000);
  });

  it("ignores a date in the past", () => {
    const now = Date.parse("2026-10-12T12:00:00Z");
    expect(parseRetryAfterMs("Mon, 12 Oct 2026 11:59:00 GMT", now)).toBeNull();
  });

  it("returns null for absent or unparseable values", () => {
    for (const value of [null, undefined, "", "   ", "soon", "1.5", "-5", "1e3"]) {
      expect(parseRetryAfterMs(value)).toBeNull();
    }
  });

  /** A mistaken header must not park an outbox row past the point anyone looks. */
  it("clamps to a day", () => {
    expect(parseRetryAfterMs("999999999")).toBe(24 * 60 * 60 * 1000);
  });
});

describe("scrubSecret", () => {
  it("replaces every occurrence", () => {
    expect(scrubSecret(`a ${TOKEN} b ${TOKEN}`, TOKEN)).toBe("a [redacted] b [redacted]");
  });

  it("leaves text alone when the secret is short enough to be a false positive", () => {
    // Scrubbing "abc" out of English prose would mangle it for no benefit.
    expect(scrubSecret("abcdef", "abc")).toBe("abcdef");
    expect(scrubSecret("anything", "")).toBe("anything");
  });
});

/* ------------------------------------------------------------------ *
 * Request shape
 * ------------------------------------------------------------------ */

describe("request headers", () => {
  /**
   * The `Version` header is REQUIRED by every v2 endpoint — omitting it is a
   * 4xx, not a default. The most boring possible bug, and the one that would
   * make every single call fail.
   */
  it("sends the Version header on every call", async () => {
    const c = client(respondWith({ ...CONTACT, tags: [] }));

    await c.upsertContact({ email: "a@b.com" });
    await c.addTags("ct_1", ["x"]);
    await c.removeTags("ct_1", ["x"]);
    await c.findContactIdByEmail("a@b.com");

    expect(recorded).toHaveLength(4);
    for (const call of recorded) {
      const headers = call.init.headers as Record<string, string>;
      expect(headers.Version).toBe(GHL_API_VERSION);
      expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    }
  });

  it("talks to the LeadConnector services host by default", async () => {
    await createGhlClient({
      locationId: LOCATION,
      token: TOKEN,
      fetchImpl: respondWith(CONTACT),
    }).upsertContact({ email: "a@b.com" });

    expect(recorded[0].url.startsWith(`${GHL_BASE_URL}/contacts/`)).toBe(true);
  });

  it("aborts a request that takes too long", async () => {
    await client(respondWith(CONTACT), { timeoutMs: 1234 }).upsertContact({
      email: "a@b.com",
    });
    // The signal is the mechanism; its presence is what the drain depends on.
    expect(recorded[0].init.signal).toBeInstanceOf(AbortSignal);
  });
});

/* ------------------------------------------------------------------ *
 * upsertContact
 * ------------------------------------------------------------------ */

describe("upsertContact", () => {
  it("returns the contact id and the request carries the location", async () => {
    const out = await client(respondWith({ contact: { id: "ct_9" }, new: true })).upsertContact({
      email: " Owner@Example.com ",
      firstName: "Pete",
      lastName: "Shaw",
      phone: "+14155550100",
      companyName: "Volcone",
    });

    expect(out).toEqual({ ok: true, status: 200, data: { contactId: "ct_9", isNew: true } });

    const body = JSON.parse(String(recorded[0].init.body));
    expect(body).toEqual({
      locationId: LOCATION,
      email: "owner@example.com",
      firstName: "Pete",
      lastName: "Shaw",
      phone: "+14155550100",
      companyName: "Volcone",
    });
  });

  /**
   * GHL reads a present null as "clear this field", so passing an absent name
   * through would wipe one their team typed in by hand.
   */
  it("omits fields it does not have rather than sending null", async () => {
    await client(respondWith(CONTACT)).upsertContact({
      email: "a@b.com",
      firstName: null,
      lastName: "   ",
      phone: undefined,
    });

    expect(JSON.parse(String(recorded[0].init.body))).toEqual({
      locationId: LOCATION,
      email: "a@b.com",
    });
  });

  /**
   * The docs are explicit that `tags` on an upsert overwrites the contact's
   * entire tag list. The client's marketing team shares that list, so sending
   * tags here would destroy their segmentation.
   */
  it("never sends tags on the upsert", async () => {
    await client(respondWith(CONTACT)).upsertContact({ email: "a@b.com" });
    expect(JSON.parse(String(recorded[0].init.body))).not.toHaveProperty("tags");
  });

  it("refuses an empty email without making a call", async () => {
    const out = await client(respondWith(CONTACT)).upsertContact({ email: "   " });

    expect(out).toMatchObject({ ok: false, retryable: false, reason: "bad_request", status: 0 });
    expect(recorded).toHaveLength(0);
  });

  it("accepts the shapes GHL actually returns for an id", async () => {
    for (const body of [
      { contact: { id: "ct_1" } },
      { contact: { _id: "ct_1" } },
      { id: "ct_1" },
      { _id: "ct_1" },
    ]) {
      const out = await client(respondWith(body)).upsertContact({ email: "a@b.com" });
      expect(out).toMatchObject({ ok: true, data: { contactId: "ct_1" } });
    }
  });

  it("reports a missing id as malformed and terminal", async () => {
    const out = await client(respondWith({ contact: {} })).upsertContact({ email: "a@b.com" });
    expect(out).toMatchObject({ ok: false, retryable: false, reason: "malformed", status: 200 });
  });

  /** Nothing branches on it, so an absent flag is context, not a failure. */
  it("reports isNew as null when GHL does not say", async () => {
    const out = await client(respondWith(CONTACT)).upsertContact({ email: "a@b.com" });
    expect(out).toMatchObject({ ok: true, data: { isNew: null } });
  });
});

/* ------------------------------------------------------------------ *
 * findContactIdByEmail
 * ------------------------------------------------------------------ */

describe("findContactIdByEmail", () => {
  it("looks the email up scoped to the location", async () => {
    const out = await client(
      respondWith({ contacts: [{ id: "ct_7" }, { id: "ct_8" }] })
    ).findContactIdByEmail("Owner@Example.com");

    expect(out).toEqual({ ok: true, status: 200, data: "ct_7" });

    const url = new URL(recorded[0].url);
    expect(url.pathname).toBe("/contacts/lookup");
    expect(url.searchParams.get("locationId")).toBe(LOCATION);
    expect(url.searchParams.get("email")).toBe("owner@example.com");
    expect(recorded[0].init.method).toBe("GET");
  });

  /**
   * "Not in the CRM" is a legitimate, terminal, non-error outcome — which is
   * why ghl_events.status has `skipped` as well as `failed`.
   */
  it("reports no match as a success carrying null", async () => {
    const out = await client(respondWith({ contacts: [] })).findContactIdByEmail("a@b.com");
    expect(out).toEqual({ ok: true, status: 200, data: null });
  });

  /** A missing array is "we did not understand you", not "they are not there". */
  it("reports a response with no contacts array as malformed", async () => {
    const out = await client(respondWith({ ok: true })).findContactIdByEmail("a@b.com");
    expect(out).toMatchObject({ ok: false, retryable: false, reason: "malformed" });
  });

  it("refuses an empty email without making a call", async () => {
    const out = await client(respondWith({ contacts: [] })).findContactIdByEmail("");
    expect(out).toMatchObject({ ok: false, reason: "bad_request" });
    expect(recorded).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * Tags
 * ------------------------------------------------------------------ */

describe("addTags / removeTags", () => {
  it("POSTs to add and DELETEs to remove, with the tags in the body", async () => {
    const c = client(respondWith({ tags: ["sam plan ai app - founder"] }));

    const added = await c.addTags("ct_1", ["sam plan ai app - founder"]);
    const removed = await c.removeTags("ct_1", ["sam plan ai app - cancellation"]);

    expect(added).toEqual({ ok: true, status: 200, data: ["sam plan ai app - founder"] });
    expect(removed.ok).toBe(true);

    expect(recorded[0].init.method).toBe("POST");
    expect(new URL(recorded[0].url).pathname).toBe("/contacts/ct_1/tags");
    expect(JSON.parse(String(recorded[0].init.body))).toEqual({
      tags: ["sam plan ai app - founder"],
    });

    expect(recorded[1].init.method).toBe("DELETE");
    expect(JSON.parse(String(recorded[1].init.body))).toEqual({
      tags: ["sam plan ai app - cancellation"],
    });
  });

  it("escapes a contact id into the path", async () => {
    await client(respondWith({ tags: [] })).addTags("ct/../1", ["x"]);
    expect(new URL(recorded[0].url).pathname).toBe("/contacts/ct%2F..%2F1/tags");
  });

  /**
   * The transition helper legitimately produces an empty add or remove list,
   * and `{ tags: [] }` against a required field is a 400 waiting to happen.
   */
  it("treats an empty tag list as a no-op success without calling GHL", async () => {
    const c = client(respondWith({ tags: [] }));

    expect(await c.addTags("ct_1", [])).toEqual({ ok: true, status: 0, data: [] });
    expect(await c.removeTags("ct_1", ["", "  "])).toEqual({ ok: true, status: 0, data: [] });
    expect(recorded).toHaveLength(0);
  });

  it("refuses a blank contact id without making a call", async () => {
    const out = await client(respondWith({ tags: [] })).addTags("  ", ["x"]);
    expect(out).toMatchObject({ ok: false, retryable: false, reason: "bad_request" });
    expect(recorded).toHaveLength(0);
  });

  /** A 2xx means the write happened; the echoed list is not load-bearing. */
  it("does not fail a successful write whose response has no tags array", async () => {
    const out = await client(respondWith({})).addTags("ct_1", ["x"]);
    expect(out).toEqual({ ok: true, status: 200, data: [] });
  });
});

/* ------------------------------------------------------------------ *
 * The classification table — the point of the module
 * ------------------------------------------------------------------ */

describe("failure classification", () => {
  it("treats 429 as retryable and reports Retry-After when GHL sends it", async () => {
    const out = await client(
      respondWith({ message: "slow down" }, { status: 429, headers: { "Retry-After": "12" } })
    ).addTags("ct_1", ["x"]);

    expect(out).toMatchObject({
      ok: false,
      retryable: true,
      status: 429,
      reason: "rate_limited",
      retryAfterMs: 12_000,
    });
  });

  /**
   * The drain must not read an absent header as "retry immediately" — the
   * field is simply absent, and it falls back to its own backoff.
   */
  it("omits retryAfterMs on a 429 with no header", async () => {
    const out = await client(respondWith({}, { status: 429 })).addTags("ct_1", ["x"]);

    expect(out).toMatchObject({ ok: false, retryable: true, reason: "rate_limited" });
    expect(out).not.toHaveProperty("retryAfterMs");
  });

  it("treats 5xx and 408 as retryable", async () => {
    for (const [status, reason] of [
      [500, "server_error"],
      [502, "server_error"],
      [503, "server_error"],
      [504, "server_error"],
      [408, "timeout"],
    ] as const) {
      const out = await client(respondWith({ err: status }, { status })).addTags("ct_1", ["x"]);
      expect(out).toMatchObject({ ok: false, retryable: true, status, reason });
    }
  });

  /**
   * 401 and 403 are TERMINAL on purpose. A Private Integration Token is
   * revoked or rotated by a person and does not come back on its own, so every
   * retry is another 401 — the failure has to be visible, not patient.
   */
  it("treats auth failures as terminal", async () => {
    for (const [status, reason] of [
      [401, "unauthorized"],
      [403, "forbidden"],
    ] as const) {
      const out = await client(respondWith({ msg: "nope" }, { status })).addTags("ct_1", ["x"]);
      expect(out).toMatchObject({ ok: false, retryable: false, status, reason });
    }
  });

  it("treats 404 as terminal", async () => {
    const out = await client(respondWith({}, { status: 404 })).addTags("ct_gone", ["x"]);
    expect(out).toMatchObject({ ok: false, retryable: false, status: 404, reason: "not_found" });
  });

  it("treats other 4xx as a terminal bad request", async () => {
    for (const status of [400, 409, 422]) {
      const out = await client(respondWith({}, { status })).addTags("ct_1", ["x"]);
      expect(out).toMatchObject({ ok: false, retryable: false, status, reason: "bad_request" });
    }
  });

  /**
   * We cannot tell whether a thrown request reached GHL, so "unknown" has to
   * be "try again" — safe only because every call here is idempotent.
   */
  it("treats a network throw as retryable", async () => {
    const out = await client(throwWith(new TypeError("fetch failed"))).addTags("ct_1", ["x"]);
    expect(out).toMatchObject({ ok: false, retryable: true, status: 0, reason: "network" });
  });

  it("treats a timeout as retryable", async () => {
    for (const name of ["TimeoutError", "AbortError"]) {
      const err = new Error("the operation was aborted");
      err.name = name;
      const out = await client(throwWith(err), { timeoutMs: 1234 }).addTags("ct_1", ["x"]);

      expect(out).toMatchObject({ ok: false, retryable: true, status: 0, reason: "timeout" });
      expect((out as { message: string }).message).toContain("1234");
    }
  });

  it("treats a thrown non-Error as retryable rather than crashing", async () => {
    const out = await client(throwWith("kaboom")).addTags("ct_1", ["x"]);
    expect(out).toMatchObject({ ok: false, retryable: true, reason: "network" });
  });

  /**
   * A 2xx whose body is not JSON is almost always an HTML page from something
   * in front of GHL. Retrying gets the same page, and the write may already
   * have happened.
   */
  it("treats a malformed 2xx body as terminal", async () => {
    const out = await client(
      respondWith(null, { raw: "<html>login</html>" })
    ).addTags("ct_1", ["x"]);

    expect(out).toMatchObject({ ok: false, retryable: false, status: 200, reason: "malformed" });
  });

  // 200 rather than 204: the Response constructor refuses a body on a 204, so
  // a no-content case cannot be built here. The branch under test is "the body
  // is empty", which this exercises either way.
  it("accepts an empty 2xx body", async () => {
    const out = await client(respondWith(null, { raw: "   " })).addTags("ct_1", ["x"]);
    expect(out).toEqual({ ok: true, status: 200, data: [] });
  });

  it("quotes a useful but bounded extract of the failing body", async () => {
    const long = "x".repeat(5000);
    const out = await client(respondWith({}, { status: 400, raw: long })).addTags("ct_1", ["x"]);
    const message = (out as { message: string }).message;

    expect(message).toContain("400");
    expect(message.length).toBeLessThan(400);
  });

  it("never throws, whatever comes back", async () => {
    const cases: (typeof fetch)[] = [
      respondWith({}, { status: 500 }),
      respondWith(null, { raw: "not json" }),
      throwWith(new Error("x")),
      throwWith(undefined),
      (async () => ({}) as unknown as Response) as unknown as typeof fetch,
    ];
    for (const impl of cases) {
      await expect(client(impl).addTags("ct_1", ["x"])).resolves.toBeDefined();
    }
  });
});

/* ------------------------------------------------------------------ *
 * The token
 * ------------------------------------------------------------------ */

describe("the token never leaves the Authorization header", () => {
  /**
   * The thing this test exists for: a failure result is written to
   * ghl_events.last_error and shown on the admin screen. A token in there is a
   * token in the database, in every backup, and in the next screenshot.
   */
  it("does not appear in a failure result, even when GHL echoes it back", async () => {
    const impls: [string, typeof fetch][] = [
      ["400", respondWith({ error: `bad token ${TOKEN}` }, { status: 400 })],
      ["401", respondWith({ error: `Bearer ${TOKEN} rejected` }, { status: 401 })],
      ["429", respondWith({ error: TOKEN }, { status: 429 })],
      ["500", respondWith({ error: TOKEN }, { status: 500 })],
      ["non-JSON 2xx", respondWith(null, { raw: `<html>${TOKEN}</html>` })],
      ["network", throwWith(new Error(`connect failed for ${TOKEN}`))],
    ];

    for (const [label, impl] of impls) {
      const out = await client(impl).addTags("ct_1", ["x"]);
      const serialised = JSON.stringify(out);
      expect(serialised, label).not.toContain(TOKEN);
      expect(serialised, label).toContain("[redacted]");
    }
  });

  it("does not appear in a successful result either", async () => {
    const out = await client(
      respondWith({ contact: { id: "ct_1", token: TOKEN } })
    ).upsertContact({ email: "a@b.com" });

    expect(JSON.stringify(out)).not.toContain(TOKEN);
  });

  /** Nothing in this module logs; this is the tripwire if that changes. */
  it("is not written to the console", async () => {
    const logged: string[] = [];
    for (const method of ["error", "warn", "log"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
    }

    const c = client(respondWith({ error: TOKEN }, { status: 500 }));
    await c.addTags("ct_1", ["x"]);
    await c.upsertContact({ email: "a@b.com" });
    await c.findContactIdByEmail("a@b.com");

    expect(logged.join("\n")).not.toContain(TOKEN);
  });

  /** It belongs in the URL of exactly no request. */
  it("is not in any request URL", async () => {
    const c = client(respondWith({ contact: { id: "ct_1" }, contacts: [], tags: [] }));
    await c.upsertContact({ email: "a@b.com" });
    await c.findContactIdByEmail("a@b.com");
    await c.addTags("ct_1", ["x"]);

    for (const call of recorded) {
      expect(call.url).not.toContain(TOKEN);
      expect(String(call.init.body ?? "")).not.toContain(TOKEN);
    }
  });
});
