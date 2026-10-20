import { describe, it, expect } from "vitest";
import { parseCallGateSettingsInput } from "./call-gate-input";

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
