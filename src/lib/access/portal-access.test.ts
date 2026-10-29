import { describe, it, expect } from "vitest";
import {
  derivePortalAccessState,
  decidePortalAccessChange,
  portalAccessPatch,
  newCompanyGateAction,
  type PortalAccessCompany,
} from "./portal-access";
import { needsCallUnlock } from "./call-gate";

const GRANTED_AT = "2026-10-12T09:00:00.000Z";
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";

/** Waiting: flagged at creation, nobody has opened it yet. */
const waiting: PortalAccessCompany = {
  requires_call_unlock: true,
  portal_access_granted_at: null,
  portal_access_granted_by: null,
};

/** Open: flagged, and an admin opened it after the call. */
const open: PortalAccessCompany = {
  requires_call_unlock: true,
  portal_access_granted_at: GRANTED_AT,
  portal_access_granted_by: ADMIN_ID,
};

describe("derivePortalAccessState", () => {
  it("is not_gated only when there is no company", () => {
    expect(derivePortalAccessState(null)).toBe("not_gated");
    expect(derivePortalAccessState(undefined)).toBe("not_gated");
  });
  it("is waiting when the flag is set and there is no grant", () => {
    expect(derivePortalAccessState(waiting)).toBe("waiting");
    expect(derivePortalAccessState({ requires_call_unlock: true })).toBe("waiting");
  });
  it("is open once a grant exists, flagged or not", () => {
    expect(derivePortalAccessState(open)).toBe("open");
    // Admin-created with full access: decided open, so admin can close it.
    expect(
      derivePortalAccessState({ requires_call_unlock: false, portal_access_granted_at: GRANTED_AT })
    ).toBe("open");
  });
  it("reads an undecided company by the global switch (Oct 2026: every company gets Open / Close)", () => {
    // Switch on: the next page view stamps it, whatever its age.
    expect(derivePortalAccessState({})).toBe("waiting");
    expect(derivePortalAccessState({ requires_call_unlock: false }, { requireCall: true })).toBe("waiting");
    // Switch off: nothing gates it, but admin may still close it.
    expect(derivePortalAccessState({ requires_call_unlock: null }, { requireCall: false })).toBe("open");
  });
});

describe("decidePortalAccessChange", () => {
  it("rejects anything that is not grant or revoke", () => {
    for (const action of ["", "open", "GRANT", "delete"]) {
      const d = decidePortalAccessChange({ action, company: waiting });
      expect(d).toMatchObject({ ok: false, status: 400, error: "bad_action" });
    }
  });

  it("refuses only when there is no company", () => {
    for (const action of ["grant", "revoke"] as const) {
      expect(decidePortalAccessChange({ action, company: null })).toMatchObject({ ok: false, status: 409 });
    }
  });
  it("lets admin open an undecided company (switch on) and close one (switch off)", () => {
    expect(decidePortalAccessChange({ action: "grant", company: {}, requireCall: true })).toMatchObject({
      ok: true,
      outcome: "granted",
    });
    expect(decidePortalAccessChange({ action: "revoke", company: {}, requireCall: false })).toMatchObject({
      ok: true,
      outcome: "revoked",
    });
  });

  it("grants a waiting company, and says to email them", () => {
    expect(decidePortalAccessChange({ action: "grant", company: waiting })).toEqual({
      ok: true,
      outcome: "granted",
      write: true,
      notify: true,
    });
  });

  it("does not re-stamp or re-email an already open company", () => {
    // Two clicks, or two admins, must not move the audit trail's timestamp or
    // send the customer a second "your portal is ready".
    expect(decidePortalAccessChange({ action: "grant", company: open })).toEqual({
      ok: true,
      outcome: "already_granted",
      write: false,
      notify: false,
    });
  });

  it("revokes an open company, and never emails on the way back", () => {
    expect(decidePortalAccessChange({ action: "revoke", company: open })).toEqual({
      ok: true,
      outcome: "revoked",
      write: true,
      notify: false,
    });
  });

  it("treats revoking a waiting company as nothing to do", () => {
    expect(decidePortalAccessChange({ action: "revoke", company: waiting })).toEqual({
      ok: true,
      outcome: "already_waiting",
      write: false,
      notify: false,
    });
  });

  it("only ever emails on a fresh grant", () => {
    const decisions = (["grant", "revoke"] as const).flatMap((action) =>
      [waiting, open].map((company) => decidePortalAccessChange({ action, company }))
    );
    for (const d of decisions) {
      if (d.ok && d.notify) expect(d.outcome).toBe("granted");
    }
  });
});

describe("portalAccessPatch", () => {
  it("stamps the grant and sets the flag", () => {
    expect(portalAccessPatch("granted", ADMIN_ID, GRANTED_AT)).toEqual({
      requires_call_unlock: true,
      portal_access_granted_at: GRANTED_AT,
      portal_access_granted_by: ADMIN_ID,
    });
  });

  it("clears the grant on a revoke and sets the flag, so a never-flagged company really closes", () => {
    const patch = portalAccessPatch("revoked", ADMIN_ID, GRANTED_AT);
    expect(patch).toEqual({
      requires_call_unlock: true,
      portal_access_granted_at: null,
      portal_access_granted_by: null,
    });
    expect(needsCallUnlock({ ...patch })).toBe(true);
  });

  it("puts a revoked company back into the waiting state", () => {
    const patch = portalAccessPatch("revoked", ADMIN_ID, GRANTED_AT);
    expect(derivePortalAccessState({ ...open, ...patch })).toBe("waiting");
  });

  it("puts a granted company into the open state", () => {
    const patch = portalAccessPatch("granted", ADMIN_ID, GRANTED_AT);
    expect(derivePortalAccessState({ ...waiting, ...patch })).toBe("open");
  });
});

describe("newCompanyGateAction (admin create company)", () => {
  it("stamps the call gate as before when no grant was requested", () => {
    expect(
      newCompanyGateAction({ grantRequested: false, adminId: ADMIN_ID, now: GRANTED_AT })
    ).toEqual({ kind: "stamp" });
  });

  it("records the portal as open, flag untouched, when full access was requested", () => {
    const action = newCompanyGateAction({
      grantRequested: true,
      adminId: ADMIN_ID,
      now: GRANTED_AT,
    });
    expect(action).toEqual({
      kind: "record_grant",
      patch: { portal_access_granted_at: GRANTED_AT, portal_access_granted_by: ADMIN_ID },
    });
    if (action.kind !== "record_grant") throw new Error("unreachable");
    expect(Object.keys(action.patch)).not.toContain("requires_call_unlock");

    // The resulting row is decided and open (admin may close it), never waiting.
    const row = { requires_call_unlock: false, ...action.patch };
    expect(needsCallUnlock(row)).toBe(false);
    expect(derivePortalAccessState(row)).toBe("open");
  });
});
