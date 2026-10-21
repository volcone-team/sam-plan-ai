import { describe, it, expect } from "vitest";
import {
  parseGhlSettingsInput,
  isDangerousGhlTransition,
  type GhlSwitchState,
} from "./admin-input";

/**
 * The GoHighLevel settings write.
 *
 * The interesting half is the TRANSITION rule: the same body is harmless
 * against one stored state and a live write into the client's CRM against
 * another, so every case below names both.
 */

const OFF_SAFE: GhlSwitchState = { enabled: false, dryRun: true };
const ON_SAFE: GhlSwitchState = { enabled: true, dryRun: true };
const ON_LIVE: GhlSwitchState = { enabled: true, dryRun: false };
/** Reachable only by turning dry run off while the integration is disabled. */
const OFF_ARMED: GhlSwitchState = { enabled: false, dryRun: false };

describe("isDangerousGhlTransition", () => {
  it("refuses enabling and leaving dry run in one request", () => {
    expect(isDangerousGhlTransition(OFF_SAFE, { enabled: true, dryRun: false })).toBe(true);
  });

  it("allows enabling on its own", () => {
    expect(isDangerousGhlTransition(OFF_SAFE, { enabled: true })).toBe(false);
  });

  it("allows turning dry run off on its own", () => {
    expect(isDangerousGhlTransition(ON_SAFE, { dryRun: false })).toBe(false);
  });

  it("allows the pair when the integration is already on", () => {
    // Nothing is crossed: it was already enabled, so this is one change.
    expect(isDangerousGhlTransition(ON_SAFE, { enabled: true, dryRun: false })).toBe(false);
  });

  it("allows the pair when dry run is already off", () => {
    // The narrow rule, asserted so a later widening is a deliberate edit.
    expect(isDangerousGhlTransition(OFF_ARMED, { enabled: true, dryRun: false })).toBe(false);
  });

  it("is not triggered by turning things off", () => {
    expect(isDangerousGhlTransition(ON_LIVE, { enabled: false, dryRun: true })).toBe(false);
  });
});

describe("parseGhlSettingsInput", () => {
  it("maps enabled to its column", () => {
    const result = parseGhlSettingsInput({ enabled: true }, OFF_SAFE);
    expect(result).toEqual({
      ok: true,
      patch: { ghl_enabled: true },
      changed: { enabled: true },
    });
  });

  it("maps dryRun to its column", () => {
    const result = parseGhlSettingsInput({ dryRun: false }, ON_SAFE);
    expect(result).toEqual({
      ok: true,
      patch: { ghl_dry_run: false },
      changed: { dryRun: false },
    });
  });

  it("refuses the dangerous combined write with two_step_required", () => {
    const result = parseGhlSettingsInput({ enabled: true, dryRun: false }, OFF_SAFE);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("two_step_required");
    // The message has to say what to do next, not just "no".
    expect(result.message).toMatch(/dry run/i);
  });

  it("accepts the same pair when it is not a dangerous transition", () => {
    const result = parseGhlSettingsInput({ enabled: true, dryRun: false }, ON_SAFE);
    expect(result.ok).toBe(true);
  });

  it("accepts switching both off together", () => {
    // Only the direction towards live writes is guarded.
    const result = parseGhlSettingsInput({ enabled: false, dryRun: true }, ON_LIVE);
    expect(result.ok).toBe(true);
  });

  it("refuses a non-boolean enabled rather than coercing it", () => {
    // A truthy string from a hand-rolled curl would otherwise switch the
    // integration on for every producer in the app.
    const result = parseGhlSettingsInput({ enabled: "true" }, OFF_SAFE);
    expect(result).toMatchObject({ ok: false, error: "enabled" });
  });

  it("refuses a non-boolean dryRun rather than coercing it", () => {
    const result = parseGhlSettingsInput({ dryRun: 0 }, ON_SAFE);
    expect(result).toMatchObject({ ok: false, error: "dryRun" });
  });

  it("refuses an empty body", () => {
    expect(parseGhlSettingsInput({}, ON_SAFE)).toMatchObject({
      ok: false,
      error: "nothing_to_update",
    });
  });

  it("refuses a non-object body", () => {
    for (const body of [null, undefined, "enabled", 7, []]) {
      expect(parseGhlSettingsInput(body, ON_SAFE)).toMatchObject({
        ok: false,
        error: "nothing_to_update",
      });
    }
  });

  it("ignores unknown fields", () => {
    const result = parseGhlSettingsInput(
      { enabled: true, locationId: "loc_abc", token: "pit-secret" },
      OFF_SAFE
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Credentials are env vars; nothing from the body may reach app_settings.
    expect(Object.keys(result.patch)).toEqual(["ghl_enabled"]);
  });

  it("validates the shape before judging the transition", () => {
    // A bad boolean must report itself rather than being read as "absent" and
    // sliding past the transition rule.
    const result = parseGhlSettingsInput({ enabled: true, dryRun: "false" }, OFF_SAFE);
    expect(result).toMatchObject({ ok: false, error: "dryRun" });
  });
});
