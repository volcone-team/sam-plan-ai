import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUPPORT_EMAIL,
  DEFAULT_SUPPORT_PHONE,
  describeSupportEmailProblem,
  describeSupportPhoneProblem,
  isUsableSupportPhone,
  resolveSupportContact,
  smsHref,
} from "./support-contact";

describe("resolveSupportContact", () => {
  it("falls back to the old footer values when nothing is stored", () => {
    expect(resolveSupportContact(null)).toEqual({
      email: DEFAULT_SUPPORT_EMAIL,
      phoneDisplay: DEFAULT_SUPPORT_PHONE,
      phoneHref: "sms:+19016128106",
    });
  });

  it("uses stored values, trimmed", () => {
    expect(
      resolveSupportContact({ support_email: " help@example.com ", support_phone: " +44 20 7946 0958 " })
    ).toEqual({
      email: "help@example.com",
      phoneDisplay: "+44 20 7946 0958",
      phoneHref: "sms:+442079460958",
    });
  });

  it("ignores unusable stored values", () => {
    const c = resolveSupportContact({ support_email: "not-an-email", support_phone: "call me" });
    expect(c.email).toBe(DEFAULT_SUPPORT_EMAIL);
    expect(c.phoneDisplay).toBe(DEFAULT_SUPPORT_PHONE);
  });
});

describe("phone helpers", () => {
  it("treats a bare 10-digit number as US", () => {
    expect(smsHref("(901) 612-8106")).toBe("sms:+19016128106");
  });

  it("rejects letters and too few digits", () => {
    expect(isUsableSupportPhone("901-CALL-NOW")).toBe(false);
    expect(isUsableSupportPhone("123")).toBe(false);
  });
});

describe("admin validation messages", () => {
  it("allows empty (clears the value) and flags bad input", () => {
    expect(describeSupportEmailProblem("")).toBeNull();
    expect(describeSupportEmailProblem("bad")).not.toBeNull();
    expect(describeSupportPhoneProblem("")).toBeNull();
    expect(describeSupportPhoneProblem("abc")).not.toBeNull();
  });
});
