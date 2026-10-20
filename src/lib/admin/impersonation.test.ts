import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  IMPERSONATION_MAX_AGE_SECONDS,
  isMarkerActive,
  isMarkerForUser,
  markerMsRemaining,
  signImpersonationMarker,
  signImpersonationReturn,
  verifyImpersonationMarker,
  verifyImpersonationReturn,
  type ImpersonationMarker,
} from "./impersonation";

/**
 * These tests exercise the real HMAC path (Web Crypto, as used on the Edge) —
 * nothing is mocked. The secret is set per test so the "wrong secret" case can
 * sign with one key and verify with another, which is the scenario that
 * matters: a rotated or mismatched deployment must reject tokens rather than
 * trust them.
 */

const SECRET_A = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SECRET_B = "test-secret-bbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const NOW = 1_760_000_000_000;

function marker(overrides: Partial<ImpersonationMarker> = {}): ImpersonationMarker {
  return {
    companyId: "company-1",
    companyName: "Acme Co",
    adminUserId: "admin-1",
    adminEmail: "admin@volcone.com",
    targetUserId: "owner-1",
    targetEmail: "owner@acme.test",
    startedAt: NOW,
    expiresAt: NOW + IMPERSONATION_MAX_AGE_SECONDS * 1000,
    ...overrides,
  };
}

let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env.TWO_FACTOR_SECRET;
  process.env.TWO_FACTOR_SECRET = SECRET_A;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.TWO_FACTOR_SECRET;
  else process.env.TWO_FACTOR_SECRET = originalSecret;
});

describe("impersonation marker cookie", () => {
  it("round-trips a valid marker", async () => {
    const token = await signImpersonationMarker(marker());
    const decoded = await verifyImpersonationMarker(token);

    expect(decoded).not.toBeNull();
    expect(decoded?.companyId).toBe("company-1");
    expect(decoded?.targetUserId).toBe("owner-1");
    expect(decoded?.adminEmail).toBe("admin@volcone.com");
    expect(decoded?.expiresAt).toBe(NOW + IMPERSONATION_MAX_AGE_SECONDS * 1000);
  });

  it("rejects a tampered payload", async () => {
    const token = await signImpersonationMarker(marker());

    // Re-encode the body with a different target user, keeping the signature.
    // This is the attack the signature exists to stop: swapping the marker onto
    // another account would otherwise let a customer skip the 2FA gate.
    const [body, signature] = [token.slice(0, token.lastIndexOf(".")), token.slice(token.lastIndexOf(".") + 1)];
    const decodedBody = Buffer.from(body, "base64url").toString("utf8");
    const forgedBody = decodedBody.replace("owner-1", "owner-2");
    const forged = `${Buffer.from(forgedBody, "utf8").toString("base64url")}.${signature}`;

    expect(await verifyImpersonationMarker(forged)).toBeNull();
  });

  it("rejects a flipped signature", async () => {
    const token = await signImpersonationMarker(marker());
    const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");

    expect(await verifyImpersonationMarker(flipped)).toBeNull();
  });

  it("rejects a marker signed with a different secret", async () => {
    const token = await signImpersonationMarker(marker());

    process.env.TWO_FACTOR_SECRET = SECRET_B;
    expect(await verifyImpersonationMarker(token)).toBeNull();
  });

  it("rejects malformed input without throwing", async () => {
    for (const bad of [null, undefined, "", "not-a-token", "a.b.c", "."]) {
      expect(await verifyImpersonationMarker(bad)).toBeNull();
    }
  });

  it("will not accept a return ticket as a marker", async () => {
    // Domain separation: both cookies are signed with the same key, so the
    // purpose prefix is the only thing stopping one being replayed as the
    // other. A return ticket accepted as a marker would be a 2FA bypass.
    const ticket = await signImpersonationReturn({
      adminUserId: "admin-1",
      adminEmail: "admin@volcone.com",
      refreshToken: "refresh-token-value",
      expiresAt: NOW + 1000,
    });

    expect(await verifyImpersonationMarker(ticket)).toBeNull();
  });

  it("rejects a marker missing required fields", async () => {
    // A marker with no targetUserId would otherwise be bound to `undefined`,
    // which the middleware's isMarkerForUser check must never see.
    process.env.TWO_FACTOR_SECRET = SECRET_A;
    const partial = await signImpersonationMarker({
      ...marker(),
      targetUserId: "",
    } as ImpersonationMarker);

    expect(await verifyImpersonationMarker(partial)).toBeNull();
  });
});

describe("isMarkerActive", () => {
  it("accepts a marker inside its window", () => {
    expect(isMarkerActive(marker(), NOW + 60_000)).toBe(true);
  });

  it("rejects an expired marker", () => {
    const expired = marker({ expiresAt: NOW + 1000 });
    expect(isMarkerActive(expired, NOW + 2000)).toBe(false);
  });

  it("rejects a marker exactly at its expiry", () => {
    const m = marker();
    expect(isMarkerActive(m, m.expiresAt)).toBe(false);
  });

  it("rejects null", () => {
    expect(isMarkerActive(null, NOW)).toBe(false);
  });

  it("rejects a marker that claims a window longer than the 60-minute policy", () => {
    // Defence against a marker minted (or edited, pre-signature) with a longer
    // life than policy allows. The limit is enforced here, not only at issue.
    const greedy = marker({
      expiresAt: NOW + IMPERSONATION_MAX_AGE_SECONDS * 1000 + 1,
    });
    expect(isMarkerActive(greedy, NOW + 1000)).toBe(false);
  });

  it("rejects a marker that started in the future", () => {
    expect(isMarkerActive(marker({ startedAt: NOW + 5000 }), NOW)).toBe(false);
  });

  it("enforces exactly a 60-minute limit", () => {
    expect(IMPERSONATION_MAX_AGE_SECONDS).toBe(3600);
  });
});

describe("isMarkerForUser", () => {
  it("accepts the impersonated user", () => {
    expect(isMarkerForUser(marker(), "owner-1")).toBe(true);
  });

  it("rejects any other user", () => {
    // The binding that makes a readable cookie safe: copied into someone
    // else's browser, the marker grants nothing.
    expect(isMarkerForUser(marker(), "owner-2")).toBe(false);
    expect(isMarkerForUser(marker(), "admin-1")).toBe(false);
  });

  it("rejects a null session", () => {
    expect(isMarkerForUser(marker(), null)).toBe(false);
    expect(isMarkerForUser(null, "owner-1")).toBe(false);
  });
});

describe("markerMsRemaining", () => {
  it("reports time left", () => {
    expect(markerMsRemaining(marker(), NOW)).toBe(IMPERSONATION_MAX_AGE_SECONDS * 1000);
  });

  it("floors at zero rather than going negative", () => {
    expect(markerMsRemaining(marker(), NOW + 10 * 60 * 60 * 1000)).toBe(0);
  });
});

describe("impersonation return ticket", () => {
  const ticket = {
    adminUserId: "admin-1",
    adminEmail: "admin@volcone.com",
    refreshToken: "refresh-token-value",
    expiresAt: NOW + IMPERSONATION_MAX_AGE_SECONDS * 1000,
  };

  it("round-trips", async () => {
    const decoded = await verifyImpersonationReturn(await signImpersonationReturn(ticket));

    expect(decoded?.adminUserId).toBe("admin-1");
    expect(decoded?.refreshToken).toBe("refresh-token-value");
  });

  it("rejects a tampered admin id", async () => {
    const token = await signImpersonationReturn(ticket);
    const body = token.slice(0, token.lastIndexOf("."));
    const signature = token.slice(token.lastIndexOf(".") + 1);
    const forgedBody = Buffer.from(body, "base64url")
      .toString("utf8")
      .replace("admin-1", "admin-9");
    const forged = `${Buffer.from(forgedBody, "utf8").toString("base64url")}.${signature}`;

    expect(await verifyImpersonationReturn(forged)).toBeNull();
  });

  it("rejects a ticket signed with a different secret", async () => {
    const token = await signImpersonationReturn(ticket);

    process.env.TWO_FACTOR_SECRET = SECRET_B;
    expect(await verifyImpersonationReturn(token)).toBeNull();
  });

  it("will not accept a marker as a return ticket", async () => {
    expect(await verifyImpersonationReturn(await signImpersonationMarker(marker()))).toBeNull();
  });

  it("still reads a ticket past its expiry, by design", async () => {
    /*
     * NOT an oversight. The ticket is only ever spent to UNDO impersonation.
     * Refusing a late one would strand the admin signed in as a customer —
     * the worst outcome this feature can produce — so expiry is enforced on
     * the marker (which grants access) and not here. Supabase independently
     * rejects a refresh token that is genuinely dead.
     */
    const stale = await signImpersonationReturn({ ...ticket, expiresAt: NOW - 1 });
    const decoded = await verifyImpersonationReturn(stale);

    expect(decoded).not.toBeNull();
    expect(decoded?.refreshToken).toBe("refresh-token-value");
  });

  it("rejects malformed input without throwing", async () => {
    for (const bad of [null, undefined, "", "garbage", "x.y"]) {
      expect(await verifyImpersonationReturn(bad)).toBeNull();
    }
  });
});

describe("missing secret", () => {
  it("throws rather than silently accepting anything", async () => {
    delete process.env.TWO_FACTOR_SECRET;

    // A deployment error must be loud. Returning null here would mean an
    // unconfigured environment quietly treats every cookie as invalid, which
    // looks like a transient bug instead of a misconfiguration.
    await expect(verifyImpersonationMarker("anything")).rejects.toThrow(
      /TWO_FACTOR_SECRET/
    );
  });
});
