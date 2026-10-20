import { describe, it, expect } from "vitest";
import {
  adminMemberStatus,
  collectLastSignIns,
  isPendingInvite,
  memberStatus,
  type AuthUserSignIn,
  type ListUsersPage,
} from "./member-status";

const SIGNED_IN = "2026-10-01T12:00:00Z";

describe("memberStatus", () => {
  it("is active when active and has signed in", () => {
    expect(memberStatus({ isActive: true, lastSignInAt: SIGNED_IN })).toBe("active");
  });

  it("is pending when active and never signed in", () => {
    expect(memberStatus({ isActive: true, lastSignInAt: null })).toBe("pending");
    expect(memberStatus({ isActive: true, lastSignInAt: undefined })).toBe("pending");
    expect(memberStatus({ isActive: true, lastSignInAt: "" })).toBe("pending");
  });

  it("inactive wins over both sign-in states", () => {
    expect(memberStatus({ isActive: false, lastSignInAt: SIGNED_IN })).toBe("inactive");
    expect(memberStatus({ isActive: false, lastSignInAt: null })).toBe("inactive");
  });

  it("treats a NULL is_active as active (column default)", () => {
    expect(memberStatus({ isActive: null, lastSignInAt: SIGNED_IN })).toBe("active");
    expect(memberStatus({ isActive: null, lastSignInAt: null })).toBe("pending");
  });

  it("isPendingInvite matches the team route's !lastSignInAt", () => {
    for (const v of [null, undefined, "", SIGNED_IN]) {
      expect(isPendingInvite(v)).toBe(!v);
    }
  });
});

describe("adminMemberStatus", () => {
  it("undefined last sign-in (lookup failed / capped) is unknown, not active", () => {
    expect(adminMemberStatus({ isActive: true, lastSignInAt: undefined })).toBe("unknown");
  });

  it("inactive still wins when the lookup is unknown", () => {
    expect(adminMemberStatus({ isActive: false, lastSignInAt: undefined })).toBe("inactive");
  });

  it("otherwise agrees with memberStatus", () => {
    expect(adminMemberStatus({ isActive: true, lastSignInAt: null })).toBe("pending");
    expect(adminMemberStatus({ isActive: true, lastSignInAt: SIGNED_IN })).toBe("active");
  });
});

/** In-memory paginated user list with the same nextPage semantics as listUsers. */
function pager(all: AuthUserSignIn[], perPage: number, failOnPage?: number) {
  const calls: number[] = [];
  const listPage = async (page: number): Promise<ListUsersPage> => {
    calls.push(page);
    if (page === failOnPage) return { error: "boom" };
    const users = all.slice((page - 1) * perPage, page * perPage);
    const nextPage = page * perPage < all.length ? page + 1 : null;
    return { users, nextPage };
  };
  return { listPage, calls };
}

const USERS: AuthUserSignIn[] = [
  { id: "a", last_sign_in_at: SIGNED_IN },
  { id: "b", last_sign_in_at: null },
  { id: "c" }, // field missing → never signed in
  { id: "d", last_sign_in_at: SIGNED_IN },
  { id: "e", last_sign_in_at: null },
];

describe("collectLastSignIns", () => {
  it("maps signed-in to the timestamp and never-signed-in to null", async () => {
    const { listPage } = pager(USERS, 2);
    const map = await collectLastSignIns(["a", "b", "c", "e"], listPage);
    expect(Object.fromEntries(map)).toEqual({ a: SIGNED_IN, b: null, c: null, e: null });
  });

  it("only returns wanted ids", async () => {
    const { listPage } = pager(USERS, 10);
    const map = await collectLastSignIns(["d"], listPage);
    expect([...map.keys()]).toEqual(["d"]);
  });

  it("stops paging once every wanted id is found", async () => {
    const { listPage, calls } = pager(USERS, 2);
    await collectLastSignIns(["a"], listPage);
    expect(calls).toEqual([1]);
  });

  it("leaves ids beyond the page cap absent (unknown)", async () => {
    const { listPage, calls } = pager(USERS, 2);
    const map = await collectLastSignIns(["a", "e"], listPage, 2);
    expect(calls).toEqual([1, 2]);
    expect(map.has("a")).toBe(true);
    expect(map.has("e")).toBe(false);
  });

  it("keeps what it found and leaves the rest absent when a page errors", async () => {
    const { listPage } = pager(USERS, 2, 2);
    const map = await collectLastSignIns(["a", "d"], listPage);
    expect(map.get("a")).toBe(SIGNED_IN);
    expect(map.has("d")).toBe(false);
  });

  it("treats a thrown page like an error", async () => {
    const map = await collectLastSignIns(["a"], async () => {
      throw new Error("network");
    });
    expect(map.size).toBe(0);
  });

  it("leaves ids with no auth user absent after the last page", async () => {
    const { listPage, calls } = pager(USERS, 2);
    const map = await collectLastSignIns(["a", "ghost"], listPage);
    expect(calls).toEqual([1, 2, 3]);
    expect(map.has("ghost")).toBe(false);
  });

  it("makes no requests for an empty id list", async () => {
    const { listPage, calls } = pager(USERS, 2);
    const map = await collectLastSignIns([], listPage);
    expect(map.size).toBe(0);
    expect(calls).toEqual([]);
  });
});
