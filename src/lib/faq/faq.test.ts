import { describe, it, expect } from "vitest";
import {
  FAQ_LIMITS,
  buildPublicFaq,
  countFaqItems,
  faqCategoryFromRow,
  faqItemFromRow,
  filterFaq,
  linkifySegments,
  normaliseFaqCategoryInput,
  normaliseFaqItemInput,
} from "./faq";
import type { FaqCategory, FaqItem, FaqStatus } from "@/types/faq.types";

const CAT = "11111111-1111-4111-8111-111111111111";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cat(id: string, over: Partial<FaqCategory> = {}): FaqCategory {
  return {
    id, slug: id, name: `Cat ${id}`, icon: null, displayOrder: 0, isPublished: true,
    createdAt: "t", updatedAt: "t", ...over,
  };
}

function item(id: string, categoryId: string, over: Partial<FaqItem> = {}): FaqItem {
  return {
    id, slug: id, categoryId, question: `Q ${id}`, answer: `A ${id}`, status: "published",
    displayOrder: 0, createdAt: "t", updatedAt: "t", updatedBy: null, ...over,
  };
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

describe("row mappers", () => {
  it("map snake_case rows and null an unknown icon", () => {
    const c = faqCategoryFromRow({
      id: CAT, slug: "s", name: "N", icon: "Skull", display_order: 3, is_published: false,
      created_at: "c", updated_at: "u",
    });
    expect(c).toEqual({
      id: CAT, slug: "s", name: "N", icon: null, displayOrder: 3, isPublished: false,
      createdAt: "c", updatedAt: "u",
    });
    expect(faqCategoryFromRow({ ...{ id: CAT, slug: "s", name: "N", display_order: 0, is_published: true, created_at: "", updated_at: "" }, icon: "Rocket" }).icon).toBe("Rocket");

    const i = faqItemFromRow({
      id: "i", slug: "q", category_id: CAT, question: "Q", answer: "A", status: "draft",
      display_order: 5, created_at: "c", updated_at: "u", updated_by: null,
    });
    expect(i).toMatchObject({ categoryId: CAT, status: "draft", displayOrder: 5, updatedBy: null });
  });
});

// ─── buildPublicFaq ──────────────────────────────────────────────────────────

describe("buildPublicFaq", () => {
  it("hides drafts, unpublished categories and empty categories, and sorts", () => {
    const categories = [
      cat("b", { displayOrder: 20 }),
      cat("a", { displayOrder: 10 }),
      cat("hidden", { isPublished: false }),
      cat("empty"),
      cat("only-drafts"),
    ];
    const items = [
      item("a2", "a", { displayOrder: 20 }),
      item("a1", "a", { displayOrder: 10 }),
      item("a-draft", "a", { status: "draft" }),
      item("b1", "b"),
      item("h1", "hidden"),
      item("d1", "only-drafts", { status: "draft" }),
      item("orphan", "missing-category"),
    ];
    const out = buildPublicFaq(categories, items);
    expect(out.map((c) => c.id)).toEqual(["a", "b"]);
    expect(out[0].items.map((i) => i.id)).toEqual(["a1", "a2"]);
    expect(Object.keys(out[0].items[0]).sort()).toEqual(["answer", "id", "question"]);
  });

  it("ties sort by name, then question", () => {
    const out = buildPublicFaq(
      [cat("2", { name: "Zeta" }), cat("1", { name: "Alpha" })],
      [item("y", "1", { question: "Why" }), item("x", "1", { question: "How" }), item("z", "2")]
    );
    expect(out.map((c) => c.name)).toEqual(["Alpha", "Zeta"]);
    expect(out[0].items.map((i) => i.question)).toEqual(["How", "Why"]);
  });

  it("seeded: a draft item, or any item of an unpublished category, never appears", () => {
    const rnd = mulberry32(0xfa9);
    const STATUSES: FaqStatus[] = ["draft", "published"];
    for (let iter = 0; iter < 300; iter++) {
      const categories = Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_, k) =>
        cat(`c${k}`, { isPublished: rnd() < 0.7, displayOrder: Math.floor(rnd() * 5) })
      );
      const items = Array.from({ length: Math.floor(rnd() * 20) }, (_, k) =>
        item(`i${k}`, `c${Math.floor(rnd() * 6)}`, {
          status: STATUSES[Math.floor(rnd() * 2)],
          answer: `secret-${iter}-${k}`,
          displayOrder: Math.floor(rnd() * 5),
        })
      );
      const out = buildPublicFaq(categories, items);
      const json = JSON.stringify(out);
      const published = new Set(categories.filter((c) => c.isPublished).map((c) => c.id));

      for (const it of items) {
        const visible = it.status === "published" && published.has(it.categoryId);
        expect(json.includes(`"${it.answer}"`), `iter ${iter} item ${it.id}`).toBe(visible);
      }
      for (const c of out) {
        expect(c.items.length).toBeGreaterThan(0);
        const orders = c.items.map((i) => items.find((x) => x.id === i.id)!.displayOrder);
        expect(orders).toEqual([...orders].sort((a, b) => a - b));
      }
    }
  });
});

// ─── filterFaq ───────────────────────────────────────────────────────────────

describe("filterFaq", () => {
  const data = buildPublicFaq(
    [cat("a"), cat("b")],
    [
      item("1", "a", { question: "Is there a free trial?", answer: "Yes." }),
      item("2", "a", { question: "Refunds", answer: "30-day money-back guarantee" }),
      item("3", "b", { question: "Security", answer: "Encrypted." }),
    ]
  );

  it("matches every term in question or answer, case-insensitively", () => {
    expect(countFaqItems(filterFaq(data, "TRIAL"))).toBe(1);
    expect(countFaqItems(filterFaq(data, "money guarantee"))).toBe(1);
    expect(countFaqItems(filterFaq(data, "money trial"))).toBe(0);
    expect(filterFaq(data, "encrypted").map((c) => c.id)).toEqual(["b"]);
  });

  it("a blank query returns everything", () => {
    expect(countFaqItems(filterFaq(data, "   "))).toBe(3);
  });
});

// ─── Validation ──────────────────────────────────────────────────────────────

describe("normaliseFaqItemInput", () => {
  const valid = { categoryId: CAT.toUpperCase(), question: "  How?  ", answer: "Line 1\r\n\r\nLine 2  " };

  it("accepts and normalises; status defaults to draft", () => {
    const r = normaliseFaqItemInput(valid);
    expect(r).toEqual({
      ok: true,
      value: { categoryId: CAT, question: "How?", answer: "Line 1\n\nLine 2", status: "draft", displayOrder: 0 },
    });
  });

  it("keeps paragraph breaks in the answer but flattens the question to one line", () => {
    const r = normaliseFaqItemInput({ ...valid, question: "Two\nlines", status: "published" });
    expect(r.ok && r.value.question).toBe("Two lines");
    expect(r.ok && r.value.status).toBe("published");
  });

  it("reports field-keyed errors", () => {
    const r = normaliseFaqItemInput({
      categoryId: "nope", question: "   ", answer: 7, status: "coming_soon", displayOrder: -1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(["answer", "categoryId", "displayOrder", "question", "status"]);
    }
  });

  it("enforces the length limits at the boundary", () => {
    const at = normaliseFaqItemInput({
      ...valid, question: "q".repeat(FAQ_LIMITS.questionMax), answer: "a".repeat(FAQ_LIMITS.answerMax),
    });
    expect(at.ok).toBe(true);
    const over = normaliseFaqItemInput({
      ...valid, question: "q".repeat(FAQ_LIMITS.questionMax + 1), answer: "a".repeat(FAQ_LIMITS.answerMax + 1),
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(Object.keys(over.errors).sort()).toEqual(["answer", "question"]);
  });

  it("rejects non-objects", () => {
    expect(normaliseFaqItemInput(null).ok).toBe(false);
    expect(normaliseFaqItemInput([valid]).ok).toBe(false);
  });
});

describe("normaliseFaqCategoryInput", () => {
  it("accepts a minimal category, published by default", () => {
    expect(normaliseFaqCategoryInput({ name: " Billing " })).toEqual({
      ok: true, value: { name: "Billing", icon: null, displayOrder: 0, isPublished: true },
    });
    expect(normaliseFaqCategoryInput({ name: "B", icon: "", isPublished: false })).toMatchObject({
      ok: true, value: { icon: null, isPublished: false },
    });
  });

  it("only allows icons on the list", () => {
    expect(normaliseFaqCategoryInput({ name: "B", icon: "CreditCard" })).toMatchObject({ ok: true, value: { icon: "CreditCard" } });
    const bad = normaliseFaqCategoryInput({ name: "", icon: "GraduationCap", isPublished: "yes" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["icon", "isPublished", "name"]);
  });
});

// ─── linkifySegments ─────────────────────────────────────────────────────────

describe("linkifySegments", () => {
  it("links http(s) urls and leaves trailing punctuation as text", () => {
    expect(linkifySegments("See https://example.com/a?b=1. Or (http://x.io/p).")).toEqual([
      { type: "text", value: "See " },
      { type: "link", value: "https://example.com/a?b=1", href: "https://example.com/a?b=1" },
      { type: "text", value: ". Or (" },
      { type: "link", value: "http://x.io/p", href: "http://x.io/p" },
      { type: "text", value: ")." },
    ]);
  });

  it("keeps balanced parentheses inside a url", () => {
    const segs = linkifySegments("https://en.wikipedia.org/wiki/Foo_(bar)");
    expect(segs).toEqual([
      { type: "link", value: "https://en.wikipedia.org/wiki/Foo_(bar)", href: "https://en.wikipedia.org/wiki/Foo_(bar)" },
    ]);
  });

  it("never links other schemes, bare hosts or credentials", () => {
    for (const s of [
      "javascript:alert(1)",
      "data:text/html,<b>x</b>",
      "www.example.com",
      "ftp://example.com",
      "https://user:pw@example.com",
      "http://",
      "<a href=\"https://x.com\">x</a>",
    ]) {
      const segs = linkifySegments(s);
      for (const seg of segs) {
        if (seg.type === "link") expect(seg.href).toMatch(/^https?:\/\/[^/@]+\//);
      }
      if (!s.includes("https://x.com")) expect(segs).toEqual([{ type: "text", value: s }]);
    }
  });

  it("empty text gives no segments", () => {
    expect(linkifySegments("")).toEqual([]);
  });

  it("seeded: segments rebuild the text and every link is a valid http(s) url", () => {
    const rnd = mulberry32(0x11f);
    const PIECES = [
      "hello ", "\n\n", "https://", "http://", "javascript:", "data:", "example.com", "/path",
      "?q=1", "#x", ".", ",", ")", "(", "\"", "'", "<", ">", " ", "user:pw@", "HTTPS://", "é", "x",
    ];
    for (let iter = 0; iter < 2000; iter++) {
      const text = Array.from({ length: Math.floor(rnd() * 14) }, () => PIECES[Math.floor(rnd() * PIECES.length)]).join("");
      const segs = linkifySegments(text);
      expect(segs.map((s) => s.value).join(""), text).toBe(text);
      for (let k = 0; k < segs.length; k++) {
        const seg = segs[k];
        expect(seg.value.length).toBeGreaterThan(0);
        if (k > 0) expect(seg.type === "text" && segs[k - 1].type === "text").toBe(false);
        if (seg.type === "link") {
          const u = new URL(seg.href);
          expect(["http:", "https:"]).toContain(u.protocol);
          expect(u.hostname).not.toBe("");
          expect(u.username + u.password).toBe("");
        }
      }
    }
  });
});
