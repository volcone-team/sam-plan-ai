import { describe, it, expect } from "vitest";
import { validateNotificationSettings } from "./logic";

describe("validateNotificationSettings (Req 2.5 / 2.6)", () => {
  it("accepts a valid full payload", () => {
    const res = validateNotificationSettings({
      enabled: true,
      lead_times: [7, 2, 1],
      recipient_rule: "owners_operators",
      subject: "Hi {{firstName}}",
      body_html: "<p>hello</p>",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.enabled).toBe(true);
      expect(res.value.leadTimes).toEqual([1, 2, 7]);
      expect(res.value.recipientRule).toBe("owners_operators");
      expect(res.value.subject).toBe("Hi {{firstName}}");
      expect(res.value.bodyHtml).toBe("<p>hello</p>");
    }
  });

  it("normalizes valid lead_times (dedupe/sort/positive)", () => {
    const res = validateNotificationSettings({ lead_times: [2, 7, 2, 1] });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.leadTimes).toEqual([1, 2, 7]);
  });

  it("allows an empty lead_times array (send nothing)", () => {
    const res = validateNotificationSettings({ lead_times: [] });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.leadTimes).toEqual([]);
  });

  it("rejects a non-boolean enabled", () => {
    const res = validateNotificationSettings({ enabled: "yes" });
    expect(res).toEqual({ ok: false, field: "enabled" });
  });

  it("rejects lead_times that is not an array", () => {
    expect(validateNotificationSettings({ lead_times: "7,2,1" })).toEqual({
      ok: false,
      field: "lead_times",
    });
  });

  it("rejects lead_times with a negative value", () => {
    expect(validateNotificationSettings({ lead_times: [7, -1] })).toEqual({
      ok: false,
      field: "lead_times",
    });
  });

  it("rejects lead_times with a zero", () => {
    expect(validateNotificationSettings({ lead_times: [0, 2] })).toEqual({
      ok: false,
      field: "lead_times",
    });
  });

  it("rejects lead_times with a float", () => {
    expect(validateNotificationSettings({ lead_times: [2.5] })).toEqual({
      ok: false,
      field: "lead_times",
    });
  });

  it("rejects lead_times with a non-number element", () => {
    expect(validateNotificationSettings({ lead_times: ["2"] })).toEqual({
      ok: false,
      field: "lead_times",
    });
  });

  it("rejects a recipient_rule outside the enum", () => {
    expect(validateNotificationSettings({ recipient_rule: "everyone" })).toEqual({
      ok: false,
      field: "recipient_rule",
    });
  });

  it("rejects an empty subject", () => {
    expect(validateNotificationSettings({ subject: "   " })).toEqual({
      ok: false,
      field: "subject",
    });
  });

  it("rejects an empty body_html", () => {
    expect(validateNotificationSettings({ body_html: "" })).toEqual({
      ok: false,
      field: "body_html",
    });
  });

  it("rejects a non-object body", () => {
    expect(validateNotificationSettings(null)).toEqual({ ok: false, field: "body" });
    expect(validateNotificationSettings([1, 2])).toEqual({ ok: false, field: "body" });
    expect(validateNotificationSettings("x")).toEqual({ ok: false, field: "body" });
  });

  it("accepts a partial payload (subset of fields)", () => {
    const res = validateNotificationSettings({ enabled: false });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.enabled).toBe(false);
      expect(res.value.leadTimes).toBeUndefined();
      expect(res.value.recipientRule).toBeUndefined();
    }
  });
});
