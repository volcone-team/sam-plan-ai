import { describe, it, expect } from "vitest";
import { decideImpersonationStart, type OwnerCandidate } from "./impersonation-start";

const OWNER: OwnerCandidate = {
  id: "owner-1",
  email: "owner@acme.test",
  created_at: "2026-01-01T00:00:00Z",
};

describe("decideImpersonationStart — authorization", () => {
  it("allows a super admin", () => {
    const decision = decideImpersonationStart("super_admin", "Acme Co", [OWNER]);

    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.targetUserId).toBe("owner-1");
      expect(decision.targetEmail).toBe("owner@acme.test");
    }
  });

  it("refuses a plain admin with 403", () => {
    // Impersonation hands over a real writable session in someone else's
    // account — a bigger capability than the rest of the admin surface.
    const decision = decideImpersonationStart("admin", "Acme Co", [OWNER]);

    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.status).toBe(403);
  });

  it("refuses a missing or unknown admin level with 403", () => {
    for (const level of [null, undefined, "", "viewer", "owner", "SUPER_ADMIN"]) {
      const decision = decideImpersonationStart(level, "Acme Co", [OWNER]);
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.status).toBe(403);
    }
  });

  it("checks authorization before anything else", () => {
    // A non-super-admin asking about an ownerless company must be told they
    // lack permission, not handed information about the company's state.
    const decision = decideImpersonationStart("admin", "Acme Co", []);

    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.status).toBe(403);
  });
});

describe("decideImpersonationStart — choosing the owner", () => {
  it("refuses a company with no owner", () => {
    const decision = decideImpersonationStart("super_admin", "Acme Co", []);

    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.status).toBe(409);
      expect(decision.error).toBe("no_owner");
      expect(decision.message).toContain("Acme Co");
    }
  });

  it("refuses when owners is null or undefined", () => {
    expect(decideImpersonationStart("super_admin", "Acme Co", null).ok).toBe(false);
    expect(decideImpersonationStart("super_admin", "Acme Co", undefined).ok).toBe(false);
  });

  it("picks the oldest owner when there are several", () => {
    const decision = decideImpersonationStart("super_admin", "Acme Co", [
      { id: "newer", email: "newer@acme.test", created_at: "2026-06-01T00:00:00Z" },
      { id: "oldest", email: "oldest@acme.test", created_at: "2025-01-01T00:00:00Z" },
      { id: "middle", email: "middle@acme.test", created_at: "2026-02-01T00:00:00Z" },
    ]);

    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.targetUserId).toBe("oldest");
  });

  it("skips owners with no email", () => {
    // A session is minted by email address, so a mail-less owner is unusable.
    // It must be filtered BEFORE the tie-break, or it could win the sort and
    // then fail to resolve.
    const decision = decideImpersonationStart("super_admin", "Acme Co", [
      { id: "no-mail", email: null, created_at: "2024-01-01T00:00:00Z" },
      { id: "usable", email: "usable@acme.test", created_at: "2026-01-01T00:00:00Z" },
    ]);

    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.targetUserId).toBe("usable");
  });

  it("refuses when every owner lacks an email", () => {
    const decision = decideImpersonationStart("super_admin", "Acme Co", [
      { id: "a", email: null },
      { id: "b", email: "" },
    ]);

    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.error).toBe("no_owner");
  });

  it("skips owners with no id", () => {
    const decision = decideImpersonationStart("super_admin", "Acme Co", [
      { id: "", email: "ghost@acme.test", created_at: "2024-01-01T00:00:00Z" },
      { id: "real", email: "real@acme.test", created_at: "2026-01-01T00:00:00Z" },
    ]);

    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.targetUserId).toBe("real");
  });

  it("sorts owners with no created_at last rather than dropping them", () => {
    const decision = decideImpersonationStart("super_admin", "Acme Co", [
      { id: "undated", email: "undated@acme.test" },
      { id: "dated", email: "dated@acme.test", created_at: "2026-01-01T00:00:00Z" },
    ]);

    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.targetUserId).toBe("dated");
  });

  it("still resolves when the only owner has no created_at", () => {
    const decision = decideImpersonationStart("super_admin", "Acme Co", [
      { id: "only", email: "only@acme.test" },
    ]);

    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.targetUserId).toBe("only");
  });

  it("does not mutate the caller's array", () => {
    const owners: OwnerCandidate[] = [
      { id: "b", email: "b@acme.test", created_at: "2026-06-01T00:00:00Z" },
      { id: "a", email: "a@acme.test", created_at: "2025-01-01T00:00:00Z" },
    ];
    decideImpersonationStart("super_admin", "Acme Co", owners);

    expect(owners.map((o) => o.id)).toEqual(["b", "a"]);
  });
});
