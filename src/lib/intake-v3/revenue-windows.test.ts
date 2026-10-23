import { describe, it, expect } from "vitest";
import { addDays, parseDateOnly, toDateOnly } from "../plan-dates";
import type { ResolvedRevenueLine, RevenueLineOutcome } from "./revenue";
import { resolveRevenueLines } from "./revenue";
import {
  distributeRevenueLines,
  distributeWindow,
  mondayOf,
  splitCents,
  type RevenueBucket,
  type WindowDistribution,
} from "./revenue-windows";

// Calendar anchors used below: 2026-06-01 is a Monday, 2026-05-31 a Sunday.

const win = (opens: string, closes: string) => ({ opens: { date: opens }, closes: { date: closes } });

function distributed(d: WindowDistribution) {
  if (d.status !== "distributed") throw new Error(`expected distributed, got ${d.reason}`);
  return d;
}

function weeklyOf(d: WindowDistribution): RevenueBucket[] {
  const x = distributed(d);
  if (x.weekly.status !== "available") throw new Error("weekly excluded");
  return x.weekly.buckets;
}

const keys = (b: RevenueBucket[]) => b.map((x) => [x.key, x.cents]);
const sumCents = (b: RevenueBucket[]) => b.reduce((s, x) => s + x.cents, 0);

describe("distributeWindow", () => {
  it("puts a one-day window entirely on that day", () => {
    const d = distributed(distributeWindow(250, win("2026-06-03", "2026-06-03")));
    expect(d.days).toBe(1);
    expect(keys(weeklyOf(d))).toEqual([["2026-06-01", 25000]]);
    expect(keys(d.monthly)).toEqual([["2026-06", 25000]]);
  });

  it("splits by day across a week boundary", () => {
    // Fri 5th-Sun 7th in the week of Mon 1st; Mon 8th-Wed 10th in the next.
    const d = distributeWindow(100, win("2026-06-05", "2026-06-10"));
    expect(keys(weeklyOf(d))).toEqual([
      ["2026-06-01", 5000],
      ["2026-06-08", 5000],
    ]);
  });

  it("splits by day across a month boundary", () => {
    const d = distributed(distributeWindow(100, win("2026-05-30", "2026-06-02")));
    expect(keys(d.monthly)).toEqual([
      ["2026-05", 5000],
      ["2026-06", 5000],
    ]);
    expect(keys(weeklyOf(d))).toEqual([
      ["2026-05-25", 5000],
      ["2026-06-01", 5000],
    ]);
  });

  it("gives the leftover cent by largest remainder", () => {
    // $100 over Sat, Sun, Mon: 66.666... and 33.333... -> 66.67 + 33.33.
    const d = distributeWindow(100, win("2026-06-06", "2026-06-08"));
    expect(keys(weeklyOf(d))).toEqual([
      ["2026-06-01", 6667],
      ["2026-06-08", 3333],
    ]);
    expect(splitCents(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it("keys weeks on Mondays", () => {
    const d = distributeWindow(1234.56, win("2026-01-01", "2026-12-31"));
    const weeks = weeklyOf(d);
    expect(weeks.length).toBe(53);
    for (const w of weeks) expect(parseDateOnly(w.key).getDay()).toBe(1);
    expect(weeks[0].key).toBe("2025-12-29");
    expect(mondayOf("2026-06-07")).toBe("2026-06-01"); // Sunday -> previous Monday
    expect(mondayOf("2026-06-01")).toBe("2026-06-01");
  });

  it("refuses an inverted window instead of swapping it", () => {
    const d = distributeWindow(100, win("2026-06-10", "2026-06-05"));
    expect(d.status).toBe("unresolved");
    if (d.status === "unresolved") expect(d.reason).toBe("window_inverted");
  });

  it("rejects bad amounts and impossible dates", () => {
    expect(distributeWindow(-1, win("2026-06-01", "2026-06-02")).status).toBe("unresolved");
    expect(distributeWindow(Number.NaN, win("2026-06-01", "2026-06-02")).status).toBe("unresolved");
    const d = distributeWindow(10, win("2026-02-31", "2026-03-02"));
    expect(d.status === "unresolved" && d.reason).toBe("invalid_date");
  });

  it("distributes a month-precision window monthly and excludes it from weekly", () => {
    const d = distributed(distributeWindow(610, win("2026-05", "2026-06")));
    expect(d.precision).toBe("month");
    expect([d.start, d.end, d.days]).toEqual(["2026-05-01", "2026-06-30", 61]);
    expect(keys(d.monthly)).toEqual([
      ["2026-05", 31000],
      ["2026-06", 30000],
    ]);
    expect(d.weekly.status).toBe("excluded");
    // An explicit precision flag on a full date means the same thing.
    const flagged = distributed(
      distributeWindow(610, { opens: { date: "2026-05-17", precision: "month" }, closes: { date: "2026-06" } })
    );
    expect(flagged.start).toBe("2026-05-01");
  });

  it("mixed precision: exact end kept, month end expanded, weekly excluded", () => {
    const d = distributed(distributeWindow(120, win("2026-05-20", "2026-05")));
    expect([d.start, d.end, d.days, d.precision]).toEqual(["2026-05-20", "2026-05-31", 12, "month"]);
    expect(keys(d.monthly)).toEqual([["2026-05", 12000]]);
    expect(d.weekly.status).toBe("excluded");

    const e = distributed(distributeWindow(100, win("2026-04", "2026-05-10")));
    expect([e.start, e.end]).toEqual(["2026-04-01", "2026-05-10"]);

    // Inverted only when no day of the named month could make it valid.
    const bad = distributeWindow(100, win("2026-06", "2026-05-20"));
    expect(bad.status === "unresolved" && bad.reason).toBe("window_inverted");
  });

  it("conserves money to the cent over many seeded random windows", () => {
    // mulberry32: a fixed seed makes any failure reproducible.
    let seed = 0x5a3c1d;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 2000; i++) {
      const start = addDays("2025-01-01", Math.floor(rand() * 1100));
      const len = 1 + Math.floor(rand() * 400);
      const opens = toDateOnly(start);
      const closes = toDateOnly(addDays(start, len - 1));
      // Mix whole dollars, cents, and unrounded price x units floats.
      const kind = i % 3;
      const target =
        kind === 0
          ? Math.floor(rand() * 1_000_000)
          : kind === 1
            ? Math.floor(rand() * 100_000_000) / 100
            : (rand() * 997.13) * Math.floor(1 + rand() * 50);
      const expected = Math.round(target * 100);

      const d = distributed(distributeWindow(target, win(opens, closes)));
      expect(d.days).toBe(len);
      expect(d.totalCents).toBe(expected);
      const weeks = weeklyOf(d);
      expect(sumCents(weeks)).toBe(expected);
      expect(sumCents(d.monthly)).toBe(expected);

      // Each bucket is within one cent of its exact pro-rata share.
      // Day counts per key are recounted independently of the module.
      const weekDays = new Map<string, number>();
      const monthDays = new Map<string, number>();
      for (let k = 0; k < len; k++) {
        const day = toDateOnly(addDays(opens, k));
        const wk = mondayOf(day);
        weekDays.set(wk, (weekDays.get(wk) ?? 0) + 1);
        monthDays.set(day.slice(0, 7), (monthDays.get(day.slice(0, 7)) ?? 0) + 1);
      }
      const check = (buckets: RevenueBucket[], counts: Map<string, number>) => {
        expect(buckets.length).toBe(counts.size);
        for (const b of buckets) {
          if (!Number.isInteger(b.cents) || b.cents < 0) throw new Error(`bad cents ${b.cents}`);
          const exact = (expected * (counts.get(b.key) ?? 0)) / len;
          if (Math.abs(b.cents - exact) >= 1) throw new Error(`${b.key}: ${b.cents} vs ${exact}`);
        }
      };
      check(weeks, weekDays);
      check(d.monthly, monthDays);
    }
  }, 30_000); // ~1s alone; headroom for a loaded full-suite run
});

describe("distributeRevenueLines", () => {
  const line = (id: string, target: number, opens: string, closes: string): ResolvedRevenueLine => ({
    status: "resolved",
    id,
    implicit: false,
    priceSource: "attrs.entry_price",
    price: target,
    units: 1,
    target,
    window: { opens: { name: "cart_opens", date: opens }, closes: { name: "cart_closes", date: closes } },
  });

  it("sums buckets across lines, lists unresolved lines and weekly exclusions", () => {
    const lines: RevenueLineOutcome[] = [
      line("main", 100, "2026-05-30", "2026-06-02"),
      line("vip", 40, "2026-06-01", "2026-06-02"),
      line("later", 300, "2026-06", "2026-06"),
      {
        status: "unresolved",
        id: "host",
        implicit: false,
        priceSource: "host_fee",
        reason: "missing_price",
        message: "No price for host_fee.",
      },
      line("typo", 10, "2026-06-10", "2026-06-01"),
    ];
    const r = distributeRevenueLines(lines);

    expect(keys(r.monthly)).toEqual([
      ["2026-05", 5000],
      ["2026-06", 5000 + 4000 + 30000],
    ]);
    expect(keys(r.weekly)).toEqual([
      ["2026-05-25", 5000],
      ["2026-06-01", 9000],
    ]);
    expect(r.monthlyCents).toBe(44000);
    expect(r.weeklyCents).toBe(14000);
    expect(sumCents(r.monthly)).toBe(r.monthlyCents);
    expect(sumCents(r.weekly)).toBe(r.weeklyCents);
    expect(r.excludedFromWeekly).toEqual(["later"]);
    expect(r.lines.map((l) => l.id)).toEqual(["main", "vip", "later"]);
    expect(r.skipped).toEqual([
      { id: "host", reason: "missing_price", message: "No price for host_fee." },
      expect.objectContaining({ id: "typo", reason: "window_inverted" }),
    ]);
  });

  it("works directly on resolveRevenueLines output", () => {
    const res = resolveRevenueLines([], {
      product: { price: 33.33 },
      activation_date: "2026-06-01",
      dates: { close_date: "2026-06-14" },
      units: { implicit: 7 },
    });
    const r = distributeRevenueLines(res.lines);
    expect(r.skipped).toEqual([]);
    expect(r.weeklyCents).toBe(Math.round(res.total * 100));
    expect(keys(r.weekly)).toEqual([
      ["2026-06-01", 11666],
      ["2026-06-08", 11665],
    ]);
  });
});
