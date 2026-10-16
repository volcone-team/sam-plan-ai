import { describe, it, expect } from "vitest";
import {
  roleHasPermission,
  getPermissionsForRole,
  isReadOnly,
  type AccessRole,
  type Permission,
} from "./permissions";

const ROLES: AccessRole[] = ["owner", "operator", "team_member", "viewer"];

describe("settings.billing — the owner-only gate", () => {
  /**
   * THE DISCLOSURE THIS CLOSES. The Subscription tab was visible to every
   * member, showing the plan, the price, the renewal date and the invoice
   * history — including links straight to the documents in Stripe — plus a
   * cancel button. Only an owner may see any of it.
   */
  it("is granted to the owner and nobody else", () => {
    expect(roleHasPermission("owner", "settings.billing")).toBe(true);
    for (const role of ["operator", "team_member", "viewer"] as const) {
      expect(roleHasPermission(role, "settings.billing"), role).toBe(false);
    }
  });

  /**
   * Deliberately NOT the same as settings.company. An operator may edit the
   * company's details without being shown what it pays.
   */
  it("is separate from settings.company, which an operator does have", () => {
    expect(roleHasPermission("operator", "settings.company")).toBe(true);
    expect(roleHasPermission("operator", "settings.billing")).toBe(false);
  });
});

describe("settings.manage_team", () => {
  it("is owner-only, so the Team Members tab stays hidden from the rest", () => {
    expect(roleHasPermission("owner", "settings.manage_team")).toBe(true);
    for (const role of ["operator", "team_member", "viewer"] as const) {
      expect(roleHasPermission(role, "settings.manage_team"), role).toBe(false);
    }
  });
});

describe("roleHasPermission", () => {
  /**
   * An unknown or absent role must never be treated as permissive. This is the
   * value present while the session is still loading, so failing open here
   * would flash privileged UI to everyone on first paint.
   */
  it("denies everything for an absent or unrecognised role", () => {
    const everything: Permission[] = [
      "initiatives.create", "initiatives.edit", "initiatives.delete",
      "products.create", "products.edit", "products.delete",
      "tasks.create", "tasks.edit", "tasks.delete", "tasks.complete",
      "results.log", "plan.regenerate",
      "settings.company", "settings.manage_team", "settings.billing",
    ];

    for (const permission of everything) {
      expect(roleHasPermission(null, permission), permission).toBe(false);
      expect(roleHasPermission("", permission), permission).toBe(false);
      expect(roleHasPermission("administrator", permission), permission).toBe(false);
      expect(roleHasPermission("Owner", permission), permission).toBe(false);
    }
  });
});

describe("viewer", () => {
  /**
   * The reported bug was a "viewer" completing tasks. It turned out to be an
   * owner, but this pins the intent: a viewer holds no mutation permission at
   * all, and task completion specifically is denied.
   */
  it("has no permissions whatsoever", () => {
    expect(getPermissionsForRole("viewer")).toEqual([]);
  });

  it("cannot complete tasks", () => {
    expect(roleHasPermission("viewer", "tasks.complete")).toBe(false);
    // team_member is the lowest role that can, which is what the role is for.
    expect(roleHasPermission("team_member", "tasks.complete")).toBe(true);
  });

  it("is the only role reported as read-only", () => {
    expect(isReadOnly("viewer")).toBe(true);
    for (const role of ["owner", "operator", "team_member"] as const) {
      expect(isReadOnly(role), role).toBe(false);
    }
  });

  /** No role means no trust, same as viewer. */
  it("treats an absent role as read-only", () => {
    expect(isReadOnly(null)).toBe(true);
    expect(isReadOnly("")).toBe(true);
  });
});

describe("the role hierarchy", () => {
  /**
   * Each role should be a superset of the one below, or the matrix has a hole
   * where a lesser role can do something a greater one cannot.
   */
  it("never gives a lesser role something a greater role lacks", () => {
    const ordered: AccessRole[] = ["viewer", "team_member", "operator", "owner"];

    for (let i = 0; i < ordered.length - 1; i += 1) {
      const lesser = getPermissionsForRole(ordered[i]);
      const greater = getPermissionsForRole(ordered[i + 1]);

      for (const permission of lesser) {
        expect(
          greater.includes(permission),
          `${ordered[i + 1]} should also have ${permission} (held by ${ordered[i]})`
        ).toBe(true);
      }
    }
  });

  it("gives the owner every permission any role has", () => {
    const owner = getPermissionsForRole("owner");
    for (const role of ROLES) {
      for (const permission of getPermissionsForRole(role)) {
        expect(owner.includes(permission), `owner missing ${permission}`).toBe(true);
      }
    }
  });

  it("returns an empty list for an unknown role rather than throwing", () => {
    expect(getPermissionsForRole("nonsense")).toEqual([]);
    expect(getPermissionsForRole(null)).toEqual([]);
  });
});
