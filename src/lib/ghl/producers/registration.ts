import type { SupabaseClient } from "@supabase/supabase-js";
import { ghlIsOn, loadGhlConfig, type GhlConfig } from "@/lib/ghl/config";
import { resolveGhlOwnerContact } from "@/lib/ghl/contact";
import { buyerPresenceForStatus } from "@/lib/ghl/buyer-state";
import { enqueueGhlEvent } from "@/lib/ghl/outbox";
import { TAG_OPTED_DND, TAG_REGISTERED_NOT_PAID } from "@/lib/ghl/tags";
import { isMissingColumnError } from "@/lib/supabase/missing-column";

/**
 * The registration producer: "a company owner just signed up through the
 * public signup and has not paid — tell GoHighLevel."
 *
 * Same contract as the sibling producers (read `first-login.ts`): never
 * throws, config first so an integration that is off costs zero queries,
 * enqueue only, no secrets in the payload.
 *
 * TAGS. TAG_REGISTERED_NOT_PAID always. TAG_OPTED_DND as well when the owner
 * left the promotional consent box unticked (`profiles.promotional_consent =
 * false`). Consent true, or NULL (never asked), adds nothing for DND. The
 * buyer-state producer removes TAG_REGISTERED_NOT_PAID when the company
 * enters the ACTIVE buyer state (see `buyerStateRemovals`).
 *
 * WHO. The company owner, and only when the account came from the PUBLIC
 * signup. The signal for that is `profiles.terms_accepted_at`: the public
 * signup cannot be submitted without ticking the terms box, and
 * handle_new_user (037) stamps the column from that metadata. Nothing else in
 * the app writes it. An admin-created company (POST /api/admin/companies/create)
 * sends no terms metadata, so its owner has NULL there and never fires; the
 * same goes for accounts created before 037, so turning this on does not
 * back-fill old customers. Admins, super admins and team members never fire.
 *
 * NOT PAID. Skipped when the company already has a Stripe subscription in the
 * active buyer state (a reconcile or webhook that beat this call). A trial,
 * including a Stripe trial, is not paid and does fire: an owner decision.
 *
 * CALL SITES, both safe together because the dedupe key is per company:
 *   - POST /api/auth/signup, right after createUser (the trigger has already
 *     created the profile and company inside that insert);
 *   - GET /api/me on the first authenticated page load (while
 *     `profiles.ghl_first_login_at` is still null), which covers the
 *     email-confirmation signup and any failure of the first call site.
 *
 * MIGRATION 052 widens `ghl_events.event_type` to accept 'registered'. Before
 * it is applied the insert is refused with 23514; that is reported as
 * `unavailable` (not delivered), logged once per process, and never reaches
 * the caller as an error.
 */

/* ------------------------------------------------------------------ *
 * The decision
 * ------------------------------------------------------------------ */

const OWNER_ROLE = "owner";

export type RegistrationDecisionReason =
  /** Owner of a publicly-signed-up company. The one case that fires. */
  | "registered"
  /** A super admin is signed in as this customer. */
  | "impersonating"
  /** Platform admin / super admin profile. Never a GHL contact here. */
  | "admin"
  /** An invited team member. Only the owner is a contact. */
  | "not_owner"
  /** No company on the profile, so there is no account to register. */
  | "no_company"
  /** No terms acceptance stamp: admin-created, or created before 037. */
  | "not_public_signup";

export interface RegistrationDecision {
  fire: boolean;
  reason: RegistrationDecisionReason;
}

export interface RegistrationDecisionInput {
  /** `profiles.role`. */
  role: string | null | undefined;
  /** `profiles.is_admin`. */
  isAdmin: boolean | null | undefined;
  /** `profiles.admin_level`. Any non-blank value is an admin. */
  adminLevel: string | null | undefined;
  /** `profiles.company_id`. */
  companyId: string | null | undefined;
  /** `profiles.terms_accepted_at`. Non-null means the public signup. */
  termsAcceptedAt: string | Date | null | undefined;
  /** Is a super admin signed in as this person right now? */
  isImpersonating: boolean;
}

/**
 * Should the registration event fire for this person?
 *
 * PURE. Impersonation first (no data about the person is needed), then the
 * admin flags, then the role, the company, and the public-signup stamp.
 */
export function shouldFireRegistration(
  input: RegistrationDecisionInput
): RegistrationDecision {
  if (input.isImpersonating) return { fire: false, reason: "impersonating" };

  const adminLevel = typeof input.adminLevel === "string" ? input.adminLevel.trim() : "";
  if (input.isAdmin === true || adminLevel !== "") return { fire: false, reason: "admin" };

  const role = typeof input.role === "string" ? input.role.trim().toLowerCase() : "";
  if (role !== OWNER_ROLE) return { fire: false, reason: "not_owner" };

  const companyId = typeof input.companyId === "string" ? input.companyId.trim() : "";
  if (!companyId) return { fire: false, reason: "no_company" };

  if (input.termsAcceptedAt === null || input.termsAcceptedAt === undefined) {
    return { fire: false, reason: "not_public_signup" };
  }
  if (typeof input.termsAcceptedAt === "string" && input.termsAcceptedAt.trim() === "") {
    return { fire: false, reason: "not_public_signup" };
  }

  return { fire: true, reason: "registered" };
}

/**
 * The tags to add. TAG_OPTED_DND only for an explicit `false`: NULL means the
 * person was never asked, which is not a refusal.
 */
export function registrationTags(promotionalConsent: boolean | null | undefined): string[] {
  return promotionalConsent === false
    ? [TAG_REGISTERED_NOT_PAID, TAG_OPTED_DND]
    : [TAG_REGISTERED_NOT_PAID];
}

/** One subscription row, as read for the paid check. */
export interface RegistrationSubscriptionRow {
  status?: unknown;
  stripe_subscription_id?: unknown;
}

/**
 * Is the company already paying?
 *
 * A row counts as paid when it has a Stripe subscription id AND its status is
 * in the ACTIVE buyer state (`active`, `past_due`), the same mapping the
 * buyer-state producer uses. `trialing` is not paid, a comp (no Stripe id) is
 * not paid, and an ended subscription is not currently paid.
 */
export function isPaidSubscription(rows: readonly RegistrationSubscriptionRow[]): boolean {
  return rows.some((row) => {
    const stripeId =
      typeof row.stripe_subscription_id === "string" ? row.stripe_subscription_id.trim() : "";
    if (!stripeId) return false;
    const status = typeof row.status === "string" ? row.status : null;
    return buyerPresenceForStatus(status).presence === "active";
  });
}

/**
 * `company:{companyId}:registered`. One per company, in the same `company:`
 * namespace as the founder and milestone keys; the `:registered` suffix keeps
 * it apart from `:founder`, `:finished_intake` and `:plan_generated`.
 */
export function registrationDedupeKey(companyId: string): string {
  return `company:${companyId}:registered`;
}

/* ------------------------------------------------------------------ *
 * Result and input
 * ------------------------------------------------------------------ */

export type RegistrationProducerResult =
  | { ok: true; outcome: "enqueued" | "duplicate"; tags: string[] }
  | { ok: true; outcome: "skipped"; reason: RegistrationSkipReason; detail?: string }
  | { ok: false; outcome: "failed"; reason: RegistrationFailReason; message: string };

export type RegistrationSkipReason =
  /** `ghlIsOn` is false. */
  | "integration_off"
  /** The pure decision declined. `detail` says why. */
  | "not_eligible"
  /** No usable user id. A caller bug. */
  | "no_user"
  /** No profile row yet. GET /api/me will try again. */
  | "no_profile"
  /** The company already has a paid subscription. */
  | "already_paid"
  /** No owner contact, or the owner is someone else. A data gap. */
  | "no_owner_contact"
  /** Migration 037 or 052 is not applied. Not delivered. */
  | "unavailable"
  /** The outbox declined (no email, nothing to do). */
  | "outbox_skipped";

export type RegistrationFailReason =
  /** The profile or subscription read failed. Nothing was enqueued. */
  | "read_failed"
  /** The insert failed, or something threw. */
  | "enqueue_failed";

/** Which call site. Debug context in the payload; never a decision input. */
export type RegistrationSource = "direct_signup" | "api_me";

export interface RegistrationProducerInput {
  /** `profiles.id` of the person who just signed up or loaded a page. */
  userId: string;
  /** True when a super admin is signed in as this person. */
  isImpersonating?: boolean;
  source: RegistrationSource;
  /** An already-loaded config, so `app_settings` is not read twice. */
  config?: GhlConfig;
}

/* ------------------------------------------------------------------ *
 * Producer
 * ------------------------------------------------------------------ */

/** Postgres check_violation: the event_type CHECK predates migration 052. */
const CHECK_VIOLATION = "23514";

let loggedMigrationMissing = false;

/** Exported for tests only. */
export function resetRegistrationLogOnceForTests(): void {
  loggedMigrationMissing = false;
}

interface ProfileRow {
  id?: unknown;
  company_id?: unknown;
  role?: unknown;
  is_admin?: unknown;
  admin_level?: unknown;
  terms_accepted_at?: unknown;
  promotional_consent?: unknown;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Enqueue the one-per-company registration event.
 *
 * `db` must be a service-role client.
 */
export async function enqueueRegisteredEvent(
  db: SupabaseClient,
  input: RegistrationProducerInput
): Promise<RegistrationProducerResult> {
  try {
    const config = input.config ?? (await loadGhlConfig(db));
    if (!ghlIsOn(config)) {
      return { ok: true, outcome: "skipped", reason: "integration_off" };
    }

    // Before any query: an admin looking at the account is never a signup.
    if (input.isImpersonating === true) {
      return { ok: true, outcome: "skipped", reason: "not_eligible", detail: "impersonating" };
    }

    const userId = typeof input.userId === "string" ? input.userId.trim() : "";
    if (!userId) return { ok: true, outcome: "skipped", reason: "no_user" };

    const { data: profileData, error: profileError } = await db
      .from("profiles")
      .select(
        "id, company_id, role, is_admin, admin_level, terms_accepted_at, promotional_consent"
      )
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      if (isMissingColumnError(profileError)) {
        return { ok: true, outcome: "skipped", reason: "unavailable", detail: "migration_037" };
      }
      console.error("[ghl/registration] profile read failed:", profileError.message);
      return { ok: false, outcome: "failed", reason: "read_failed", message: profileError.message };
    }
    if (!profileData) return { ok: true, outcome: "skipped", reason: "no_profile" };

    const profile = profileData as ProfileRow;
    const companyId = typeof profile.company_id === "string" ? profile.company_id : null;
    const termsAcceptedAt =
      typeof profile.terms_accepted_at === "string" ? profile.terms_accepted_at : null;

    const decision = shouldFireRegistration({
      role: typeof profile.role === "string" ? profile.role : null,
      isAdmin: profile.is_admin === true,
      adminLevel: typeof profile.admin_level === "string" ? profile.admin_level : null,
      companyId,
      termsAcceptedAt,
      isImpersonating: false,
    });
    if (!decision.fire || !companyId) {
      return { ok: true, outcome: "skipped", reason: "not_eligible", detail: decision.reason };
    }

    const { data: subs, error: subsError } = await db
      .from("subscriptions")
      .select("status, stripe_subscription_id")
      .eq("company_id", companyId);
    if (subsError) {
      // Unknown is not "not paid": tagging a paying customer "not paid" would
      // put them in the wrong workflow. Nothing is enqueued.
      console.error("[ghl/registration] subscription read failed:", subsError.message);
      return { ok: false, outcome: "failed", reason: "read_failed", message: subsError.message };
    }
    if (isPaidSubscription((subs ?? []) as RegistrationSubscriptionRow[])) {
      return { ok: true, outcome: "skipped", reason: "already_paid" };
    }

    const owner = await resolveGhlOwnerContact(db, companyId);
    if (!owner.ok) {
      return { ok: true, outcome: "skipped", reason: "no_owner_contact", detail: owner.reason };
    }
    if (owner.contact.userId !== null && owner.contact.userId !== userId) {
      // The resolved owner is a different person. Never tag them for this one.
      return { ok: true, outcome: "skipped", reason: "no_owner_contact", detail: "owner_mismatch" };
    }

    const promotionalConsent =
      typeof profile.promotional_consent === "boolean" ? profile.promotional_consent : null;
    const tags = registrationTags(promotionalConsent);

    const enqueued = await enqueueGhlEvent(db, {
      eventType: "registered",
      companyId,
      userId,
      contactEmail: owner.contact.email,
      tagsAdd: tags,
      tagsRemove: [],
      payload: {
        reason: decision.reason,
        source: input.source,
        promotionalConsent,
        firstName: owner.contact.firstName,
        lastName: owner.contact.lastName,
        companyName: owner.contact.companyName,
        phone: owner.contact.phone,
      },
      dedupeKey: registrationDedupeKey(companyId),
      config,
    });

    if (enqueued.outcome === "enqueued" || enqueued.outcome === "duplicate") {
      return { ok: true, outcome: enqueued.outcome, tags };
    }
    if (enqueued.outcome === "skipped") {
      return { ok: true, outcome: "skipped", reason: "outbox_skipped", detail: enqueued.reason };
    }
    if (enqueued.code === CHECK_VIOLATION) {
      if (!loggedMigrationMissing) {
        loggedMigrationMissing = true;
        console.warn(
          "[ghl/registration] ghl_events does not accept 'registered' yet " +
            "(migration 052 not applied). Registration tags are not being queued."
        );
      }
      return { ok: true, outcome: "skipped", reason: "unavailable", detail: "migration_052" };
    }
    return { ok: false, outcome: "failed", reason: "enqueue_failed", message: enqueued.message };
  } catch (err: unknown) {
    const message = errMessage(err);
    console.error("[ghl/registration] producer threw:", message);
    return { ok: false, outcome: "failed", reason: "enqueue_failed", message };
  }
}
