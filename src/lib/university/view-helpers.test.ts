import { describe, it, expect } from "vitest";
import {
  formatDuration,
  moduleCount,
  resourceAction,
  resourceTypeLabel,
  summariseCatalogue,
  unlockLabel,
} from "./view-helpers";
import type { UniversityCategoryView, UniversityResourceView } from "@/types/university.types";

function view(over: Partial<UniversityResourceView> = {}): UniversityResourceView {
  return {
    id: "r", title: "T", description: null, type: "video", durationMinutes: 5,
    status: "published", locked: false, url: null, unlockPlanNames: [], isFree: false,
    ...over,
  };
}

describe("unlockLabel", () => {
  it("joins plan names with 'or'", () => {
    expect(unlockLabel(["Pro"])).toBe("Available on Pro");
    expect(unlockLabel(["Starter", "Pro"])).toBe("Available on Starter or Pro");
    expect(unlockLabel(["Starter", "Pro", "Mastery"])).toBe("Available on Starter or Pro or Mastery");
  });
  it("has a neutral fallback when no plan is advertised", () => {
    expect(unlockLabel([])).toBe("Not included in your plan");
    expect(unlockLabel([" "])).toBe("Not included in your plan");
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(8)).toBe("8 min");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(75)).toBe("1 h 15 min");
  });
  it("is null when unknown or zero", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(0)).toBeNull();
  });
});

describe("labels", () => {
  it("names each type", () => {
    expect(resourceTypeLabel("pdf")).toBe("PDF");
    expect(resourceTypeLabel("video")).toBe("Video");
  });
  it("pluralises module counts", () => {
    expect(moduleCount(1)).toBe("1 module");
    expect(moduleCount(3)).toBe("3 modules");
  });
});

describe("summariseCatalogue", () => {
  it("counts unlocked and locked across categories", () => {
    const cats: UniversityCategoryView[] = [
      { id: "a", name: "A", description: null, icon: null, resources: [view(), view({ locked: true })] },
      { id: "b", name: "B", description: null, icon: null, resources: [view({ locked: true })] },
    ];
    expect(summariseCatalogue(cats)).toEqual({ total: 3, unlocked: 1, locked: 2 });
    expect(summariseCatalogue([])).toEqual({ total: 0, unlocked: 0, locked: 0 });
  });
});

describe("resourceAction", () => {
  it("locked wins over everything", () => {
    expect(resourceAction(view({ locked: true, status: "coming_soon" }))).toEqual({ kind: "locked" });
  });
  it("coming soon is never openable", () => {
    expect(resourceAction(view({ status: "coming_soon" }))).toEqual({ kind: "coming_soon" });
  });
  it("embeddable videos are watched in the modal", () => {
    expect(resourceAction(view({ url: "https://youtu.be/dQw4w9WgXcQ" }))).toEqual({
      kind: "watch",
      embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
  });
  it("non-embeddable videos and other types open in a new tab", () => {
    expect(resourceAction(view({ url: "https://example.com/v.mp4" }))).toEqual({
      kind: "open",
      url: "https://example.com/v.mp4",
    });
    expect(resourceAction(view({ type: "pdf", url: "https://youtu.be/dQw4w9WgXcQ" }))).toEqual({
      kind: "open",
      url: "https://youtu.be/dQw4w9WgXcQ",
    });
  });
  it("is inert when an unlocked published item has no url", () => {
    expect(resourceAction(view({ url: null }))).toEqual({ kind: "none" });
  });
});

describe("resourceAction — seeded: only published, unlocked views are actionable", () => {
  it("holds across 500 random views", () => {
    let a = 0xc0ffee;
    const rnd = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const types = ["video", "article", "pdf", "link"] as const;
    const urls = [null, "https://youtu.be/dQw4w9WgXcQ", "https://example.com/doc.pdf"];
    for (let i = 0; i < 500; i++) {
      const v = view({
        type: types[Math.floor(rnd() * types.length)],
        status: rnd() < 0.5 ? "published" : "coming_soon",
        locked: rnd() < 0.5,
        url: urls[Math.floor(rnd() * urls.length)],
      });
      const kind = resourceAction(v).kind;
      if (v.locked) expect(kind).toBe("locked");
      else if (v.status === "coming_soon") expect(kind).toBe("coming_soon");
      else expect(kind === "watch" || kind === "open").toBe(v.url !== null);
    }
  });
});
