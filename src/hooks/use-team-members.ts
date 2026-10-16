"use client";

import { useEffect, useState } from "react";

/**
 * The people in this company who can be given work.
 *
 * Fetched from /api/team, which is already the single source for the team list
 * on the settings page — rather than querying `profiles` from the browser,
 * where RLS and the auth lookups for invite status would have to be
 * reimplemented.
 *
 * ALWAYS INCLUDES THE CALLER. A one-person company still needs to be able to
 * assign a task, and "assign it to me" is the common case; a dropdown that
 * only listed OTHER people would be empty for most accounts.
 */

export interface TeamMember {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  isActive: boolean;
  /** Invited but has never signed in, so they have not set a password yet. */
  pending: boolean;
}

/**
 * The one role that cannot be assigned work.
 *
 * Named rather than inlined so the reason travels with it: a viewer has
 * read-only access and could not move a task they were given.
 */
const ASSIGNMENT_EXCLUDED_ROLE = "viewer";

export interface UseTeamMembers {
  members: TeamMember[];
  loading: boolean;
  error: string | null;
}

/**
 * A member's display name, falling back to their email.
 *
 * An invited member has a row before they have ever filled in a name, so
 * `first_name` and `last_name` are empty strings — rendering those would put a
 * blank entry in the dropdown. The email is always present and always
 * identifies them.
 */
export function memberLabel(member: TeamMember): string {
  const name = [member.firstName, member.lastName]
    .filter((part) => part && part.trim())
    .join(" ")
    .trim();

  return name || member.email;
}

export function useTeamMembers(): UseTeamMembers {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/team", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Could not load your team (${response.status}).`);
        }

        const body = (await response.json()) as { members?: TeamMember[] };
        if (cancelled) return;

        /**
         * Who can be given work.
         *
         * DEACTIVATED MEMBERS ARE DROPPED. Someone switched off should not
         * collect new work.
         *
         * PENDING MEMBERS ARE KEPT. An invited colleague who has not signed in
         * yet absolutely can be assigned something — handing them a task is
         * often why they were invited, and it is waiting when they arrive.
         *
         * VIEWERS ARE DROPPED. The role is read-only by definition: a viewer
         * cannot change a task's status, so assigning one work would create an
         * item nobody is able to progress. The role list is on `profiles` in
         * migration 001 — owner, operator, team_member, viewer — and viewer is
         * the only one without write access.
         */
        setMembers(
          (body.members ?? []).filter(
            (member) => member.isActive !== false && member.role !== ASSIGNMENT_EXCLUDED_ROLE
          )
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { members, loading, error };
}
