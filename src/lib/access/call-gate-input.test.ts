import { describe, it, expect } from "vitest";
import { parseCallGateSettingsInput, migrationForMissingColumn } from "./call-gate-input";

/**
 * Validation for /api/admin/call-gate-settings PUT.
 *
 * The cases that matter are the ones with consequences: a switch that can only
 * be moved by an explicit boolean, a URL that is rendered as a link a paying
 * customer clicks, and a clear that genuinely clears.
 */
describe("parseCallGateSettingsInput", () => {
  describe("requireCall", () => {
    it("maps true onto the column", () => {
      const result = parseCallGateSettingsInput({ requireCall: true });
      expect(result).toEqual({
        ok: true,
        patch: { require_call_before_access: true },
        changed: { requireCall: true },
      });
    });

    it("maps false onto the column, rather than treating it as absent", () => {
      const result = parseCallGateSettingsInput({ requireCall: false });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.patch).toEqual({ require_call_before_access: false });
      }
    });

    it.each(["true", 1, "", null, {}])(
      "refuses a non-boolean switch (%o) instead of coercing it",
      (value) => {
        const result = parseCallGateSettingsInput({ requireCall: value });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toBe("requireCall");
      }
    );
  });

  describe("bookingUrl", () => {
    it("stores a trimmed https link", () => {
      const result = parseCallGateSettingsInput({
        bookingUrl: "  https://link.gohighlevel.com/widget/bookings/sam  ",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.patch).toEqual({
          onboarding_call_url: "https://link.gohighlevel.com/widget/bookings/sam",
        });
      }
    });

    it.each([null, ""])("clears the column for %o", (value) => {
      const result = parseCallGateSettingsInput({ bookingUrl: value });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.patch).toEqual({ onboarding_call_url: null });
        expect(result.changed).toEqual({ bookingUrl: null });
      }
    });

    it.each([
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://calendar.example.com/book",
      "calendar.example.com/book",
      "not a url",
      42,
    ])("refuses %o rather than storing it", (value) => {
      const result = parseCallGateSettingsInput({ bookingUrl: value });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("bookingUrl");
        // The message is what the admin sees next to the field, so it has to
        // say what a good value looks like.
        expect(result.message).toContain("https://");
      }
    });

    it("refuses a bad URL even when the switch alongside it is valid, so a half-valid save writes nothing", () => {
      const result = parseCallGateSettingsInput({
        requireCall: true,
        bookingUrl: "javascript:alert(1)",
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("the body as a whole", () => {
    it("writes both fields when both are given", () => {
      const result = parseCallGateSettingsInput({
        requireCall: true,
        bookingUrl: "https://example.com/book",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.patch).toEqual({
          require_call_before_access: true,
          onboarding_call_url: "https://example.com/book",
        });
        expect(Object.keys(result.changed).sort()).toEqual(["bookingUrl", "requireCall"]);
      }
    });

    it.each([{}, { somethingElse: 1 }, null, undefined, "nope", 7])(
      "refuses %o as nothing to update",
      (body) => {
        const result = parseCallGateSettingsInput(body);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toBe("nothing_to_update");
      }
    );

    it("never produces a company column: the switch applies at creation only", () => {
      const result = parseCallGateSettingsInput({ requireCall: true });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.keys(result.patch)).not.toContain("requires_call_unlock");
        expect(Object.keys(result.patch)).not.toContain("portal_access_granted_at");
      }
    });
  });
});

describe("parseCallGateSettingsInput — bookingUrlYearly (migration 048)", () => {
  it("stores a trimmed https link in the yearly column only", () => {
    const result = parseCallGateSettingsInput({
      bookingUrlYearly: "  https://link.gohighlevel.com/widget/bookings/sam-yearly  ",
    });
    expect(result).toEqual({
      ok: true,
      patch: {
        onboarding_call_url_yearly: "https://link.gohighlevel.com/widget/bookings/sam-yearly",
      },
      changed: {
        bookingUrlYearly: "https://link.gohighlevel.com/widget/bookings/sam-yearly",
      },
    });
  });

  it.each([null, ""])("clears the yearly column for %o", (value) => {
    const result = parseCallGateSettingsInput({ bookingUrlYearly: value });
    expect(result).toEqual({
      ok: true,
      patch: { onboarding_call_url_yearly: null },
      changed: { bookingUrlYearly: null },
    });
  });

  it.each([
    "javascript:alert(1)",
    "http://insecure.example.com/book",
    "not a url",
    "   ",
    42,
    {},
  ])("refuses %o with its own error code", (value) => {
    const result = parseCallGateSettingsInput({ bookingUrlYearly: value });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("bookingUrlYearly");
      expect(result.message).toMatch(/https:\/\//);
    }
  });

  it("refuses the whole write when only the yearly link is bad", () => {
    const result = parseCallGateSettingsInput({
      requireCall: true,
      bookingUrl: "https://example.com/monthly",
      bookingUrlYearly: "javascript:alert(1)",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("bookingUrlYearly");
  });

  it("writes all three fields together", () => {
    const result = parseCallGateSettingsInput({
      requireCall: false,
      bookingUrl: "https://example.com/monthly",
      bookingUrlYearly: "https://example.com/yearly",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patch).toEqual({
        require_call_before_access: false,
        onboarding_call_url: "https://example.com/monthly",
        onboarding_call_url_yearly: "https://example.com/yearly",
      });
      expect(Object.keys(result.changed).sort()).toEqual([
        "bookingUrl",
        "bookingUrlYearly",
        "requireCall",
      ]);
    }
  });

  /** The UI omits it when unchanged, so a database without 048 can still save. */
  it("leaves the yearly column out of the patch when the field is absent", () => {
    const result = parseCallGateSettingsInput({ bookingUrl: "https://example.com/monthly" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patch).not.toHaveProperty("onboarding_call_url_yearly");
  });
});

describe("migrationForMissingColumn", () => {
  const yearlyPatch = { onboarding_call_url_yearly: "https://example.com/yearly" };
  const basePatch = { onboarding_call_url: "https://example.com/monthly" };

  it("names 048 when the error names the yearly column", () => {
    for (const message of [
      "Could not find the 'onboarding_call_url_yearly' column of 'app_settings' in the schema cache",
      "column app_settings.onboarding_call_url_yearly does not exist",
    ]) {
      expect(migrationForMissingColumn({ message }, yearlyPatch)).toBe("048");
      expect(migrationForMissingColumn({ message }, basePatch)).toBe("048");
    }
  });

  it("names 043 when the error names one of 043's columns", () => {
    for (const message of [
      "Could not find the 'require_call_before_access' column of 'app_settings' in the schema cache",
      "Could not find the 'onboarding_call_url' column of 'app_settings' in the schema cache",
    ]) {
      expect(migrationForMissingColumn({ message }, { ...basePatch, ...yearlyPatch })).toBe("043");
    }
  });

  it("falls back on what the patch writes when the message names no column", () => {
    expect(migrationForMissingColumn({ message: "column does not exist" }, yearlyPatch)).toBe("048");
    expect(migrationForMissingColumn({ message: "column does not exist" }, basePatch)).toBe("043");
    expect(migrationForMissingColumn(null, { require_call_before_access: true })).toBe("043");
  });
});
