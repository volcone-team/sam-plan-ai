import { describe, it, expect } from "vitest";
import { adminAccessAction } from "./admin-access-action";

describe("adminAccessAction", () => {
  it("offers Grant access to a company with no subscriptions row", () => {
    expect(adminAccessAction(null)).toBe("grant");
    expect(adminAccessAction(undefined)).toBe("grant");
  });

  it("offers Grant access to a row that is neither comped nor paying", () => {
    expect(adminAccessAction({ isComped: false, isPaying: false })).toBe("grant");
  });

  it("offers Revoke for a comped company", () => {
    expect(adminAccessAction({ isComped: true, isPaying: false })).toBe("revoke");
  });

  it("offers no comp to a paying customer", () => {
    expect(adminAccessAction({ isComped: false, isPaying: true })).toBe("paying");
  });
});
