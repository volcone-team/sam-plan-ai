import { describe, it, expect } from "vitest";
import {
  isUsableLegalUrl,
  normaliseLegalUrl,
  resolveLegalUrls,
  describeLegalUrlProblem,
  NO_LEGAL_URLS,
} from "./legal-urls";

describe("isUsableLegalUrl", () => {
  it("accepts public https pages", () => {
    for (const url of [
      "https://advanceyourreach.com/privacy",
      "https://example.com/terms-and-conditions",
      "https://docs.google.com/document/d/abc123/view",
      "https://example.co.uk/legal?v=2",
    ]) {
      expect(isUsableLegalUrl(url), url).toBe(true);
    }
  });

  /**
   * THE SECURITY-RELEVANT CASE. These values are typed into an admin field and
   * rendered as an anchor a prospective customer clicks, so a script-bearing
   * scheme must never survive validation.
   */
  it("rejects schemes that are not https", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "file:///etc/passwd",
      "ftp://example.com/terms",
    ]) {
      expect(isUsableLegalUrl(url), url).toBe(false);
    }
  });

  /** A policy served over http can be rewritten in transit. */
  it("rejects plain http", () => {
    expect(isUsableLegalUrl("http://example.com/privacy")).toBe(false);
  });

  it("rejects anything that is not a parseable absolute URL", () => {
    for (const value of [
      "",
      "   ",
      "example.com/privacy",
      "/privacy",
      "#",
      "https://",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(isUsableLegalUrl(value), String(value)).toBe(false);
    }
  });

  it("tolerates surrounding whitespace", () => {
    expect(isUsableLegalUrl("  https://example.com/privacy  ")).toBe(true);
  });
});

describe("normaliseLegalUrl", () => {
  it("trims a usable URL", () => {
    expect(normaliseLegalUrl("  https://example.com/terms ")).toBe(
      "https://example.com/terms"
    );
  });

  it("returns null for anything unusable, so no broken anchor is stored", () => {
    expect(normaliseLegalUrl("")).toBeNull();
    expect(normaliseLegalUrl("#")).toBeNull();
    expect(normaliseLegalUrl("http://example.com")).toBeNull();
    expect(normaliseLegalUrl("javascript:alert(1)")).toBeNull();
    expect(normaliseLegalUrl(null)).toBeNull();
  });
});

describe("resolveLegalUrls", () => {
  it("maps the settings row to the shape the form needs", () => {
    expect(
      resolveLegalUrls({
        privacy_policy_url: "https://example.com/privacy",
        terms_url: "https://example.com/terms",
      })
    ).toEqual({
      privacyPolicyUrl: "https://example.com/privacy",
      termsUrl: "https://example.com/terms",
    });
  });

  it("returns nulls for a missing row", () => {
    expect(resolveLegalUrls(null)).toEqual(NO_LEGAL_URLS);
    expect(resolveLegalUrls(undefined)).toEqual(NO_LEGAL_URLS);
    expect(resolveLegalUrls({})).toEqual(NO_LEGAL_URLS);
  });

  it("allows one link without the other", () => {
    expect(
      resolveLegalUrls({ privacy_policy_url: "https://example.com/privacy" })
    ).toEqual({
      privacyPolicyUrl: "https://example.com/privacy",
      termsUrl: null,
    });
  });

  /**
   * Re-validated on the way OUT. A row can predate the validation or be edited
   * straight in the SQL editor, and the signup page is public — it must not be
   * where a bad value is first discovered.
   */
  it("discards a stored value that would not pass validation", () => {
    expect(
      resolveLegalUrls({
        privacy_policy_url: "javascript:alert(1)",
        terms_url: "http://example.com/terms",
      })
    ).toEqual(NO_LEGAL_URLS);
  });
});

describe("describeLegalUrlProblem", () => {
  it("says nothing for a good link", () => {
    expect(describeLegalUrlProblem("https://example.com/privacy")).toBeNull();
  });

  /** Empty is allowed — it is how an admin removes a link. */
  it("says nothing for an empty value", () => {
    expect(describeLegalUrlProblem("")).toBeNull();
    expect(describeLegalUrlProblem("   ")).toBeNull();
  });

  it("names the https rule for an http link, the commonest mistake", () => {
    const problem = describeLegalUrlProblem("http://example.com/privacy");
    expect(problem).toContain("https://");
    expect(problem).toContain("altered in transit");
  });

  it("gives an example for anything else", () => {
    expect(describeLegalUrlProblem("example.com")).toContain("https://example.com/privacy");
  });

  it("never just says invalid", () => {
    for (const value of ["example.com", "http://x.com", "#"]) {
      expect(describeLegalUrlProblem(value)?.toLowerCase()).not.toContain("invalid");
    }
  });
});
