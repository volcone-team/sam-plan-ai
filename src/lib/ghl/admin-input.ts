/**
 * Validation for the admin's GoHighLevel settings write
 * (/api/admin/ghl/settings PUT).
 *
 * ITS OWN PURE MODULE, following `src/lib/access/call-gate-input.ts`: the
 * route needs it on the server and it is the only part of that endpoint worth
 * testing — the rest is an auth check, an upsert and an audit line. Keeping it
 * out of `config.ts` matters for the same reason that file gives: `config.ts`
 * is imported by the cron drain and by the Stripe webhook, and nothing in a
 * delivery path should carry admin input validation.
 *
 * TWO FIELDS, BOTH OPTIONAL, because the panel saves ONE SWITCH PER REQUEST
 * (see `ghl-settings.tsx` for why) and a PUT that names neither is a mistake
 * rather than a no-op worth writing. Column names are produced here so the
 * caller can hand the result straight to the upsert without a second mapping
 * to keep in step.
 */

/** The two operational switches from migration 044, as the API names them. */
export interface GhlSwitchState {
  enabled: boolean;
  dryRun: boolean;
}

export interface GhlSettingsInput {
  enabled?: unknown;
  dryRun?: unknown;
}

/** Why an input was refused. Sent as the `error` field, so it is stable. */
export type GhlSettingsInputError =
  /** `enabled` was present but not a boolean. */
  | "enabled"
  /** `dryRun` was present but not a boolean. */
  | "dryRun"
  /** Neither field was present, so there is nothing to write. */
  | "nothing_to_update"
  /** Switching on and leaving dry run behind in the same request. See below. */
  | "two_step_required";

export type GhlSettingsInputResult =
  | {
      ok: true;
      /** Column-keyed, ready for the `app_settings` upsert. */
      patch: Record<string, boolean>;
      /** The same values under their API names, for the audit log. */
      changed: Record<string, boolean>;
    }
  | { ok: false; error: GhlSettingsInputError; message: string };

/**
 * The one transition this endpoint refuses.
 *
 * THE DANGEROUS WRITE IS "OFF AND SAFE" -> "ON AND LIVE" IN ONE REQUEST.
 * Every other combination is recoverable: a wrongly enabled integration with
 * dry run still on resolves rows and contacts nobody, and dry run turned off
 * while the integration is disabled sends nothing either. Only this one
 * crosses, in a single click, from "GoHighLevel has never been touched" to
 * "we are writing tags into the client's CRM full of THEIR customers" — and a
 * tag cannot be untagged out of the workflow it already triggered, because the
 * email has been sent. `config.ts` fails closed for the same reason; this is
 * the write side of the same stance.
 *
 * REFUSED RATHER THAN GATED BEHIND A `confirm: true` FLAG. A confirmation flag
 * is a field in a JSON body: it is satisfied by a UI checkbox nobody reads, it
 * is satisfied by whatever a curl command happens to contain, and it leaves
 * the server unable to distinguish "the operator thought about this" from "the
 * client always sends it". Two requests cannot be sent by accident in the same
 * way: the first one has an observable effect (the status becomes `dry_run`,
 * the drain starts resolving rows, the delivery log fills with dry-run rows)
 * that the operator sees BEFORE the second one is possible. The confirmation
 * is the dry run itself, which is exactly what 044 built two switches for.
 *
 * NARROW ON PURPOSE. A single-field change is always allowed, including
 * enabling while `ghl_dry_run` is already false. That state is reachable only
 * because an operator deliberately turned dry run off on a disabled
 * integration, the panel shows it as "will go live the moment you switch it
 * on", and widening the rule to cover it would force a pointless three-step
 * dance (dry run on, enable, dry run off) through the state everyone is trying
 * to avoid.
 */
export function isDangerousGhlTransition(
  current: GhlSwitchState,
  next: Partial<GhlSwitchState>
): boolean {
  const enabling = next.enabled === true && current.enabled === false;
  const goingLive = next.dryRun === false && current.dryRun === true;
  return enabling && goingLive;
}

const TWO_STEP_MESSAGE =
  "Turning the integration on and turning dry run off cannot be done in the " +
  "same step. Enable it first and let a drain run while dry run is still on, " +
  "check the delivery log shows the tags you expect, then turn dry run off.";

/**
 * Turn a request body into an `app_settings` patch.
 *
 * `current` IS REQUIRED, because the rule above is about a TRANSITION and not
 * about a value: the same body is harmless against one stored state and a live
 * write against another. The caller reads the current state from
 * `loadGhlConfig`, which it needs anyway to answer the GET.
 *
 * Booleans are checked for an actual boolean rather than coerced. A truthy
 * string from a hand-rolled curl would otherwise switch the integration on for
 * every producer in the app, and that is not a mistake worth guessing at —
 * the same call `parseCallGateSettingsInput` makes about `requireCall`.
 */
export function parseGhlSettingsInput(
  body: unknown,
  current: GhlSwitchState
): GhlSettingsInputResult {
  const input: GhlSettingsInput =
    body && typeof body === "object" ? (body as GhlSettingsInput) : {};

  const patch: Record<string, boolean> = {};
  const changed: Record<string, boolean> = {};
  const next: Partial<GhlSwitchState> = {};

  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") {
      return { ok: false, error: "enabled", message: "The switch must be true or false." };
    }
    patch.ghl_enabled = input.enabled;
    changed.enabled = input.enabled;
    next.enabled = input.enabled;
  }

  if (input.dryRun !== undefined) {
    if (typeof input.dryRun !== "boolean") {
      return { ok: false, error: "dryRun", message: "Dry run must be true or false." };
    }
    patch.ghl_dry_run = input.dryRun;
    changed.dryRun = input.dryRun;
    next.dryRun = input.dryRun;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "nothing_to_update", message: "Nothing to update." };
  }

  // After parsing, before anything is written: the refusal has to see both
  // fields, so it cannot live inside either branch above.
  if (isDangerousGhlTransition(current, next)) {
    return { ok: false, error: "two_step_required", message: TWO_STEP_MESSAGE };
  }

  return { ok: true, patch, changed };
}
