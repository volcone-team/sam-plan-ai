import { describe, it, expect } from "vitest";
import {
  summariseGhlOutbox,
  describeGhlRowStatus,
  describeGhlEventType,
  describeGhlFixedTags,
  isGhlDryRunRow,
  ghlRowErrorText,
  ghlSettingsPayload,
  GHL_OUTBOX_STATUSES,
} from "./admin-view";
import { GHL_DRY_RUN_MARKER } from "./drain";
import { FIXED_TAGS, TAG_OPTED_DND, TAG_REGISTERED_NOT_PAID } from "./tags";
import { GHL_ENV_LOCATION_ID, GHL_ENV_PRIVATE_TOKEN, type GhlConfig } from "./config";

/**
 * Presentation decisions for the admin panel.
 *
 * Two of these are load-bearing rather than cosmetic: `skipped` must never
 * read as a failure (044 legislates it), and a dry-run row must never read as
 * a real delivery. The third is the credential projection, which is asserted
 * on the serialised payload so a future `...config` cannot slip a token into a
 * response.
 */

const LOCATION = "loc_abc123";
const TOKEN = "pit-0123456789abcdef";

describe("summariseGhlOutbox", () => {
  const counts = { pending: 3, delivered: 10, failed: 2, skipped: 7, dueNow: 1 };

  it("totals the four statuses and not dueNow", () => {
    // dueNow is a SUBSET of pending; adding it would double-count.
    expect(summariseGhlOutbox(counts).total).toBe(22);
  });

  it("counts only failed rows as needing attention", () => {
    expect(summariseGhlOutbox(counts).needsAttention).toBe(2);
  });

  it("never counts skipped rows as a problem", () => {
    const skippedOnly = { pending: 0, delivered: 0, failed: 0, skipped: 99, dueNow: 0 };
    expect(summariseGhlOutbox(skippedOnly).needsAttention).toBe(0);
  });

  it("does not treat pending rows as a problem", () => {
    const pendingOnly = { pending: 40, delivered: 0, failed: 0, skipped: 0, dueNow: 40 };
    expect(summariseGhlOutbox(pendingOnly).needsAttention).toBe(0);
    expect(summariseGhlOutbox(pendingOnly).inFlight).toBe(40);
  });
});

describe("describeGhlRowStatus", () => {
  it("tones skipped down, not up", () => {
    const described = describeGhlRowStatus("skipped");
    expect(described.tone).toBe("muted");
    expect(described.terminal).toBe(true);
    expect(described.detail).toMatch(/not a failure/i);
  });

  it("is the only error tone for failed", () => {
    expect(describeGhlRowStatus("failed").tone).toBe("error");
    expect(describeGhlRowStatus("delivered").tone).toBe("ok");
    expect(describeGhlRowStatus("pending").tone).toBe("muted");
  });

  it("marks pending as the one non-terminal status", () => {
    const nonTerminal = GHL_OUTBOX_STATUSES.filter((s) => !describeGhlRowStatus(s).terminal);
    expect(nonTerminal).toEqual(["pending"]);
  });

  it("says so plainly for a status 044 does not allow", () => {
    const described = describeGhlRowStatus("processing");
    expect(described.label).toContain("processing");
    expect(described.tone).toBe("error");
    expect(describeGhlRowStatus(null).label).toBe("Unknown");
  });
});

describe("isGhlDryRunRow", () => {
  it("reads the drain's last_error marker", () => {
    expect(isGhlDryRunRow({ last_error: GHL_DRY_RUN_MARKER })).toBe(true);
  });

  it("reads the payload flag", () => {
    expect(isGhlDryRunRow({ payload: { ghl_dry_run: true } })).toBe(true);
  });

  it("reads the payload flag even once last_error has been cleared", () => {
    // The real divergence: a later real delivery clears last_error but leaves
    // the old payload key behind.
    expect(isGhlDryRunRow({ last_error: null, payload: { ghl_dry_run: true } })).toBe(true);
  });

  it("does not mistake a real delivery for a dry run", () => {
    expect(isGhlDryRunRow({ last_error: null, payload: { firstName: "Ada" } })).toBe(false);
    expect(isGhlDryRunRow({})).toBe(false);
    expect(isGhlDryRunRow({ last_error: "http_429: rate limited" })).toBe(false);
  });

  it("does not read a falsy payload flag as a dry run", () => {
    expect(isGhlDryRunRow({ payload: { ghl_dry_run: false } })).toBe(false);
    expect(isGhlDryRunRow({ payload: { ghl_dry_run: "true" } })).toBe(false);
  });
});

describe("ghlRowErrorText", () => {
  it("hides the dry-run marker, which is a note and not an error", () => {
    expect(ghlRowErrorText({ status: "delivered", last_error: GHL_DRY_RUN_MARKER })).toBeNull();
  });

  it("shows a real error", () => {
    expect(ghlRowErrorText({ status: "failed", last_error: "http_401: unauthorized" })).toBe(
      "http_401: unauthorized"
    );
  });

  it("treats blank and missing the same", () => {
    expect(ghlRowErrorText({ last_error: "   " })).toBeNull();
    expect(ghlRowErrorText({ last_error: null })).toBeNull();
    expect(ghlRowErrorText({})).toBeNull();
  });

  it("still returns a skipped row's reason", () => {
    // Information, not a fault — the tone comes from describeGhlRowStatus.
    expect(
      ghlRowErrorText({ status: "skipped", last_error: "The contact does not exist" })
    ).toBe("The contact does not exist");
  });
});

describe("describeGhlEventType", () => {
  it("names the six live producers", () => {
    expect(describeGhlEventType("buyer_state")).toBe("Buyer state");
    expect(describeGhlEventType("cancellation")).toBe("Cancellation");
    expect(describeGhlEventType("finished_intake")).toBe("Finished intake");
    expect(describeGhlEventType("plan_generated")).toBe("Plan generated");
    expect(describeGhlEventType("first_login")).toBe("First login");
    expect(describeGhlEventType("founder")).toBe("Founding member");
    expect(describeGhlEventType("registered")).toBe("Registered");
  });

  it("leaves the dropped login trigger unprettified", () => {
    // Nothing enqueues one any more; a friendly name would imply it is still
    // a thing.
    expect(describeGhlEventType("login_trigger")).toBe("login_trigger");
  });

  it("falls back to a dash", () => {
    expect(describeGhlEventType(null)).toBe("—");
  });
});

describe("ghlSettingsPayload", () => {
  const liveConfig: GhlConfig = {
    status: "live",
    available: true,
    mayWrite: true,
    env: { locationId: true, token: true },
    credentials: { locationId: LOCATION, token: TOKEN },
  };

  it("reports presence, names and status", () => {
    expect(ghlSettingsPayload(liveConfig)).toMatchObject({
      status: "live",
      available: true,
      mayWrite: true,
      env: { locationId: true, token: true },
      envVars: { locationId: GHL_ENV_LOCATION_ID, token: GHL_ENV_PRIVATE_TOKEN },
    });
  });

  it("leaks neither the token nor the location id, anywhere in the payload", () => {
    // Serialised, so a credential nested under a key added later is caught
    // too — this is the assertion that stands in for a reviewer noticing a
    // future `...config`.
    const serialised = JSON.stringify(ghlSettingsPayload(liveConfig));
    expect(serialised).not.toContain(TOKEN);
    expect(serialised).not.toContain(LOCATION);
    expect(serialised).not.toContain("credentials");
  });

  it("describes each of the five statuses without a credential", () => {
    const configs: GhlConfig[] = [
      liveConfig,
      { status: "dry_run", available: true, mayWrite: false, env: { locationId: true, token: true } },
      { status: "disabled", available: true, mayWrite: false, env: { locationId: true, token: true } },
      {
        status: "not_configured",
        available: true,
        mayWrite: false,
        env: { locationId: false, token: false },
        missing: [GHL_ENV_LOCATION_ID, GHL_ENV_PRIVATE_TOKEN],
      },
      { status: "unavailable", available: false, mayWrite: false, env: { locationId: false, token: false } },
    ];

    for (const config of configs) {
      const payload = ghlSettingsPayload(config);
      expect(payload.status).toBe(config.status);
      // The panel renders this verbatim, so every status must say something.
      expect(payload.description.length).toBeGreaterThan(0);
      expect(JSON.stringify(payload)).not.toContain(TOKEN);
    }
  });

  it("passes `available: false` through, so the panel can ask for migration 044", () => {
    const unavailable: GhlConfig = {
      status: "unavailable",
      available: false,
      mayWrite: false,
      env: { locationId: false, token: false },
    };
    expect(ghlSettingsPayload(unavailable).available).toBe(false);
    expect(ghlSettingsPayload(unavailable).description).toMatch(/044/);
  });
});

describe("describeGhlFixedTags", () => {
  it("lists every fixed tag, in contract order, each with a one-line description", () => {
    const rows = describeGhlFixedTags();
    expect(rows.map((r) => r.tag)).toEqual([...FIXED_TAGS]);
    for (const row of rows) {
      expect(row.description.trim()).not.toBe("");
      expect(row.description).not.toContain("\n");
    }
  });

  it("includes the two registration tags", () => {
    const tags = describeGhlFixedTags().map((r) => r.tag);
    expect(tags).toContain(TAG_REGISTERED_NOT_PAID);
    expect(tags).toContain(TAG_OPTED_DND);
  });
});
