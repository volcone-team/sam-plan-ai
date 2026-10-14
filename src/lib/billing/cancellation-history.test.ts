import { describe, it, expect } from "vitest";
import {
  latestCancellationByCompany,
  type CancellationFeedbackRowLike,
} from "./cancellation-history";

/** A complete row, so each test varies only the field it is about. */
function row(
  overrides: Partial<CancellationFeedbackRowLike> = {}
): CancellationFeedbackRowLike {
  return {
    company_id: "company-1",
    reason: "too_expensive",
    reason_detail: null,
    outcome: "cancelled",
    created_at: "2026-10-01T10:00:00Z",
    access_ends_at: "2026-11-01T10:00:00Z",
    ...overrides,
  };
}

describe("latestCancellationByCompany", () => {
  it("returns a note for a company that cancelled", () => {
    const notes = latestCancellationByCompany([row()]);

    expect(notes.get("company-1")).toEqual({
      reason: "too_expensive",
      reasonLabel: "It's too expensive right now",
      detail: null,
      cancelledAt: "2026-10-01T10:00:00Z",
      accessEndsAt: "2026-11-01T10:00:00Z",
    });
  });

  it("returns an empty map for no rows", () => {
    expect(latestCancellationByCompany([]).size).toBe(0);
    expect(latestCancellationByCompany(null).size).toBe(0);
    expect(latestCancellationByCompany(undefined).size).toBe(0);
  });

  /* ---------------- Only real cancellations ---------------- */

  /**
   * THE CASE THAT MATTERS MOST. Migration 030 logs a row for everyone who
   * opens the flow, and on the live database the overwhelming majority are
   * `kept`. Captioning those "Reason for plan cancellation" would report
   * every customer who ever wavered as churned.
   */
  it("ignores customers who stayed", () => {
    const notes = latestCancellationByCompany([
      row({ outcome: "kept" }),
      row({ outcome: "offer_accepted" }),
    ]);

    expect(notes.size).toBe(0);
  });

  it("ignores an unrecognised outcome rather than assuming it cancelled", () => {
    expect(latestCancellationByCompany([row({ outcome: "something_new" })]).size).toBe(0);
    expect(latestCancellationByCompany([row({ outcome: null })]).size).toBe(0);
  });

  it("picks the cancellation out of a mixed history", () => {
    const notes = latestCancellationByCompany([
      row({ outcome: "kept", created_at: "2026-10-05T10:00:00Z", reason: "fell_behind" }),
      row({ outcome: "cancelled", created_at: "2026-10-03T10:00:00Z", reason: "no_results" }),
      row({ outcome: "offer_accepted", created_at: "2026-10-04T10:00:00Z" }),
    ]);

    // The newest row overall is a `kept` one; the note must still be the
    // cancellation, not the most recent visit to the modal.
    expect(notes.get("company-1")?.reason).toBe("no_results");
  });

  /* ---------------- Newest per company ---------------- */

  it("keeps the newest cancellation per company", () => {
    const notes = latestCancellationByCompany([
      row({ created_at: "2026-09-01T10:00:00Z", reason: "fell_behind" }),
      row({ created_at: "2026-10-01T10:00:00Z", reason: "closing_business" }),
      row({ created_at: "2026-08-01T10:00:00Z", reason: "no_results" }),
    ]);

    expect(notes.get("company-1")?.reason).toBe("closing_business");
  });

  /**
   * The caller orders by `created_at DESC`, so taking the first row seen would
   * pass today. This asserts the function does its own comparison, so dropping
   * or changing that ORDER BY cannot silently start showing the oldest reason.
   */
  it("does not depend on the input being sorted", () => {
    const ascending = [
      row({ created_at: "2026-08-01T10:00:00Z", reason: "no_results" }),
      row({ created_at: "2026-09-01T10:00:00Z", reason: "fell_behind" }),
      row({ created_at: "2026-10-01T10:00:00Z", reason: "closing_business" }),
    ];

    expect(latestCancellationByCompany(ascending).get("company-1")?.reason)
      .toBe("closing_business");
    expect(latestCancellationByCompany([...ascending].reverse()).get("company-1")?.reason)
      .toBe("closing_business");
  });

  it("separates companies", () => {
    const notes = latestCancellationByCompany([
      row({ company_id: "company-1", reason: "too_expensive" }),
      row({ company_id: "company-2", reason: "busy_season" }),
    ]);

    expect(notes.size).toBe(2);
    expect(notes.get("company-1")?.reason).toBe("too_expensive");
    expect(notes.get("company-2")?.reason).toBe("busy_season");
  });

  it("keeps an earlier row when a later one belongs to another company", () => {
    const notes = latestCancellationByCompany([
      row({ company_id: "company-1", created_at: "2026-09-01T10:00:00Z", reason: "no_results" }),
      row({ company_id: "company-2", created_at: "2026-10-01T10:00:00Z", reason: "busy_season" }),
    ]);

    expect(notes.get("company-1")?.reason).toBe("no_results");
    expect(notes.get("company-2")?.reason).toBe("busy_season");
  });

  /* ---------------- Unusable rows ---------------- */

  it("skips a row with no company", () => {
    expect(latestCancellationByCompany([row({ company_id: null })]).size).toBe(0);
    expect(latestCancellationByCompany([row({ company_id: "" })]).size).toBe(0);
  });

  it("skips a row that cannot be ranked", () => {
    expect(latestCancellationByCompany([row({ created_at: null })]).size).toBe(0);
    expect(latestCancellationByCompany([row({ created_at: "not a date" })]).size).toBe(0);
  });

  it("still reports a company whose other row is unusable", () => {
    const notes = latestCancellationByCompany([
      row({ created_at: null, reason: "closing_business" }),
      row({ created_at: "2026-09-01T10:00:00Z", reason: "fell_behind" }),
    ]);

    expect(notes.get("company-1")?.reason).toBe("fell_behind");
  });

  /* ---------------- Labels ---------------- */

  it("labels every reason in the catalogue", () => {
    const codes = [
      "too_expensive",
      "fell_behind",
      "no_results",
      "busy_season",
      "missing_feature",
      "closing_business",
    ];

    for (const code of codes) {
      const label = latestCancellationByCompany([row({ reason: code })])
        .get("company-1")?.reasonLabel;
      // Resolved to real copy, not echoed back as the code.
      expect(label).toBeTruthy();
      expect(label).not.toBe(code);
    }
  });

  /**
   * Migration 030 has no CHECK on `reason` precisely so the catalogue can
   * change without a migration, which means retired codes live on in old
   * rows. Echoing the code tells the operator something; dropping the note
   * would tell them the customer gave no reason, which is false.
   */
  it("falls back to the raw code for a reason no longer in the catalogue", () => {
    const note = latestCancellationByCompany([row({ reason: "retired_code_7" })])
      .get("company-1");

    expect(note?.reason).toBe("retired_code_7");
    expect(note?.reasonLabel).toBe("retired_code_7");
  });

  it("says so when no reason was stored", () => {
    const note = latestCancellationByCompany([row({ reason: null })]).get("company-1");

    expect(note?.reason).toBe("");
    expect(note?.reasonLabel).toBe("Not given");
  });

  /* ---------------- Free text ---------------- */

  it("carries the customer's own words", () => {
    const note = latestCancellationByCompany([
      row({ reason_detail: "The forecasts never matched reality." }),
    ]).get("company-1");

    expect(note?.detail).toBe("The forecasts never matched reality.");
  });

  it("collapses whitespace-only detail to null", () => {
    for (const detail of ["", "   ", "\n\t"]) {
      expect(
        latestCancellationByCompany([row({ reason_detail: detail })]).get("company-1")?.detail
      ).toBeNull();
    }
  });

  it("trims the detail it keeps", () => {
    expect(
      latestCancellationByCompany([row({ reason_detail: "  too pricey  " })])
        .get("company-1")?.detail
    ).toBe("too pricey");
  });

  it("tolerates a missing access end date", () => {
    expect(
      latestCancellationByCompany([row({ access_ends_at: null })])
        .get("company-1")?.accessEndsAt
    ).toBeNull();
  });
});
