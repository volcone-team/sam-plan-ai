import { describe, expect, it } from "vitest";
import { parsePortalRequest, portalSessionParams } from "./portal-session";

describe("parsePortalRequest", () => {
  it("treats an empty body as no flow (the /choose-plan call)", () => {
    expect(parsePortalRequest("")).toEqual({ ok: true, flow: null });
    expect(parsePortalRequest("  \n")).toEqual({ ok: true, flow: null });
  });

  it("treats an object without a flow as no flow", () => {
    expect(parsePortalRequest("{}")).toEqual({ ok: true, flow: null });
    expect(parsePortalRequest('{"flow":null}')).toEqual({ ok: true, flow: null });
  });

  it("accepts payment_method_update", () => {
    expect(parsePortalRequest('{"flow":"payment_method_update"}')).toEqual({
      ok: true,
      flow: "payment_method_update",
    });
  });

  it("rejects flows that are not allow-listed, including ones Stripe supports", () => {
    for (const flow of ["subscription_cancel", "subscription_update", "customer_update", "", "PAYMENT_METHOD_UPDATE"]) {
      expect(parsePortalRequest(JSON.stringify({ flow }))).toEqual({ ok: false, error: "invalid_flow" });
    }
    expect(parsePortalRequest('{"flow":1}')).toEqual({ ok: false, error: "invalid_flow" });
    expect(parsePortalRequest('{"flow":{"type":"payment_method_update"}}')).toEqual({
      ok: false,
      error: "invalid_flow",
    });
  });

  it("rejects bodies that are not a JSON object", () => {
    for (const raw of ["not json", "[]", '"payment_method_update"', "null", "42"]) {
      expect(parsePortalRequest(raw)).toEqual({ ok: false, error: "invalid_body" });
    }
  });
});

describe("portalSessionParams", () => {
  const base = { customer: "cus_123", configuration: "bpc_123", appUrl: "https://app.example.com" };

  it("without a flow, opens the portal homepage and returns to /settings", () => {
    expect(portalSessionParams({ ...base, flow: null })).toEqual({
      customer: "cus_123",
      configuration: "bpc_123",
      return_url: "https://app.example.com/settings",
    });
  });

  it("with payment_method_update, deep-links to the card screen and redirects back to /settings", () => {
    expect(portalSessionParams({ ...base, flow: "payment_method_update" })).toEqual({
      customer: "cus_123",
      configuration: "bpc_123",
      return_url: "https://app.example.com/settings",
      flow_data: {
        type: "payment_method_update",
        after_completion: {
          type: "redirect",
          redirect: { return_url: "https://app.example.com/settings" },
        },
      },
    });
  });
});
