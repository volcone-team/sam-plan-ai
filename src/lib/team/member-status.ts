import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One definition of a team member's status, shared by the customer's
 * Settings › Team Members screen (/api/team) and the admin Users table
 * (/api/admin/users).
 *
 * "Pending" means the person has never signed in: they were invited but
 * haven't accepted / set a password yet. That fact lives only in Supabase
 * Auth (`last_sign_in_at`), not on `profiles`.
 */

export type MemberStatus = "inactive" | "pending" | "active";

/** A member who has never signed in has not accepted their invite. */
export function isPendingInvite(lastSignInAt: string | null | undefined): boolean {
  return !lastSignInAt;
}

/**
 * Inactive wins: a deactivated member is "inactive" whether or not they
 * ever signed in. Otherwise never-signed-in is "pending", else "active".
 */
export function memberStatus(input: {
  isActive: boolean | null | undefined;
  lastSignInAt: string | null | undefined;
}): MemberStatus {
  // profiles.is_active defaults to true; NULL is treated as active (matches /api/team).
  if (input.isActive === false) return "inactive";
  return isPendingInvite(input.lastSignInAt) ? "pending" : "active";
}

/** Status shown in the admin table. "unknown" = the auth lookup failed or was capped. */
export type AdminMemberStatus = MemberStatus | "unknown";

/**
 * Like memberStatus, but `lastSignInAt === undefined` means "we don't know"
 * (lookup failed / not reached) rather than "never signed in". Inactive still
 * wins because it comes from profiles, not the lookup.
 */
export function adminMemberStatus(input: {
  isActive: boolean | null | undefined;
  lastSignInAt: string | null | undefined;
}): AdminMemberStatus {
  if (input.isActive === false) return "inactive";
  if (input.lastSignInAt === undefined) return "unknown";
  return memberStatus(input);
}

type AdminClient = Pick<SupabaseClient, "auth">;

/** Minimal shape of an auth user that the mapping needs. */
export interface AuthUserSignIn {
  id: string;
  last_sign_in_at?: string | null;
}

/** One page of auth users, or an error. */
export type ListUsersPage =
  | { users: AuthUserSignIn[]; nextPage: number | null; error?: undefined }
  | { users?: undefined; nextPage?: undefined; error: string };

export const LIST_USERS_PER_PAGE = 1000;
/** 10 pages × 1000 = the first 10,000 auth users are scanned. */
export const LIST_USERS_MAX_PAGES = 10;

/**
 * Batched last-sign-in lookup by walking `auth.admin.listUsers` pages
 * (supabase-js has no "get these ids" endpoint).
 *
 * Result map:
 *   - id → ISO string : has signed in
 *   - id → null       : auth user found, never signed in (pending)
 *   - id absent       : UNKNOWN — a page failed, the page cap was hit before
 *                       the id was seen, or no auth user exists for it.
 *                       Callers must not treat absent as active (or pending).
 *
 * Stops as soon as every wanted id has been found, so for small sets the
 * cost is usually one or two requests.
 */
export async function collectLastSignIns(
  ids: readonly string[],
  listPage: (page: number) => Promise<ListUsersPage>,
  maxPages: number = LIST_USERS_MAX_PAGES,
): Promise<Map<string, string | null>> {
  const wanted = new Set(ids);
  const found = new Map<string, string | null>();
  let page = 1;

  for (let i = 0; i < maxPages && found.size < wanted.size; i++) {
    let result: ListUsersPage;
    try {
      result = await listPage(page);
    } catch (err: unknown) {
      result = { error: err instanceof Error ? err.message : String(err) };
    }
    if (result.error !== undefined) {
      console.error("[member-status] listUsers page", page, "failed:", result.error);
      break; // remaining ids stay unknown
    }
    for (const u of result.users) {
      if (wanted.has(u.id)) found.set(u.id, u.last_sign_in_at ?? null);
    }
    if (!result.nextPage) break;
    page = result.nextPage;
  }

  if (found.size < wanted.size) {
    console.warn("[member-status]", wanted.size - found.size, "of", wanted.size, "users unresolved (status unknown)");
  }
  return found;
}

/** collectLastSignIns against a real service-role client. */
export function lookupLastSignInsBatched(
  adminClient: AdminClient,
  ids: readonly string[],
): Promise<Map<string, string | null>> {
  if (ids.length === 0) return Promise.resolve(new Map());
  return collectLastSignIns(ids, async (page) => {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: LIST_USERS_PER_PAGE });
    if (error) return { error: error.message };
    return { users: data.users, nextPage: data.nextPage ?? null };
  });
}

/**
 * Per-id lookup (one getUserById per member) used by /api/team, where the
 * set is a single company's members and usually tiny — cheaper than paging
 * every auth user. Only the first `cap` ids are looked up. A failed lookup
 * is recorded as null; ids beyond the cap are absent. /api/team treats both
 * as pending (its long-standing behaviour).
 */
export async function lookupLastSignInsById(
  adminClient: AdminClient,
  ids: readonly string[],
  cap: number = 100,
): Promise<Map<string, string | null>> {
  const lastSignInById = new Map<string, string | null>();
  await Promise.all(
    ids.slice(0, cap).map(async (id) => {
      try {
        const { data, error } = await adminClient.auth.admin.getUserById(id);
        if (error) {
          console.error("[member-status] getUserById error for", id, ":", error.message);
          lastSignInById.set(id, null);
          return;
        }
        lastSignInById.set(id, data?.user?.last_sign_in_at ?? null);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[member-status] getUserById threw for", id, ":", msg);
        lastSignInById.set(id, null);
      }
    }),
  );
  return lastSignInById;
}
