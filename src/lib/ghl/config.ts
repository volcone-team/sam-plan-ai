import type { SupabaseClient } from "@supabase/supabase-js";
// From its own module rather than via a re-export, for the same reason
// call-gate-settings.ts does it: this is importable from a cron route and from
// the Stripe webhook, and neither has any business pulling a wider graph in.
import { isMissingColumnError } from "@/lib/supabase/missing-column";

/**
 * "May we talk to GoHighLevel at all, and if so, for real?"
 *
 * Combines the two credentials (env) with the two operational switches
 * (`app_settings.ghl_enabled` / `ghl_dry_run`, migration 044) into one answer
 * that the drain and the admin screen both read.
 *
 * NEVER THROWS, AND FAILS CLOSED. That second half is the opposite of
 * `loadCallGateSettings`, which fails OPEN, and the inversion is deliberate
 * rather than an inconsistency:
 *
 *   - The call gate's failure mode is "a customer keeps access to a product
 *     they have already paid for". Annoying to nobody. So an unreadable
 *     setting there means the gate is off.
 *   - This module's failure mode is "we start writing into the client's live
 *     CRM, which is full of THEIR customers, on the strength of a setting we
 *     could not read". A tag written in error cannot be untagged out of the
 *     workflow it already triggered — the email has been sent. There is no
 *     undo, and the damage lands on someone else's reputation.
 *
 * So every flavour of uncertainty — missing env, missing column, unreadable
 * singleton, a client that throws — resolves to "do not sync". The integration
 * only goes live when all four inputs positively say so.
 *
 * NO SECRET LEAVES THIS MODULE EXCEPT ON THE `live` RESULT. `dry_run`
 * deliberately carries no credentials at all: a dry run that held a usable
 * token could still make a call if someone wired it up wrongly, and the whole
 * point of the dry run is that it cannot. `not_configured` reports WHICH
 * variable is missing, by name, never by value.
 *
 * Pure-ish: no React, no Next imports, no module-level `process.env` read (the
 * env is passed in, defaulted at the call), so a test needs neither network
 * nor environment.
 */

/* ------------------------------------------------------------------ *
 * Env
 * ------------------------------------------------------------------ */

/**
 * The only two environment variables this integration has.
 *
 * ONE SUB-ACCOUNT. The outbox migration (044) mentions six variables for three
 * locations; that fan-out was cancelled by the client before any of it was
 * built. There is one location — the app one — and `ghl_events.sub_account` is
 * only ever written as `'app'`. The extra CHECK values in 044 are dead, and
 * narrowing them is not worth a hand-run migration.
 *
 * A location id pairs 1:1 with the token that can write to it, which is why
 * neither is in the database: storing one half of a credential pair invites
 * the halves to drift and puts the location id in every backup.
 */
export const GHL_ENV_LOCATION_ID = "GHL_LOCATION_ID" as const;
export const GHL_ENV_PRIVATE_TOKEN = "GHL_PRIVATE_TOKEN" as const;

export type GhlEnvVarName = typeof GHL_ENV_LOCATION_ID | typeof GHL_ENV_PRIVATE_TOKEN;

/** The shape of the environment this module reads. Injected so tests need none. */
export type GhlEnvSource = Partial<Record<GhlEnvVarName, string | undefined>>;

/** Credentials for one GHL sub-account. Only ever handed out on a `live` result. */
export interface GhlCredentials {
  locationId: string;
  /** The Private Integration Token. NEVER log, echo or persist this. */
  token: string;
}

/** Which credentials are present. Booleans, so this is safe to log and render. */
export interface GhlEnvPresence {
  locationId: boolean;
  token: boolean;
}

/**
 * Read the two variables.
 *
 * TRIMMED, AND EMPTY COUNTS AS ABSENT. Vercel's UI will happily store a
 * variable whose value is a space, and `GHL_PRIVATE_TOKEN=""` in a .env file
 * is indistinguishable from a typo. "Present but blank" is never a working
 * credential, so it is reported as missing rather than sent as a `Bearer `
 * header that earns a 401 on every row in the outbox.
 */
export function readGhlEnv(env: GhlEnvSource = process.env as GhlEnvSource): {
  credentials: GhlCredentials | null;
  presence: GhlEnvPresence;
  missing: GhlEnvVarName[];
} {
  const locationId = (env[GHL_ENV_LOCATION_ID] ?? "").trim();
  const token = (env[GHL_ENV_PRIVATE_TOKEN] ?? "").trim();

  const missing: GhlEnvVarName[] = [];
  if (!locationId) missing.push(GHL_ENV_LOCATION_ID);
  if (!token) missing.push(GHL_ENV_PRIVATE_TOKEN);

  return {
    credentials: missing.length === 0 ? { locationId, token } : null,
    presence: { locationId: locationId !== "", token: token !== "" },
    missing,
  };
}

/* ------------------------------------------------------------------ *
 * The result
 * ------------------------------------------------------------------ */

/**
 * Why we are or are not syncing.
 *
 * FOUR DISTINCT "NO"s AND TWO "YES"es, NOT A BOOLEAN. The admin screen has to
 * tell an operator what to do next, and "off because you switched it off",
 * "off because nobody has set the token in Vercel", "off because migration 044
 * is not applied" and "off because the settings table is unreadable right now"
 * have four different fixes. Collapsing them into `canSync: false` would make
 * the screen show a dead switch and the operator guess.
 */
export type GhlConfigStatus =
  /** `ghl_enabled` is false. Off by choice; the default state after 044. */
  | "disabled"
  /** Enabled, but `GHL_LOCATION_ID` / `GHL_PRIVATE_TOKEN` are not both set. */
  | "not_configured"
  /** Enabled and configured, but `ghl_dry_run` is true. Resolve and log only. */
  | "dry_run"
  /** Enabled, configured, dry run off. Real writes into the client's CRM. */
  | "live"
  /** The settings could not be read. Migration missing, or a failed query. */
  | "unavailable";

interface GhlConfigBase {
  status: GhlConfigStatus;
  /**
   * False only when migration 044 is not applied (the columns are missing).
   *
   * For the admin screen, so it can say "apply migration 044" instead of
   * rendering a switch that silently does nothing — exactly the role
   * `available` plays in `readCallGateSettings`. 044 IS applied in the live
   * database, but this code must not assume it: migrations here are run by
   * hand and a release routinely ships ahead of one.
   */
  available: boolean;
  /** Which credentials exist, regardless of status. Booleans only. */
  env: GhlEnvPresence;
  /**
   * May the drain contact GHL? True ONLY for `live`.
   *
   * The single question a producer or the drain should ask. Everything else on
   * this object is for the admin screen and the logs.
   */
  mayWrite: boolean;
}

export type GhlConfig =
  | (GhlConfigBase & { status: "live"; mayWrite: true; credentials: GhlCredentials })
  | (GhlConfigBase & { status: "dry_run"; mayWrite: false })
  | (GhlConfigBase & { status: "disabled"; mayWrite: false })
  | (GhlConfigBase & { status: "not_configured"; mayWrite: false; missing: GhlEnvVarName[] })
  | (GhlConfigBase & { status: "unavailable"; mayWrite: false });

/**
 * Should a producer enqueue, or the drain claim, at all?
 *
 * TRUE FOR A DRY RUN. The point of the dry run is that the whole path runs —
 * producers enqueue, the drain claims and resolves — with GHL untouched, so
 * "are we switched on" and "may we write" are separate questions and have
 * separate accessors. Use this one to decide whether to do any work; use
 * `mayWrite` to decide whether to make a request.
 */
export function ghlIsOn(config: GhlConfig): boolean {
  return config.status === "live" || config.status === "dry_run";
}

/* ------------------------------------------------------------------ *
 * Resolution
 * ------------------------------------------------------------------ */

/**
 * Resolve the integration's configuration.
 *
 * `db` must be a service-role or server client: `app_settings` is admin
 * configuration and is not readable from a customer session or the browser.
 *
 * ORDER OF THE CHECKS IS THE ORDER OF THE OPERATOR'S CONTROL. The database
 * switch is read first and reported first, because "I switched it off" must
 * win over "and also the token is missing" — an operator who turned the
 * integration off should not be nagged about credentials for something they
 * deliberately disabled. Within "on", a missing credential beats the dry-run
 * flag, since a dry run with no token is still not a working configuration and
 * saying "dry run" would imply more progress than there is.
 *
 * `env.presence` is reported on EVERY result including `disabled`, so the
 * admin screen can still warn that the token is unset before the operator
 * flips the switch and discovers it the hard way.
 */
export async function loadGhlConfig(
  db: SupabaseClient,
  options?: { env?: GhlEnvSource }
): Promise<GhlConfig> {
  const { credentials, presence, missing } = readGhlEnv(options?.env);

  /** True for every path below that got far enough to read the columns. */
  const available = true;

  try {
    const { data, error } = await db
      .from("app_settings")
      .select("ghl_enabled, ghl_dry_run")
      .eq("id", "global")
      .maybeSingle();

    if (error) {
      const missingColumn = isMissingColumnError(error);
      if (!missingColumn) {
        // A real read failure is worth a line in the log; an unapplied
        // migration is expected and is not.
        console.error("[ghl/config] settings read failed, not syncing:", error.message);
      }
      return {
        status: "unavailable",
        available: !missingColumn,
        env: presence,
        mayWrite: false,
      };
    }

    if (!data) {
      /*
       * NO SINGLETON ROW IS "UNAVAILABLE", NOT "DISABLED". Migration 020
       * creates `app_settings` with id = 'global' and nothing deletes it, so a
       * missing row means the table is not in the state this code expects.
       * Reporting it as a deliberate "off" would tell an operator their switch
       * is working when in fact there is nothing for it to write to.
       */
      console.error("[ghl/config] no app_settings singleton, not syncing");
      return { status: "unavailable", available: true, env: presence, mayWrite: false };
    }

    const row = data as { ghl_enabled?: unknown; ghl_dry_run?: unknown };

    // Strict true. A null column — a row written before the DEFAULT took
    // effect — must not read as "enabled".
    if (row.ghl_enabled !== true) {
      return { status: "disabled", available, env: presence, mayWrite: false };
    }

    if (!credentials) {
      return {
        status: "not_configured",
        available,
        env: presence,
        mayWrite: false,
        missing,
      };
    }

    /*
     * DRY RUN IS THE DEFAULT READING OF ANYTHING THAT IS NOT EXACTLY FALSE.
     * Note the asymmetry with `ghl_enabled` above: there, the safe default is
     * "off", so only `=== true` counts; here the safe default is "do not
     * write", so only `=== false` releases us. A NULL in either column
     * therefore lands on the cautious side of both, which is the invariant
     * this whole module exists to hold.
     */
    if (row.ghl_dry_run !== false) {
      return { status: "dry_run", available, env: presence, mayWrite: false };
    }

    return {
      status: "live",
      available,
      env: presence,
      mayWrite: true,
      credentials,
    };
  } catch (err: unknown) {
    // A thrown client (bad URL, fetch failure, mocked-away method) is the same
    // answer as an unreadable table. `available` stays true: we learned
    // nothing about whether the columns exist, and claiming the migration is
    // missing would send an operator to the SQL editor for no reason.
    console.error(
      "[ghl/config] settings read threw, not syncing:",
      err instanceof Error ? err.message : String(err)
    );
    return { status: "unavailable", available, env: presence, mayWrite: false };
  }
}

/**
 * One line for the logs and the admin screen.
 *
 * NEVER INCLUDES A CREDENTIAL — not the token, and not the location id either.
 * A location id is not a secret on its own, but it is half of a credential
 * pair and it identifies the client's account; log lines end up in support
 * tickets and screenshots, and there is no reason for it to be there.
 */
export function describeGhlConfig(config: GhlConfig): string {
  switch (config.status) {
    case "live":
      return "Live. Tags are being written to GoHighLevel.";
    case "dry_run":
      return "Dry run. Events are queued and resolved, but GoHighLevel is not contacted.";
    case "disabled":
      return "Switched off. Nothing is queued and nothing is sent.";
    case "not_configured":
      return (
        "Not configured. Set " +
        config.missing.join(" and ") +
        " in the environment, then reload."
      );
    case "unavailable":
      return config.available
        ? "The GoHighLevel settings could not be read, so nothing is being sent."
        : "Migration 044 is not applied, so the GoHighLevel settings do not exist yet.";
  }
}
