import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPricingTable } from "./load-pricing-table";
import { sectionTotal } from "./pricing-table";

/* Answers each query chain by table. Every builder method chains; awaiting the
 * chain (or .maybeSingle()) resolves to the table's response. */
type Res = { data: unknown; error: unknown };
function makeDb(responses: Record<string, Res | (() => never)>): SupabaseClient {
  return {
    from(table: string) {
      const answer = () => {
        const r = responses[table];
        if (typeof r === "function") return r();
        return Promise.resolve(r ?? { data: [], error: null });
      };
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order"]) builder[m] = () => builder;
      builder.maybeSingle = answer;
      builder.then = (resolve: (v: Res) => unknown, reject: (e: unknown) => unknown) =>
        answer().then(resolve, reject);
      return builder;
    },
  } as unknown as SupabaseClient;
}

const OK: Record<string, Res> = {
  pricing_rows: {
    data: [
      { id: "r1", section: "included", label: "App", sublabel: null, value_cents: null, display_order: 10, is_active: true },
      { id: "r2", section: "bonus", label: "Call", sublabel: "", value_cents: "50000", display_order: 10, is_active: true },
    ],
    error: null,
  },
  pricing_row_plans: {
    data: [
      { row_id: "r1", plan_id: "s", included: true, value_cents: 30000 },
      { row_id: "r2", plan_id: "s", included: true, value_cents: null },
    ],
    error: null,
  },
  subscription_plans: {
    data: [{ id: "s", name: "Starter", monthly_price: "49", annual_price: 490, compare_at_monthly_cents: 9900, price_label: "Founding Price", display_order: 1 }],
    error: null,
  },
  app_settings: {
    data: { pricing_annual_note: "2 months free", pricing_annual_note_value_cents: 250000 },
    error: null,
  },
};

describe("loadPricingTable", () => {
  afterEach(() => vi.restoreAllMocks());

  it("builds the table and the annual note", async () => {
    const result = await loadPricingTable(makeDb(OK));
    expect(result).not.toBeNull();
    expect(result!.annualNote).toBe("2 months free");
    expect(result!.annualNoteValueCents).toBe(250000);
    expect(result!.table.plans[0]).toMatchObject({ monthly_price: 49, compare_at_monthly_cents: 9900 });
    const [included, bonus] = result!.table.sections;
    expect(sectionTotal(included, "s")).toBe(30000);
    expect(sectionTotal(bonus, "s")).toBe(50000);
    expect(bonus.rows[0].sublabel).toBeNull();
  });

  it("returns null when the 050 tables are missing", async () => {
    const db = makeDb({
      ...OK,
      pricing_rows: { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.pricing_rows' in the schema cache" } },
    });
    expect(await loadPricingTable(db)).toBeNull();
  });

  it("returns null when the 050 columns are missing", async () => {
    const db = makeDb({
      ...OK,
      subscription_plans: { data: null, error: { code: "42703", message: "column subscription_plans.compare_at_monthly_cents does not exist" } },
    });
    expect(await loadPricingTable(db)).toBeNull();
    const db2 = makeDb({
      ...OK,
      app_settings: { data: null, error: { message: "column app_settings.pricing_annual_note does not exist" } },
    });
    expect(await loadPricingTable(db2)).toBeNull();
  });

  it("returns null, never throws, on other errors and on a thrown client", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await loadPricingTable(makeDb({ ...OK, pricing_row_plans: { data: null, error: { code: "500", message: "boom" } } }))
    ).toBeNull();
    expect(
      await loadPricingTable(
        makeDb({
          ...OK,
          pricing_rows: () => {
            throw new Error("network");
          },
        })
      )
    ).toBeNull();
    expect(spy).toHaveBeenCalled();
  });

  it("returns null when there are no active rows", async () => {
    expect(await loadPricingTable(makeDb({ ...OK, pricing_rows: { data: [], error: null } }))).toBeNull();
  });
});
