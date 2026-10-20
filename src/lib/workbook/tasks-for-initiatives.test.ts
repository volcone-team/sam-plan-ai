import { describe, it, expect, vi } from "vitest";
import {
  resolveTasks,
  resolveTaskTemplates,
  runwayForUntemplated,
  type TaskGenerator,
} from "@/lib/workbook/tasks-for-initiatives";
import { STARTER_RUNWAY_DAYS, STARTER_TASK_COUNT } from "@/lib/workbook/starter-template";
import { fakeSupabase, type Row } from "@/lib/workbook/fake-supabase.test-helper";

const EVENT = "2026-12-01";
const FLOOR = "2026-09-27";

const lib = (key: string, name: string, over: Row = {}): Row => ({
  initiative_key: key, workbook_id: "IN01", name, category: "Campaigns", difficulty: 3,
  speed_to_results: "Medium", one_liner: `${name} in one line`, own_or_ops: "OWN",
  price_tier: "Mid", needs_sales_team: "NO", base_key: null, speed_score: 4, cost_score: 3,
  odds_score: 3, revenue_score: 4, ease_score: 3, score_total: 17, ideal_industries: [],
  cta_options: [], training: [], metrics_raw: "- Opens", metrics: [], display_order: 0, ...over,
});

const tpl = (key: string, name: string, order: number, over: Row = {}): Row => ({
  initiative_key: key, task_number: order + 1, name, category: "Build", lead_days: 30 - order * 5,
  duration_hours: 2, role: "Owner", depends_on: order === 0 ? [] : [order], notes: null,
  display_order: order, ...over,
});

/** webinar has a 5-task authored template; the other two have none. */
const tables = (): Record<string, Row[]> => ({
  wb_initiative_library: [
    lib("webinar", "Live Webinar"),
    lib("past-buyer-reactivation", "Past-Buyer Reactivation Campaign"),
    lib("event-sponsorship", "Event Sponsorship & Exhibitor Sales"),
  ],
  wb_task_templates: [0, 1, 2, 3, 4].map((i) => tpl("webinar", `Webinar step ${i + 1}`, i)),
  wb_ai_context: [
    {
      initiative_key: "past-buyer-reactivation", when_to_use: "When you have past customers",
      best_fit: null, min_budget: null, min_assets: "A list of past buyers",
      why_it_works: "They already bought", what_to_avoid: "Do not blast everyone",
      sequencing_notes: null,
    },
  ],
});

/** AI task list of `n` tasks for one key. */
const aiList = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `AI step ${i + 1}`,
    description: "Do it well",
    daysBeforeEvent: (n - i) * 4,
    estimatedHours: 3,
    role: "Marketing",
    dependsOn: i === 0 ? [] : [i],
  }));

/** A generator returning the given per-key lists as model text. */
const generatorFor = (byKey: Record<string, unknown>, extra: Partial<{ error: string }> = {}) =>
  vi.fn(async () => ({
    text: JSON.stringify(byKey),
    model: "claude-test",
    tokensInput: 1200,
    tokensOutput: 800,
    durationMs: 42,
    ...extra,
  })) as unknown as TaskGenerator & { mock: { calls: unknown[] } };

describe("resolveTaskTemplates", () => {
  it("prefers the workbook's authored template", async () => {
    const db = fakeSupabase({ tables: tables() });
    const generate = generatorFor({});
    const out = await resolveTaskTemplates(db.client, ["webinar"], { generate });

    expect(out.get("webinar")?.source).toBe("template");
    expect(out.get("webinar")?.templates.map((t) => t.name)).toEqual([
      "Webinar step 1", "Webinar step 2", "Webinar step 3", "Webinar step 4", "Webinar step 5",
    ]);
    // Templated keys never reach the AI.
    expect(generate).not.toHaveBeenCalled();
  });

  it("uses AI tasks for a key the workbook has no template for", async () => {
    const db = fakeSupabase({ tables: tables() });
    const generate = generatorFor({ "past-buyer-reactivation": aiList(9) });
    const out = await resolveTaskTemplates(db.client, ["past-buyer-reactivation"], { generate });

    expect(out.get("past-buyer-reactivation")?.source).toBe("ai");
    expect(out.get("past-buyer-reactivation")?.templates).toHaveLength(9);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("asks for every untemplated key in ONE batched call", async () => {
    const db = fakeSupabase({ tables: tables() });
    const generate = generatorFor({
      "past-buyer-reactivation": aiList(8),
      "event-sponsorship": aiList(8),
    });
    const out = await resolveTaskTemplates(
      db.client,
      ["webinar", "past-buyer-reactivation", "event-sponsorship", "past-buyer-reactivation"],
      { generate }
    );

    expect(generate).toHaveBeenCalledTimes(1);
    const args = (generate as unknown as { mock: { calls: [{ keys: string[] }][] } }).mock.calls[0][0];
    expect([...args.keys].sort()).toEqual(["event-sponsorship", "past-buyer-reactivation"]);
    expect([...out.keys()].sort()).toEqual([
      "event-sponsorship", "past-buyer-reactivation", "webinar",
    ]);
  });

  it("gives the model the library row and its AI context", async () => {
    const db = fakeSupabase({ tables: tables() });
    const generate = generatorFor({});
    await resolveTaskTemplates(db.client, ["past-buyer-reactivation"], { generate });

    const args = (generate as unknown as {
      mock: { calls: [{ library: Map<string, { name: string }>; context: Map<string, { minAssets: string | null }>; examples: unknown[][] }][] };
    }).mock.calls[0][0];
    expect(args.library.get("past-buyer-reactivation")?.name).toBe(
      "Past-Buyer Reactivation Campaign"
    );
    expect(args.context.get("past-buyer-reactivation")?.minAssets).toBe("A list of past buyers");
    // One real authored template rides along as a format example.
    expect(args.examples).toHaveLength(1);
    expect(args.examples[0]).toHaveLength(5);
  });

  it("falls back to the starter template when the AI fails", async () => {
    const db = fakeSupabase({ tables: tables() });
    const generate = vi.fn(async () => ({ text: null, error: "timeout" })) as unknown as TaskGenerator;
    const out = await resolveTaskTemplates(db.client, ["event-sponsorship"], { generate });

    const entry = out.get("event-sponsorship");
    expect(entry?.source).toBe("starter");
    expect(entry?.templates).toHaveLength(STARTER_TASK_COUNT);
    // Lightly tailored with the library row's name.
    expect(entry?.templates[4].name).toBe("Run Event Sponsorship & Exhibitor Sales");
  });

  it("falls back to the starter when the generator throws", async () => {
    const db = fakeSupabase({ tables: tables() });
    const generate = vi.fn(async () => {
      throw new Error("socket hang up");
    }) as unknown as TaskGenerator;
    const out = await resolveTaskTemplates(db.client, ["event-sponsorship"], { generate });
    expect(out.get("event-sponsorship")?.source).toBe("starter");
  });

  it("falls back per key on a partial AI response", async () => {
    const db = fakeSupabase({ tables: tables() });
    const generate = generatorFor({
      "past-buyer-reactivation": aiList(10),
      "event-sponsorship": aiList(1), // too short to be a plan
    });
    const out = await resolveTaskTemplates(
      db.client,
      ["past-buyer-reactivation", "event-sponsorship"],
      { generate }
    );

    expect(out.get("past-buyer-reactivation")?.source).toBe("ai");
    expect(out.get("event-sponsorship")?.source).toBe("starter");
  });

  it("ignores AI output for keys that were not requested", async () => {
    const db = fakeSupabase({ tables: tables() });
    const generate = generatorFor({ webinar: aiList(9), "made-up-key": aiList(9) });
    const out = await resolveTaskTemplates(db.client, ["event-sponsorship"], { generate });

    expect([...out.keys()]).toEqual(["event-sponsorship"]);
    expect(out.get("event-sponsorship")?.source).toBe("starter");
  });

  it("never leaves a requested key without tasks", async () => {
    const db = fakeSupabase({ tables: tables() });
    const generate = generatorFor({});
    const keys = ["webinar", "past-buyer-reactivation", "event-sponsorship", "not-in-library"];
    const out = await resolveTaskTemplates(db.client, keys, { generate });

    for (const key of keys) {
      expect(out.get(key)?.templates.length ?? 0).toBeGreaterThan(0);
    }
    // A key with no library row at all still gets the starter, named from the key.
    expect(out.get("not-in-library")?.source).toBe("starter");
    expect(out.get("not-in-library")?.templates[4].name).toBe("Run not-in-library");
  });

  it("asks for nothing when there are no keys", async () => {
    const db = fakeSupabase({ tables: tables() });
    const generate = generatorFor({});
    expect((await resolveTaskTemplates(db.client, [], { generate })).size).toBe(0);
    expect((await resolveTaskTemplates(db.client, ["", "  "], { generate })).size).toBe(1);
    expect(generate).toHaveBeenCalledTimes(1); // only for "  "
  });
});

describe("resolveTasks", () => {
  it("materialises dated tasks with ids and dependencies, keyed by library key", async () => {
    const db = fakeSupabase({ tables: tables() });
    let n = 0;
    const out = await resolveTasks(
      db.client,
      [{ libraryKey: "webinar", eventDate: EVENT, floor: FLOOR }],
      { generate: generatorFor({}), newId: () => `t-${++n}` }
    );

    const entry = out.get("webinar");
    expect(entry?.source).toBe("template");
    expect(entry?.tasks).toHaveLength(5);
    expect(entry?.tasks[0].dueDate).toBe("2026-11-01"); // 30 days before the event
    expect(entry?.tasks[1].dependencyIds).toEqual([entry?.tasks[0].id]);
    for (const t of entry!.tasks) expect(t.dueDate >= FLOOR).toBe(true);
  });

  it("dates AI and starter tasks by the same rules", async () => {
    const db = fakeSupabase({ tables: tables() });
    const out = await resolveTasks(
      db.client,
      [
        { libraryKey: "past-buyer-reactivation", eventDate: EVENT, floor: FLOOR },
        { libraryKey: "event-sponsorship", eventDate: EVENT, floor: FLOOR },
      ],
      { generate: generatorFor({ "past-buyer-reactivation": aiList(8) }) }
    );

    expect(out.get("past-buyer-reactivation")?.source).toBe("ai");
    expect(out.get("event-sponsorship")?.source).toBe("starter");
    for (const entry of out.values()) {
      expect(entry.tasks.length).toBeGreaterThanOrEqual(6);
      for (const t of entry.tasks) {
        expect(t.dueDate >= FLOOR).toBe(true);
        expect(t.dueDate <= EVENT).toBe(true);
      }
    }
  });

  it("keeps one entry per key, using the first item's dates", async () => {
    const db = fakeSupabase({ tables: tables() });
    const out = await resolveTasks(
      db.client,
      [
        { libraryKey: "webinar", eventDate: EVENT, floor: FLOOR },
        { libraryKey: "webinar", eventDate: "2026-10-15", floor: FLOOR },
      ],
      { generate: generatorFor({}) }
    );
    expect(out.size).toBe(1);
    expect(out.get("webinar")?.tasks[0].dueDate).toBe("2026-11-01");
  });
});

describe("usage metering", () => {
  it("never charges the customer's AI allowance", async () => {
    const db = fakeSupabase({ tables: tables() });
    await resolveTaskTemplates(
      db.client,
      ["past-buyer-reactivation", "event-sponsorship"],
      {
        companyId: "company-1",
        userId: "user-1",
        generate: generatorFor({ "past-buyer-reactivation": aiList(8) }),
      }
    );

    // recordUsage meters through rpc("increment_usage"). Nothing here may.
    expect(db.rpcCalls).toEqual([]);
    expect(db.calls.filter((c) => c.table === "usage_counters")).toEqual([]);
  });

  it("logs the token spend as a task_generation event", async () => {
    const db = fakeSupabase({ tables: tables() });
    await resolveTaskTemplates(db.client, ["past-buyer-reactivation"], {
      companyId: "company-1",
      userId: "user-1",
      generate: generatorFor({ "past-buyer-reactivation": aiList(8) }),
    });

    const logged = db.calls.filter((c) => c.table === "generation_events" && c.op === "insert");
    expect(logged).toHaveLength(1);
    expect(logged[0].rows?.[0]).toMatchObject({
      company_id: "company-1",
      user_id: "user-1",
      event_type: "task_generation",
      status: "success",
      model: "claude-test",
      tokens_input: 1200,
      tokens_output: 800,
    });
    expect(db.rpcCalls).toEqual([]);
  });

  it("records a failed generation without failing the resolve", async () => {
    const db = fakeSupabase({ tables: tables() });
    const generate = vi.fn(async () => ({
      text: null, error: "Request timed out", model: "claude-test", durationMs: 30000,
    })) as unknown as TaskGenerator;

    const out = await resolveTaskTemplates(db.client, ["event-sponsorship"], {
      companyId: "company-1",
      generate,
    });

    expect(out.get("event-sponsorship")?.source).toBe("starter");
    const logged = db.calls.filter((c) => c.table === "generation_events");
    expect(logged[0].rows?.[0]).toMatchObject({
      event_type: "task_generation",
      status: "failed",
      error_message: "Request timed out",
    });
  });

  it("logs nothing when no company is given", async () => {
    const db = fakeSupabase({ tables: tables() });
    await resolveTaskTemplates(db.client, ["event-sponsorship"], { generate: generatorFor({}) });
    expect(db.calls.filter((c) => c.table === "generation_events")).toEqual([]);
  });
});

describe("runwayForUntemplated", () => {
  it("is the starter template's runway, so scheduling never waits on the AI", () => {
    expect(runwayForUntemplated()).toBe(STARTER_RUNWAY_DAYS);
  });
});
