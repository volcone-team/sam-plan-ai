import { reasonSpec } from "@/lib/billing/cancellation";

/**
 * Reducing `cancellation_feedback` rows to one note per company.
 *
 * WHY THIS IS A FUNCTION AND NOT A QUERY. Postgres can return the newest row
 * per company with a window function, but the admin companies route already
 * fetches five other per-company lookups as plain `.in(company_id, ids)`
 * queries and folds each into a Map. A DISTINCT ON would be a sixth idiom in
 * the same handler for no benefit at page-size volumes, and none of its
 * behaviour would be testable.
 *
 * ONLY REAL CANCELLATIONS COUNT. Migration 030 records a row for every pass
 * through the flow, including the ones who stayed — that is what makes the
 * retention funnel measurable. The admin note is a different question: "why
 * did this company leave", not "when did they last waver". A company that
 * opened the modal, said it was too expensive, took the discount and stayed
 * must not be captioned "Reason for plan cancellation", so `kept` and
 * `offer_accepted` rows are discarded here.
 *
 * THE NOTE SURVIVES REACTIVATION, deliberately. A customer can cancel and then
 * change their mind, which clears `cancel_at_period_end` but leaves the
 * feedback row — correctly, because they did cancel. The note stays and is
 * rendered with its date, so "cancelled in March, came back" remains visible
 * as history instead of being quietly erased by the recovery it caused.
 *
 * No database, no React — same contract as cancellation.ts.
 */

/** The outcome that means the subscription was actually ended. */
const CANCELLED: string = "cancelled";

/**
 * Only the columns this reduction reads.
 *
 * Snake-cased because these are database rows, not a mapped type: naming them
 * as they arrive is what lets the caller pass the query result straight in
 * without an intermediate shape that could drift from the table.
 */
export interface CancellationFeedbackRowLike {
  company_id: string | null;
  reason: string | null;
  reason_detail: string | null;
  outcome: string | null;
  created_at: string | null;
  access_ends_at: string | null;
}

export interface CompanyCancellationNote {
  /** The stored reason code, e.g. `too_expensive`. */
  reason: string;
  /**
   * The customer-facing label from the catalogue, verbatim.
   *
   * Deliberately the same string the customer was shown rather than a terser
   * admin phrasing. Two wordings for one code drift apart, and the operator
   * reading this is usually about to reply to the person who chose it.
   */
  reasonLabel: string;
  /** The "Anything else?" free text, or null when they typed nothing. */
  detail: string | null;
  cancelledAt: string;
  /** When access actually ran out, as captured at cancellation time. */
  accessEndsAt: string | null;
}

/**
 * The newest genuine cancellation for each company.
 *
 * ORDER-INDEPENDENT ON PURPOSE. The caller orders by `created_at DESC`, so
 * taking the first row seen would be correct today — and would break silently
 * the moment someone drops the ORDER BY or adds a secondary sort. Timestamps
 * are compared explicitly instead.
 *
 * Rows missing a company or a timestamp are skipped rather than guessed at:
 * one cannot be attached to anything and the other cannot be ranked, and a
 * note that might be the wrong one is worse than no note.
 */
export function latestCancellationByCompany(
  rows: readonly CancellationFeedbackRowLike[] | null | undefined
): Map<string, CompanyCancellationNote> {
  const latest = new Map<string, { note: CompanyCancellationNote; at: number }>();

  for (const row of rows ?? []) {
    if (row.outcome !== CANCELLED) continue;

    const companyId = row.company_id;
    if (!companyId) continue;

    const createdAt = row.created_at;
    if (!createdAt) continue;

    const at = Date.parse(createdAt);
    // An unparseable timestamp cannot be ranked against the others.
    if (Number.isNaN(at)) continue;

    const existing = latest.get(companyId);
    if (existing && existing.at >= at) continue;

    latest.set(companyId, {
      at,
      note: {
        reason: row.reason ?? "",
        reasonLabel: labelForReason(row.reason),
        // Collapsed to null so the UI has one falsy check rather than two.
        detail: row.reason_detail?.trim() ? row.reason_detail.trim() : null,
        cancelledAt: createdAt,
        accessEndsAt: row.access_ends_at ?? null,
      },
    });
  }

  const result = new Map<string, CompanyCancellationNote>();
  for (const [companyId, { note }] of latest) result.set(companyId, note);
  return result;
}

/**
 * A reason code's human label, falling back to the code itself.
 *
 * NEVER DROPS AN UNRECOGNISED CODE. Migration 030 deliberately puts no CHECK
 * constraint on `reason` so the catalogue can be reworded or reworked without
 * a migration — which means retired codes stay in old rows forever. Showing
 * `legacy_reason_7` tells the operator something; showing nothing tells them
 * the customer gave no reason, which would be false.
 */
function labelForReason(reason: string | null): string {
  if (!reason) return "Not given";
  return reasonSpec(reason)?.label ?? reason;
}
