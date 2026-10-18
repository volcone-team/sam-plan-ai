import { describe, it, expect } from "vitest";
import { loadCustomerLibrary } from "@/lib/library/customer-library";
import { fakeSupabase, type Row } from "@/lib/workbook/fake-supabase.test-helper";

const lib = (key: string, order: number, over: Row = {}): Row => ({
  initiative_key: key, workbook_id: null, name: key, category: "Webinars", difficulty: 2,
  speed_to_results: null, one_liner: null, needs_sales_team: "NO", price_tier: "Mid",
  own_or_ops: "OWN", display_order: order, ...over,
});

describe("loadCustomerLibrary (GET /api/library/initiatives)", () => {
  it("returns active initiatives only: explicitly disabled ones are left out, absent settings mean active", async () => {
    const db = fakeSupabase({
      tables: {
        wb_initiative_library: [lib("webinar", 0), lib("paid-ads", 1), lib("podcast", 2)],
        initiative_settings: [
          { initiative_key: "paid-ads", is_active: false },
          { initiative_key: "webinar", is_active: true },
          // podcast has no row: active.
        ],
      },
    });
    const items = await loadCustomerLibrary(db.client);
    expect(items.map((i) => i.key)).toEqual(["webinar", "podcast"]);
  });

  it("never sends admin-only fields", async () => {
    const db = fakeSupabase({ tables: { wb_initiative_library: [lib("webinar", 0)], initiative_settings: [] } });
    const [item] = await loadCustomerLibrary(db.client);
    expect(item).not.toHaveProperty("priceTier");
    expect(item).not.toHaveProperty("needsSalesTeam");
    expect(item).not.toHaveProperty("idealIndustries");
  });
});
