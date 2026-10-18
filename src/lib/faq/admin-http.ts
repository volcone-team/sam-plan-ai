/**
 * Shared plumbing for the FAQ admin routes (`src/app/api/admin/faq/**`).
 *
 * The generic pieces (service-role client, JSON body parsing, display-order
 * detection, audit logging) are the SAM University ones, re-exported; only the
 * error mapping is FAQ-specific.
 */
import { NextResponse } from "next/server";
import { FaqAdminError } from "./admin-repo";

export {
  adminClient,
  hasDisplayOrder,
  invalidBody,
  readJsonObject,
  logUniversityAction as logFaqAction,
} from "@/lib/university/admin-http";

/** Map any thrown value to a JSON response. */
export function faqErrorResponse(err: unknown, context: string): NextResponse {
  if (err instanceof FaqAdminError) {
    const body: Record<string, unknown> = { error: err.code, message: err.message };
    if (err.errors) body.errors = err.errors;
    return NextResponse.json(body, { status: err.status });
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[admin/faq] ${context} error:`, message);
  return NextResponse.json({ error: "internal", message: message || "Internal error" }, { status: 500 });
}

/** 404 for a malformed or unknown id. */
export function faqNotFound(what: "Category" | "Question"): NextResponse {
  return NextResponse.json({ error: "not_found", message: `${what} not found.` }, { status: 404 });
}
