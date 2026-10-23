/**
 * Which access control the admin companies table offers for one company.
 *
 *   revoke → comped; offer "Revoke access"
 *   paying → live paid subscription; no comp (the server refuses it too)
 *   grant  → everything else, INCLUDING a company with no subscriptions row
 *
 * A missing row used to render nothing, so an admin-created company (which had
 * no row) could never be granted access. The comp action now ensures the row
 * before writing, so "no row" is simply "not comped, not paying".
 */
export type AdminAccessAction = "revoke" | "paying" | "grant";

export function adminAccessAction(
  sub: { isComped: boolean; isPaying: boolean } | null | undefined
): AdminAccessAction {
  if (!sub) return "grant";
  if (sub.isComped) return "revoke";
  if (sub.isPaying) return "paying";
  return "grant";
}
