import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import { loadGhlConfig } from "@/lib/ghl/config";
import { ghlSettingsPayload } from "@/lib/ghl/admin-view";
import { parseGhlSettingsInput, type GhlSwitchState } from "@/lib/ghl/admin-input";
import { isMissingColumnError } from "@/lib/supabase/missing-column";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The GoHighLevel integration's two switches (migration 044).
 *
 * SUPER-ADMIN ONLY, matching /api/admin/call-gate-settings: `ghl_enabled` is
 * the client's requested global off switch for an integration that writes into
 * THEIR CRM, which is a commercial decision rather than day-to-day admin.
 *
 * GET → the switch positions, the resolved status, which credentials exist.
 * PUT → set either switch. One switch per request is the intended use.
 *
 * NO CREDENTIAL EVER LEAVES THIS ROUTE. The token and the location id are env
 * vars and are reported as PRESENCE BOOLEANS only — `config.credentials`
 * exists on a live config and must never be spread into a response. That
 * projection is `ghlSettingsPayload`, a pure function precisely so
 * `admin-view.test.ts` can assert the serialised payload contains neither
 * value, rather than trusting a reviewer to notice a future `...config`.
 */

function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The answer when the columns are not there yet.
 *
 * 409, not 500 and not 503: nothing has failed and retrying will not help —
 * the database is simply a migration behind, which is a normal state in this
 * project (they are applied by hand). Same contract as the call gate's
 * `migration_required`, which the panel keys off to disable its controls
 * rather than show switches that silently discard what they are told.
 */
const MIGRATION_REQUIRED = {
  error: "migration_required",
  migration: "044_ghl_outbox",
  message:
    "Migration 044 (044_ghl_outbox.sql) has not been applied to this database " +
    "yet, so the GoHighLevel integration cannot be configured. Run it in the " +
    "Supabase SQL editor, then reload this page.",
} as const;

/**
 * Where the two switches actually are.
 *
 * WHY THIS READS THE COLUMNS WHEN `loadGhlConfig` ALREADY DID. `config.ts`
 * answers a different question — "may we sync, and for real?" — and
 * deliberately collapses the inputs on the way: once `ghl_enabled` is false,
 * or a credential is missing, it stops reporting the dry-run column at all,
 * because the drain has no use for it. A panel with two switches has to render
 * two positions, including the position of a switch whose value currently
 * changes nothing, and so does the transition rule in `admin-input.ts`, which
 * compares the stored state against the requested one.
 *
 * Deriving them from `status` instead would be wrong in exactly the dangerous
 * direction: `not_configured` and `disabled` both hide the stored dry-run
 * value, so a panel would show "dry run: on" over a column that says false,
 * and the first flip of the enable switch would go straight to live writes.
 *
 * THE DECISION IS STILL `config.ts`'s ALONE. Nothing here infers whether we
 * may write; `mayWrite` and `status` on the response come from `loadGhlConfig`.
 */
async function readGhlSwitches(
  db: SupabaseClient
): Promise<
  { ok: true; switches: GhlSwitchState } | { ok: false; migrationRequired: boolean; message: string }
> {
  try {
    const { data, error } = await db
      .from("app_settings")
      .select("ghl_enabled, ghl_dry_run")
      .eq("id", "global")
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        migrationRequired: isMissingColumnError(error),
        message: error.message,
      };
    }

    const row = (data ?? {}) as { ghl_enabled?: unknown; ghl_dry_run?: unknown };
    return {
      ok: true,
      // The same asymmetry `config.ts` uses, and for the same reason: a NULL
      // column reads as "off" for enabled and as "do not write" for dry run,
      // so either null lands on the cautious side of both.
      switches: { enabled: row.ghl_enabled === true, dryRun: row.ghl_dry_run !== false },
    };
  } catch (err: unknown) {
    return { ok: false, migrationRequired: false, message: errMessage(err) };
  }
}

export async function GET() {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const db = adminClient();
    const config = await loadGhlConfig(db);
    const switches = await readGhlSwitches(db);

    if (!switches.ok) {
      if (switches.migrationRequired) {
        return NextResponse.json(MIGRATION_REQUIRED, { status: 409 });
      }
      console.error("[admin/ghl/settings] switch read failed:", switches.message);
      return NextResponse.json({ error: switches.message }, { status: 500 });
    }

    return NextResponse.json({
      enabled: switches.switches.enabled,
      dryRun: switches.switches.dryRun,
      ...ghlSettingsPayload(config),
    });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/ghl/settings] GET error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "body" }, { status: 400 });
    }

    const db = adminClient();

    /*
     * THE STORED STATE IS READ BEFORE THE INPUT IS JUDGED, because the rule
     * `admin-input.ts` enforces is about a TRANSITION: the same body is
     * harmless against one stored state and a live write into the client's CRM
     * against another. A read-then-write is not atomic, and does not need to
     * be — the worst a lost update can do here is refuse a transition that was
     * already made, or let through a second request that is identical to the
     * first.
     */
    const switches = await readGhlSwitches(db);
    if (!switches.ok) {
      if (switches.migrationRequired) {
        return NextResponse.json(MIGRATION_REQUIRED, { status: 409 });
      }
      console.error("[admin/ghl/settings] switch read failed:", switches.message);
      return NextResponse.json({ error: switches.message }, { status: 500 });
    }

    const parsed = parseGhlSettingsInput(body, switches.switches);
    if (!parsed.ok) {
      /*
       * 409 FOR THE TWO-STEP REFUSAL, 400 FOR THE REST. The body is
       * well-formed and the operator is allowed to do what they asked; it is
       * the CURRENT STATE that makes it a single-click jump to live writes, and
       * "retry after doing something else first" is what 409 means. 400 would
       * read as "your request is malformed" and send them looking for a typo.
       */
      const status = parsed.error === "two_step_required" ? 409 : 400;
      return NextResponse.json(
        { error: parsed.error, message: parsed.message },
        { status }
      );
    }

    const now = new Date().toISOString();
    const { error } = await db
      .from("app_settings")
      .upsert(
        { id: "global", ...parsed.patch, updated_by: check.userId, updated_at: now },
        { onConflict: "id" }
      );

    if (error) {
      if (isMissingColumnError(error)) {
        return NextResponse.json(MIGRATION_REQUIRED, { status: 409 });
      }
      console.error("[admin/ghl/settings] write failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: actor } = await db
      .from("profiles")
      .select("email")
      .eq("id", check.userId)
      .maybeSingle();

    await logActivity(
      {
        actorUserId: check.userId,
        actorEmail: (actor as { email?: string } | null)?.email ?? null,
        action: "ghl_settings.updated",
        targetType: "app_settings",
        targetId: null,
        targetLabel: "gohighlevel",
        /*
         * Values recorded in full, and the PREVIOUS state with them. This is
         * operational config, not customer data, and the question an audit
         * trail has to answer about this feature is "who turned dry run off,
         * and when did the live writes start" — which needs the before as well
         * as the after. No credential is involved: these are two booleans.
         */
        metadata: {
          changed: parsed.changed,
          previous: switches.switches,
          fields: Object.keys(parsed.changed),
        },
      },
      db
    );

    // Re-resolved rather than guessed: the operator's next decision depends on
    // the STATUS the two switches produce together with the credentials, and
    // "enabled, but no token in this environment" is a state the panel must
    // show immediately rather than after a reload.
    const config = await loadGhlConfig(db);

    return NextResponse.json({
      updated: true,
      changed: parsed.changed,
      enabled: parsed.patch.ghl_enabled ?? switches.switches.enabled,
      dryRun: parsed.patch.ghl_dry_run ?? switches.switches.dryRun,
      ...ghlSettingsPayload(config),
    });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/ghl/settings] PUT error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
