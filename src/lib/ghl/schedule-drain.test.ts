import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/* ── Mocked `after` ─────────────────────────────────────────────────────────
 * THE WHOLE POINT OF THIS FILE IS WHAT HAPPENS WHEN THIS IS NOT AVAILABLE.
 * The real `after()` throws outside a request context, which is the normal
 * situation for a test, a script, and the cron's own producers — so the mock
 * is swappable per test: it captures callbacks by default, and one test makes
 * it throw the way the real one does.
 */
const captured: (() => unknown)[] = [];
let afterImpl: (cb: () => unknown) => void = (cb) => {
  captured.push(cb);
};
vi.mock("next/server", () => ({ after: (cb: () => unknown) => afterImpl(cb) }));

/* ── Mocked boundaries ──────────────────────────────────────────────────────
 * `drain.ts` is tested exhaustively in drain.test.ts; what matters here is
 * WHETHER it is called and WITH WHAT. The client is mocked so that a live
 * config cannot make a request even by accident.
 */
const drainGhlOutbox = vi.fn<(options: Record<string, unknown>) => Promise<unknown>>();
vi.mock("@/lib/ghl/drain", () => ({
  drainGhlOutbox: (options: Record<string, unknown>) => drainGhlOutbox(options),
}));

const createGhlClient = vi.fn((_opts: unknown) => ({ marker: "fake-client" }));
vi.mock("@/lib/ghl/client", () => ({
  createGhlClient: (opts: never) => createGhlClient(opts),
}));

import { scheduleGhlDrain, GHL_AFTER_DRAIN_BATCH_SIZE } from "./schedule-drain";

/** `loadGhlConfig` is the real one, reading these two columns off a fake db. */
function makeDb(settings: { ghl_enabled: unknown; ghl_dry_run: unknown } | null): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: settings, error: null }) }),
      }),
    }),
  } as unknown as SupabaseClient;
}

const DRY_RUN = { ghl_enabled: true, ghl_dry_run: true };
const LIVE = { ghl_enabled: true, ghl_dry_run: false };
const OFF = { ghl_enabled: false, ghl_dry_run: true };

/** Run every callback `after` was handed, and surface nothing but a throw. */
async function runScheduled(): Promise<void> {
  for (const cb of captured) await cb();
}

beforeEach(() => {
  captured.length = 0;
  afterImpl = (cb) => {
    captured.push(cb);
  };
  drainGhlOutbox.mockReset();
  drainGhlOutbox.mockResolvedValue({ claimed: 0, delivered: 0, errors: [] });
  createGhlClient.mockClear();
  /*
   * Credentials present by default. `loadGhlConfig` reports a missing one as
   * `not_configured` whatever the switches say, so without this even the dry
   * run would resolve to "off" and these tests would pass for the wrong
   * reason.
   */
  vi.stubEnv("GHL_LOCATION_ID", "loc_1");
  vi.stubEnv("GHL_PRIVATE_TOKEN", "pit-secret-value");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("scheduleGhlDrain — the batch it asks for", () => {
  it("drains a small batch after the response", async () => {
    scheduleGhlDrain(makeDb(DRY_RUN));
    expect(captured).toHaveLength(1);
    // Nothing has run yet: that is the contract — the response goes first.
    expect(drainGhlOutbox).not.toHaveBeenCalled();

    await runScheduled();

    expect(drainGhlOutbox).toHaveBeenCalledTimes(1);
    expect(drainGhlOutbox.mock.calls[0][0]).toMatchObject({
      batchSize: GHL_AFTER_DRAIN_BATCH_SIZE,
    });
  });

  /**
   * The size is a TIME budget, not a throughput one: this shares a function
   * window with the request that scheduled it, and `maxDuration` is not raised
   * anywhere. The cron's 25 would be killed mid-batch.
   */
  it("keeps the batch far below the cron's", () => {
    expect(GHL_AFTER_DRAIN_BATCH_SIZE).toBeGreaterThan(0);
    expect(GHL_AFTER_DRAIN_BATCH_SIZE).toBeLessThanOrEqual(5);
  });

  /** A dry run carries no credentials by design, so there is nothing to build. */
  it("passes no client on a dry run", async () => {
    scheduleGhlDrain(makeDb(DRY_RUN));
    await runScheduled();

    expect(createGhlClient).not.toHaveBeenCalled();
    expect(drainGhlOutbox.mock.calls[0][0]).toMatchObject({ client: null });
  });

  it("builds a client only on a live config", async () => {
    scheduleGhlDrain(makeDb(LIVE));
    await runScheduled();

    expect(createGhlClient).toHaveBeenCalledWith({
      locationId: "loc_1",
      token: "pit-secret-value",
    });
    expect(drainGhlOutbox.mock.calls[0][0].client).toEqual({ marker: "fake-client" });
  });
});

describe("scheduleGhlDrain — when it should do nothing", () => {
  /**
   * An off integration never enqueues, so this is the narrow race where it was
   * switched off between the insert and the callback. One settings read, no
   * outbox query, no client.
   */
  it("does nothing when the integration is off", async () => {
    scheduleGhlDrain(makeDb(OFF));
    await runScheduled();

    expect(drainGhlOutbox).not.toHaveBeenCalled();
    expect(createGhlClient).not.toHaveBeenCalled();
  });

  /** `loadGhlConfig` fails closed, so an unreadable singleton is also "off". */
  it("does nothing when the settings cannot be read", async () => {
    scheduleGhlDrain(makeDb(null));
    await runScheduled();

    expect(drainGhlOutbox).not.toHaveBeenCalled();
  });
});

describe("scheduleGhlDrain — it never throws", () => {
  /**
   * THE INVARIANT. The callers are the Stripe webhook, intake build, plan
   * generation and login; `after()` throws synchronously when there is no
   * request context, which is every script and every test. The fallbacks are
   * the daily cron and the admin button, so this costs latency, not delivery.
   */
  it("swallows an `after` that throws (no request context)", () => {
    afterImpl = () => {
      throw new Error("`after` was called outside a request scope");
    };

    expect(() => scheduleGhlDrain(makeDb(DRY_RUN))).not.toThrow();
    expect(drainGhlOutbox).not.toHaveBeenCalled();
  });

  it("swallows an `after` that is not a function at all", () => {
    afterImpl = undefined as unknown as (cb: () => unknown) => void;
    expect(() => scheduleGhlDrain(makeDb(DRY_RUN))).not.toThrow();
  });

  /**
   * By the time the callback runs the response is sent, so a rejection here
   * would be an unhandled one in the platform log and nothing more.
   */
  it("swallows a callback that throws", async () => {
    drainGhlOutbox.mockRejectedValue(new Error("boom"));

    scheduleGhlDrain(makeDb(DRY_RUN));
    await expect(runScheduled()).resolves.toBeUndefined();
  });

  it("swallows a database client that throws on use", async () => {
    const throwingDb = {
      from() {
        throw new Error("no connection");
      },
    } as unknown as SupabaseClient;

    scheduleGhlDrain(throwingDb);
    // loadGhlConfig fails closed rather than throwing, so this is an off
    // config and the drain is never reached.
    await expect(runScheduled()).resolves.toBeUndefined();
    expect(drainGhlOutbox).not.toHaveBeenCalled();
  });
});
