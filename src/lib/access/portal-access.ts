/**
 * Per-company portal access: what state the onboarding call gate has a company
 * in, and what an admin's "open it" / "close it again" is allowed to do.
 *
 * The decision half of /api/admin/companies/[id]/portal-access, kept pure so
 * the route and the admin table agree. The route owns the database, the email
 * and the audit row; everything that can be got wrong by reasoning about two
 * columns lives here, where it is tested.
 *
 * THE GATE ITSELF IS NOT RESTATED. `needsCallUnlock` (./call-gate) already
 * answers "is this company waiting", and the middleware, the APIs and the
 * thank-you page all go through it. A second copy of `flag && !granted` in the
 * admin path is exactly how an admin screen comes to disagree with the gate
 * the customer actually meets.
 *
 * NOT BILLING, the same way the rest of ./call-gate is not: "Grant access" on
 * the companies table comps a subscription, and this opens a door. A company
 * can be comped and still waiting for its call, or unlocked and past due.
 */

import { needsCallUnlock, type CallGateCompany } from "./call-gate";

/**
 * The company columns this module reads (migration 043).
 *
 * ALL OPTIONAL, as in CallGateCompany and for the same reason: 043 is applied
 * by hand, so a selected row may simply not have the fields. Absent reads as
 * "never gated", which is what the gate does too.
 */
export interface PortalAccessCompany extends CallGateCompany {
  portal_access_granted_by?: string | null;
}

export type PortalAccessState =
  /** Not part of the gate. Every company predating 043 is here. */
  | "not_gated"
  /** Flagged and no grant yet: the customer is on the thank-you page. */
  | "waiting"
  /** An admin opened the portal after the call. */
  | "open";

/**
 * Which state a company is in, as admin shows it.
 *
 * EVERY COMPANY GETS OPEN / CLOSE (Oct 2026). Before, a company with no flag
 * read as `not_gated` and admin had no control over it — the case of a
 * customer who paid more than ten minutes after registering.
 *
 *   flagged, no grant            -> waiting (on the thank-you page)
 *   any grant                    -> open    (admin may close it again)
 *   no flag, no grant (undecided):
 *       switch on  -> waiting: the next page view stamps it (no age limit)
 *       switch off -> open: nothing gates it, but admin may still close it
 *
 * `requireCall` is the global switch; omitted reads as on. `not_gated` is now
 * returned only when there is no company at all.
 */
export function derivePortalAccessState(
  company: PortalAccessCompany | null | undefined,
  opts: { requireCall?: boolean } = {}
): PortalAccessState {
  if (!company) return "not_gated";
  if (company.portal_access_granted_at) return "open";
  if (company.requires_call_unlock === true) return "waiting";
  return opts.requireCall === false ? "open" : "waiting";
}

export type PortalAccessAction = "grant" | "revoke";

/** Why the decision went the way it did. Reported to the admin and logged. */
export type PortalAccessOutcome =
  /** Waiting -> open. The one case that emails the customer. */
  | "granted"
  /** Open -> waiting. Silent: nobody is told a door closed. */
  | "revoked"
  /** Already open. No write, no second email. */
  | "already_granted"
  /** Already waiting. Nothing to clear. */
  | "already_waiting";

export type PortalAccessDecision =
  | {
      ok: true;
      outcome: PortalAccessOutcome;
      /** False means this request changes nothing: do not write, do not email. */
      write: boolean;
      /**
       * Send the "your portal is open" email.
       *
       * Only ever true for a fresh grant. Re-granting must not resend —
       * an admin clicking twice, or two admins clicking at once, would
       * otherwise mail the customer again about a door that was already open.
       */
      notify: boolean;
    }
  | {
      ok: false;
      status: number;
      error: "not_gated" | "bad_action";
      message: string;
    };

/**
 * What an admin's grant or revoke is allowed to do.
 *
 * REFUSES AN UNGATED COMPANY rather than writing to it. Stamping
 * `portal_access_granted_at` on a company whose `requires_call_unlock` is
 * false would record that somebody was let through a gate they were never
 * behind, and would leave a row no code path can produce. 409 rather than 400
 * because nothing about the request is malformed — the company is simply not
 * in a state this action applies to, which is the same reading the sibling
 * route's `migration_required` 409 has.
 *
 * IDEMPOTENT IN BOTH DIRECTIONS. Granting an open company and revoking a
 * waiting one both succeed with `write: false`, so the caller can report "it
 * was already open" instead of either erroring or silently re-stamping the
 * timestamp (which would move the audit trail's "when" to the second click).
 */
export function decidePortalAccessChange(args: {
  action: PortalAccessAction | string;
  company: PortalAccessCompany | null | undefined;
  /** The global switch; see derivePortalAccessState. */
  requireCall?: boolean;
}): PortalAccessDecision {
  if (args.action !== "grant" && args.action !== "revoke") {
    return {
      ok: false,
      status: 400,
      error: "bad_action",
      message: "action must be 'grant' or 'revoke'.",
    };
  }

  const state = derivePortalAccessState(args.company, { requireCall: args.requireCall });

  if (state === "not_gated") {
    return {
      ok: false,
      status: 409,
      error: "not_gated",
      message:
        "This company does not need an onboarding call, so its portal is " +
        "already open and there is nothing to grant or revoke.",
    };
  }

  if (args.action === "grant") {
    return state === "open"
      ? { ok: true, outcome: "already_granted", write: false, notify: false }
      : { ok: true, outcome: "granted", write: true, notify: true };
  }

  return state === "waiting"
    ? { ok: true, outcome: "already_waiting", write: false, notify: false }
    : { ok: true, outcome: "revoked", write: true, notify: false };
}

/**
 * The column patch for a decision that writes.
 *
 * Revoke CLEARS BOTH COLUMNS and leaves `requires_call_unlock` alone, which is
 * what puts the company back in the waiting state rather than out of the gate
 * entirely. Dropping the flag instead would open the portal permanently — the
 * opposite of a revoke — because `needsCallUnlock` reads an unflagged company
 * as never gated.
 *
 * @param grantedBy profiles.id of the acting admin. Recorded unvalidated and
 *                  with no FK (see migration 043): it is an audit trail, and
 *                  deleting the admin must not erase who opened the account.
 */
export function portalAccessPatch(
  outcome: PortalAccessOutcome,
  grantedBy: string | null,
  now: string
): {
  requires_call_unlock: true;
  portal_access_granted_at: string | null;
  portal_access_granted_by: string | null;
} {
  // The flag is set on BOTH: an admin decision puts the company under the
  // gate's control, so a close on a never-flagged company really closes it
  // (needsCallUnlock reads an unflagged company as open).
  return outcome === "granted"
    ? { requires_call_unlock: true, portal_access_granted_at: now, portal_access_granted_by: grantedBy }
    : { requires_call_unlock: true, portal_access_granted_at: null, portal_access_granted_by: null };
}

export type NewCompanyGateAction =
  /** Snapshot the global switch onto the company (stampCallUnlockForNewCompany). */
  | { kind: "stamp" }
  /** Record the admin's decision: portal open, flag left false. */
  | {
      kind: "record_grant";
      patch: { portal_access_granted_at: string; portal_access_granted_by: string | null };
    };

/**
 * What the admin create-company route does about the onboarding call gate.
 *
 * WITH "GRANT FULL ACCESS" the route used to skip the stamp and write nothing,
 * which leaves the company looking undecided (flag false, no grant). The
 * backstop stamps in the middleware and on /welcome read that as a new signup
 * nobody has decided on and set the flag, locking the comped owner behind a
 * call. Recording `portal_access_granted_at` marks the decision as made, so
 * every backstop (all of which skip a row with a grant) leaves it alone.
 *
 * The flag stays false, so derivePortalAccessState reads this company as
 * `not_gated`, which is what the customer experiences.
 */
export function newCompanyGateAction(args: {
  grantRequested: boolean;
  adminId: string | null;
  now: string;
}): NewCompanyGateAction {
  if (!args.grantRequested) return { kind: "stamp" };
  const patch = portalAccessPatch("granted", args.adminId, args.now);
  return {
    kind: "record_grant",
    patch: {
      portal_access_granted_at: patch.portal_access_granted_at as string,
      portal_access_granted_by: patch.portal_access_granted_by,
    },
  };
}
