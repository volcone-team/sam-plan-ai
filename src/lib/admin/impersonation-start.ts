/**
 * Who may start an impersonation, and whom they become.
 *
 * Pure, so the two rules that matter most can be tested without a database,
 * an auth server or cookies:
 *   - only a super admin may start one;
 *   - the only account they may become is the target company's OWNER.
 *
 * The route still calls `requireSuperAdmin()` as its primary gate — this does
 * not replace it. Both say "super_admin only", so they cannot disagree; having
 * the rule as a pure function means the refusal paths are covered by tests
 * rather than only by inspection.
 */

export interface OwnerCandidate {
  id: string;
  email: string | null;
  /** ISO timestamp. Used only to break ties between multiple owners. */
  created_at?: string | null;
}

export type ImpersonationStartDecision =
  | { ok: true; targetUserId: string; targetEmail: string }
  | { ok: false; status: number; error: string; message: string };

/**
 * Decide whether this impersonation may proceed.
 *
 * @param adminLevel `profiles.admin_level` of the CALLER.
 * @param companyName for the refusal message.
 * @param owners      profiles in the target company with role = 'owner'.
 */
export function decideImpersonationStart(
  adminLevel: string | null | undefined,
  companyName: string,
  owners: readonly OwnerCandidate[] | null | undefined
): ImpersonationStartDecision {
  /*
   * SUPER ADMIN ONLY. A plain `admin` is refused: impersonation hands over a
   * real, writable session in someone else's account, which is a bigger
   * capability than anything else on the admin surface.
   */
  if (adminLevel !== 'super_admin') {
    return {
      ok: false,
      status: 403,
      error: 'Super admin access required',
      message: 'Only a super admin can view the app as a customer.',
    };
  }

  /*
   * Pick the OLDEST owner when a company has several, so repeated visits land
   * on the same account and the audit trail stays comparable. Owners with no
   * email are unusable — a session is minted by email address — so they are
   * filtered out before the tie-break rather than after, otherwise a
   * mail-less owner could win the sort and then fail to resolve.
   */
  const usable = (owners ?? [])
    .filter((o): o is OwnerCandidate & { email: string } =>
      typeof o.email === 'string' && o.email.length > 0 && typeof o.id === 'string' && o.id.length > 0
    )
    .slice()
    .sort((a, b) => {
      const at = a.created_at ? Date.parse(a.created_at) : Number.POSITIVE_INFINITY;
      const bt = b.created_at ? Date.parse(b.created_at) : Number.POSITIVE_INFINITY;
      if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
      if (Number.isNaN(at)) return 1;
      if (Number.isNaN(bt)) return -1;
      return at - bt;
    });

  const target = usable[0];

  /*
   * NO OWNER — refuse, loudly. The tempting fallbacks are both wrong: any
   * other member would misrepresent whose permissions are on screen, and
   * falling back to the admin's own account is the original bug. Better to say
   * the company needs an owner.
   */
  if (!target) {
    return {
      ok: false,
      status: 409,
      error: 'no_owner',
      message:
        `${companyName} has no owner account, so there is no user to view as. ` +
        `Assign an owner to this company first.`,
    };
  }

  return { ok: true, targetUserId: target.id, targetEmail: target.email };
}
