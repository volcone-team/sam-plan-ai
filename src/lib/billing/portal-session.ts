import type Stripe from "stripe";

/**
 * Request parsing and session parameters for POST /api/stripe/portal.
 *
 * Pure, so the body validation and the Stripe parameter shape can be tested
 * without a request, a database or Stripe.
 *
 * FLOWS ARE AN ALLOW-LIST. Stripe accepts other `flow_data.type` values, and
 * two of them (`subscription_cancel`, `subscription_update`) are exactly what
 * the portal configuration switches off: cancellation runs through the in-app
 * retention flow and plan changes through /api/stripe/change-plan. Passing a
 * client-supplied type straight through would reopen those doors, so anything
 * not listed here is rejected with a 400.
 */

/** Flows a client may ask for. */
export const PORTAL_FLOWS = ["payment_method_update"] as const;
export type PortalFlow = (typeof PORTAL_FLOWS)[number];

export type PortalRequest =
  | { ok: true; flow: PortalFlow | null }
  | { ok: false; error: "invalid_body" | "invalid_flow" };

function isPortalFlow(value: unknown): value is PortalFlow {
  return typeof value === "string" && (PORTAL_FLOWS as readonly string[]).includes(value);
}

/**
 * Parse the raw request body.
 *
 * An EMPTY body is valid and means "no flow": /choose-plan posts with no body
 * and must keep landing on the portal homepage. A body that is present must
 * be a JSON object; `flow`, if present, must be one of PORTAL_FLOWS.
 */
export function parsePortalRequest(rawBody: string): PortalRequest {
  if (rawBody.trim() === "") return { ok: true, flow: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: "invalid_body" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "invalid_body" };
  }

  const flow: unknown = (parsed as Record<string, unknown>).flow;
  if (flow === undefined || flow === null) return { ok: true, flow: null };
  if (!isPortalFlow(flow)) return { ok: false, error: "invalid_flow" };
  return { ok: true, flow };
}

/**
 * Parameters for `billingPortal.sessions.create`.
 *
 * `return_url` is the "back to SAM" link Stripe shows on every portal screen.
 *
 * For the card-update flow, `after_completion: redirect` sends the customer
 * straight back to Settings once the new card is saved, instead of leaving
 * them on Stripe's confirmation page. Stripe deep-link docs:
 * https://docs.stripe.com/customer-management/portal-deep-links
 */
export function portalSessionParams(input: {
  customer: string;
  configuration: string;
  appUrl: string;
  flow: PortalFlow | null;
}): Stripe.BillingPortal.SessionCreateParams {
  const returnUrl = `${input.appUrl}/settings`;
  const params: Stripe.BillingPortal.SessionCreateParams = {
    customer: input.customer,
    configuration: input.configuration,
    return_url: returnUrl,
  };

  if (input.flow === "payment_method_update") {
    params.flow_data = {
      type: "payment_method_update",
      after_completion: {
        type: "redirect",
        redirect: { return_url: returnUrl },
      },
    };
  }

  return params;
}
