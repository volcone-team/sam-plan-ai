import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  disabledPickerBody,
  isSuperAdminProfile,
  parseIntakeV3ToggleInput,
  pickerAccess,
  readIntakeV3Enabled,
} from "./rollout-setting";

/** A client whose app_settings read resolves (or throws) as given. */
function makeDb(result: { data: unknown; error: unknown } | Error): {
  db: SupabaseClient;
  selected: string[];
} {
  const selected: string[] = [];
  const builder = {
    select(cols: string) {
      selected.push(cols);
      return builder;
    },
    eq() {
      return builder;
    },
    maybeSingle() {
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
  return { db: { from: () => builder } as unknown as SupabaseClient, selected };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("readIntakeV3Enabled", () => {
  it("reads true as on", async () => {
    const { db, selected } = makeDb({ data: { intake_v3_enabled: true }, error: null });
    expect(await readIntakeV3Enabled(db)).toEqual({ enabled: true, available: true });
    expect(selected).toEqual(["intake_v3_enabled"]);
  });

  it("reads false, null, a missing row and non-boolean values as off", async () => {
    for (const data of [{ intake_v3_enabled: false }, { intake_v3_enabled: null }, null, { intake_v3_enabled: "true" }]) {
      expect(await readIntakeV3Enabled(makeDb({ data, error: null }).db)).toEqual({ enabled: false, available: true });
    }
  });

  it("treats a missing column (047 not applied) as off and unavailable", async () => {
    for (const error of [
      { code: "42703", message: "column app_settings.intake_v3_enabled does not exist" },
      { code: "PGRST204", message: "Could not find the 'intake_v3_enabled' column" },
    ]) {
      expect(await readIntakeV3Enabled(makeDb({ data: null, error }).db)).toEqual({ enabled: false, available: false });
    }
  });

  it("treats any other error, or a throw, as off without failing", async () => {
    expect(await readIntakeV3Enabled(makeDb({ data: null, error: { code: "500", message: "boom" } }).db)).toEqual({
      enabled: false,
      available: true,
    });
    expect(await readIntakeV3Enabled(makeDb(new Error("network")).db)).toEqual({ enabled: false, available: true });
  });
});

describe("isSuperAdminProfile", () => {
  it("is true only for is_admin with level super_admin", () => {
    expect(isSuperAdminProfile({ is_admin: true, admin_level: "super_admin" })).toBe(true);
    expect(isSuperAdminProfile({ is_admin: true, admin_level: "admin" })).toBe(false);
    expect(isSuperAdminProfile({ is_admin: false, admin_level: "super_admin" })).toBe(false);
    expect(isSuperAdminProfile({ is_admin: "true", admin_level: "super_admin" })).toBe(false);
    expect(isSuperAdminProfile(null)).toBe(false);
    expect(isSuperAdminProfile(undefined)).toBe(false);
  });
});

describe("pickerAccess", () => {
  it("serves everyone when on, previews for super admins when off, else off", () => {
    expect(pickerAccess(true, false)).toBe("serve");
    expect(pickerAccess(true, true)).toBe("serve");
    expect(pickerAccess(false, true)).toBe("preview");
    expect(pickerAccess(false, false)).toBe("off");
  });

  it("the disabled body is empty and says enabled: false", () => {
    expect(disabledPickerBody()).toEqual({ enabled: false, items: [], configs: {}, recentKeys: [] });
  });
});

describe("parseIntakeV3ToggleInput", () => {
  it("accepts a boolean enabled", () => {
    expect(parseIntakeV3ToggleInput({ enabled: true })).toEqual({ ok: true, enabled: true });
    expect(parseIntakeV3ToggleInput({ enabled: false })).toEqual({ ok: true, enabled: false });
  });

  it("rejects anything else without coercing", () => {
    for (const body of [null, undefined, [], "x", {}, { enabled: "true" }, { enabled: 1 }, { enabled: null }]) {
      expect(parseIntakeV3ToggleInput(body).ok).toBe(false);
    }
  });
});
