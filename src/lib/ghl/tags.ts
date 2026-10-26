/**
 * The GoHighLevel tag contract.
 *
 * THE SINGLE SOURCE OF THE TAG STRINGS. Everything downstream — the outbox,
 * the API client, the Stripe webhook wiring, the admin screen and the GHL
 * workflow documentation — is generated from this module, so a tag is correct
 * here or it is wrong everywhere. Nothing else in the codebase may spell a tag
 * out by hand.
 *
 * WHY THAT MATTERS MORE THAN USUAL: GHL has no tag registry and no validation.
 * Writing a tag that does not exist CREATES it, silently and successfully. A
 * one-character difference does not fail, it quietly produces a second tag
 * that no workflow is listening to, and the only symptom is an automation that
 * never fires for some contacts. There is no error to find later, so the
 * strings are pinned and asserted in tests instead.
 *
 * PURE. No database, no network, no React, no env vars — safe to import from
 * the Edge runtime, the webhook handler and a bare unit test alike. The caller
 * owns reading `subscription_plans.name` and talking to GHL.
 */

/* ------------------------------------------------------------------ *
 * Fixed tags
 * ------------------------------------------------------------------ */

/** Founding-member cohort. Set once, never cleared by the app. */
export const TAG_FOUNDER = "sam plan ai app - founder";

/** Onboarding call booked, per coach. */
export const TAG_ONBOARDING_PETE_BOOKED = "sam plan ai onboarding - pete booked";
export const TAG_ONBOARDING_RACHEL_BOOKED = "sam plan ai onboarding - rachel booked";
/**
 * The coach-agnostic companion to the two above.
 *
 * NOT DERIVED from them and not mutually exclusive with them: the client's
 * workflows key off the generic tag for "has booked at all" and off the named
 * tags for routing, so a booked contact carries both. Do not "tidy" one away.
 */
export const TAG_ONBOARDING_CALL_BOOKED = "sam plan ai onboarding - call booked";

/** Fired on every login, as a workflow trigger rather than a state flag. */
export const TAG_LOGIN_TRIGGER = "sam plan ai app - login trigger";

/*
 * THE THREE INACTIVITY TAGS CONTAIN NON-ASCII CHARACTERS, AND THEY ARE
 * LOAD-BEARING. Written with explicit escapes so that no editor autocorrect,
 * no "smart quotes" setting and no copy-paste through a tool that normalises
 * punctuation can quietly change them:
 *
 *   \u2019  RIGHT SINGLE QUOTATION MARK in "haven't" — NOT an ASCII
 *           apostrophe ('), which is what a keyboard produces.
 *   \u2013  EN DASH, used as the separator before the day count (" – "). Note
 *           that this is a DIFFERENT character from the ASCII hyphen used as
 *           the separator earlier in the very same string ("app - "). The
 *           inconsistency is the client's; it is reproduced faithfully because
 *           the tags already exist in their account.
 *
 * Changing either character does not break anything visibly — it creates a new
 * tag in GHL with no workflow attached, and the win-back email never sends.
 * tags.test.ts asserts the exact code points for this reason.
 */
export const TAG_INACTIVE_90 = "sam plan ai app - haven\u2019t logged \u2013 90 days+";
export const TAG_INACTIVE_60 = "sam plan ai app - haven\u2019t logged \u2013 60 days";
export const TAG_INACTIVE_30 = "sam plan ai app - haven\u2019t logged \u2013 30 days";

/** Lifecycle milestones. */
export const TAG_FIRST_LOGIN = "sam plan ai app - first login";
export const TAG_PLAN_GENERATED = "sam plan ai app - plan generated";
export const TAG_FINISHED_INTAKE = "sam plan ai app - finished intake";
export const TAG_CANCELLATION = "sam plan ai app - cancellation";

/**
 * Registration (the `registered` event, producers/registration.ts).
 *
 * TAG_REGISTERED_NOT_PAID is added once when a company owner signs up through
 * the public signup, and removed by the buyer-state producer when they enter
 * the ACTIVE buyer state. Trial users carry it: a trial is not a payment.
 *
 * TAG_OPTED_DND is added alongside it when the owner left the promotional
 * consent box unticked (profiles.promotional_consent = false). Add only; the
 * app never removes it.
 *
 * TAG_OPTED_DND STARTS WITH BUYER_TAG_PREFIX AND IS NOT A BUYER TAG. The
 * client chose the string. `isBuyerTag` excludes it explicitly, so the buyer
 * state cleanup (which removes every buyer tag it can name or match) can never
 * strip a do-not-disturb preference off a contact.
 */
export const TAG_REGISTERED_NOT_PAID = "sam plan ai app - registered - not - paid";
export const TAG_OPTED_DND = "sam plan ai app - buyer - opted - dnd";

/**
 * Every fixed tag, in the order the client listed them.
 *
 * Frozen because it is module-level shared state that the admin screen and the
 * outbox both read; a caller that sorts or splices it in place would corrupt
 * the contract for the rest of the process.
 */
export const FIXED_TAGS: readonly string[] = Object.freeze([
  TAG_FOUNDER,
  TAG_ONBOARDING_PETE_BOOKED,
  TAG_ONBOARDING_RACHEL_BOOKED,
  TAG_ONBOARDING_CALL_BOOKED,
  TAG_LOGIN_TRIGGER,
  TAG_INACTIVE_90,
  TAG_INACTIVE_60,
  TAG_INACTIVE_30,
  TAG_FIRST_LOGIN,
  TAG_PLAN_GENERATED,
  TAG_FINISHED_INTAKE,
  TAG_CANCELLATION,
  TAG_REGISTERED_NOT_PAID,
  TAG_OPTED_DND,
]);

/**
 * The AYR / 10X Stages suppression tag.
 *
 * LIVES IN THE TWO MARKETING SUB-ACCOUNTS, NOT THE APP ONE. It exists so their
 * nurture and promotional sequences skip people who already pay for SAM Plan
 * AI. It is therefore written against a different location ID than everything
 * else here, is not one of our lifecycle tags, and must not be swept up by the
 * cleanup logic — `isAppOriginTag` deliberately returns false for it.
 *
 * The client writes it as "Customer - SAM Plan AI". The constant is the
 * normalised form because GHL lowercases tags on write, so that is the string
 * that comes back on a read and the only form worth comparing against; the
 * original casing is kept beside it purely for documentation and admin copy.
 */
export const MARKETING_SUPPRESSION_TAG = "customer - sam plan ai";
export const MARKETING_SUPPRESSION_TAG_AS_WRITTEN = "Customer - SAM Plan AI";

/* ------------------------------------------------------------------ *
 * Comparison helpers
 * ------------------------------------------------------------------ */

/**
 * Normalise a tag for comparison against this contract.
 *
 * GHL LOWERCASES TAGS ON WRITE and is tolerant about surrounding whitespace,
 * so a tag we sent as "Sam Plan AI App - Founder" reads back lowercased, and a
 * tag typed into their UI may carry a stray space or a double space. Comparing
 * raw strings would then report a tag we set ourselves as foreign and add it a
 * second time.
 *
 * ONLY case and ASCII whitespace are touched. Punctuation is left exactly as
 * it is — folding \u2019 to ' or \u2013 to - here would make the three
 * inactivity tags compare equal to strings that are different tags in GHL,
 * which is the precise failure this module exists to prevent.
 */
export function normaliseTagForCompare(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Do two tags refer to the same GHL tag? */
export function tagsEqual(a: unknown, b: unknown): boolean {
  const left = normaliseTagForCompare(a);
  return left !== "" && left === normaliseTagForCompare(b);
}

/**
 * The buyer-tag namespace. Exported because the cleanup logic needs to
 * recognise buyer tags for plans it has never heard of — a plan the admin
 * renamed or deleted still leaves its old tags on the contact.
 */
export const BUYER_TAG_PREFIX = "sam plan ai app - buyer - ";

const FIXED_TAG_SET = new Set(FIXED_TAGS.map(normaliseTagForCompare));

/**
 * Is this one of OUR tags, as opposed to a GHL-managed or marketing one?
 *
 * The question the sync asks before touching anything: a contact's tag list is
 * shared with the client's marketing team, and removing "webinar attendee"
 * because it was not in our contract would destroy their segmentation.
 *
 * MEMBERSHIP, NOT PREFIX, for the fixed tags. "sam plan ai app - anything the
 * marketing team invents" is not ours to manage just because it starts the
 * same way; claiming it would let a future hand-made tag be deleted by our
 * cleanup. Buyer tags are the one exception and are matched by prefix, because
 * the plan names in them are admin-editable and therefore unknowable here.
 */
export function isAppOriginTag(raw: unknown): boolean {
  const tag = normaliseTagForCompare(raw);
  if (!tag) return false;
  return FIXED_TAG_SET.has(tag) || isBuyerTag(tag);
}

/**
 * Tags inside the buyer namespace that are NOT buyer-state tags. Compared in
 * normalised form. See TAG_OPTED_DND.
 */
const NON_BUYER_STATE_TAGS = new Set([normaliseTagForCompare(TAG_OPTED_DND)]);

/**
 * Is this a buyer tag, for any plan including one we no longer know about?
 *
 * FALSE FOR TAG_OPTED_DND, which shares the prefix but records a consent
 * choice. Treating it as a buyer tag would let the buyer-state cleanup remove
 * it.
 */
export function isBuyerTag(raw: unknown): boolean {
  const tag = normaliseTagForCompare(raw);
  if (NON_BUYER_STATE_TAGS.has(tag)) return false;
  return tag.startsWith(BUYER_TAG_PREFIX) && tag.length > BUYER_TAG_PREFIX.length;
}

/* ------------------------------------------------------------------ *
 * Buyer tags
 * ------------------------------------------------------------------ */

/** The two halves of the buyer tag that are ours, not the admin's. */
export type BuyerState = "active" | "inactive";

/** What the TAGS say. */
export type TagCycle = "monthly" | "yearly";

/**
 * What the DATABASE says.
 *
 * THE MISMATCH IS REAL AND IT IS A TRAP. `stripe_prices.billing_cycle` and
 * `subscriptions.billing_cycle` store "annual" (see
 * src/lib/billing/sync-prices.ts); the client's tags say "yearly". Passing the
 * database value straight through would produce
 * "... - buyer - active - pro annual", which GHL would happily create and no
 * workflow would ever see. So the translation happens HERE, once, and
 * `buyerTag` accepts either spelling on input while only ever emitting
 * "yearly".
 */
export type InputCycle = TagCycle | "annual";

export const BUYER_STATES: readonly BuyerState[] = Object.freeze(["active", "inactive"]);
export const TAG_CYCLES: readonly TagCycle[] = Object.freeze(["monthly", "yearly"]);

/** Why a buyer tag could not be built. Stable: logged and surfaced to admins. */
export type BuyerTagError =
  /** `planName` was absent, not a string, or normalised to nothing usable. */
  | "plan_name"
  /** `cycle` was not monthly / yearly / annual. */
  | "cycle"
  /** `state` was not active / inactive. */
  | "state";

export type BuyerTagResult =
  | {
      ok: true;
      tag: string;
      /** The normalised plan name that went into the tag. */
      plan: string;
      /** The emitted cycle, i.e. "annual" already translated to "yearly". */
      cycle: TagCycle;
      state: BuyerState;
    }
  | { ok: false; error: BuyerTagError; message: string };

/**
 * Characters that may appear in a plan name inside a tag.
 *
 * `subscription_plans.name` IS ADMIN-EDITABLE FREE TEXT. Today it holds
 * "Starter" and "Pro"; tomorrow it can hold "Pro+", "10X Stages", an em dash,
 * a trailing space or an emoji. A tag is matched by exact string in a GHL
 * workflow the client built by hand, so anything outside this set is dropped
 * rather than passed through: the alternative is a tag whose name nobody can
 * retype correctly.
 *
 * STRIPPED, NOT SUBSTITUTED. "Pro+" becomes "pro", not "pro-plus" or "pro_",
 * because the client's existing tags contain only letters, digits and spaces
 * and a substitution would invent a convention they have not agreed to.
 */
const PLAN_NAME_ALLOWED = /[^a-z0-9 ]+/g;

/**
 * Turn an admin-typed plan name into the form that goes in a tag.
 *
 * Lowercase, strip the disallowed characters, collapse whitespace, trim. The
 * collapse happens AFTER the strip as well as before it, so "Pro + Max" does
 * not leave a double space behind.
 *
 * Returns null when nothing usable survives ("+++", "", "  ", "日本語"). The
 * caller must refuse at that point — see buyerTag.
 */
export function normalisePlanNameForTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .toLowerCase()
    .replace(PLAN_NAME_ALLOWED, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned === "" ? null : cleaned;
}

/** "annual" -> "yearly". Returns null for anything that is not a cycle. */
export function toTagCycle(raw: unknown): TagCycle | null {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "monthly") return "monthly";
  // The database's spelling and the tag's spelling, both landing on the tag's.
  if (value === "annual" || value === "yearly") return "yearly";
  return null;
}

function toBuyerState(raw: unknown): BuyerState | null {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return value === "active" || value === "inactive" ? value : null;
}

export interface BuyerTagInput {
  /** Raw `subscription_plans.name`. Normalised here, not by the caller. */
  planName: unknown;
  /** `subscriptions.billing_cycle` ("monthly" | "annual") or a tag cycle. */
  cycle: unknown;
  state: unknown;
}

/**
 * Build `sam plan ai app - buyer - {state} - {plan} {cycle}`.
 *
 * REFUSES RATHER THAN GUESSING, and refuses with a result object rather than
 * an exception — the house pattern (see parseCallGateSettingsInput,
 * decidePortalAccessChange). A thrown error in the Stripe webhook path would
 * cost us the event; a plausible-but-wrong tag would cost us an automation,
 * silently, for as long as nobody notices. The caller logs the refusal and
 * leaves the contact untouched.
 */
export function buyerTag(input: BuyerTagInput): BuyerTagResult {
  const plan = normalisePlanNameForTag(input.planName);
  if (!plan) {
    return {
      ok: false,
      error: "plan_name",
      message:
        "The plan name has no letters or digits, so it cannot be put in a tag. " +
        "Rename the plan to something that uses letters, digits or spaces.",
    };
  }

  const cycle = toTagCycle(input.cycle);
  if (!cycle) {
    return {
      ok: false,
      error: "cycle",
      message: "The billing cycle must be monthly, annual or yearly.",
    };
  }

  const state = toBuyerState(input.state);
  if (!state) {
    return {
      ok: false,
      error: "state",
      message: "The buyer state must be active or inactive.",
    };
  }

  return {
    ok: true,
    tag: `${BUYER_TAG_PREFIX}${state} - ${plan} ${cycle}`,
    plan,
    cycle,
    state,
  };
}

/**
 * Every buyer tag for a set of plan names: 4 per plan (2 states × 2 cycles).
 *
 * Needed by the cleanup logic, which has to name the tags it is removing, and
 * by the admin screen, which lists what the client must wire up in GHL after
 * adding a plan.
 *
 * ORDER IS THE CLIENT'S: per plan, active monthly, active yearly, inactive
 * monthly, inactive yearly. Deterministic so the admin screen and the
 * documentation do not reshuffle between loads.
 *
 * Unnormalisable names are SKIPPED, not refused: the enumerator's callers are
 * working with whatever is in the table, and one unusable plan name should not
 * stop a contact's other tags from being cleaned up. Skipped names come back
 * in `skipped` so an admin screen can say which plan needs renaming.
 */
export function buyerTagsFor(planNames: Iterable<unknown>): {
  tags: string[];
  /** Normalised plan names actually used, deduped, in first-seen order. */
  plans: string[];
  /** Raw names that produced no usable tag. */
  skipped: unknown[];
} {
  const plans: string[] = [];
  const seen = new Set<string>();
  const skipped: unknown[] = [];

  for (const raw of planNames) {
    const plan = normalisePlanNameForTag(raw);
    if (!plan) {
      skipped.push(raw);
      continue;
    }
    // Deduped AFTER normalising, so "Pro" and " pro " are one plan — they
    // would otherwise generate the same four tags twice and the remove list
    // would contain duplicates.
    if (seen.has(plan)) continue;
    seen.add(plan);
    plans.push(plan);
  }

  const tags: string[] = [];
  for (const plan of plans) {
    for (const state of BUYER_STATES) {
      for (const cycle of TAG_CYCLES) {
        const tag = `${BUYER_TAG_PREFIX}${state} - ${plan} ${cycle}`;
        // Never lists a non-buyer-state tag such as TAG_OPTED_DND.
        if (isBuyerTag(tag)) tags.push(tag);
      }
    }
  }

  return { tags, plans, skipped };
}

/* ------------------------------------------------------------------ *
 * Mutual exclusion
 * ------------------------------------------------------------------ */

export type BuyerTagTransitionResult =
  | {
      ok: true;
      /** The one buyer tag the contact should hold after this transition. */
      add: string;
      /**
       * Every other buyer tag we can name. Never contains `add`.
       *
       * Sent as removals unconditionally; GHL's remove-tag call is a no-op for
       * a tag the contact does not have, so there is nothing to gain from
       * reading the contact first and a race to lose by it.
       */
      remove: string[];
      plan: string;
      cycle: TagCycle;
      state: BuyerState;
    }
  | { ok: false; error: BuyerTagError; message: string };

export interface BuyerTagTransitionInput extends BuyerTagInput {
  /**
   * Every plan name the app knows about — `subscription_plans.name` for ALL
   * plans, retired ones included.
   *
   * RETIRED PLANS MUST BE IN HERE. A retired plan keeps its existing
   * subscribers (see the billing notes), so its tags are still live and still
   * have to be cleared when one of those subscribers moves. Passing only the
   * active plans would leave a stale "buyer - active - legacy monthly" on the
   * contact forever.
   */
  knownPlanNames: Iterable<unknown>;
}

/**
 * What to add and what to remove when a contact ENTERS a buyer state.
 *
 * THE POINT OF THIS MODULE. A contact must hold exactly one buyer tag: never
 * two actives, never active and inactive together, never last month's plan
 * alongside this month's. GHL decides what to send a contact by tag, so a
 * leftover tag is not untidy data — it is the wrong email, or two.
 *
 * THE ENTERING PLAN IS ADDED TO THE UNIVERSE even when it is not in
 * `knownPlanNames`. A plan can be renamed or deleted between the subscription
 * being written and this running, and a transition that removed the tag it
 * just added would be worse than useless.
 *
 * TAGS FOR PLANS WE NO LONGER KNOW ABOUT CANNOT BE ENUMERATED. After a rename,
 * the old name is gone from the table and nothing here can reconstruct it; the
 * caller reconciles those by reading the contact's real tags and dropping
 * whatever `isBuyerTag` matches that is not `add`. That is why `isBuyerTag` is
 * exported, and why `remove` is documented as "every tag we can name" rather
 * than "every tag".
 */
export function buyerTagTransition(
  input: BuyerTagTransitionInput
): BuyerTagTransitionResult {
  const target = buyerTag(input);
  if (!target.ok) return target;

  // The target plan goes FIRST, so a plan missing from knownPlanNames is still
  // covered and the output order is stable regardless of table order.
  const { tags } = buyerTagsFor([target.plan, ...input.knownPlanNames]);

  return {
    ok: true,
    add: target.tag,
    // The one invariant worth stating in code: the add is never in the remove
    // list. Compared on the normalised form, since both sides are generated
    // here and are already normalised, but cheap insurance if that changes.
    // `isBuyerTag` as well: the generated shape cannot spell TAG_OPTED_DND
    // (the state always comes first), but the remove list must never be able
    // to carry it even if the shape changes.
    remove: tags.filter((tag) => !tagsEqual(tag, target.tag) && isBuyerTag(tag)),
    plan: target.plan,
    cycle: target.cycle,
    state: target.state,
  };
}
