import type { GhlCredentials } from "@/lib/ghl/config";

/**
 * The GoHighLevel HTTP client. Four calls, no cleverness.
 *
 * ONE JOB: turn an intent ("this contact should hold these tags") into HTTP,
 * and turn HTTP back into a RESULT THE DRAIN CAN ACT ON. The single most
 * important thing in this file is the retryable/terminal split — see
 * `GhlFailure`. Everything else is plumbing.
 *
 * NEVER THROWS. The drain processes a batch inside a cron invocation; one
 * contact that happens to 404 must not abandon the other rows, and a thrown
 * error in a `Promise.all` would do exactly that. Every path returns a result
 * object, the house pattern (see `buyerTag`, `decidePortalAccessChange`,
 * `classifyAiFailure`).
 *
 * NO SECRET IN ANY OUTPUT. The token appears in exactly one place — the
 * `Authorization` header built in `request` — and never in a returned object,
 * a message or a log line. Response bodies are scrubbed against it before
 * being quoted, because the only thing worse than a leaked token is a leaked
 * token in a log file nobody is watching. `client.test.ts` asserts this.
 *
 * NO RATE LIMITER. The documented ceiling is 100 requests per 10 seconds and
 * 200,000 a day, per location, per app
 * (https://marketplace.gohighlevel.com/docs/other/rate-limits/). Our volume is
 * a handful of tag writes per customer event, so a token bucket here would be
 * machinery guarding a limit we cannot reach. THE REAL CONTROL IS THE DRAIN'S
 * BATCH SIZE: whoever writes the drain must keep one invocation's worth of
 * calls under 100-per-10s, and 429 is handled honestly below for the day it
 * gets it wrong. GHL also returns `X-RateLimit-Remaining` and
 * `X-RateLimit-Daily-Remaining` on every response, which is the authoritative
 * signal if the drain ever wants to self-throttle.
 *
 * Pure-ish and injectable: `fetch` comes in as an option, so every test runs
 * with no network and no environment.
 */

/* ------------------------------------------------------------------ *
 * Endpoints
 * ------------------------------------------------------------------ */

/**
 * The LeadConnector host. Not `api.leadconnectorhq.com`, which is the older
 * v1 API and does not accept a Private Integration Token.
 */
export const GHL_BASE_URL = "https://services.leadconnectorhq.com";

/**
 * The required API version header.
 *
 * NOT OPTIONAL — every endpoint in the v2 docs lists `Version` as a required
 * request header, and omitting it is a 4xx rather than a default. Pinned
 * because GHL versions by date and a newer version can change response
 * shapes under us.
 *
 * The newest doc pages have begun advertising `v3` as the available option for
 * the same endpoints
 * (https://marketplace.gohighlevel.com/docs/ghl/contacts/add-tags). We stay on
 * the dated version: the 2021-07-28 pages document identical paths and bodies
 * (https://marketplace.gohighlevel.com/docs/2021-07-28/ghl/contacts/add-tags),
 * and it is the version a Private Integration Token is documented against.
 */
export const GHL_API_VERSION = "2021-07-28";

/**
 * Confirmed paths.
 *
 *   POST   /contacts/:contactId/tags
 *     https://marketplace.gohighlevel.com/docs/2021-07-28/ghl/contacts/add-tags
 *   DELETE /contacts/:contactId/tags
 *     https://marketplace.gohighlevel.com/docs/2021-07-28/ghl/contacts/remove-tags
 *   GET    /contacts/lookup
 *     https://marketplace.gohighlevel.com/docs/ghl/contacts/lookup-contact/
 *
 * Both tag endpoints take `{ tags: string[] }` and answer with
 * `{ tags: string[] }` — the contact's tags AFTER the operation.
 */
const PATH_CONTACT_TAGS = (contactId: string) =>
  `/contacts/${encodeURIComponent(contactId)}/tags`;
const PATH_CONTACT_LOOKUP = "/contacts/lookup";

/**
 * ASSUMPTION, ISOLATED HERE ON PURPOSE.
 *
 * The Upsert Contact endpoint exists and its request body is fully documented
 * (https://marketplace.gohighlevel.com/docs/2021-07-28/ghl/contacts/upsert-contact),
 * but that page's method-and-path line could not be read from the published
 * docs during this work — only the sibling Create Contact page, which confirms
 * `POST /contacts/`
 * (https://marketplace.gohighlevel.com/docs/ghl/contacts/create-contact/).
 * `/contacts/upsert` is the conventional path and matches the endpoint's name.
 *
 * IF THE FIRST LIVE CALL 404s, THIS CONSTANT IS WHY. A 404 is classified as
 * terminal below, so the symptom will be outbox rows going straight to
 * `failed` with `not_found` and no retry storm. Confirm the path in the docs
 * or against the real account and change this one line.
 */
const PATH_CONTACT_UPSERT = "/contacts/upsert";

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

/**
 * Why a call failed. Stable strings: written to `ghl_events.last_error` and
 * shown on the admin screen, so renaming one rewrites history.
 */
export type GhlFailureReason =
  /** 429. Retry after the window — see `retryAfterMs`. */
  | "rate_limited"
  /** 5xx. Their problem, and usually temporary. */
  | "server_error"
  /** fetch threw: DNS, connection reset, TLS. Nothing was necessarily sent. */
  | "network"
  /** Our own `AbortSignal` fired, or they returned 408. */
  | "timeout"
  /** 400 / 422 and other 4xx. The request is wrong; sending it again will not help. */
  | "bad_request"
  /** 401. The token is missing, wrong, revoked or lacks the scope. */
  | "unauthorized"
  /** 403. Authenticated but not allowed — wrong location, or wrong auth channel. */
  | "forbidden"
  /** 404. No such contact, or no such endpoint. */
  | "not_found"
  /** 2xx whose body was not JSON, or was JSON without the field we need. */
  | "malformed";

export interface GhlFailure {
  ok: false;
  /**
   * THE FIELD THE DRAIN BRANCHES ON. True means "the identical request could
   * plausibly succeed later", so back off and leave the row `pending`; false
   * means "stop", so mark it `failed` and spend no more of the retry budget.
   *
   * Retrying a terminal failure is not harmless: the outbox retries on a
   * schedule, and a few hundred rows each re-sending a request that can only
   * ever 401 is how an integration burns its rate limit and fills the admin
   * screen with noise while the real problem goes unnoticed.
   */
  retryable: boolean;
  /** HTTP status, or 0 when nothing came back (network failure, timeout). */
  status: number;
  reason: GhlFailureReason;
  /** Safe to log and to store. Scrubbed of the token. */
  message: string;
  /**
   * How long to wait, from `Retry-After`, in milliseconds. Only ever set on
   * `rate_limited`, and only when GHL actually sent the header. The drain
   * writes `next_attempt_at = now() + this`, falling back to its own backoff
   * when it is absent.
   */
  retryAfterMs?: number;
}

export type GhlResult<T> = { ok: true; status: number; data: T } | GhlFailure;

/* ------------------------------------------------------------------ *
 * Client
 * ------------------------------------------------------------------ */

/**
 * How long a single GHL request may take before we give up.
 *
 * TEN SECONDS. The drain runs inside a cron invocation with a hard wall-clock
 * budget and works through a batch of rows, so the cost of a hanging CRM is
 * not one slow row — it is the whole batch starving and the invocation being
 * killed with rows half-processed. Ten seconds is an order of magnitude above
 * a normal GHL response and still leaves room for several rows inside any
 * plausible function limit. A timeout is retryable, so the only cost of being
 * wrong on the low side is one extra attempt on the next pass.
 */
export const GHL_TIMEOUT_MS = 10_000;

export interface GhlClientOptions extends GhlCredentials {
  /**
   * Injected so tests need no network. Defaults to the global `fetch`, bound
   * away from `globalThis` — some runtimes object to an unbound `fetch`.
   */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface GhlContactInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  companyName?: string | null;
}

export interface GhlUpsertedContact {
  contactId: string;
  /**
   * Whether GHL reported this as a newly created contact, when it says so.
   * Null when the response did not include the flag — it is useful context for
   * the outbox payload and nothing branches on it, so an absent value is not a
   * malformed response.
   */
  isNew: boolean | null;
}

/**
 * Lowercase and trim an email before it goes to GHL.
 *
 * THE CASE RULE IS THEIRS, THE TRIM IS OURS. The lookup endpoint documents its
 * email match as case-insensitive
 * (https://marketplace.gohighlevel.com/docs/ghl/contacts/lookup-contact/), so
 * lowercasing cannot change which contact is found and makes our own logs and
 * dedupe keys comparable. Nothing in the docs says anything about surrounding
 * whitespace, so the trim is a decision of ours: an address that reached us
 * from a signup form with a trailing space is the same person, and sending the
 * space would at best miss the contact and at worst create a second one.
 */
export function normaliseGhlEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/**
 * Parse `Retry-After`.
 *
 * TWO FORMATS, BOTH IN THE SPEC: delta-seconds, or an HTTP date. GHL sends
 * seconds in practice, but a proxy in front of them may rewrite it, and
 * reading "Wed, 21 Oct 2026 07:28:00 GMT" as a number gives NaN and silently
 * loses the only piece of scheduling advice we were given.
 *
 * Returns null for absent, unparseable, or a date already in the past; the
 * caller then falls back to its own backoff. Clamped to a day, because a
 * mistaken header must not park an outbox row past the point anyone is
 * watching.
 */
export function parseRetryAfterMs(
  header: string | null | undefined,
  now: number = Date.now()
): number | null {
  if (typeof header !== "string") return null;
  const raw = header.trim();
  if (!raw) return null;

  const MAX_MS = 24 * 60 * 60 * 1000;

  // Delta-seconds. Integer-only on purpose: "1.5" is not a valid Retry-After,
  // and Number() would quietly accept "1e3" as 1000 seconds.
  if (/^\d+$/.test(raw)) {
    const ms = Number(raw) * 1000;
    return Math.min(ms, MAX_MS);
  }

  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  const delta = at - now;
  if (delta <= 0) return null;
  return Math.min(delta, MAX_MS);
}

/**
 * Remove a secret from a string before it is logged or returned.
 *
 * Belt and braces: we never put the token in a body or a URL, so it should not
 * be in a response. But GHL's error responses sometimes echo request context,
 * a white-label proxy sits in front of some accounts, and an error message is
 * exactly the kind of value that gets pasted into a support ticket. Cheap
 * insurance against a mistake we would otherwise find out about far too late.
 *
 * Also guards against the short-token degenerate case: scrubbing a 3-character
 * token out of English prose would mangle the message for no benefit.
 */
export function scrubSecret(text: string, secret: string): string {
  if (!secret || secret.length < 8) return text;
  return text.split(secret).join("[redacted]");
}

/** How much of a failing response body is worth keeping in the message. */
const MAX_BODY_SNIPPET = 300;

export class GhlClient {
  private readonly locationId: string;
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GhlClientOptions) {
    this.locationId = options.locationId;
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? GHL_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? GHL_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  /**
   * Create or update the contact, and return its id.
   *
   * WE DO NOT SEND TAGS HERE, EVEN THOUGH THE BODY ACCEPTS THEM, and this is
   * the one place where fewer round trips would be the wrong call. The docs are
   * explicit that `tags` on an upsert "will overwrite all current tags
   * associated with the contact" and recommend the Add/Remove Tag endpoints
   * instead
   * (https://marketplace.gohighlevel.com/docs/2021-07-28/ghl/contacts/upsert-contact).
   * The contact's tag list is shared with the client's marketing team; sending
   * our twelve lifecycle tags would delete everything else on the record and
   * destroy their segmentation. So: upsert to get an id, then add and remove
   * tags by name. Two or three calls per event, against a 100-per-10s ceiling.
   *
   * WHAT COUNTS AS "THE SAME CONTACT" IS NOT OUR DECISION. The upsert obeys the
   * location's "Allow Duplicate Contact" setting, which the client controls in
   * their GHL UI: with it configured on email and phone, an upsert carrying
   * both may match on whichever field the configured sequence prefers, and if
   * two different contacts hold the email and the phone, only the first is
   * updated. We therefore send the phone only when we have one, and never rely
   * on matching behaviour for correctness — the returned id is the truth.
   *
   * `createNewIfDuplicateAllowed` is deliberately not sent, so the default
   * (false, i.e. normal upsert) applies whatever the location setting is.
   */
  async upsertContact(input: GhlContactInput): Promise<GhlResult<GhlUpsertedContact>> {
    const email = normaliseGhlEmail(input.email);
    if (!email) {
      // Caught here rather than sent: an upsert with no email has nothing to
      // match on and would create a nameless contact in the client's CRM.
      // Terminal, because no amount of retrying will add an address.
      return {
        ok: false,
        retryable: false,
        status: 0,
        reason: "bad_request",
        message: "No contact email, so there is nothing to upsert.",
      };
    }

    const body: Record<string, unknown> = {
      locationId: this.locationId,
      email,
      // "SAM Plan AI" would be the honest value, but `source` is shown in the
      // client's GHL UI and they have their own conventions for it; left unset
      // until they ask for one rather than inventing a label they then have to
      // filter around.
    };
    // Only non-empty values are sent. GHL treats a present null as "clear this
    // field", so passing through an absent last name would wipe a name their
    // team typed in by hand.
    if (nonEmpty(input.firstName)) body.firstName = input.firstName!.trim();
    if (nonEmpty(input.lastName)) body.lastName = input.lastName!.trim();
    if (nonEmpty(input.phone)) body.phone = input.phone!.trim();
    if (nonEmpty(input.companyName)) body.companyName = input.companyName!.trim();

    const res = await this.request("POST", PATH_CONTACT_UPSERT, { body });
    if (!res.ok) return res;

    const contactId = readContactId(res.data);
    if (!contactId) {
      return {
        ok: false,
        retryable: false,
        status: res.status,
        reason: "malformed",
        message: "GoHighLevel accepted the upsert but returned no contact id.",
      };
    }

    return {
      ok: true,
      status: res.status,
      data: { contactId, isNew: readIsNew(res.data) },
    };
  }

  /**
   * Find an existing contact by exact email, or null.
   *
   * NOT USED ON THE HAPPY PATH — the upsert already returns an id, so this is
   * for the admin screen ("is this person in the CRM?") and for a drain that
   * wants to tag someone without touching their record. A null answer is a
   * SUCCESS carrying null, not a failure: "this person is not in that
   * sub-account" is a legitimate, terminal, non-error outcome, which is why
   * `ghl_events.status` has a `skipped` value distinct from `failed`.
   *
   * THE DOCS FLAG THIS ENDPOINT AS "OAuth channel only"
   * (https://marketplace.gohighlevel.com/docs/ghl/contacts/lookup-contact/),
   * and we authenticate with a Private Integration Token. It may therefore 401
   * or 403 where the upsert and tag calls work. Both are classified terminal,
   * so the failure is loud and cheap rather than a retry loop — and the happy
   * path does not depend on it. If it turns out to be refused, the replacement
   * is the Search Contacts endpoint.
   */
  async findContactIdByEmail(rawEmail: string): Promise<GhlResult<string | null>> {
    const email = normaliseGhlEmail(rawEmail);
    if (!email) {
      return {
        ok: false,
        retryable: false,
        status: 0,
        reason: "bad_request",
        message: "No contact email, so there is nothing to look up.",
      };
    }

    const res = await this.request("GET", PATH_CONTACT_LOOKUP, {
      query: {
        locationId: this.locationId,
        email,
        // `limit` is left at its default of 20. The endpoint documents the
        // default and the cap as the same number and says nothing about a
        // minimum, so asking for 1 is an assumption with no upside: we read
        // the first element either way, and a page of 20 is one response.
      },
    });
    if (!res.ok) return res;

    const contacts = readContactsArray(res.data);
    if (contacts === null) {
      return {
        ok: false,
        retryable: false,
        status: res.status,
        reason: "malformed",
        message: "The lookup response had no contacts array.",
      };
    }

    // An empty array is documented as the no-match answer, not an error.
    const first = contacts.length > 0 ? readContactId({ contact: contacts[0] }) : null;
    return { ok: true, status: res.status, data: first ?? null };
  }

  /**
   * Add tags. Returns the contact's tags after the operation, as GHL reports
   * them — useful for the outbox payload and for spotting a tag that was
   * created rather than matched.
   *
   * An empty list is a no-op SUCCESS rather than a call: the transition helper
   * legitimately produces an empty add or remove list, and `{ tags: [] }`
   * against a required field is a 400 waiting to happen.
   */
  async addTags(contactId: string, tags: readonly string[]): Promise<GhlResult<string[]>> {
    return this.writeTags("POST", contactId, tags);
  }

  /**
   * Remove tags.
   *
   * SENT UNCONDITIONALLY, without reading the contact first. The remove call is
   * a no-op for a tag the contact does not hold, so a read would buy nothing
   * and would open a window for a concurrent change — the same reasoning
   * `ghl_events.tags_remove` is documented with.
   */
  async removeTags(contactId: string, tags: readonly string[]): Promise<GhlResult<string[]>> {
    return this.writeTags("DELETE", contactId, tags);
  }

  private async writeTags(
    method: "POST" | "DELETE",
    contactId: string,
    tags: readonly string[]
  ): Promise<GhlResult<string[]>> {
    const clean = tags.map((t) => (typeof t === "string" ? t.trim() : "")).filter((t) => t !== "");

    if (!contactId.trim()) {
      return {
        ok: false,
        retryable: false,
        status: 0,
        reason: "bad_request",
        message: "No contact id, so there is nothing to tag.",
      };
    }

    if (clean.length === 0) {
      return { ok: true, status: 0, data: [] };
    }

    const res = await this.request(method, PATH_CONTACT_TAGS(contactId), {
      body: { tags: clean },
    });
    if (!res.ok) return res;

    // The response's `tags` is documented but not load-bearing: a 2xx means
    // the write happened. An absent array reads as empty rather than
    // malformed, so a response-shape change cannot turn successful writes into
    // failures.
    return { ok: true, status: res.status, data: readTagsArray(res.data) };
  }

  /* ---------------------------------------------------------------- *
   * The one place that does HTTP
   * ---------------------------------------------------------------- */

  private async request(
    method: "GET" | "POST" | "DELETE",
    path: string,
    options?: { body?: unknown; query?: Record<string, string> }
  ): Promise<GhlResult<unknown>> {
    let url = `${this.baseUrl}${path}`;
    if (options?.query) {
      const params = new URLSearchParams(options.query);
      url += `?${params.toString()}`;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          // THE ONLY PLACE THE TOKEN IS USED.
          Authorization: `Bearer ${this.token}`,
          // Required by every v2 endpoint. Omitting it is a 4xx, not a default.
          Version: GHL_API_VERSION,
          Accept: "application/json",
          ...(options?.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: options?.body === undefined ? undefined : JSON.stringify(options.body),
        /*
         * A hanging CRM must not hold a cron invocation open. `AbortSignal
         * .timeout` rather than a manual controller plus `setTimeout`: no
         * timer to clear, so a slow response cannot leave a dangling handle
         * that keeps a serverless function alive after it has answered.
         */
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err: unknown) {
      return this.classifyThrow(err);
    }

    const status = response.status;
    const text = await safeText(response);

    if (!response.ok) {
      return this.classifyStatus(status, text, response.headers);
    }

    // 204 and an empty 200 are both legitimate; `{}` keeps the readers below
    // from having to care.
    if (text.trim() === "") {
      return { ok: true, status, data: {} };
    }

    try {
      return { ok: true, status, data: JSON.parse(text) as unknown };
    } catch {
      /*
       * TERMINAL, not retryable. A 2xx whose body is not JSON is almost always
       * an HTML page from something in front of GHL — a white-label proxy, a
       * captive portal, a login redirect. Retrying gets the same page, and the
       * write may well have happened, so the honest outcome is "stop and let
       * someone look".
       */
      return {
        ok: false,
        retryable: false,
        status,
        reason: "malformed",
        message: `GoHighLevel returned a non-JSON body: ${this.snippet(text)}`,
      };
    }
  }

  /**
   * HTTP status to result.
   *
   * THE CLASSIFICATION TABLE. Read it as "will the identical request plausibly
   * work later?" and nothing else:
   *
   *   429      retryable   rate_limited   their window; honour Retry-After
   *   408      retryable   timeout        their side gave up, ours may not
   *   5xx      retryable   server_error   their outage
   *   401      terminal    unauthorized   token wrong/revoked — a human fixes it
   *   403      terminal    forbidden      wrong location, or wrong auth channel
   *   404      terminal    not_found      no such contact, or no such endpoint
   *   other 4xx terminal   bad_request    our request is wrong
   *
   * 401 AND 403 ARE DELIBERATELY TERMINAL, and it is worth saying why, because
   * "auth might come back" is a tempting reading. It does not come back on its
   * own: a Private Integration Token is revoked or rotated by a person, and
   * until that person acts every retry is another 401. Treating them as
   * retryable would mean the entire outbox grinding against a wall and the
   * admin screen showing "pending, retrying" for a condition only a human can
   * clear — the failure must be visible, not patient.
   */
  private classifyStatus(status: number, body: string, headers: Headers): GhlFailure {
    const detail = this.snippet(body);

    if (status === 429) {
      const retryAfterMs = parseRetryAfterMs(headers.get("retry-after"));
      return {
        ok: false,
        retryable: true,
        status,
        reason: "rate_limited",
        message: `GoHighLevel rate limit reached${detail ? `: ${detail}` : "."}`,
        // Only present when they actually told us. The drain must not read an
        // absent header as "retry immediately" — it falls back to its own
        // backoff, which is why this is optional rather than defaulted here.
        ...(retryAfterMs === null ? {} : { retryAfterMs }),
      };
    }

    if (status === 408) {
      return {
        ok: false,
        retryable: true,
        status,
        reason: "timeout",
        message: `GoHighLevel timed out${detail ? `: ${detail}` : "."}`,
      };
    }

    if (status >= 500) {
      return {
        ok: false,
        retryable: true,
        status,
        reason: "server_error",
        message: `GoHighLevel returned ${status}${detail ? `: ${detail}` : "."}`,
      };
    }

    const reason: GhlFailureReason =
      status === 401
        ? "unauthorized"
        : status === 403
          ? "forbidden"
          : status === 404
            ? "not_found"
            : "bad_request";

    return {
      ok: false,
      retryable: false,
      status,
      reason,
      message: `GoHighLevel returned ${status}${detail ? `: ${detail}` : "."}`,
    };
  }

  /**
   * A thrown fetch to a result.
   *
   * ALL RETRYABLE. DNS, a reset connection, a TLS hiccup and our own timeout
   * are all transient by nature, and crucially we cannot tell whether the
   * request reached GHL — so "unknown" has to be treated as "try again". The
   * writes this client makes are idempotent (upsert by email, add/remove a
   * named tag), which is what makes retrying a possibly-delivered request
   * safe; if a non-idempotent call is ever added, this is the comment it
   * invalidates.
   */
  private classifyThrow(err: unknown): GhlFailure {
    const name = err instanceof Error ? err.name : "";
    // `AbortSignal.timeout` rejects with TimeoutError; an AbortError means
    // something else cancelled us. Both are "we stopped waiting".
    const timedOut = name === "TimeoutError" || name === "AbortError";
    const raw = err instanceof Error ? err.message : String(err);

    return {
      ok: false,
      retryable: true,
      status: 0,
      reason: timedOut ? "timeout" : "network",
      message: timedOut
        ? `GoHighLevel did not respond within ${this.timeoutMs}ms.`
        : `Could not reach GoHighLevel: ${scrubSecret(raw, this.token)}`,
    };
  }

  /** A short, token-free extract of a response body for the error message. */
  private snippet(body: string): string {
    const scrubbed = scrubSecret(body, this.token).replace(/\s+/g, " ").trim();
    if (!scrubbed) return "";
    return scrubbed.length > MAX_BODY_SNIPPET
      ? `${scrubbed.slice(0, MAX_BODY_SNIPPET)}...`
      : scrubbed;
  }
}

/** Construct a client. A function so the call sites read the same as the rest. */
export function createGhlClient(options: GhlClientOptions): GhlClient {
  return new GhlClient(options);
}

/* ------------------------------------------------------------------ *
 * Response readers
 * ------------------------------------------------------------------ */

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Read the body and never throw doing it. `response.text()` can reject on a
 * truncated or aborted stream, and losing the status code to an error while
 * reading the body would turn a clean 503 into an unexplained network failure.
 */
async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Pull the contact id out of a response.
 *
 * TOLERANT OF THREE SHAPES. Create Contact documents `{ contact: { id } }`
 * (https://marketplace.gohighlevel.com/docs/ghl/contacts/create-contact/) and
 * the upsert is its sibling, so that is the expected one. `id` at the top level
 * and `_id` are accepted too: GHL's responses are Mongo-derived and `_id`
 * shows up in enough of their payloads that refusing it would be a malformed
 * failure on a response that plainly contains the answer. Reading an extra key
 * costs nothing; a false `malformed` costs a tag.
 */
function readContactId(data: unknown): string | null {
  const root = asRecord(data);
  if (!root) return null;

  const candidates: unknown[] = [];
  const contact = asRecord(root.contact);
  if (contact) candidates.push(contact.id, contact._id, contact.contactId);
  candidates.push(root.id, root._id, root.contactId);

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim();
  }
  return null;
}

/** GHL's "did this create a new record" flag, when present. */
function readIsNew(data: unknown): boolean | null {
  const root = asRecord(data);
  if (!root) return null;
  for (const key of ["new", "isNew", "created"]) {
    if (typeof root[key] === "boolean") return root[key] as boolean;
  }
  return null;
}

/**
 * The lookup response's `contacts`, or null when the key is absent.
 *
 * NULL AND EMPTY MEAN DIFFERENT THINGS and the caller depends on it: an empty
 * array is the documented "no match" and must read as a successful null
 * contact, whereas a missing array means we did not understand the response
 * and must not be reported as "this person is not in the CRM".
 */
function readContactsArray(data: unknown): unknown[] | null {
  const root = asRecord(data);
  if (!root) return null;
  return Array.isArray(root.contacts) ? root.contacts : null;
}

function readTagsArray(data: unknown): string[] {
  const root = asRecord(data);
  if (!root || !Array.isArray(root.tags)) return [];
  return root.tags.filter((t): t is string => typeof t === "string");
}
