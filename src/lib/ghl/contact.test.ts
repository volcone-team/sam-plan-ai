import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveGhlOwnerContact } from "./contact";

/* ── Mocked Supabase ─────────────────────────────────────────────────────────
 * Records the filters as well as the rows, because "only the owner" is a
 * CLIENT REQUIREMENT and the thing that enforces it is one `.eq('role',
 * 'owner')`. A test that only checked the returned email would still pass if
 * that predicate were deleted — the fixture below has an owner who sorts last
 * precisely so the filter has to do real work.
 */
type Filter = { column: string; value: unknown };

interface Table {
  rows: Record<string, unknown>[];
  error?: { message: string } | null;
}

let tables: Record<string, Table> = {};
let seenFilters: Record<string, Filter[]> = {};

function makeDb(): SupabaseClient {
  const db = {
    from(table: string) {
      const filters: Filter[] = [];
      seenFilters[table] = filters;
      const builder = {
        select: () => builder,
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return builder;
        },
        maybeSingle() {
          const config = tables[table];
          if (!config) return Promise.resolve({ data: null, error: null });
          if (config.error) return Promise.resolve({ data: null, error: config.error });
          const match = config.rows.find((row) =>
            filters.every((f) => row[f.column] === f.value)
          );
          return Promise.resolve({ data: match ?? null, error: null });
        },
      };
      return builder;
    },
  };
  return db as unknown as SupabaseClient;
}

const throwingDb = {
  from() {
    throw new Error("boom");
  },
} as unknown as SupabaseClient;

const COMPANY = "comp-1";

/** A whole team, with the owner NOT first — see the note above. */
function team() {
  return [
    {
      id: "member-1",
      company_id: COMPANY,
      role: "member",
      email: "member@example.com",
      first_name: "Mel",
      last_name: "Member",
    },
    {
      id: "member-2",
      company_id: COMPANY,
      role: "admin",
      email: "manager@example.com",
      first_name: "Max",
      last_name: "Manager",
    },
    {
      id: "owner-1",
      company_id: COMPANY,
      role: "owner",
      email: "  Owner@Example.COM ",
      first_name: " Olive ",
      last_name: "Owner",
    },
  ];
}

beforeEach(() => {
  tables = {
    profiles: { rows: team() },
    companies: { rows: [{ id: COMPANY, name: "Volcone Ltd" }] },
  };
  seenFilters = {};
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveGhlOwnerContact — the owner, and only the owner", () => {
  it("returns the owner's details with the email normalised", async () => {
    const result = await resolveGhlOwnerContact(makeDb(), COMPANY);

    expect(result).toEqual({
      ok: true,
      contact: {
        // Normalised here as well as in the outbox: this result is also the
        // answer to "do we have a usable address at all".
        email: "owner@example.com",
        firstName: "Olive",
        lastName: "Owner",
        companyName: "Volcone Ltd",
        userId: "owner-1",
      },
    });
  });

  /**
   * THE CLIENT REQUIREMENT, asserted on the query rather than the result.
   * Tagging a team member would put somebody who never bought anything into a
   * buyer workflow — and because `drain.ts` upserts the contact from the row's
   * email, it would MANUFACTURE a contact to do it.
   */
  it("filters on role = owner, so no team member can ever be picked", async () => {
    await resolveGhlOwnerContact(makeDb(), COMPANY);

    expect(seenFilters.profiles).toEqual([
      { column: "company_id", value: COMPANY },
      { column: "role", value: "owner" },
    ]);
  });

  it("ignores members even when they outnumber the owner", async () => {
    const result = await resolveGhlOwnerContact(makeDb(), COMPANY);
    expect(result).toMatchObject({ ok: true, contact: { email: "owner@example.com" } });
  });
});

describe("resolveGhlOwnerContact — data gaps", () => {
  it("reports no_owner when the company has no owner profile", async () => {
    // Reachable: an admin-created company whose owner invite never landed.
    tables.profiles.rows = team().filter((p) => p.role !== "owner");

    const result = await resolveGhlOwnerContact(makeDb(), COMPANY);

    expect(result).toMatchObject({ ok: false, reason: "no_owner" });
  });

  it("reports no_email when the owner row has no usable address", async () => {
    for (const email of [null, "", "   ", undefined, 42]) {
      tables.profiles.rows = [
        { id: "owner-1", company_id: COMPANY, role: "owner", email },
      ];
      const result = await resolveGhlOwnerContact(makeDb(), COMPANY);
      expect(result).toMatchObject({ ok: false, reason: "no_email" });
    }
  });

  it("reports no_company for a missing or blank company id", async () => {
    for (const id of [null, undefined, "", "   "]) {
      const result = await resolveGhlOwnerContact(makeDb(), id);
      expect(result).toMatchObject({ ok: false, reason: "no_company" });
    }
  });

  it("reports read_failed when the profiles query errors", async () => {
    tables.profiles.error = { message: "permission denied for table profiles" };

    const result = await resolveGhlOwnerContact(makeDb(), COMPANY);

    expect(result).toMatchObject({
      ok: false,
      reason: "read_failed",
      message: expect.stringContaining("permission denied"),
    });
  });

  /**
   * The company name is DECORATION. Losing it is not a reason to lose a buyer
   * tag, so an unreadable or absent `companies` row degrades to null.
   */
  it("still resolves when the company name is missing or unreadable", async () => {
    tables.companies = { rows: [] };
    await expect(resolveGhlOwnerContact(makeDb(), COMPANY)).resolves.toMatchObject({
      ok: true,
      contact: { companyName: null },
    });

    tables.companies = { rows: [], error: { message: "nope" } };
    await expect(resolveGhlOwnerContact(makeDb(), COMPANY)).resolves.toMatchObject({
      ok: true,
      contact: { companyName: null },
    });
  });

  it("returns null names rather than empty strings", async () => {
    // GHL reads a present null as "clear this field", and the client's own
    // team types names into these contacts.
    tables.profiles.rows = [
      {
        id: "owner-1",
        company_id: COMPANY,
        role: "owner",
        email: "o@example.com",
        first_name: "   ",
        last_name: null,
      },
    ];

    const result = await resolveGhlOwnerContact(makeDb(), COMPANY);

    expect(result).toMatchObject({
      ok: true,
      contact: { firstName: null, lastName: null },
    });
  });

  /**
   * THE INVARIANT. The callers are the Stripe webhook, intake build, plan
   * generation and login. A CRM lookup must never cost a payment or a sign-in.
   */
  it("never throws, whatever the client does", async () => {
    await expect(resolveGhlOwnerContact(throwingDb, COMPANY)).resolves.toEqual({
      ok: false,
      reason: "read_failed",
      message: "boom",
    });
  });
});
