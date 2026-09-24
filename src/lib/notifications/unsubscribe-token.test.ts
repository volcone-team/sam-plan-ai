import { describe, it, expect, beforeAll } from "vitest";
import { generateUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-token";

beforeAll(() => {
  process.env.NOTIFICATIONS_TOKEN_SECRET = "test-secret-for-unit-tests";
});

describe("unsubscribe token", () => {
  it("round-trips: a generated token verifies to the same user (Req 5.1)", () => {
    const token = generateUnsubscribeToken("user-123", "initiative_reminder");
    const payload = verifyUnsubscribeToken(token);
    expect(payload).toEqual({ userId: "user-123", category: "initiative_reminder" });
  });

  it("defaults the category when omitted", () => {
    const token = generateUnsubscribeToken("user-abc");
    expect(verifyUnsubscribeToken(token)?.category).toBe("initiative_reminder");
  });

  it("rejects a token whose payload was tampered (id swapped)", () => {
    const token = generateUnsubscribeToken("user-123");
    // Forge: keep the signature but swap the encoded payload to another user.
    const sig = token.split(".")[1];
    const forgedPayload = Buffer.from("user-999:initiative_reminder").toString("base64url");
    const forged = `${forgedPayload}.${sig}`;
    expect(verifyUnsubscribeToken(forged)).toBeNull();
  });

  it("rejects a token whose signature was tampered", () => {
    const token = generateUnsubscribeToken("user-123");
    const [payload] = token.split(".");
    expect(verifyUnsubscribeToken(`${payload}.deadbeef`)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = generateUnsubscribeToken("user-123");
    process.env.NOTIFICATIONS_TOKEN_SECRET = "a-different-secret";
    expect(verifyUnsubscribeToken(token)).toBeNull();
    process.env.NOTIFICATIONS_TOKEN_SECRET = "test-secret-for-unit-tests"; // restore
  });

  it("rejects malformed input without throwing", () => {
    expect(verifyUnsubscribeToken(null)).toBeNull();
    expect(verifyUnsubscribeToken("")).toBeNull();
    expect(verifyUnsubscribeToken("no-dot-here")).toBeNull();
    expect(verifyUnsubscribeToken(".onlysig")).toBeNull();
  });

  it("tokens are opaque — the raw user id is not readable without decoding", () => {
    const token = generateUnsubscribeToken("user-123");
    expect(token).not.toContain("user-123");
  });
});
