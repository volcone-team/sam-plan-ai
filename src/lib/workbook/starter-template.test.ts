import { describe, it, expect } from "vitest";
import {
  starterTemplate,
  STARTER_RUNWAY_DAYS,
  STARTER_TASK_COUNT,
} from "@/lib/workbook/starter-template";
import { materialiseTasks, templateRunwayDays } from "@/lib/workbook/materialise";

describe("starterTemplate", () => {
  it("is six ordered steps covering plan, offer, build, promote, run, follow-up", () => {
    const t = starterTemplate("Past-Buyer Reactivation Campaign");
    expect(t).toHaveLength(STARTER_TASK_COUNT);
    expect(t).toHaveLength(6);
    expect(t.map((x) => x.displayOrder)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(t.map((x) => x.taskNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(t.map((x) => x.category)).toEqual([
      "Plan", "Offer", "Build", "Promote", "Run", "Follow-up",
    ]);
  });

  it("tailors the task names with the initiative's name", () => {
    const names = starterTemplate("Event Sponsorship").map((t) => t.name);
    expect(names[0]).toBe("Plan Event Sponsorship and set the goal");
    expect(names[3]).toBe("Promote Event Sponsorship");
    // The follow-up step carries no name placeholder.
    expect(names[5]).toBe("Follow up and record results");
  });

  it("falls back to 'this initiative' rather than an empty gap", () => {
    for (const blank of [undefined, null, "", "   "]) {
      expect(starterTemplate(blank)[4].name).toBe("Run this initiative");
    }
  });

  it("counts down to the event and never schedules work after it", () => {
    const leads = starterTemplate("X").map((t) => t.leadDays);
    expect(leads).toEqual([30, 24, 17, 10, 0, 0]);
    // Non-negative: a lead time is a count of days BEFORE the event.
    for (const l of leads) expect(l).toBeGreaterThanOrEqual(0);
    // Earliest first, so display order and date order agree.
    expect([...leads].sort((a, b) => b - a)).toEqual(leads);
  });

  it("gives every step a duration and a role", () => {
    for (const t of starterTemplate("X")) {
      expect(t.durationHours).toBeGreaterThan(0);
      expect(t.role).toBeTruthy();
      expect(t.notes).toBeTruthy();
    }
  });

  it("chains each step to the one before it", () => {
    const t = starterTemplate("X");
    expect(t[0].dependsOn).toEqual([]);
    expect(t.slice(1).map((x) => x.dependsOn)).toEqual([[1], [2], [3], [4], [5]]);
  });

  it("declares the runway it actually needs", () => {
    expect(STARTER_RUNWAY_DAYS).toBe(30);
    expect(templateRunwayDays(starterTemplate("X"))).toBe(STARTER_RUNWAY_DAYS);
  });

  it("materialises like an authored template: real dates, ids and dependencies", () => {
    let n = 0;
    const tasks = materialiseTasks(starterTemplate("Webinar"), {
      eventDate: "2026-12-01",
      floor: "2026-09-27",
      newId: () => `t-${++n}`,
    });

    expect(tasks).toHaveLength(6);
    expect(tasks.map((t) => t.dueDate)).toEqual([
      "2026-11-01", "2026-11-07", "2026-11-14", "2026-11-21", "2026-12-01", "2026-12-01",
    ]);
    // Dependencies resolve to the ids generated in this same pass.
    expect(tasks[0].dependencyIds).toEqual([]);
    expect(tasks[1].dependencyIds).toEqual([tasks[0].id]);
    expect(tasks[5].dependencyIds).toEqual([tasks[4].id]);
    // Blocking steps are high priority; only the last blocks nothing.
    expect(tasks.map((t) => t.priority)).toEqual([
      "high", "high", "high", "high", "high", "medium",
    ]);
  });

  it("floors at today when the event is sooner than the runway", () => {
    const tasks = materialiseTasks(starterTemplate("Webinar"), {
      eventDate: "2026-10-01",
      floor: "2026-09-27",
    });
    for (const t of tasks) expect(t.dueDate >= "2026-09-27").toBe(true);
  });

  it("is pure: two calls give identical templates", () => {
    expect(starterTemplate("X")).toEqual(starterTemplate("X"));
  });
});
