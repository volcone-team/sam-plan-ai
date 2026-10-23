import { describe, it, expect } from "vitest";
import {
  DIRECT_SIGNUP_SOURCE,
  DIRECT_SIGNUP_SOURCE_KEY,
  EXISTS_MESSAGE,
  RATE_LIMITED_MESSAGE,
  decideDirectSignupOutcome,
  isAlreadyRegisteredError,
  isFormPhone,
  parseDirectSignup,
  pathAfterSignupTrust,
  signupUserMetadata,
} from "./direct-signup";
import { DIAL_CODES, composeE164 } from "@/lib/phone";

const VALID = {
  email: "  Sarah@Example.com ",
  password: "correct horse",
  firstName: "Sarah",
  lastName: "Mitchell",
  companyName: "Acme Inc.",
  phoneE164: "+15551234567",
  termsAccepted: true,
  promotionalConsent: false,
  website: "",
};

function parsed(overrides: Record<string, unknown> = {}) {
  return parseDirectSignup({ ...VALID, ...overrides });
}

describe("parseDirectSignup", () => {
  it("accepts a valid body and normalises the email", () => {
    const r = parsed();
    expect(r.ok && !r.honeypot && r.input.email).toBe("sarah@example.com");
  });

  it("treats a filled honeypot as success before validating anything", () => {
    expect(parseDirectSignup({ website: "http://spam" })).toEqual({ ok: true, honeypot: true });
    expect(parsed({ website: "x", email: "bad" })).toEqual({ ok: true, honeypot: true });
  });

  it("allows the honeypot to be absent", () => {
    const { website: _w, ...rest } = VALID;
    void _w;
    expect(parseDirectSignup(rest).ok).toBe(true);
  });

  it.each([
    ["non-object body", null],
    ["array body", []],
  ])("rejects a %s", (_label, body) => {
    expect(parseDirectSignup(body).ok).toBe(false);
  });

  it.each([
    ["bad email", { email: "not-an-email" }],
    ["empty email", { email: "" }],
    ["short password", { password: "1234567" }],
    ["over-long password", { password: "a".repeat(73) }],
    ["missing first name", { firstName: "   " }],
    ["missing last name", { lastName: undefined }],
    ["missing company", { companyName: "" }],
    ["terms not accepted", { termsAccepted: false }],
    ["terms as a string", { termsAccepted: "true" }],
    ["promotional consent not a boolean", { promotionalConsent: "false" }],
    ["phone missing", { phoneE164: "" }],
    ["phone with spaces", { phoneE164: "+1 555 123 4567" }],
    ["phone too short for +1", { phoneE164: "+1555123" }],
    ["phone with a kept trunk zero", { phoneE164: "+4402079460958" }],
    ["phone without plus", { phoneE164: "15551234567" }],
  ])("rejects %s", (_label, overrides) => {
    const r = parsed(overrides);
    expect(r.ok).toBe(false);
  });

  it("accepts exactly 8 and 72 character passwords", () => {
    expect(parsed({ password: "12345678" }).ok).toBe(true);
    expect(parsed({ password: "a".repeat(72) }).ok).toBe(true);
  });
});

describe("isFormPhone", () => {
  it("accepts what the form composes for every listed country at its minimum and maximum length", () => {
    for (const entry of DIAL_CODES) {
      for (const len of [entry.min, entry.max]) {
        const national = "5".repeat(len);
        expect(isFormPhone(composeE164(entry.code, national))).toBe(true);
      }
    }
  });

  it("accepts a UK number typed with its trunk zero, once composed", () => {
    expect(isFormPhone(composeE164("44", "020 7946 0958"))).toBe(true);
  });
});

describe("signupUserMetadata", () => {
  it("uses exactly the keys and string formats the page sends to signUp()", () => {
    const r = parsed({ promotionalConsent: true });
    if (!r.ok || r.honeypot) throw new Error("expected valid");
    expect(signupUserMetadata(r.input)).toEqual({
      first_name: "Sarah",
      last_name: "Mitchell",
      company_name: "Acme Inc.",
      phone: "+15551234567",
      marketing_consent: "true",
      terms_accepted: "true",
      promotional_consent: "true",
    });
  });

  it("records a declined promotional consent as the string 'false'", () => {
    const r = parsed();
    if (!r.ok || r.honeypot) throw new Error("expected valid");
    const meta = signupUserMetadata(r.input);
    expect(meta.marketing_consent).toBe("false");
    expect(meta.promotional_consent).toBe("false");
  });

  it("marks direct signups with a service-role-only app_metadata key", () => {
    expect(DIRECT_SIGNUP_SOURCE_KEY).toBe("signup_source");
    expect(DIRECT_SIGNUP_SOURCE).toBe("direct_no_verify");
  });
});

describe("isAlreadyRegisteredError", () => {
  it("recognises Supabase's existing-account errors", () => {
    expect(isAlreadyRegisteredError({ code: "email_exists", status: 422 })).toBe(true);
    expect(
      isAlreadyRegisteredError({ message: "A user with this email address has already been registered", status: 422 })
    ).toBe(true);
  });

  it("does not treat other 422s as existing accounts", () => {
    expect(isAlreadyRegisteredError({ code: "weak_password", status: 422, message: "Password is too weak" })).toBe(false);
    expect(isAlreadyRegisteredError(null)).toBe(false);
  });
});

describe("decideDirectSignupOutcome", () => {
  it("signs in on 200 ok", () => {
    expect(decideDirectSignupOutcome({ status: 200, body: { ok: true } })).toEqual({ kind: "sign_in" });
  });

  it("falls back to the email flow when verification is required", () => {
    expect(
      decideDirectSignupOutcome({ status: 409, body: { error: "verification_required" } })
    ).toEqual({ kind: "fallback" });
  });

  it("shows the existing-account message on 409 exists", () => {
    expect(decideDirectSignupOutcome({ status: 409, body: { error: "exists" } })).toEqual({
      kind: "error",
      message: EXISTS_MESSAGE,
    });
  });

  it("shows the rate-limit message on 429", () => {
    expect(decideDirectSignupOutcome({ status: 429, body: { error: "rate_limited" } })).toEqual({
      kind: "error",
      message: RATE_LIMITED_MESSAGE,
    });
  });

  it("shows the server's validation message on 400", () => {
    expect(
      decideDirectSignupOutcome({ status: 400, body: { error: "invalid", message: "Password is too weak" } })
    ).toEqual({ kind: "error", message: "Password is too weak" });
  });

  it.each([
    ["no response (network error)", null],
    ["404 route missing", { status: 404, body: null }],
    ["500", { status: 500, body: { error: "server_error" } }],
    ["502 HTML body", { status: 502, body: null }],
    ["200 without ok", { status: 200, body: {} }],
    ["400 without a message", { status: 400, body: { error: "invalid" } }],
    ["409 unknown error", { status: 409, body: { error: "other" } }],
  ])("falls back on %s", (_label, response) => {
    expect(decideDirectSignupOutcome(response)).toEqual({ kind: "fallback" });
  });
});

describe("pathAfterSignupTrust", () => {
  const dest = "/checkout?plan=e4dce2b7-8fa0-495d-8ffb-fa4de1b8d866&cycle=annual";
  it("goes to the destination when trusted", () => {
    expect(pathAfterSignupTrust(true, dest)).toBe(dest);
  });
  it("goes to the code challenge, returning to the destination, when not", () => {
    expect(pathAfterSignupTrust(false, dest)).toBe(`/auth/verify-code?next=${encodeURIComponent(dest)}`);
  });
});
