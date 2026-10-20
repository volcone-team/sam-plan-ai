import { describe, it, expect } from "vitest";
import {
  parseAiTaskBatch,
  parseJsonObject,
  validateAiTaskList,
  MAX_AI_LEAD_DAYS,
  MAX_AI_TASKS,
  MIN_AI_TASKS,
} from "@/lib/workbook/ai-tasks";
import { MAX_TASK_HOURS } from "@/lib/workbook/materialise";

/** A valid task list of `n` tasks, newest-first lead times. */
const list = (n: number, over: Record<string, unknown>[] = []) =>
  Array.from({ length: n }, (_, i) => ({
    name: `Task ${i + 1}`,
    description: `Do thing ${i + 1}`,
    daysBeforeEvent: (n - i) * 5,
    estimatedHours: 2,
    role: "Owner",
    dependsOn: i === 0 ? [] : [i],
    ...(over[i] ?? {}),
  }));

describe("parseJsonObject", () => {
  it("reads plain JSON, a fenced block, or JSON buried in prose", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonObject('Sure! {"a":1} hope that helps')).toEqual({ a: 1 });
  });

  it("is null for nothing usable", () => {
    expect(parseJsonObject("")).toBeNull();
    expect(parseJsonObject("no json here")).toBeNull();
    // A top-level array is not a keyed batch.
    expect(parseJsonObject("[1,2]")).toBeNull();
  });
});

describe("validateAiTaskList", () => {
  it("accepts a well-formed list and keeps its order", () => {
    const out = validateAiTaskList(list(8));
    expect(out).not.toBeNull();
    expect(out).toHaveLength(8);
    expect(out!.map((t) => t.displayOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(out!.map((t) => t.taskNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out![0].name).toBe("Task 1");
    expect(out![0].notes).toBe("Do thing 1");
    expect(out![0].role).toBe("Owner");
  });

  it("rejects anything that is not an array", () => {
    for (const junk of [null, undefined, {}, "tasks", 7]) {
      expect(validateAiTaskList(junk)).toBeNull();
    }
  });

  it("drops malformed tasks", () => {
    const out = validateAiTaskList([
      ...list(4),
      { description: "no name" },
      { name: "   " },
      "a string",
      null,
      42,
    ]);
    expect(out).toHaveLength(4);
  });

  it("discards the whole list when too few tasks survive", () => {
    expect(validateAiTaskList(list(MIN_AI_TASKS - 1))).toBeNull();
    expect(validateAiTaskList([...list(2), { name: "" }, { nope: 1 }])).toBeNull();
    // Exactly the minimum is enough.
    expect(validateAiTaskList(list(MIN_AI_TASKS))).toHaveLength(MIN_AI_TASKS);
  });

  it("caps an over-long list rather than rejecting it", () => {
    expect(validateAiTaskList(list(40))).toHaveLength(MAX_AI_TASKS);
  });

  it("clamps lead days to a magnitude within the ceiling", () => {
    const out = validateAiTaskList(
      list(4, [
        { daysBeforeEvent: -14 },        // wrong sign
        { daysBeforeEvent: 99999 },      // absurd
        { daysBeforeEvent: 10.7 },       // fractional
        { daysBeforeEvent: "21" },       // numeric string
      ])
    );
    expect(out!.map((t) => t.leadDays)).toEqual([14, MAX_AI_LEAD_DAYS, 10, 21]);
  });

  it("spreads missing lead days instead of piling tasks onto one day", () => {
    const out = validateAiTaskList(
      list(4, [
        { daysBeforeEvent: null },
        { daysBeforeEvent: "soon" },
        { daysBeforeEvent: undefined },
        { daysBeforeEvent: "" },
      ])
    );
    // Earliest first: 9, 6, 3, 0 — ordered, distinct, non-negative.
    expect(out!.map((t) => t.leadDays)).toEqual([9, 6, 3, 0]);
  });

  it("clamps durations to the materialise ceiling and defaults the unusable", () => {
    const out = validateAiTaskList(
      list(5, [
        { estimatedHours: 46025 },
        { estimatedHours: -3 },
        { estimatedHours: "four" },
        { estimatedHours: undefined },
        { estimatedHours: 6.5 },
      ])
    );
    expect(out!.map((t) => t.durationHours)).toEqual([MAX_TASK_HOURS, 2, 2, 2, 6.5]);
  });

  it("keeps dependencies inside the list and drops everything else", () => {
    const out = validateAiTaskList(
      list(4, [
        { dependsOn: [] },
        { dependsOn: [1] },          // fine
        { dependsOn: [99] },         // outside the list
        { dependsOn: [4, 2, "3", -1, 0, null] }, // self, earlier, string, junk
      ])
    );
    expect(out!.map((t) => t.dependsOn)).toEqual([[], [1], [], [2, 3]]);
  });

  it("remaps dependencies after a malformed task is dropped", () => {
    // Position 2 is dropped, so the model's "depends on 3" becomes "depends on 2".
    const out = validateAiTaskList([
      { name: "First", daysBeforeEvent: 20 },
      { name: "", daysBeforeEvent: 15 },
      { name: "Third", daysBeforeEvent: 10, dependsOn: [1] },
      { name: "Fourth", daysBeforeEvent: 5, dependsOn: [3, 2] },
    ]);
    expect(out!.map((t) => t.name)).toEqual(["First", "Third", "Fourth"]);
    // Task 3 ("Fourth") depended on original 3 (now 2) and on the dropped 2.
    expect(out!.map((t) => t.dependsOn)).toEqual([[], [1], [2]]);
  });

  it("never lets a dependency point forwards", () => {
    const out = validateAiTaskList(list(4, [{ dependsOn: [2, 3, 4] }]));
    expect(out![0].dependsOn).toEqual([]);
  });

  it("ignores any field the model invents", () => {
    const out = validateAiTaskList(
      list(3, [{ priority: "critical", cost: 99, dueDate: "2026-01-01" }])
    );
    expect(Object.keys(out![0]).sort()).toEqual([
      "category", "dependsOn", "displayOrder", "durationHours", "leadDays",
      "name", "notes", "role", "taskNumber",
    ]);
  });
});

describe("parseAiTaskBatch", () => {
  const keys = ["past-buyer-reactivation", "event-sponsorship"];

  it("returns validated lists for the requested keys", () => {
    const raw = JSON.stringify({
      "past-buyer-reactivation": list(8),
      "event-sponsorship": list(5),
    });
    const out = parseAiTaskBatch(raw, keys);
    expect([...out.keys()].sort()).toEqual([...keys].sort());
    expect(out.get("past-buyer-reactivation")).toHaveLength(8);
  });

  it("ignores keys that were not requested", () => {
    const raw = JSON.stringify({
      "event-sponsorship": list(6),
      "webinar": list(6),
      "": list(6),
    });
    const out = parseAiTaskBatch(raw, keys);
    expect([...out.keys()]).toEqual(["event-sponsorship"]);
  });

  it("keeps the good half of a partial response", () => {
    const raw = JSON.stringify({
      "past-buyer-reactivation": list(9),
      "event-sponsorship": list(1), // too short to use
    });
    const out = parseAiTaskBatch(raw, keys);
    expect(out.has("past-buyer-reactivation")).toBe(true);
    expect(out.has("event-sponsorship")).toBe(false);
  });

  it("unwraps a single wrapper object the model adds", () => {
    const raw = JSON.stringify({ initiatives: { "event-sponsorship": list(6) } });
    expect(parseAiTaskBatch(raw, keys).has("event-sponsorship")).toBe(true);
  });

  it("reads through a markdown fence", () => {
    const raw = "```json\n" + JSON.stringify({ "event-sponsorship": list(6) }) + "\n```";
    expect(parseAiTaskBatch(raw, keys).has("event-sponsorship")).toBe(true);
  });

  it("is empty for unparseable, irrelevant or absent output", () => {
    expect(parseAiTaskBatch("not json", keys).size).toBe(0);
    expect(parseAiTaskBatch("", keys).size).toBe(0);
    expect(parseAiTaskBatch(JSON.stringify({ webinar: list(6) }), keys).size).toBe(0);
    expect(parseAiTaskBatch(JSON.stringify({ "event-sponsorship": "soon" }), keys).size).toBe(0);
  });

  it("asks for nothing, returns nothing — no key is accepted by default", () => {
    expect(parseAiTaskBatch(JSON.stringify({ webinar: list(6) }), []).size).toBe(0);
  });
});
