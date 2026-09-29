/**
 * Shared sign-out helper.
 *
 * Ending the Supabase session is not enough on its own: the `sam_2fa`
 * device-trust cookie is httpOnly, so only the server can delete it. Every
 * sign-out path must therefore also call /api/auth/2fa/revoke, or the next
 * person signing in on this browser inherits trust they never earned and skips
 * the emailed code challenge.
 *
 * Kept in one place because that is easy to forget at each individual call site
 * — and the failure is silent, since everything still appears to work.
 *
 * NOTE: this intentionally does NOT run when a tab closes or a session merely
 * ages. Device trust is meant to survive that for 30 days; only an explicit
 * sign-out revokes it.
 */
export async function revokeDeviceTrust(): Promise<void> {
  try {
    await fetch('/api/auth/2fa/revoke', {
      method: 'POST',
      credentials: 'same-origin',
    });
  } catch {
    // Best-effort: never block sign-out on this. Worst case the cookie survives
    // and the user is not re-challenged on this device — the Supabase session
    // is still ended either way.
  }
}
