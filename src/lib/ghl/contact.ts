import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseGhlEmail } from "@/lib/ghl/client";

/**
 * Who, exactly, is the GoHighLevel contact for a company?
 *
 * A GHL CONTACT IS A PERSON, NOT AN ACCOUNT. Everything on the far side of
 * this integration — tags, workflows, emails — lands in somebody's inbox. Our
 * data model, by contrast, is company-shaped: a subscription belongs to a
 * `companies` row, not to a human. So every producer that wants to say "this
 * customer just bought / cancelled / finished their intake" has to cross from
 * the company to a single person first, and that crossing is this module.
 *
 * THE OWNER, AND ONLY THE OWNER. This is a client requirement, not a
 * performance shortcut, so it is stated here rather than buried at a call
 * site: invited team members never become GHL contacts. Two reasons it
 * matters, both of them expensive to get wrong:
 *
 *   - Tagging the wrong member puts a TEAM MEMBER into a buyer workflow. They
 *     did not buy anything, they cannot cancel anything, and they are about
 *     to receive billing and retention email about someone else's card. That
 *     is the client's reputation, in the client's CRM, and it cannot be
 *     untagged out of a workflow that has already sent.
 *   - Contacts are created implicitly by the first delivered event (see
 *     `drain.ts` — it upserts from the row's email). So resolving a member
 *     here does not merely mis-tag an existing contact, it MANUFACTURES one.
 *     A five-person agency would quietly become five contacts in a CRM the
 *     client pays for per contact, and only one of them is a customer.
 *
 * NEVER THROWS. Same contract as `enqueueGhlEvent` and for the same reason:
 * the callers are the Stripe webhook, intake build, plan generation and
 * login. A company with no owner profile, or an owner with no address, is a
 * DATA GAP — a real and reachable state (an admin-created company whose owner
 * invite never landed, a profile row deleted by hand) — and it is reported as
 * a reason rather than raised as an error.
 *
 * The lookup matches the one in `/api/admin/companies/[id]/portal-access`
 * (`profiles` where `company_id` = x and `role` = 'owner'), deliberately: the
 * two answer the same question — "who is the human behind this account" — and
 * they must not drift on it.
 */

/* ------------------------------------------------------------------ *
 * The contact
 * ------------------------------------------------------------------ */

/**
 * Everything the outbox and the drain need about a person.
 *
 * The three optional name fields map onto what `deliverGhlRow` reads out of
 * `payload` (firstName / lastName / companyName) and passes to the contact
 * upsert. They are NULL rather than "" when unknown: GHL reads a present null
 * as "clear this field", and the client's own team types names into these
 * contacts, so an empty string here would wipe real data. `drain.ts` filters
 * blanks out for exactly that reason; this module simply does not produce
 * them.
 */
export interface GhlOwnerContact {
  /** Normalised, lowercased — the GHL join key. Never blank on an `ok` result. */
  email: string;
  firstName: string | null;
  lastName: string | null;
  /** `companies.name`, for the contact's Company Name field. */
  companyName: string | null;
  /** `profiles.id`, written to `ghl_events.user_id` so 044 can cascade it. */
  userId: string | null;
}

/**
 * Why no contact could be resolved. Stable strings: logged, and asserted in
 * tests. Each one has a different meaning for whoever reads the log:
 *
 *   `no_company`  — the caller passed nothing usable. A bug in the caller.
 *   `no_owner`    — no `role = 'owner'` profile. A data gap worth noticing.
 *   `no_email`    — an owner row with no usable address. Also a data gap.
 *   `read_failed` — the query errored or threw. Transient; the event is lost
 *                   for this delivery, and that is the correct trade.
 */
export type GhlOwnerContactFailure =
  | "no_company"
  | "no_owner"
  | "no_email"
  | "read_failed";

export type ResolveGhlOwnerContactResult =
  | { ok: true; contact: GhlOwnerContact }
  | { ok: false; reason: GhlOwnerContactFailure; message: string };

/* ------------------------------------------------------------------ *
 * Resolution
 * ------------------------------------------------------------------ */

/** Trim, and treat blank as absent, so we never send GHL an empty name. */
function textOrNull(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value === "" ? null : value;
}

interface OwnerRow {
  id?: unknown;
  email?: unknown;
  first_name?: unknown;
  last_name?: unknown;
}

/**
 * Resolve the owner's contact details for one company.
 *
 * `db` must be a service-role client: `profiles` and `companies` are both
 * behind RLS, and this runs from the Stripe webhook where there is no session.
 *
 * TWO QUERIES, AND THE COMPANY NAME IS THE OPTIONAL ONE. The owner profile is
 * what makes or breaks the result; the company name is cosmetic context for
 * the CRM record. So a failed or empty `companies` read degrades to
 * `companyName: null` instead of failing the whole resolution — losing a
 * display name is not a reason to lose a buyer tag.
 *
 * `maybeSingle` ON THE OWNER LOOKUP IS A DELIBERATE RISK, and worth naming:
 * if a company somehow had two `role = 'owner'` rows, PostgREST returns an
 * error rather than picking one, and this reports `read_failed`. That is the
 * right outcome — guessing which of two owners gets the buyer workflow is
 * exactly the mis-tagging this module exists to prevent — but it means a
 * duplicate-owner data bug shows up here as a read failure, not as silence.
 */
export async function resolveGhlOwnerContact(
  db: SupabaseClient,
  companyId: string | null | undefined
): Promise<ResolveGhlOwnerContactResult> {
  const company = textOrNull(companyId);
  if (!company) {
    return {
      ok: false,
      reason: "no_company",
      message: "No company id was supplied, so there is no owner to look up.",
    };
  }

  try {
    const { data, error } = await db
      .from("profiles")
      .select("id, email, first_name, last_name")
      .eq("company_id", company)
      // THE WHOLE POINT. Dropping this predicate would resolve whichever
      // member happened to sort first.
      .eq("role", "owner")
      .maybeSingle();

    if (error) {
      console.error(
        `[ghl/contact] owner lookup failed for company ${company}:`,
        error.message
      );
      return {
        ok: false,
        reason: "read_failed",
        message: `The owner profile could not be read: ${error.message}`,
      };
    }

    if (!data) {
      /*
       * Reachable, and not an exception. An admin-created company whose owner
       * invite never landed has no owner row; so does a company whose owner
       * profile was deleted by hand. Logged at warn: there is nothing the
       * caller can do, but a company that can never be tagged is worth seeing.
       */
      console.warn(`[ghl/contact] company ${company} has no owner profile.`);
      return {
        ok: false,
        reason: "no_owner",
        message:
          "This company has no profile with role 'owner', so there is no " +
          "person to represent it in GoHighLevel.",
      };
    }

    const row = data as OwnerRow;

    // Normalised HERE as well as in the outbox, because the result is also
    // the answer to "do we have a usable address at all" and a caller must not
    // have to re-derive that.
    const email = normaliseGhlEmail(row.email);
    if (!email) {
      console.warn(`[ghl/contact] owner of company ${company} has no usable email.`);
      return {
        ok: false,
        reason: "no_email",
        message: "The company owner has no usable email address.",
      };
    }

    return {
      ok: true,
      contact: {
        email,
        firstName: textOrNull(row.first_name),
        lastName: textOrNull(row.last_name),
        companyName: await readCompanyName(db, company),
        userId: typeof row.id === "string" ? row.id : null,
      },
    };
  } catch (err: unknown) {
    // A thrown client (bad URL, fetch failure, a method mocked away in a
    // test). THE CATCH THAT MAKES THE DOC COMMENT TRUE.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ghl/contact] owner lookup threw for company ${company}:`, message);
    return { ok: false, reason: "read_failed", message };
  }
}

/**
 * The company's display name, or null.
 *
 * SWALLOWS EVERYTHING. A missing name, an unreadable row and a thrown client
 * are all the same answer, because none of them is a reason to abandon a tag
 * — the contact is identified by email, and the name is decoration.
 */
async function readCompanyName(
  db: SupabaseClient,
  companyId: string
): Promise<string | null> {
  try {
    const { data } = await db
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle();
    return textOrNull((data as { name?: unknown } | null)?.name);
  } catch {
    return null;
  }
}
