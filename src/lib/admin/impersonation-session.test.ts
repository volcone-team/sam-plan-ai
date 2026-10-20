import { describe, it, expect } from "vitest";
import {
  decideBannerState,
  resolveImpersonationView,
} from "./impersonation-session";
import {
  IMPERSONATION_MAX_AGE_SECONDS,
  type ImpersonationMarker,
  type ImpersonationReturn,
} from "./impersonation";

const NOW = 1_760_000_000_000;
const TARGET = "owner-1";

function marker(overrides: Partial<ImpersonationMarker> = {}): ImpersonationMarker {
  return {
    companyId: "company-1",
    companyName: "Acme Co",
    adminUserId: "admin-1",
    adminEmail: "admin@volcone.com",
    targetUserId: TARGET,
    targetEmail: "owner@acme.test",
    startedAt: NOW,
    expiresAt: NOW + IMPERSONATION_MAX_AGE_SECONDS * 1000,
    ...overrides,
  };
}

function ticket(overrides: Partial<ImpersonationReturn> = {}): ImpersonationReturn {
  return {
    adminUserId: "admin-1",
    adminEmail: "admin@volcone.com",
    refreshToken: "refresh-token-value",
    expiresAt: NOW + IMPERSONATION_MAX_AGE_SECONDS * 1000,
    ...overrides,
  };
}

/**
 * The shape /api/me reports, under the three combinations that matter. The
 * middle one is the whole point of the redesign: a marker the server cannot
 * read must NOT be able to hide the Exit button.
 */
describe("resolveImpersonationView", () => {
  it("ticket + marker: reports full detail", () => {
    const view = resolveImpersonationView({
      ticket: ticket(),
      marker: marker(),
      sessionUserId: TARGET,
    });

    expect(view).toEqual({
      companyName: "Acme Co",
      targetEmail: "owner@acme.test",
      adminEmail: "admin@volcone.com",
      expiresAt: NOW + IMPERSONATION_MAX_AGE_SECONDS * 1000,
      degraded: false,
    });
  });

  it("ticket only: still reports an impersonation, degraded", () => {
    // The failure mode that caused the bug. Whatever is wrong with the marker
    // — absent, unsigned, malformed, signed with a rotated secret — the admin
    // must still be told they are impersonating and offered the way out.
    const view = resolveImpersonationView({
      ticket: ticket(),
      marker: null,
      sessionUserId: TARGET,
    });

    expect(view).not.toBeNull();
    expect(view?.degraded).toBe(true);
    expect(view?.companyName).toBe("this company");
    expect(view?.targetEmail).toBe("the owner");
    // The admin's own address is known from the ticket even with no marker.
    expect(view?.adminEmail).toBe("admin@volcone.com");
    // No invented deadline: null, so nothing auto-exits on a guess.
    expect(view?.expiresAt).toBeNull();
  });

  it("neither: reports nothing", () => {
    expect(
      resolveImpersonationView({ ticket: null, marker: null, sessionUserId: TARGET })
    ).toBeNull();
  });

  it("marker without a ticket: reports nothing", () => {
    // A marker alone cannot be exited from — the endpoint needs the ticket —
    // so offering a dead button would be worse than offering none. The
    // middleware separately refuses to honour a marker the session does not
    // own, so ignoring it here grants nothing.
    expect(
      resolveImpersonationView({ ticket: null, marker: marker(), sessionUserId: TARGET })
    ).toBeNull();
  });

  it("marker naming a different user: degrades rather than lying", () => {
    // A leftover marker from a previous impersonation in the same browser. Its
    // company name and countdown would be false, so they are dropped — but the
    // banner still appears, because the ticket says one is in progress.
    const view = resolveImpersonationView({
      ticket: ticket(),
      marker: marker({ targetUserId: "someone-else", companyName: "Stale Co" }),
      sessionUserId: TARGET,
    });

    expect(view?.degraded).toBe(true);
    expect(view?.companyName).not.toBe("Stale Co");
  });

  it("uses the marker when the session user is unknown", () => {
    // /api/me reports impersonation even with no readable session, so that a
    // stranded admin can still get home.
    const view = resolveImpersonationView({
      ticket: ticket(),
      marker: marker(),
      sessionUserId: null,
    });

    expect(view?.degraded).toBe(false);
    expect(view?.companyName).toBe("Acme Co");
  });

  it("falls back for blank display fields", () => {
    const view = resolveImpersonationView({
      ticket: ticket({ adminEmail: "ticket@volcone.com" }),
      marker: marker({ companyName: "", targetEmail: "", adminEmail: "" }),
      sessionUserId: TARGET,
    });

    expect(view?.companyName).toBe("this company");
    expect(view?.targetEmail).toBe("the owner");
    expect(view?.adminEmail).toBe("ticket@volcone.com");
    expect(view?.degraded).toBe(false);
  });
});

/**
 * The banner's own decision, with NO cookie involved anywhere — the signal is
 * the `/api/me` view object and nothing else. This is the property the old
 * implementation could not have: it rendered from `document.cookie`, so a
 * decoding failure was indistinguishable from "not impersonating".
 */
describe("decideBannerState", () => {
  const view = {
    companyName: "Acme Co",
    targetEmail: "owner@acme.test",
    adminEmail: "admin@volcone.com",
    expiresAt: NOW + 60_000,
    degraded: false,
  };

  it("shows from the server signal alone", () => {
    const state = decideBannerState({
      impersonation: view,
      pathname: "/year-at-a-glance",
      hiddenPath: false,
      now: NOW,
    });

    expect(state.show).toBe(true);
    if (!state.show) throw new Error("unreachable");
    expect(state.view.targetEmail).toBe("owner@acme.test");
    expect(state.showCountdown).toBe(true);
    expect(state.remainingMs).toBe(60_000);
    expect(state.elapsed).toBe(false);
  });

  it("hides when there is no impersonation", () => {
    expect(
      decideBannerState({
        impersonation: null,
        pathname: "/year-at-a-glance",
        hiddenPath: false,
        now: NOW,
      }).show
    ).toBe(false);
  });

  it("hides on a suppressed path", () => {
    expect(
      decideBannerState({
        impersonation: view,
        pathname: "/auth/login",
        hiddenPath: true,
        now: NOW,
      }).show
    ).toBe(false);
  });

  it("shows WITHOUT a countdown when the deadline is unknown", () => {
    // Degraded case. The banner and the Exit button appear; no clock is shown
    // and `elapsed` stays false, so the auto-exit cannot fire on a number we
    // do not have.
    const state = decideBannerState({
      impersonation: { ...view, expiresAt: null, degraded: true },
      pathname: "/year-at-a-glance",
      hiddenPath: false,
      now: NOW,
    });

    expect(state.show).toBe(true);
    if (!state.show) throw new Error("unreachable");
    expect(state.showCountdown).toBe(false);
    expect(state.remainingMs).toBeNull();
    expect(state.elapsed).toBe(false);
    expect(state.view.degraded).toBe(true);
  });

  it("reports elapsed once the window closes, so the banner auto-exits", () => {
    const state = decideBannerState({
      impersonation: view,
      pathname: "/year-at-a-glance",
      hiddenPath: false,
      now: NOW + 60_001,
    });

    expect(state.show).toBe(true);
    if (!state.show) throw new Error("unreachable");
    expect(state.elapsed).toBe(true);
    expect(state.remainingMs).toBe(0);
  });

  it("floors the countdown at zero rather than going negative", () => {
    const state = decideBannerState({
      impersonation: view,
      pathname: "/year-at-a-glance",
      hiddenPath: false,
      now: NOW + 10 * 60 * 60 * 1000,
    });

    if (!state.show) throw new Error("unreachable");
    expect(state.remainingMs).toBe(0);
  });
});
