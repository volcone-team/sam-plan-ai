import { describe, it, expect } from "vitest";
import {
  IMPERSONATION_EXIT_PATH,
  isBlockedWhileImpersonating,
} from "./impersonation-blocked";

describe("isBlockedWhileImpersonating — blocked", () => {
  it("blocks every admin API", () => {
    for (const path of [
      "/api/admin",
      "/api/admin/companies",
      "/api/admin/users/create",
      "/api/admin/settings",
      "/api/admin/workbook",
      "/api/admin/subscribers/pause",
    ]) {
      expect(isBlockedWhileImpersonating(path, "POST")).toBe(true);
    }
  });

  it("blocks starting a second impersonation from inside the first", () => {
    // Nesting would overwrite the return ticket and strand the admin as the
    // customer with no way back.
    expect(isBlockedWhileImpersonating("/api/admin/impersonate", "POST")).toBe(true);
  });

  it("blocks admin pages", () => {
    expect(isBlockedWhileImpersonating("/admin", "GET")).toBe(true);
    expect(isBlockedWhileImpersonating("/admin/companies", "GET")).toBe(true);
    expect(isBlockedWhileImpersonating("/admin/subscriptions", "GET")).toBe(true);
  });

  it("blocks password change", () => {
    expect(isBlockedWhileImpersonating("/api/me/password", "POST")).toBe(true);
  });

  it("blocks account deletion but not reading the profile", () => {
    // Same path, different verdict by method: the AuthProvider needs the GET
    // to render any page at all.
    expect(isBlockedWhileImpersonating("/api/me", "DELETE")).toBe(true);
    expect(isBlockedWhileImpersonating("/api/me", "GET")).toBe(false);
  });

  it("is case-insensitive about the method", () => {
    expect(isBlockedWhileImpersonating("/api/me", "delete")).toBe(true);
  });

  it("blocks the password-setting pages", () => {
    // Reachable by accident: an impersonated session's `amr` is 'otp', so the
    // middleware's link-only confinement would have redirected the admin here
    // for an owner who never chose a password. Setting a customer's password
    // is not part of "viewing as".
    expect(isBlockedWhileImpersonating("/auth/set-password", "GET")).toBe(true);
    expect(isBlockedWhileImpersonating("/auth/reset-password", "GET")).toBe(true);
  });

  it("blocks giving consent on the customer's behalf", () => {
    expect(isBlockedWhileImpersonating("/api/auth/invite-consent", "POST")).toBe(true);
  });

  it("does not block the rest of the auth area", () => {
    // Sign-in, sign-out and the impersonation exit landing page must stay
    // reachable — they are how the admin stops being the customer.
    expect(isBlockedWhileImpersonating("/auth/login", "GET")).toBe(false);
    expect(isBlockedWhileImpersonating("/auth/impersonation-ended", "GET")).toBe(false);
  });

  it("blocks all 2FA endpoints", () => {
    // Requirement 7: no code emailed to the customer, and no 30-day device
    // trust written for the customer's account on the admin's machine.
    for (const path of [
      "/api/auth/2fa/send",
      "/api/auth/2fa/verify",
      "/api/auth/2fa/grant",
      "/api/auth/2fa/revoke",
    ]) {
      expect(isBlockedWhileImpersonating(path, "POST")).toBe(true);
    }
  });
});

describe("isBlockedWhileImpersonating — allowed", () => {
  it("allows the exit endpoint despite its /api/admin prefix", () => {
    // The one exception. Blocked, the Exit button would 403 and an admin who
    // dismissed the banner would stay signed in as the customer.
    expect(isBlockedWhileImpersonating(IMPERSONATION_EXIT_PATH, "POST")).toBe(false);
    expect(IMPERSONATION_EXIT_PATH.startsWith("/api/admin")).toBe(true);
  });

  it("allows billing, by explicit decision", () => {
    // Owner's choice: an admin helping a customer through a plan change is a
    // main use of impersonation. The banner warns that these are real.
    for (const path of [
      "/api/billing/me",
      "/api/billing/reconcile",
      "/api/billing/checkout",
      "/api/billing/cancel",
      "/api/billing/plan-change",
      "/api/stripe/checkout",
      "/api/stripe/portal",
    ]) {
      expect(isBlockedWhileImpersonating(path, "POST")).toBe(false);
    }
  });

  it("allows the customer app and its APIs", () => {
    for (const path of [
      "/year-at-a-glance",
      "/planner",
      "/initiatives",
      "/products",
      "/reports",
      "/settings",
      "/api/me",
      "/api/plan/year",
      "/api/intake/recommend",
      "/api/intake/build",
      "/api/generate-plan",
    ]) {
      expect(isBlockedWhileImpersonating(path, "POST")).toBe(false);
    }
  });

  it("does not block paths that merely start with a blocked word", () => {
    // Prefix matching must respect segment boundaries, or an unrelated route
    // like /administrators would be caught by the /admin rule.
    expect(isBlockedWhileImpersonating("/administrators", "GET")).toBe(false);
    expect(isBlockedWhileImpersonating("/api/administration", "GET")).toBe(false);
    expect(isBlockedWhileImpersonating("/api/me/passwordless", "POST")).toBe(false);
  });

  it("defaults to GET for page navigations", () => {
    expect(isBlockedWhileImpersonating("/api/me")).toBe(false);
    expect(isBlockedWhileImpersonating("/admin/companies")).toBe(true);
  });

  it("handles empty input", () => {
    expect(isBlockedWhileImpersonating("", "GET")).toBe(false);
  });
});
