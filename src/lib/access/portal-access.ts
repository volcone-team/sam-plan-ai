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
 * Which of the three states a company is in.
 *
 * `open` requires the FLAG as well as the timestamp. A grant without the flag
 * should not exist — nothing can create one, since granting an ungated company
 * is refused below — and if one somehow appears (a hand-written UPDATE, say)
 * calling it "open" would advertise a gate that was never there. It reads as
 * `not_gated`, which is what the customer experiences.
 */
export function derivePortalAccessState(
  company: PortalAccessCompany | null | undefined
): PortalAccessState {
  if (!company) return "not_gated";
  if (company.requires_call_unlock !== true) return "not_gated";
  return needsCallUnlock(company) ? "waiting" : "open";
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
}): PortalAccessDecision {
  if (args.action !== "grant" && args.action !== "revoke") {
    return {
      ok: false,
      status: 400,
      error: "bad_action",
      message: "action must be 'grant' or 'revoke'.",
    };
  }

  const state = derivePortalAccessState(args.company);

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
): { portal_access_granted_at: string | null; portal_access_granted_by: string | null } {
  return outcome === "granted"
    ? { portal_access_granted_at: now, portal_access_granted_by: grantedBy }
    : { portal_access_granted_at: null, portal_access_granted_by: null };
}
