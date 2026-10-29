import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueInviteConsentEvent, inviteConsentDedupeKey } from "./invite-consent";
import type { GhlConfig } from "../config";
import { TAG_OPTED_COMMUNICATION, TAG_OPTED_DND, TAG_REGISTERED_NOT_PAID } from "../tags";

/* Minimal fake: profiles (owner lookup), companies (name), ghl_events (insert). */
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let inserts: Row[];
let insertError: { code?: string; message: string } | null;
let queried: string[];

function makeDb(): SupabaseClient {
  return {
    from(table: string) {
      queried.push(table);
      const filters: [string, unknown][] = [];
      const rows = () => (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
        single: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
        insert(values: Row) {
          inserts.push(values);
          return {
            select: () => ({
              maybeSingle: () =>
                Promise.resolve(insertError ? { data: null, error: insertError } : { data: { id: "e1" }, error: null }),
            }),
          };
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const LIVE: GhlConfig = {
  status: "live",
  available: true,
  env: { locationId: true, token: true },
  mayWrite: true,
  credentials: { locationId: "loc_1", token: "pit-secret" },
};
const OFF: GhlConfig = { status: "disabled", available: true, env: { locationId: true, token: true }, mayWrite: false };

const COMPANY = "comp-1";
const OWNER = "owner-1";

beforeEach(() => {
  tables = {
    profiles: [
      { id: OWNER, company_id: COMPANY, role: "owner", email: "Owner@Example.com", first_name: "Olive", last_name: "Owner" },
      { id: "member-1", company_id: COMPANY, role: "team_member", email: "m@example.com" },
    ],
    companies: [{ id: COMPANY, name: "Volcone Ltd" }],
  };
  inserts = [];
  insertError = null;
  queried = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const run = (over: Partial<Parameters<typeof enqueueInviteConsentEvent>[1]> = {}) =>
  enqueueInviteConsentEvent(makeDb(), {
    userId: OWNER,
    companyId: COMPANY,
    role: "owner",
    isAdmin: false,
    promotionalConsent: true,
    config: LIVE,
    ...over,
  });

describe("enqueueInviteConsentEvent", () => {
  it("tags a ticking owner 'communication', and never 'not paid'", async () => {
    expect(await run()).toEqual({ ok: true, outcome: "enqueued", tag: TAG_OPTED_COMMUNICATION });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      event_type: "consent",
      user_id: OWNER,
      contact_email: "owner@example.com",
      tags_add: [TAG_OPTED_COMMUNICATION],
      tags_remove: [],
      dedupe_key: inviteConsentDedupeKey(OWNER),
    });
    expect(inserts[0].tags_add).not.toContain(TAG_REGISTERED_NOT_PAID);
  });

  it("tags an unticking owner 'dnd'", async () => {
    expect(await run({ promotionalConsent: false })).toMatchObject({ tag: TAG_OPTED_DND });
    expect(inserts[0].tags_add).toEqual([TAG_OPTED_DND]);
  });

  it("never sends a team member or an admin (owner-only contacts)", async () => {
    expect(await run({ userId: "member-1", role: "team_member" })).toMatchObject({ reason: "not_owner" });
    expect(await run({ isAdmin: true })).toMatchObject({ reason: "not_owner" });
    expect(await run({ companyId: null })).toMatchObject({ reason: "not_owner" });
    expect(inserts).toHaveLength(0);
  });

  it("does no queries while the integration is off", async () => {
    expect(await run({ config: OFF })).toEqual({ ok: true, outcome: "skipped", reason: "integration_off" });
    expect(queried).toEqual([]);
  });

  it("reports migration 058 missing as unavailable, not an error", async () => {
    insertError = { code: "23514", message: "violates check constraint" };
    expect(await run()).toMatchObject({ ok: true, outcome: "skipped", reason: "unavailable" });
  });

  it("is once per person", () => {
    expect(inviteConsentDedupeKey(OWNER)).toBe("user:owner-1:invite_consent");
  });
});
