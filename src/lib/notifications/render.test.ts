import { describe, it, expect } from "vitest";
import { renderTemplate, DEFAULT_TEMPLATE } from "./render";

const tpl = {
  subject: "Hi {{firstName}} — {{channel}} {{initiativeName}} in {{daysUntil}}d",
  body_html: "<p>{{initiativeName}} on {{activationDate}}</p>",
};

describe("renderTemplate", () => {
  it("interpolates all five supported variables (Req 7.2, 7.6)", () => {
    const out = renderTemplate(tpl, {
      firstName: "Nik",
      initiativeName: "Q4 Webinar",
      channel: "webinar",
      daysUntil: 2,
      activationDate: "Dec 31, 2026",
    });
    expect(out.subject).toBe("Hi Nik — webinar Q4 Webinar in 2d");
    expect(out.html).toBe("<p>Q4 Webinar on Dec 31, 2026</p>");
  });

  it("applies safe fallbacks for null/missing values with no leftover placeholders (Req 7.3)", () => {
    const out = renderTemplate(tpl, {});
    expect(out.subject).toBe("Hi there — initiative your initiative in a fewd");
    expect(out.html).toBe("<p>your initiative on soon</p>");
    expect(out.subject).not.toContain("{{");
    expect(out.html).not.toContain("{{");
  });

  it("HTML-escapes interpolated values to prevent injection (Req 7.3)", () => {
    const out = renderTemplate(tpl, {
      firstName: "<script>alert(1)</script>",
      initiativeName: "A & B <b>",
      channel: "x",
      daysUntil: 1,
      activationDate: "y",
    });
    expect(out.subject).toContain("&lt;script&gt;");
    expect(out.subject).not.toContain("<script>");
    expect(out.html).toContain("A &amp; B &lt;b&gt;");
  });

  it("collapses unknown placeholders to empty string", () => {
    const out = renderTemplate(
      { subject: "a {{bogus}} b", body_html: "<p>{{alsoBogus}}</p>" },
      {}
    );
    expect(out.subject).toBe("a  b");
    expect(out.html).toBe("<p></p>");
  });

  it("falls back to the built-in default when template is null (Req 7.4)", () => {
    const out = renderTemplate(null, {
      firstName: "Sam",
      initiativeName: "Launch",
      channel: "email",
      daysUntil: 7,
      activationDate: "soon",
    });
    // Should render the DEFAULT_TEMPLATE, not throw or return empty.
    expect(out.subject).toContain("Launch");
    expect(out.subject).toContain("email");
    expect(out.html).toContain("Sam");
  });

  it("falls back to default when template is missing required fields (Req 7.5)", () => {
    // subject present, body empty -> treated as unusable -> default
    const out = renderTemplate({ subject: "x", body_html: "" }, { initiativeName: "Z", daysUntil: 3 });
    expect(out.html).toContain("Z");
    expect(out.html).toContain(DEFAULT_TEMPLATE.body_html.slice(0, 5).replace("{{", ""));
  });

  it("daysUntil of 0 renders as 0, not the fallback", () => {
    const out = renderTemplate({ subject: "{{daysUntil}}", body_html: "x" }, { daysUntil: 0 });
    expect(out.subject).toBe("0");
  });
});
