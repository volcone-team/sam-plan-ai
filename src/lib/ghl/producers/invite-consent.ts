import type { SupabaseClient } from "@supabase/supabase-js";
import { ghlIsOn, loadGhlConfig, type GhlConfig } from "@/lib/ghl/config";
import { resolveGhlOwnerContact } from "@/lib/ghl/contact";
import { enqueueGhlEvent } from "@/lib/ghl/outbox";
import { consentTagFor } from "@/lib/ghl/tags";

/**
 * The invite-consent producer: "an invited owner just answered the
 * promotional box on /auth/set-password — tell GoHighLevel."
 *
 * Same contract as the sibling producers: never throws, config first so an
 * integration that is off costs zero queries, enqueue only, no secrets in the
 * payload.
 *
 * TAG. Exactly one: TAG_OPTED_COMMUNICATION when ticked, TAG_OPTED_DND when
 * left unticked. NOT "registered - not - paid": invited accounts are created
 * by an admin or an owner, often comped, and are not public signups.
 *
 * WHO. The company OWNER only. Team members' answers are saved on their
 * profile but never sent: only owners are GHL contacts (see contact.ts), and
 * enqueueing a teammate would create a contact for them.
 *
 * ONCE PER PERSON. The dedupe key is per user, so a second answer (a reused
 * link) adds nothing.
 *
 * MIGRATION 058 widens `ghl_events.event_type` to accept 'consent'. Before it
 * is applied the insert is refused with 23514, reported as `unavailable`.
 */

export type InviteConsentResult =
  | { ok: true; outcome: "enqueued" | "duplicate"; tag: string }
  | { ok: true; outcome: "skipped"; reason: InviteConsentSkipReason; detail?: string }
  | { ok: false; outcome: "failed"; message: string };

export type InviteConsentSkipReason =
  | "integration_off"
  /** Not the company owner, or not a customer. */
  | "not_owner"
  /** No usable owner contact for the company. */
  | "no_owner_contact"
  /** Migration 058 is not applied. Not delivered. */
  | "unavailable"
  /** The outbox declined (no email, nothing to do). */
  | "outbox_skipped";

export interface InviteConsentInput {
  userId: string;
  companyId: string | null;
  /** `profiles.role`. Only 'owner' is sent. */
  role: string | null;
  /** True when the profile is a platform admin. Never sent. */
  isAdmin: boolean;
  promotionalConsent: boolean;
  config?: GhlConfig;
}

/** `user:{userId}:invite_consent`. One per person. */
export function inviteConsentDedupeKey(userId: string): string {
  return `user:${userId}:invite_consent`;
}

const CHECK_VIOLATION = "23514";

export async function enqueueInviteConsentEvent(
  db: SupabaseClient,
  input: InviteConsentInput
): Promise<InviteConsentResult> {
  try {
    const config = input.config ?? (await loadGhlConfig(db));
    if (!ghlIsOn(config)) return { ok: true, outcome: "skipped", reason: "integration_off" };

    const role = (input.role ?? "").trim().toLowerCase();
    if (input.isAdmin || role !== "owner" || !input.companyId) {
      return { ok: true, outcome: "skipped", reason: "not_owner" };
    }

    const owner = await resolveGhlOwnerContact(db, input.companyId);
    if (!owner.ok) {
      return { ok: true, outcome: "skipped", reason: "no_owner_contact", detail: owner.reason };
    }
    if (owner.contact.userId !== null && owner.contact.userId !== input.userId) {
      return { ok: true, outcome: "skipped", reason: "no_owner_contact", detail: "owner_mismatch" };
    }

    const tag = consentTagFor(input.promotionalConsent) as string;
    const enqueued = await enqueueGhlEvent(db, {
      eventType: "consent",
      companyId: input.companyId,
      userId: input.userId,
      contactEmail: owner.contact.email,
      tagsAdd: [tag],
      tagsRemove: [],
      payload: {
        source: "set_password",
        promotionalConsent: input.promotionalConsent,
        firstName: owner.contact.firstName,
        lastName: owner.contact.lastName,
        companyName: owner.contact.companyName,
        phone: owner.contact.phone,
      },
      dedupeKey: inviteConsentDedupeKey(input.userId),
      config,
    });

    if (enqueued.outcome === "enqueued" || enqueued.outcome === "duplicate") {
      return { ok: true, outcome: enqueued.outcome, tag };
    }
    if (enqueued.outcome === "skipped") {
      return { ok: true, outcome: "skipped", reason: "outbox_skipped", detail: enqueued.reason };
    }
    if (enqueued.code === CHECK_VIOLATION) {
      return { ok: true, outcome: "skipped", reason: "unavailable", detail: "migration_058" };
    }
    return { ok: false, outcome: "failed", message: enqueued.message };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ghl/invite-consent] producer threw:", message);
    return { ok: false, outcome: "failed", message };
  }
}
