import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseToggleInput, readRequireEmailVerification } from "./email-verification-setting";

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

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("readRequireEmailVerification", () => {
  it("reads true as required", async () => {
    const { db, selected } = makeDb({ data: { require_email_verification: true }, error: null });
    expect(await readRequireEmailVerification(db)).toEqual({ required: true, available: true });
    expect(selected).toEqual(["require_email_verification"]);
  });

  it("reads false, null, a missing row and non-boolean values as not required", async () => {
    for (const data of [
      { require_email_verification: false },
      { require_email_verification: null },
      null,
      { require_email_verification: "true" },
    ]) {
      expect(await readRequireEmailVerification(makeDb({ data, error: null }).db)).toEqual({
        required: false,
        available: true,
      });
    }
  });

  it("treats a missing column (049 not applied) as off and unavailable, without logging", async () => {
    for (const error of [
      { code: "42703", message: "column app_settings.require_email_verification does not exist" },
      { code: "PGRST204", message: "Could not find the 'require_email_verification' column" },
    ]) {
      expect(await readRequireEmailVerification(makeDb({ data: null, error }).db)).toEqual({
        required: false,
        available: false,
      });
    }
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("treats any other error, or a throw, as off and logs it without failing", async () => {
    expect(
      await readRequireEmailVerification(makeDb({ data: null, error: { code: "500", message: "boom" } }).db)
    ).toEqual({ required: false, available: true });
    expect(await readRequireEmailVerification(makeDb(new Error("network")).db)).toEqual({
      required: false,
      available: true,
    });
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });
});

describe("parseToggleInput", () => {
  it("accepts a boolean required", () => {
    expect(parseToggleInput({ required: true })).toEqual({ ok: true, required: true });
    expect(parseToggleInput({ required: false })).toEqual({ ok: true, required: false });
  });

  it("rejects anything else without coercing", () => {
    for (const body of [null, undefined, [], "x", {}, { required: "true" }, { required: 1 }, { required: null }]) {
      expect(parseToggleInput(body).ok).toBe(false);
    }
  });
});
