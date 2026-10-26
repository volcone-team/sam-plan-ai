import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyPatch,
  configStatus,
  configToRow,
  isOfferedInIntakePicker,
  loadLibraryConfigs,
  mergeEffective,
  parseConfigPatch,
  pickerConfigs,
  reconcile,
  toRecordConfig,
  rowToConfig,
  saveLibraryConfig,
  seedLibraryConfigs,
  type ConfigRow,
  type PickerCandidate,
  type StoredConfig,
} from "./config-repo";
import {
  CONVERSION_PATHS,
  INITIATIVE_KINDS,
  RECURRENCE_FREQUENCIES,
} from "./library-config";

/* ── In-memory Supabase fake ──────────────────────────────────────────────────
 * Same spirit as src/lib/ghl/outbox.test.ts: a hand-rolled chain that records
 * writes. Supports exactly what config-repo uses: select/order/eq/maybeSingle
 * and upsert (merge, or ON CONFLICT DO NOTHING with ignoreDuplicates) + select.
 */
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let readErrors: Record<string, { message: string } | undefined>;
let upserts: { table: string; rows: Row[]; ignoreDuplicates: boolean }[];

function makeDb(): SupabaseClient {
  return {
    from(table: string) {
      const rows = () => (tables[table] ??= []);
      return {
        select() {
          let filter: ((r: Row) => boolean) | null = null;
          const result = () =>
            readErrors[table]
              ? { data: null, error: readErrors[table] }
              : { data: rows().filter((r) => !filter || filter(r)).map((r) => ({ ...r })), error: null };
          const builder = {
            order: () => builder,
            eq(col: string, val: unknown) {
              filter = (r) => r[col] === val;
              return builder;
            },
            maybeSingle: () => {
              const r = result();
              return Promise.resolve(r.error ? r : { data: r.data![0] ?? null, error: null });
            },
            then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
              Promise.resolve(result()).then(res, rej),
          };
          return builder;
        },
        upsert(values: Row | Row[], opts: { onConflict: string; ignoreDuplicates?: boolean }) {
          const list = Array.isArray(values) ? values : [values];
          const ignore = !!opts.ignoreDuplicates;
          upserts.push({ table, rows: list, ignoreDuplicates: ignore });
          const inserted: Row[] = [];
          for (const v of list) {
            const i = rows().findIndex((r) => r[opts.onConflict] === v[opts.onConflict]);
            if (i === -1) {
              rows().push({ is_launch: false, ...v });
              inserted.push(v);
            } else if (!ignore) {
              rows()[i] = { ...rows()[i], ...v };
              inserted.push(v);
            }
          }
          const done = { data: null, error: null };
          return {
            select: () => Promise.resolve({ data: inserted.map((r) => ({ ...r })), error: null }),
            then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
              Promise.resolve(done).then(res, rej),
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

const throwingDb = {
  from() {
    throw new Error("boom");
  },
} as unknown as SupabaseClient;

/* ── Library fixtures ────────────────────────────────────────────────────── */
const STAGE = {
  initiative_key: "speaking-gig",
  workbook_id: "IN20",
  name: "Speaking Gig",
  category: "Other People's Stages - In-Person Events",
  own_or_ops: "OPS",
  cta_options: ["Offer", "Speaker Fee"],
};
const WEBINAR = {
  initiative_key: "webinar",
  workbook_id: "IN01",
  name: "Live Webinar",
  category: "Webinars",
  own_or_ops: "OWN",
  cta_options: ["Offer", "Drive to Calls"],
};
const HYBRID = {
  initiative_key: "hybrid-events",
  workbook_id: "IN15",
  name: "Hybrid Events",
  category: "Other People's Stages - Virtual Events",
  own_or_ops: "OPS",
  cta_options: ["Offer"],
};

const ADMIN = "admin-1";

const fullRow = (over: Partial<ConfigRow> = {}): ConfigRow => ({
  initiative_key: "speaking-gig",
  category_id: "other-peoples-stages-in-person",
  allowed_kinds: ["one-time"],
  allowed_paths: ["offer", "speaker-fee"],
  allowed_frequencies: [],
  audience_source: "borrowed",
  format_override: null,
  ongoing_label: null,
  partner_host: true,
  partner_booking: false,
  revenue_lines: [{ id: "main", priceSource: "host_fee", windowOpens: "event_date", windowCloses: "contract_terms" }],
  field_extras: [],
  ...over,
});

beforeEach(() => {
  tables = {
    wb_initiative_library: [{ ...STAGE }, { ...WEBINAR }, { ...HYBRID }],
    initiative_library_config: [],
    initiative_settings: [],
  };
  readErrors = {};
  upserts = [];
});

/* ── Mappers ─────────────────────────────────────────────────────────────── */
describe("rowToConfig / configToRow", () => {
  it("round-trips a full row", () => {
    const row = fullRow();
    expect(configToRow(rowToConfig(row))).toEqual(row);
  });

  it("keeps NULL arrays unset, never []", () => {
    const config = rowToConfig(fullRow({ allowed_kinds: null, allowed_paths: null, allowed_frequencies: null }));
    expect("allowedKinds" in config).toBe(false);
    expect("allowedPaths" in config).toBe(false);
    expect("allowedFrequencies" in config).toBe(false);
    const back = configToRow(config);
    expect(back.allowed_kinds).toBeNull();
    expect(back.allowed_paths).toBeNull();
    expect(back.allowed_frequencies).toBeNull();
  });

  it("keeps [] distinct from NULL", () => {
    const config = rowToConfig(fullRow({ allowed_kinds: [] }));
    expect(config.allowedKinds).toEqual([]);
    expect(configToRow(config).allowed_kinds).toEqual([]);
  });

  it("maps partner_host/partner_booking to partnerBlock and back", () => {
    const config = rowToConfig(fullRow({ partner_host: false, partner_booking: true }));
    expect(config.partnerBlock).toEqual({ host: false, booking: true });
    expect(configToRow(config)).toMatchObject({ partner_host: false, partner_booking: true });
  });

  it("never emits is_launch", () => {
    expect("is_launch" in configToRow(rowToConfig(fullRow()))).toBe(false);
  });

  it("round-trips randomly generated rows (any subset of NULL/[]/values)", () => {
    // A small seeded generator rather than a PBT library (none is installed).
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = <T>(vocab: readonly T[]): T[] | null => {
      const r = rand();
      if (r < 0.25) return null;
      if (r < 0.4) return [];
      return vocab.filter(() => rand() < 0.5);
    };
    for (let i = 0; i < 200; i++) {
      const row = fullRow({
        allowed_kinds: pick(INITIATIVE_KINDS),
        allowed_paths: pick(CONVERSION_PATHS),
        allowed_frequencies: pick(RECURRENCE_FREQUENCIES),
        audience_source: rand() < 0.3 ? null : rand() < 0.5 ? "own" : "borrowed",
        category_id: rand() < 0.3 ? null : "webinars",
        format_override: rand() < 0.5 ? null : "hybrid",
        ongoing_label: rand() < 0.5 ? null : "Evergreen",
        partner_host: rand() < 0.5,
        partner_booking: rand() < 0.5,
      });
      expect(configToRow(rowToConfig(row))).toEqual(row);
    }
  });
});

/* ── Effective config ────────────────────────────────────────────────────── */
describe("mergeEffective", () => {
  const derived: StoredConfig = {
    initiativeKey: "k",
    categoryId: "webinars",
    audienceSource: "own",
    allowedPaths: ["offer"],
    formatOverride: "hybrid",
    partnerBlock: { host: true, booking: true },
  };

  it("saved wins over derived per field; unset fields fall back or stay unset", () => {
    const saved: StoredConfig = { initiativeKey: "k", allowedPaths: ["calls"], allowedKinds: ["one-time"] };
    const { effective, sources } = mergeEffective("k", saved, derived);
    expect(effective.allowedPaths).toEqual(["calls"]);
    expect(sources.allowedPaths).toBe("saved");
    expect(effective.categoryId).toBe("webinars");
    expect(sources.categoryId).toBe("derived");
    expect(sources.allowedKinds).toBe("saved");
    expect(sources.allowedFrequencies).toBe("unset");
  });

  it("with no saved row, derived fills everything it can", () => {
    const { effective, sources } = mergeEffective("k", null, derived);
    expect(effective.formatOverride).toBe("hybrid");
    expect(sources.formatOverride).toBe("derived");
    expect(sources.allowedKinds).toBe("unset");
  });

  it("an existing row's empty optional field is authoritative (derived override does not come back)", () => {
    const { effective, sources } = mergeEffective("k", { initiativeKey: "k" }, derived);
    expect(effective.formatOverride).toBeUndefined();
    expect(sources.formatOverride).toBe("saved");
  });

  it("the workbook date flags always come from derived, saved row or not, and have no source entry", () => {
    const flagged: StoredConfig = { ...derived, askStartDate: false, askEventDate: true };
    for (const saved of [null, { initiativeKey: "k" }, { initiativeKey: "k", askStartDate: true } as StoredConfig]) {
      const { effective, sources } = mergeEffective("k", saved, flagged);
      expect(effective.askStartDate).toBe(false);
      expect(effective.askEventDate).toBe(true);
      expect(sources).not.toHaveProperty("askStartDate");
    }
    // Unset in derived stays unset (= ask).
    const { effective } = mergeEffective("k", { initiativeKey: "k", askEventDate: false } as StoredConfig, derived);
    expect(effective).not.toHaveProperty("askStartDate");
    expect(effective).not.toHaveProperty("askEventDate");
  });
});

describe("configStatus", () => {
  it("incomplete lists the missing required fields and skips validation", () => {
    const status = configStatus(rowToConfig(fullRow({ allowed_kinds: null, allowed_paths: ["leads"], audience_source: "own" })));
    expect(status).toEqual({ status: "incomplete", missing: ["allowedKinds"] });
  });

  it("invalid when complete and the validator refuses", () => {
    // Was leads on an own audience; that rule is gone (owner's designs offer
    // leads on own-audience categories), so speaker fee off a stage stands in.
    const status = configStatus(rowToConfig(fullRow({ category_id: "webinars", audience_source: "own", allowed_paths: ["speaker-fee"] })));
    expect(status.status).toBe("invalid");
    if (status.status === "invalid") {
      expect(status.problems.map((p) => p.code)).toContain("speaker_fee_off_stage");
    }
  });

  it("valid when complete and coherent", () => {
    expect(configStatus(rowToConfig(fullRow()))).toEqual({ status: "valid" });
  });
});

describe("parseConfigPatch / applyPatch", () => {
  it("rejects unknown fields, isLaunch, bad vocab and non-objects", () => {
    expect(parseConfigPatch(null).ok).toBe(false);
    expect(parseConfigPatch({}).ok).toBe(false);
    expect(parseConfigPatch({ isLaunch: true }).ok).toBe(false);
    expect(parseConfigPatch({ allowedKinds: ["forever"] }).ok).toBe(false);
    expect(parseConfigPatch({ categoryId: "nope" }).ok).toBe(false);
    expect(parseConfigPatch({ revenueLines: [{ id: "x" }] }).ok).toBe(false);
  });

  it("refuses the workbook-only date flags: no admin input for them", () => {
    expect(parseConfigPatch({ askStartDate: false })).toEqual({ ok: false, errors: ['Unknown field "askStartDate".'] });
    expect(parseConfigPatch({ askEventDate: true }).ok).toBe(false);
  });

  it("configToRow never writes the date flags", () => {
    const row = configToRow({ ...rowToConfig(fullRow()), askStartDate: false, askEventDate: false });
    expect(Object.keys(row).some((k) => /date/i.test(k))).toBe(false);
  });

  it("keeps an extra's type, hint, binds and derives, and refuses bad ones", () => {
    const extra = { key: "pitch_day", label: "Pitch day", readBy: "cart", type: "date", hint: " h ", derives: "cart.opens" };
    const parsed = parseConfigPatch({ fieldExtras: [extra, { key: "c", label: "C", readBy: "r", type: "date", binds: "dates.close" }] });
    expect(parsed).toEqual({
      ok: true,
      patch: {
        fieldExtras: [
          { key: "pitch_day", label: "Pitch day", readBy: "cart", type: "date", hint: "h", derives: "cart.opens" },
          { key: "c", label: "C", readBy: "r", type: "date", binds: "dates.close" },
        ],
      },
    });
    expect(parseConfigPatch({ fieldExtras: [{ ...extra, type: "colour" }] }).ok).toBe(false);
    expect(parseConfigPatch({ fieldExtras: [{ ...extra, derives: "dates.event" }] }).ok).toBe(false);
    expect(parseConfigPatch({ fieldExtras: [{ ...extra, binds: "name" }] }).ok).toBe(false);
  });

  it("a seeded row's [] extras stay authoritative over derived type extras", () => {
    const derivedExtras: StoredConfig = {
      initiativeKey: "k",
      fieldExtras: [{ key: "pitch_day", label: "Pitch day", readBy: "cart", type: "date", derives: "cart.opens" }],
    };
    expect(mergeEffective("k", rowToConfig(fullRow()), derivedExtras).effective.fieldExtras).toEqual([]);
    expect(mergeEffective("k", null, derivedExtras).effective.fieldExtras).toEqual(derivedExtras.fieldExtras);
  });

  it("null clears a nullable field and resets a NOT NULL one to its default", () => {
    const base = rowToConfig(fullRow());
    const out = applyPatch(base, { allowedKinds: null, revenueLines: null, partnerBlock: null });
    expect("allowedKinds" in out).toBe(false);
    expect(out.revenueLines).toEqual([]);
    expect(out.partnerBlock).toEqual({ host: true, booking: true });
  });
});

describe("reconcile", () => {
  it("reports orphan config rows and library records with no row", () => {
    expect(reconcile(["a", "b"], ["b", "zombie"])).toEqual({
      orphanConfigKeys: ["zombie"],
      missingConfigKeys: ["a"],
    });
  });
});

/* ── Offered in the new intake picker ────────────────────────────────────── */
describe("isOfferedInIntakePicker", () => {
  const valid: PickerCandidate["validation"] = { status: "valid" };
  const invalid: PickerCandidate["validation"] = {
    status: "invalid",
    problems: [{ code: "no_kinds", field: "allowedKinds", message: "x" }],
  };
  const incomplete: PickerCandidate["validation"] = { status: "incomplete", missing: ["allowedKinds"] };
  const rec = (isActive: boolean, validation: PickerCandidate["validation"]): PickerCandidate => ({
    settings: { isActive },
    validation,
  });

  it("active + valid → offered", () => {
    expect(isOfferedInIntakePicker(rec(true, valid))).toBe(true);
  });

  it("active + incomplete → not offered", () => {
    expect(isOfferedInIntakePicker(rec(true, incomplete))).toBe(false);
  });

  it("active + invalid → not offered", () => {
    expect(isOfferedInIntakePicker(rec(true, invalid))).toBe(false);
  });

  it("inactive + valid → not offered", () => {
    expect(isOfferedInIntakePicker(rec(false, valid))).toBe(false);
  });
});

/* ── Configs sent with the picker ────────────────────────────────────────── */
describe("toRecordConfig / pickerConfigs", () => {
  it("maps a complete config to the contract shape, without categoryId", () => {
    const config = toRecordConfig(rowToConfig(fullRow()));
    expect(config).toEqual({
      initiativeKey: "speaking-gig",
      isLaunch: false,
      allowedKinds: ["one-time"],
      allowedPaths: ["offer", "speaker-fee"],
      audienceSource: "borrowed",
      allowedFrequencies: [],
      revenueLines: [{ id: "main", priceSource: "host_fee", windowOpens: "event_date", windowCloses: "contract_terms" }],
      fieldExtras: [],
      partnerBlock: { host: true, booking: false },
    });
  });

  it("is null for an incomplete config", () => {
    expect(toRecordConfig(rowToConfig(fullRow({ allowed_kinds: null })))).toBeNull();
  });

  it("carries the date flags when set, and omits them when unset", () => {
    const base = rowToConfig(fullRow());
    expect(toRecordConfig({ ...base, askStartDate: false, askEventDate: true })).toMatchObject({
      askStartDate: false, askEventDate: true,
    });
    const plain = toRecordConfig(base)!;
    expect(plain).not.toHaveProperty("askStartDate");
    expect(plain).not.toHaveProperty("askEventDate");
    const out = pickerConfigs([{ initiativeKey: "speaking-gig", effective: { ...base, askEventDate: false } }], ["speaking-gig"]);
    expect(out["speaking-gig"].askEventDate).toBe(false);
  });

  it("returns configs only for the offered keys", () => {
    const records = [
      { initiativeKey: "speaking-gig", effective: rowToConfig(fullRow()) },
      { initiativeKey: "other", effective: rowToConfig(fullRow({ initiative_key: "other" })) },
      { initiativeKey: "half", effective: rowToConfig(fullRow({ initiative_key: "half", allowed_paths: null })) },
    ];
    const out = pickerConfigs(records, ["speaking-gig", "half"]);
    expect(Object.keys(out)).toEqual(["speaking-gig"]);
    expect(out["speaking-gig"].initiativeKey).toBe("speaking-gig");
  });
});
/* ── Load ────────────────────────────────────────────────────────────────── */
describe("loadLibraryConfigs", () => {
  it("assembles every record with settings, sources, validation, summary and reconciliation", async () => {
    tables.initiative_library_config.push({ ...fullRow(), is_launch: true }, { ...fullRow({ initiative_key: "zombie" }) });
    tables.initiative_settings.push({ initiative_key: "hybrid-events", is_active: false, max_per_plan: 2 });

    const r = await loadLibraryConfigs(makeDb());
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const byKey = Object.fromEntries(r.records.map((x) => [x.initiativeKey, x]));
    expect(byKey["speaking-gig"].validation).toEqual({ status: "valid" });
    expect(byKey["speaking-gig"].sources.allowedKinds).toBe("saved");
    expect(byKey["speaking-gig"].settings).toEqual({ exists: false, isActive: true, maxPerPlan: null });
    expect(byKey.webinar.saved).toBeNull();
    expect(byKey.webinar.validation.status).toBe("incomplete");
    expect(byKey.webinar.sources.categoryId).toBe("derived");
    expect(byKey["hybrid-events"].settings).toEqual({ exists: true, isActive: false, maxPerPlan: 2 });
    expect(byKey["hybrid-events"].effective.formatOverride).toBe("hybrid");
    expect(byKey["hybrid-events"].category?.id).toBe("other-peoples-stages-virtual");

    expect(r.summary).toMatchObject({
      total: 3,
      withSavedRow: 1,
      complete: 1,
      valid: 1,
      invalid: 0,
      incomplete: 2,
      active: 2,
      offeredInPicker: 1,
    });
    expect(r.summary.needsHumanCounts.allowedKinds).toBe(2);
    expect(r.summary.needsHumanCounts.revenueLines).toBe(2);
    expect(r.reconciliation).toEqual({ orphanConfigKeys: ["zombie"], missingConfigKeys: ["webinar", "hybrid-events"] });
  });

  it("offeredInPicker counts only records that are both active and valid", async () => {
    // speaking-gig: valid but switched off; webinar: valid and active (missing
    // settings row); hybrid-events: active but incomplete.
    tables.initiative_library_config.push(
      { ...fullRow() },
      { ...fullRow({ initiative_key: "webinar", category_id: "webinars", audience_source: "own", allowed_paths: ["offer"], revenue_lines: [] }) }
    );
    tables.initiative_settings.push({ initiative_key: "speaking-gig", is_active: false, max_per_plan: null });

    const r = await loadLibraryConfigs(makeDb());
    if (!r.ok) throw new Error(r.error);
    const byKey = Object.fromEntries(r.records.map((x) => [x.initiativeKey, x]));
    expect(byKey["speaking-gig"].validation.status).toBe("valid");
    expect(byKey.webinar.validation.status).toBe("valid");
    expect(byKey["hybrid-events"].validation.status).toBe("incomplete");
    expect(r.summary).toMatchObject({ valid: 2, active: 2, offeredInPicker: 1 });
  });

  it("derives kinds/frequencies from the raw workbook cells under a saved row that leaves them NULL", async () => {
    Object.assign(tables.wb_initiative_library[1], {
      allowed_kinds_raw: "Once, Recurring",
      allowed_frequencies_raw: "Monthly, Quarterly",
    });
    // A seeded row as all 87 are today: kinds and frequencies never set.
    tables.initiative_library_config.push({
      ...fullRow({
        initiative_key: "webinar", category_id: "webinars", audience_source: "own",
        allowed_paths: ["offer"], allowed_kinds: null, allowed_frequencies: null, revenue_lines: [],
      }),
    });
    const r = await loadLibraryConfigs(makeDb());
    if (!r.ok) throw new Error(r.error);
    const webinar = r.records.find((x) => x.initiativeKey === "webinar")!;
    expect(webinar.effective.allowedKinds).toEqual(["one-time", "recurring"]);
    expect(webinar.effective.allowedFrequencies).toEqual(["monthly", "quarterly"]);
    expect(webinar.sources.allowedKinds).toBe("derived");
    expect(webinar.sources.allowedFrequencies).toBe("derived");
    expect(webinar.needsHuman).not.toContain("allowedKinds");
    expect(webinar.validation).toEqual({ status: "valid" });
  });

  it("before migration 051: re-selects without the raw columns and still loads", async () => {
    const base = makeDb();
    const selects: string[] = [];
    const db = {
      from(table: string) {
        const t = base.from(table);
        if (table !== "wb_initiative_library") return t;
        return {
          ...t,
          select(cols: string) {
            selects.push(cols);
            if (cols.includes("allowed_kinds_raw")) {
              const failed = Promise.resolve({ data: null, error: { code: "42703", message: "column wb_initiative_library.allowed_kinds_raw does not exist" } });
              const b = { order: () => b, eq: () => b, maybeSingle: () => failed, then: failed.then.bind(failed) };
              return b;
            }
            return t.select(cols);
          },
        };
      },
    } as unknown as SupabaseClient;

    const r = await loadLibraryConfigs(db);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.records).toHaveLength(3);
    // Everything, then without 054 (still has 051, refused again), then base.
    expect(selects).toHaveLength(3);
    expect(selects[1]).toContain("allowed_kinds_raw");
    expect(selects[1]).not.toContain("start_date_raw");
    expect(selects[2]).not.toContain("allowed_kinds_raw");
    expect(r.records.every((x) => x.effective.allowedKinds === undefined)).toBe(true);
  });

  it("before migration 054: re-selects without the date columns, keeps 051, and asks both dates", async () => {
    Object.assign(tables.wb_initiative_library[1], { allowed_kinds_raw: "Once", allowed_frequencies_raw: "n/a" });
    const base = makeDb();
    const selects: string[] = [];
    const db = {
      from(table: string) {
        const t = base.from(table);
        if (table !== "wb_initiative_library") return t;
        return {
          ...t,
          select(cols: string) {
            selects.push(cols);
            if (cols.includes("start_date_raw")) {
              const failed = Promise.resolve({ data: null, error: { code: "PGRST204", message: "Could not find the 'start_date_raw' column" } });
              const b = { order: () => b, eq: () => b, maybeSingle: () => failed, then: failed.then.bind(failed) };
              return b;
            }
            return t.select(cols);
          },
        };
      },
    } as unknown as SupabaseClient;

    const r = await loadLibraryConfigs(db);
    if (!r.ok) throw new Error(r.error);
    expect(selects).toHaveLength(2);
    expect(selects[1]).toContain("allowed_kinds_raw");
    expect(selects[1]).not.toContain("start_date_raw");
    const webinar = r.records.find((x) => x.initiativeKey === "webinar")!;
    expect(webinar.effective.allowedKinds).toEqual(["one-time"]);
    expect(r.records.every((x) => x.effective.askStartDate === undefined && x.effective.askEventDate === undefined)).toBe(true);
  });

  it("carries the workbook date flags onto the effective config even under a saved row", async () => {
    Object.assign(tables.wb_initiative_library[1], { start_date_raw: "No", event_date_raw: "Yes" });
    tables.initiative_library_config.push({
      ...fullRow({ initiative_key: "webinar", category_id: "webinars", audience_source: "own", allowed_paths: ["offer"], revenue_lines: [] }),
    });
    const r = await loadLibraryConfigs(makeDb());
    if (!r.ok) throw new Error(r.error);
    const webinar = r.records.find((x) => x.initiativeKey === "webinar")!;
    expect(webinar.saved).not.toBeNull();
    expect(webinar.saved).not.toHaveProperty("askStartDate");
    expect(webinar.effective).toMatchObject({ askStartDate: false, askEventDate: true });
    expect(webinar.validation).toEqual({ status: "valid" });
    // And through to what the picker sends the form.
    const configs = pickerConfigs(r.records, ["webinar"]);
    expect(configs.webinar).toMatchObject({ askStartDate: false, askEventDate: true });
  });

  it("reports a read error instead of throwing", async () => {
    readErrors.initiative_library_config = { message: "relation does not exist" };
    const r = await loadLibraryConfigs(makeDb());
    expect(r).toEqual({ ok: false, error: "initiative_library_config: relation does not exist" });
  });

  it("never throws on a throwing client", async () => {
    expect(await loadLibraryConfigs(throwingDb)).toEqual({ ok: false, error: "boom" });
  });
});

/* ── Save ────────────────────────────────────────────────────────────────── */
describe("saveLibraryConfig", () => {
  it("allows a partial (incomplete) save and writes updated_at/updated_by", async () => {
    const r = await saveLibraryConfig(makeDb(), "webinar", { allowedPaths: ["calls"] }, ADMIN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toBe(true);
    expect(r.validation.status).toBe("incomplete");
    const stored = tables.initiative_library_config[0];
    expect(stored).toMatchObject({
      initiative_key: "webinar",
      allowed_paths: ["calls"],
      allowed_kinds: null,
      category_id: "webinars",
      updated_by: ADMIN,
    });
    expect(typeof stored.updated_at).toBe("string");
    expect(upserts[0].rows[0]).not.toHaveProperty("is_launch");
  });

  it("refuses a complete but invalid config and writes nothing", async () => {
    const r = await saveLibraryConfig(
      makeDb(),
      "webinar",
      // Was ["leads"] (refused on an own audience); that rule is gone, so an
      // off-stage speaker fee is the invalid config now.
      { allowedKinds: ["one-time"], allowedFrequencies: [], allowedPaths: ["speaker-fee"] },
      ADMIN
    );
    expect(r.ok).toBe(false);
    if (r.ok || r.reason !== "invalid") throw new Error("expected invalid");
    expect(r.problems.map((p) => p.code)).toContain("speaker_fee_off_stage");
    expect(upserts).toHaveLength(0);
  });

  it("merges the patch over the saved row, keeping untouched fields", async () => {
    tables.initiative_library_config.push({ ...fullRow(), is_launch: true });
    const r = await saveLibraryConfig(makeDb(), "speaking-gig", { ongoingLabel: null, partnerBlock: { host: true, booking: true } }, ADMIN);
    expect(r.ok && r.created).toBe(false);
    expect(tables.initiative_library_config[0]).toMatchObject({
      allowed_kinds: ["one-time"],
      allowed_paths: ["offer", "speaker-fee"],
      partner_booking: true,
      is_launch: true, // untouched: never written
    });
  });

  it("400-class results for a bad key or patch, not_found for a key outside the library", async () => {
    expect(await saveLibraryConfig(makeDb(), "", { allowedKinds: [] }, ADMIN)).toMatchObject({ ok: false, reason: "bad_request" });
    expect(await saveLibraryConfig(makeDb(), "webinar", { bogus: 1 }, ADMIN)).toMatchObject({ ok: false, reason: "bad_request" });
    expect(await saveLibraryConfig(makeDb(), "zombie", { allowedKinds: ["one-time"] }, ADMIN)).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("never throws on a throwing client", async () => {
    expect(await saveLibraryConfig(throwingDb, "webinar", { allowedKinds: ["one-time"] }, ADMIN)).toEqual({
      ok: false,
      reason: "db_error",
      message: "boom",
    });
  });
});

/* ── Seed ────────────────────────────────────────────────────────────────── */
describe("seedLibraryConfigs", () => {
  it("creates a derived row for each missing record, never overwrites, and is idempotent", async () => {
    const existing = { ...fullRow(), is_launch: true, updated_by: "someone-else" };
    tables.initiative_library_config.push(existing);
    const db = makeDb();

    const first = await seedLibraryConfigs(db, ADMIN);
    expect(first).toEqual({ ok: true, created: 2, skipped: 1, createdKeys: ["webinar", "hybrid-events"] });
    expect(upserts[0].ignoreDuplicates).toBe(true);
    expect(tables.initiative_library_config[0]).toEqual(existing);

    const webinar = tables.initiative_library_config.find((r) => r.initiative_key === "webinar")!;
    expect(webinar).toMatchObject({
      category_id: "webinars",
      audience_source: "own",
      allowed_paths: ["offer", "calls"],
      allowed_kinds: null,
      allowed_frequencies: null,
      revenue_lines: [],
      updated_by: ADMIN,
    });
    // Uniform column list across the bulk insert.
    const keySets = new Set(upserts[0].rows.map((r) => Object.keys(r).sort().join(",")));
    expect(keySets.size).toBe(1);

    const second = await seedLibraryConfigs(db, ADMIN);
    expect(second).toEqual({ ok: true, created: 0, skipped: 3, createdKeys: [] });
    expect(upserts).toHaveLength(1);
  });

  it("counts only what the database inserted when a row appears mid-seed", async () => {
    // The row exists in the table but the pre-read misses it (simulated race):
    // ON CONFLICT DO NOTHING must still leave it alone and not count it.
    const db = makeDb();
    const realFrom = db.from.bind(db);
    let firstConfigRead = true;
    (db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      if (t === "initiative_library_config" && firstConfigRead) {
        firstConfigRead = false;
        tables.initiative_library_config.push({ ...fullRow({ initiative_key: "webinar" }), updated_by: "racer" });
        return { select: () => Promise.resolve({ data: [], error: null }) };
      }
      return realFrom(t);
    };
    const r = await seedLibraryConfigs(db, ADMIN);
    expect(r).toEqual({ ok: true, created: 2, skipped: 1, createdKeys: ["speaking-gig", "hybrid-events"] });
    expect(tables.initiative_library_config.find((x) => x.initiative_key === "webinar")!.updated_by).toBe("racer");
  });

  it("never throws on a throwing client", async () => {
    expect(await seedLibraryConfigs(throwingDb, ADMIN)).toEqual({ ok: false, error: "boom" });
  });
});
