import { describe, it, expect, beforeAll } from "vitest";
import { buildEmailBody, unsubscribeUrlFor } from "./unsubscribe-link";
import { verifyUnsubscribeToken } from "./unsubscribe-token";

beforeAll(() => {
  process.env.NOTIFICATIONS_TOKEN_SECRET = "test-secret-for-unit-tests";
});

/** Pull the token query param out of an unsubscribe href. */
function tokenFromUrl(url: string): string {
  return new URL(url).searchParams.get("token") ?? "";
}

/** Pull the unsubscribe href out of a rendered email body. */
function hrefFromBody(body: string): string {
  return body.match(/<a href="([^"]+)">Unsubscribe<\/a>/)?.[1] ?? "";
}

describe("unsubscribe link in the send path (Req 5.1)", () => {
  it("builds a body containing an unsubscribe anchor to the unsubscribe route", () => {
    const url = unsubscribeUrlFor("user-123");
    const body = buildEmailBody("<p>Hello there</p>", url);

    const href = hrefFromBody(body);
    expect(href).toContain("/api/notifications/unsubscribe?token=");
  });

  it("embeds a token that round-trips to the same user id", () => {
    const url = unsubscribeUrlFor("user-123");
    const body = buildEmailBody("<p>Body</p>", url);

    const token = tokenFromUrl(hrefFromBody(body));
    const payload = verifyUnsubscribeToken(token);
    expect(payload?.userId).toBe("user-123");
  });

  it("rejects a tampered token embedded in the URL", () => {
    const url = unsubscribeUrlFor("user-123");
    const body = buildEmailBody("<p>Body</p>", url);

    const token = tokenFromUrl(hrefFromBody(body));
    // Forge: keep the signature but swap the encoded payload to another user.
    const sig = token.split(".")[1];
    const forgedPayload = Buffer.from("user-999:initiative_reminder").toString("base64url");
    const forged = `${forgedPayload}.${sig}`;
    expect(verifyUnsubscribeToken(forged)).toBeNull();
  });

  it("preserves the original rendered body content", () => {
    const base = "<p>Hi there, your campaign goes live soon.</p>";
    const body = buildEmailBody(base, unsubscribeUrlFor("user-abc"));
    expect(body).toContain(base);
    // The unsubscribe block is appended after the original content.
    expect(body.indexOf(base)).toBeLessThan(body.indexOf("Unsubscribe"));
  });
});
