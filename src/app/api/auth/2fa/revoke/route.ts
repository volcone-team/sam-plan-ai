import { NextResponse } from "next/server";
import { TWO_FACTOR_COOKIE } from "@/lib/two-factor";

export const runtime = "nodejs";

const COOLDOWN_COOKIE = "sam_2fa_sent";

/**
 * POST /api/auth/2fa/revoke
 *
 * Clears this browser's two-factor device trust, so the next sign-in has to
 * pass the emailed code challenge again.
 *
 * Exists because `sam_2fa` is httpOnly: client code calling
 * `supabase.auth.signOut()` can end the Supabase session but physically cannot
 * delete this cookie. Without this endpoint, signing out left device trust
 * behind for its full 30 days — so the next person to sign in on the same
 * browser skipped two-factor entirely, inheriting trust they never earned.
 *
 * Deliberately NOT tied to session teardown anywhere else: closing a tab or
 * returning days later must keep trust intact (that is the whole point of a
 * 30-day device cookie). Only an explicit sign-out revokes it.
 *
 * NO AUTH CHECK, on purpose. This only ever deletes cookies from the caller's
 * own browser, so the worst an unauthenticated or hostile call can do is force
 * whoever made it to re-verify. Requiring a valid session would defeat the
 * purpose: sign-out flows call this while the session is already being torn
 * down, and ordering is not guaranteed.
 *
 * Always 200 — callers treat this as best-effort and must not block sign-out on
 * the result.
 */
export async function POST() {
  const response = NextResponse.json({ revoked: true });

  // maxAge 0 expires the cookie immediately. Attributes must match how it was
  // set (path, sameSite, secure) or the browser keeps the original.
  response.cookies.set(TWO_FACTOR_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  // Also clear the send-cooldown marker, so the next challenge can issue a code
  // straight away instead of appearing to rate-limit a fresh sign-in.
  response.cookies.set(COOLDOWN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}
