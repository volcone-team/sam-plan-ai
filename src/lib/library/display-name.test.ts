import { describe, expect, it } from "vitest";
import {
  distinguishingDetail,
  distinguishingLabel,
  distinguishingLabelBesideOwnOrOps,
  ownOrOpsLabel,
  type NamedItem,
} from "./display-name";

const item = (key: string, name: string, category: string | null, ownOrOps: string | null): NamedItem => ({
  key,
  name,
  category,
  ownOrOps,
});

describe("ownOrOpsLabel", () => {
  it("translates OWN and OPS, any case", () => {
    expect(ownOrOpsLabel("OWN")).toBe("Your own stage");
    expect(ownOrOpsLabel(" ops ")).toBe("Other people's stages");
  });
  it("returns anything else as written, and null when blank", () => {
    expect(ownOrOpsLabel("OWN & OPS")).toBe("OWN & OPS");
    expect(ownOrOpsLabel("")).toBeNull();
    expect(ownOrOpsLabel(null)).toBeNull();
  });
});

describe("distinguishingLabel", () => {
  it("gives a unique name no subtitle", () => {
    const list = [item("a", "Webinar", "Webinars", "OWN"), item("b", "Paid Ads", "Paid Ads", "OWN")];
    expect(distinguishingLabel(list[0], list)).toBeNull();
  });

  it("uses the category for two Hybrid Events in different categories", () => {
    const a = item("hybrid-events", "Hybrid Events", "Live Events", "OWN");
    const b = item("hybrid-events-2", "Hybrid Events", "Virtual Events", "OWN");
    expect(distinguishingLabel(a, [a, b])).toBe("Live Events");
    expect(distinguishingLabel(b, [a, b])).toBe("Virtual Events");
  });

  it("prefers Own/Ops when that is what differs", () => {
    const a = item("webinar-own", "Webinar", "Webinars", "OWN");
    const b = item("webinar-ops", "Webinar", "Webinars", "OPS");
    expect(distinguishingLabel(a, [a, b])).toBe("Your own stage");
    expect(distinguishingLabel(b, [a, b])).toBe("Other people's stages");
  });

  it("prefers Own/Ops even when the category also differs", () => {
    const a = item("x", "Summit", "Live Events", "OWN");
    const b = item("y", "Summit", "Partnerships", "OPS");
    expect(distinguishingDetail(a, [a, b])).toEqual({ label: "Your own stage", basis: "ownOrOps" });
  });

  it("falls back to both when neither alone is unique", () => {
    const a = item("a", "Event", "Live", "OWN");
    const b = item("b", "Event", "Live", "OPS");
    const c = item("c", "Event", "Virtual", "OWN");
    expect(distinguishingDetail(a, [a, b, c])).toEqual({ label: "Your own stage · Live", basis: "both" });
  });

  it("returns null for true duplicates", () => {
    const a = item("a", "Event", "Live", "OWN");
    const b = item("b", "Event", "Live", "OWN");
    expect(distinguishingLabel(a, [a, b])).toBeNull();
  });

  it("matches names ignoring case and spacing", () => {
    const a = item("a", "Hybrid  Events", "Live", null);
    const b = item("b", "hybrid events", "Virtual", null);
    expect(distinguishingLabel(a, [a, b])).toBe("Live");
  });

  it("skips Own/Ops when this item has none", () => {
    const a = item("a", "Event", "Live", null);
    const b = item("b", "Event", "Virtual", "OPS");
    expect(distinguishingLabel(a, [a, b])).toBe("Live");
  });

  it("every label it returns tells the item apart from each same-name twin (all 3-item lists)", () => {
    // Exhaustive over a small domain: 3 categories x 3 Own/Ops of one name,
    // plus one row with another name = 10 rows, every ordered list of three.
    const rows: Omit<NamedItem, "key">[] = [{ name: "Webinar", category: "Live", ownOrOps: "OWN" }];
    for (const category of ["Live", "Virtual", null])
      for (const ownOrOps of ["OWN", "OPS", null]) rows.push({ name: "Hybrid Events", category, ownOrOps });

    let labelled = 0;
    for (const a of rows)
      for (const b of rows)
        for (const c of rows) {
          const items = [a, b, c].map((r, i) => ({ key: `k${i}`, ...r }));
          for (const it of items) {
            const label = distinguishingLabel(it, items);
            if (label === null) continue;
            labelled++;
            for (const twin of items) {
              if (twin.key === it.key || twin.name !== it.name) continue;
              expect(distinguishingLabel(twin, items)).not.toBe(label);
            }
          }
        }
    expect(labelled).toBeGreaterThan(0);
  });
});

describe("distinguishingLabelBesideOwnOrOps", () => {
  it("is null when the OWN/OPS badge already tells them apart", () => {
    const a = item("a", "Webinar", "Webinars", "OWN");
    const b = item("b", "Webinar", "Webinars", "OPS");
    expect(distinguishingLabelBesideOwnOrOps(a, [a, b])).toBeNull();
  });
  it("gives the category alone where both differ", () => {
    const a = item("a", "Event", "Live", "OWN");
    const b = item("b", "Event", "Live", "OPS");
    const c = item("c", "Event", "Virtual", "OWN");
    expect(distinguishingLabelBesideOwnOrOps(a, [a, b, c])).toBe("Live");
  });
  it("gives the category where that is what differs", () => {
    const a = item("a", "Hybrid Events", "Live Events", "OWN");
    const b = item("b", "Hybrid Events", "Virtual Events", "OWN");
    expect(distinguishingLabelBesideOwnOrOps(a, [a, b])).toBe("Live Events");
  });
  it("gives the full label to a row without a badge", () => {
    const a = item("a", "Launch", "Affiliates", "OWN & OPS");
    const b = item("b", "Launch", "Affiliates", "OWN");
    expect(distinguishingLabelBesideOwnOrOps(a, [a, b])).toBe("OWN & OPS");
  });
});
