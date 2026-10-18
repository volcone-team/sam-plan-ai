import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  insertWithLibraryKey,
  pickTypeIdForChannel,
  resetLibraryKeyWarning,
  resolveInitiativeTypeId,
  typeInsertFor,
  type InitiativeTypeInsert,
  type InitiativeTypeStore,
} from "@/lib/workbook/initiative-type";
import { buildMetricSet } from "@/lib/metrics/metric-set";
import { parseMetricsCell } from "@/lib/metrics/parse-metrics";
import { resolveSuggestionInitiative, suggestionChannel } from "@/lib/initiatives/suggestion-initiative";

interface TypeRow { id: string; channel: string; is_active: boolean; created_at: string; name: string }

/** An in-memory initiative_types table with the store's semantics. */
function memoryStore(seed: TypeRow[] = []) {
  const rows = [...seed];
  let clock = 1000;
  const inserts: InitiativeTypeInsert[] = [];
  const store: InitiativeTypeStore = {
    async findOldestByChannel(channel) {
      return pickTypeIdForChannel(rows, channel);
    },
    async insert(row) {
      inserts.push(row);
      const id = `new-${inserts.length}`;
      rows.push({ id, channel: row.channel, is_active: row.is_active, name: row.name, created_at: `2026-10-${clock++}` });
      return id;
    },
  };
  return { store, rows, inserts };
}

const WEBINAR = { name: "Live Webinar", oneLiner: "Teach then pitch", difficulty: 2 };

describe("resolveInitiativeTypeId", () => {
  it("reuses an existing row whose channel is the library key", async () => {
    const { store, inserts } = memoryStore([
      { id: "t1", channel: "webinar", is_active: true, created_at: "2026-01-01", name: "Webinar" },
    ]);
    expect(await resolveInitiativeTypeId(store, "webinar", WEBINAR)).toBe("t1");
    expect(inserts).toHaveLength(0);
  });

  it("reuses an INACTIVE row and does not reactivate it", async () => {
    const { store, rows, inserts } = memoryStore([
      { id: "off", channel: "webinar", is_active: false, created_at: "2026-01-01", name: "Webinar" },
    ]);
    expect(await resolveInitiativeTypeId(store, "webinar", WEBINAR)).toBe("off");
    expect(inserts).toHaveLength(0);
    expect(rows[0].is_active).toBe(false);
  });

  it("picks the OLDEST of existing duplicates", async () => {
    const { store } = memoryStore([
      { id: "newer", channel: "webinar", is_active: true, created_at: "2026-05-01", name: "W" },
      { id: "oldest", channel: "webinar", is_active: false, created_at: "2026-01-01", name: "W" },
    ]);
    expect(await resolveInitiativeTypeId(store, "webinar", WEBINAR)).toBe("oldest");
  });

  it("creates exactly once when no row exists, then reuses it", async () => {
    const { store, inserts } = memoryStore();
    const first = await resolveInitiativeTypeId(store, "webinar", WEBINAR);
    const second = await resolveInitiativeTypeId(store, "webinar", WEBINAR);
    expect(first).toBe("new-1");
    expect(second).toBe(first);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ channel: "webinar", name: "Live Webinar", description: "Teach then pitch" });
  });

  it("does not match by name: a same-named type on another channel is not reused", async () => {
    const { store, inserts } = memoryStore([
      { id: "ops", channel: "webinar-ops", is_active: true, created_at: "2026-01-01", name: "Live Webinar" },
    ]);
    expect(await resolveInitiativeTypeId(store, "webinar-own", WEBINAR)).toBe("new-1");
    expect(inserts).toHaveLength(1);
  });

  it("uses the cache so a repeated key in one plan costs one lookup", async () => {
    const { store } = memoryStore();
    const spy = vi.spyOn(store, "findOldestByChannel");
    const cache = new Map<string, string>();
    await resolveInitiativeTypeId(store, "webinar", WEBINAR, cache);
    const calls = spy.mock.calls.length;
    await resolveInitiativeTypeId(store, "webinar", WEBINAR, cache);
    expect(spy.mock.calls.length).toBe(calls);
  });

  it("converges on the oldest row when a concurrent insert won the race", async () => {
    const { store, rows } = memoryStore();
    // Another request inserts the same channel between our lookup and insert.
    const realInsert = store.insert;
    store.insert = async (row) => {
      rows.push({ id: "theirs", channel: row.channel, is_active: true, name: row.name, created_at: "2026-01-01" });
      return realInsert(row);
    };
    expect(await resolveInitiativeTypeId(store, "webinar", WEBINAR)).toBe("theirs");
  });

  it("returns null for a blank key and on a failed insert", async () => {
    const { store } = memoryStore();
    expect(await resolveInitiativeTypeId(store, "  ", WEBINAR)).toBeNull();
    store.insert = async () => null;
    expect(await resolveInitiativeTypeId(store, "webinar", WEBINAR)).toBeNull();
  });
});

describe("typeInsertFor", () => {
  it("falls back to the key and a neutral difficulty without a library entry", () => {
    const row = typeInsertFor("webinar", null);
    expect(row).toMatchObject({ name: "Webinar", channel: "webinar", description: "", is_active: true });
    expect(row.difficulty.effortToImplement).toBe(3);
  });
  it("ignores an out-of-range difficulty", () => {
    expect(typeInsertFor("x", { name: "X", oneLiner: null, difficulty: 9 }).difficulty.costToRun).toBe(3);
  });
});

describe("insertWithLibraryKey", () => {
  beforeEach(() => resetLibraryKeyWarning());

  it("writes library_key when the column exists", async () => {
    const seen: Record<string, unknown>[] = [];
    const result = await insertWithLibraryKey({ name: "a" }, "webinar", async (row) => {
      seen.push(row);
      return { data: { id: "i1" }, error: null };
    });
    expect(result.data).toEqual({ id: "i1" });
    expect(seen).toEqual([{ name: "a", library_key: "webinar" }]);
  });

  it("retries without library_key when migration 040 is missing, warning once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const run = async (row: Record<string, unknown>) =>
      "library_key" in row
        ? { data: null, error: { code: "PGRST204", message: "Could not find the 'library_key' column of 'initiatives' in the schema cache" } }
        : { data: { id: "i1" }, error: null };
    expect((await insertWithLibraryKey({ name: "a" }, "webinar", run)).data).toEqual({ id: "i1" });
    expect((await insertWithLibraryKey({ name: "b" }, "webinar", run)).data).toEqual({ id: "i1" });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("omits the field for a null key and does not retry other errors", async () => {
    const seen: Record<string, unknown>[] = [];
    const run = async (row: Record<string, unknown>) => {
      seen.push(row);
      return { data: null, error: { code: "23503", message: "fk violation" } };
    };
    await insertWithLibraryKey({ name: "a" }, null, run);
    await insertWithLibraryKey({ name: "b" }, "webinar", run);
    expect(seen).toEqual([{ name: "a" }, { name: "b", library_key: "webinar" }]);
  });

  it("writes metric_set alongside, and drops both when a column is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const metricSet = buildMetricSet("webinar", parseMetricsCell("- Registrations\n- Attendees"));
    const seen: Record<string, unknown>[] = [];
    const run = async (row: Record<string, unknown>) => {
      seen.push(row);
      return "metric_set" in row
        ? { data: null, error: { code: "42703", message: "column \"metric_set\" does not exist" } }
        : { data: { id: "i1" }, error: null };
    };
    expect((await insertWithLibraryKey({ name: "a" }, "webinar", run, metricSet)).data).toEqual({ id: "i1" });
    expect(seen).toEqual([{ name: "a", library_key: "webinar", metric_set: metricSet }, { name: "a" }]);
    warn.mockRestore();
  });

  it("omits a null metric set", async () => {
    const seen: Record<string, unknown>[] = [];
    await insertWithLibraryKey({ name: "a" }, "webinar", async (row) => {
      seen.push(row);
      return { data: { id: "i1" }, error: null };
    }, null);
    expect(seen).toEqual([{ name: "a", library_key: "webinar" }]);
  });
});

describe("resolveSuggestionInitiative (accepted new_initiative suggestions)", () => {
  const WEBINAR_ENTRY = { ...WEBINAR, metrics: null, metricsRaw: "- Registrations\n- Attendees" };

  it("reads libraryKey, then channel, then 'custom'", () => {
    expect(suggestionChannel({ libraryKey: " webinar ", channel: "x" })).toBe("webinar");
    expect(suggestionChannel({ channel: "email" })).toBe("email");
    expect(suggestionChannel({ libraryKey: "" })).toBe("custom");
  });

  it("never falls back to an unrelated type: creates one for an unknown channel", async () => {
    const { store, inserts } = memoryStore([
      { id: "unrelated", channel: "podcast", is_active: true, created_at: "2025-01-01", name: "Podcast" },
    ]);
    const m = await resolveSuggestionInitiative(store, "webinar", WEBINAR_ENTRY);
    expect(m.typeId).toBe("new-1");
    expect(inserts[0]).toMatchObject({ channel: "webinar", name: "Live Webinar", description: "Teach then pitch" });
    expect(m.libraryKey).toBe("webinar");
    expect(m.metricSet?.groups[0].metrics.map((x) => x.key)).toEqual(["registrations", "attendees", "show_up_rate"]);
  });

  it("reuses the oldest (even inactive) row and writes no library key or metric set off-library", async () => {
    const { store, inserts } = memoryStore([
      { id: "newer", channel: "webinar", is_active: true, created_at: "2026-05-01", name: "W" },
      { id: "old-off", channel: "webinar", is_active: false, created_at: "2026-01-01", name: "W" },
    ]);
    expect((await resolveSuggestionInitiative(store, "webinar", WEBINAR_ENTRY)).typeId).toBe("old-off");
    const legacy = await resolveSuggestionInitiative(store, "webinar", null);
    expect(legacy).toEqual({ typeId: "old-off", libraryKey: null, metricSet: null });
    expect(inserts).toHaveLength(0);
  });
});
