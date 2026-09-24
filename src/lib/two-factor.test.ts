import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  signDeviceToken,
  verifyDeviceToken,
  TWO_FACTOR_MAX_AGE_SECONDS,
} from "./two-factor";

beforeAll(() => {
  process.env.TWO_FACTOR_SECRET = "test-secret-for-unit-tests";
});

describe("two-factor device token", () => {
  it("round-trips: a signed token verifies for the same user", async () => {
    const token = await signDeviceToken("user-123");
    await expect(verifyDeviceToken(token, "user-123")).resolves.toBe(true);
  });

  it("rejects a valid token presented for a different user", async () => {
    const token = await signDeviceToken("user-123");
    await expect(verifyDeviceToken(token, "user-999")).resolves.toBe(false);
  });

  it("rejects a token whose payload was swapped but signature kept", async () => {
    const token = await signDeviceToken("user-123");
    const signature = token.split(".")[1];
    // base64url of `user-999:<now>` — a payload this signature never covered.
    const forgedPayload = btoa(`user-999:${Date.now()}`)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    await expect(
      verifyDeviceToken(`${forgedPayload}.${signature}`, "user-999")
    ).resolves.toBe(false);
  });

  it("rejects a token whose signature was tampered", async () => {
    const token = await signDeviceToken("user-123");
    const [payload] = token.split(".");
    await expect(
      verifyDeviceToken(`${payload}.deadbeef`, "user-123")
    ).resolves.toBe(false);
  });

  it("rejects a token issued beyond the 30-day window", async () => {
    const realNow = Date.now();
    const spy = vi
      .spyOn(Date, "now")
      .mockReturnValue(realNow - (TWO_FACTOR_MAX_AGE_SECONDS * 1000 + 60_000));
    const staleToken = await signDeviceToken("user-123");
    spy.mockRestore();

    await expect(verifyDeviceToken(staleToken, "user-123")).resolves.toBe(false);
  });

  it("rejects malformed input without throwing", async () => {
    await expect(verifyDeviceToken(null, "user-123")).resolves.toBe(false);
    await expect(verifyDeviceToken(undefined, "user-123")).resolves.toBe(false);
    await expect(verifyDeviceToken("", "user-123")).resolves.toBe(false);
    await expect(verifyDeviceToken("nodot", "user-123")).resolves.toBe(false);
    await expect(verifyDeviceToken("a.b.c", "user-123")).resolves.toBe(false);
  });
});
