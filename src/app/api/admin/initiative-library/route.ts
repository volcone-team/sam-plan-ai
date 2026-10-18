import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import { loadLibrary, loadInactiveInitiativeKeys } from "@/lib/workbook/read";
import { MAX_RECOMMENDED_INITIATIVES } from "@/lib/recommend/sizing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which workbook initiatives the AI may use. SUPER-ADMIN ONLY, matching the
 * other controls that decide what customers are offered.
 *
 * THE LIST IS THE WORKBOOK'S; ONLY THE TOGGLES ARE OURS. Every initiative the
 * uploaded workbook defines is returned, active or not — the library stays a
 * faithful projection of the spreadsheet and nothing is ever removed from it.
 * `initiative_settings` (migration 034) decides what the AI is allowed to
 * reference, and it lives in its own table precisely so a workbook re-upload
 * cannot wipe these choices.
 *
 * WHY THIS IS NOT /admin/initiatives. That screen toggles `initiative_types`,
 * a separate 32-row list the AI has never read — its switches looked like they
 * worked and did nothing. This one acts on the list that actually feeds
 * recommendations, the intake picker, plan generation, Enhance and the chatbot.
 *
 * GET → every library initiative with its active flag, plus counts.
 * PUT → set one or many toggles.
 *
 * PUT body:
 *   { changes: [{ initiativeKey: string, isActive: boolean, notes?: string|null }] }
 */

interface SettingsRow {
  initiative_key: string;
  is_active: boolean | null;
  max_per_plan: number | null;
  notes: string | null;
  updated_at: string | null;
}

function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function GET() {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const db = adminClient();

    /**
     * `includeInactive` is the whole point here: the admin screen has to show
     * what is switched OFF in order to offer a switch for it. Every other
     * caller of loadLibrary gets the filtered set.
     */
    const library = await loadLibrary(db, { includeInactive: true });

    const { data: settingsRaw, error: settingsError } = await db
      .from("initiative_settings")
      .select("initiative_key, is_active, max_per_plan, notes, updated_at");

    if (settingsError) {
      // Almost certainly migration 034 not applied. Said plainly, because the
      // alternative is a screen full of toggles that silently discard changes.
      console.error("[admin/initiative-library] Settings read failed:", settingsError.message);
      return NextResponse.json(
        { error: "settings_unavailable", message: settingsError.message },
        { status: 503 }
      );
    }

    const settings = new Map(
      ((settingsRaw ?? []) as unknown as SettingsRow[]).map((r) => [r.initiative_key, r])
    );

    const initiatives = library.map((entry) => {
      const row = settings.get(entry.initiativeKey);
      return {
        initiativeKey: entry.initiativeKey,
        name: entry.name,
        category: entry.category,
        oneLiner: entry.oneLiner,
        difficulty: entry.difficulty,
        speedToResults: entry.speedToResults,
        ownOrOps: entry.ownOrOps,
        needsSalesTeam: entry.needsSalesTeam,
        // Migration 040 fields (null / [] until it is applied and the
        // workbook re-uploaded). Not rendered yet — the UI is task 4.
        workbookId: entry.workbookId,
        baseKey: entry.baseKey,
        priceTier: entry.priceTier,
        speedScore: entry.speedScore,
        costScore: entry.costScore,
        oddsScore: entry.oddsScore,
        revenueScore: entry.revenueScore,
        easeScore: entry.easeScore,
        scoreTotal: entry.scoreTotal,
        idealIndustries: entry.idealIndustries,
        ctaOptions: entry.ctaOptions,
        training: entry.training,
        metricsRaw: entry.metricsRaw,
        metrics: entry.metrics,
        /**
         * Absent row reads as ACTIVE, matching loadInactiveInitiativeKeys. A
         * freshly uploaded workbook is usable before anyone has visited this
         * screen, rather than silently disabled.
         */
        isActive: row?.is_active !== false,
        /** True when nobody has made a decision about this one yet. */
        isDefault: !row,
        notes: row?.notes ?? null,
        updatedAt: row?.updated_at ?? null,
      };
    });

    /**
     * Settings rows with no matching library row — an initiative that was in a
     * previous workbook and is not in the current one. Harmless (the toggle has
     * nothing to apply to) but surfaced, because otherwise a toggle set months
     * ago is invisible and inexplicable if that initiative ever returns.
     */
    const libraryKeys = new Set(library.map((e) => e.initiativeKey));
    const orphanedSettings = [...settings.keys()].filter((k) => !libraryKeys.has(k));

    const activeCount = initiatives.filter((i) => i.isActive).length;

    return NextResponse.json({
      initiatives,
      counts: {
        total: initiatives.length,
        active: activeCount,
        inactive: initiatives.length - activeCount,
      },
      /** So the UI can explain the recommendation cap without hardcoding it. */
      maxRecommendedInitiatives: MAX_RECOMMENDED_INITIATIVES,
      orphanedSettings,
      /**
       * The library is empty when no workbook has been uploaded. Distinguished
       * from "everything is switched off", which looks identical on screen but
       * has a completely different fix.
       */
      libraryEmpty: initiatives.length === 0,
    });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/initiative-library] GET error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    let body: { changes?: unknown } = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      return NextResponse.json({ error: "body" }, { status: 400 });
    }

    if (!Array.isArray(body.changes) || body.changes.length === 0) {
      return NextResponse.json({ error: "changes" }, { status: 400 });
    }

    const changes: { initiative_key: string; is_active: boolean; notes: string | null }[] = [];

    for (const raw of body.changes) {
      const entry = raw as { initiativeKey?: unknown; isActive?: unknown; notes?: unknown };
      if (typeof entry?.initiativeKey !== "string" || !entry.initiativeKey.trim()) {
        return NextResponse.json({ error: "changes.initiativeKey" }, { status: 400 });
      }
      if (typeof entry.isActive !== "boolean") {
        return NextResponse.json({ error: "changes.isActive" }, { status: 400 });
      }
      changes.push({
        initiative_key: entry.initiativeKey.trim(),
        is_active: entry.isActive,
        notes:
          typeof entry.notes === "string" && entry.notes.trim()
            ? entry.notes.trim().slice(0, 500)
            : null,
      });
    }

    // A key sent twice in one request would make the result order-dependent.
    const seen = new Set<string>();
    for (const c of changes) {
      if (seen.has(c.initiative_key)) {
        return NextResponse.json(
          { error: "duplicate_key", message: `${c.initiative_key} appears twice.` },
          { status: 400 }
        );
      }
      seen.add(c.initiative_key);
    }

    const db = adminClient();
    const now = new Date().toISOString();

    /**
     * KEYS ARE NOT VALIDATED AGAINST THE CURRENT LIBRARY, on purpose.
     *
     * A toggle for an initiative that is not in the uploaded workbook right now
     * is meaningless but harmless, and refusing it would break the legitimate
     * case: switching something off, re-uploading a workbook that omits it, and
     * expecting the decision to still hold when it comes back. The settings
     * table has no FK for exactly the same reason.
     */
    const { error } = await db.from("initiative_settings").upsert(
      changes.map((c) => ({ ...c, updated_by: check.userId, updated_at: now })),
      { onConflict: "initiative_key" }
    );

    if (error) {
      console.error("[admin/initiative-library] Write failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    /**
     * Count what the AI is left with, and warn when that is too little.
     *
     * Switching everything off is honoured — an admin may mean it — but the
     * downstream symptom is "the AI recommends nothing" with no visible cause,
     * so the response says so and the screen can repeat it.
     */
    const inactive = (await loadInactiveInitiativeKeys(db)) ?? new Set<string>();
    const library = await loadLibrary(db, { includeInactive: true });
    const activeCount = library.filter((e) => !inactive.has(e.initiativeKey)).length;

    const { data: actor } = await db
      .from("profiles")
      .select("email")
      .eq("id", check.userId)
      .maybeSingle();

    await logActivity(
      {
        actorUserId: check.userId,
        actorEmail: (actor as { email?: string } | null)?.email ?? null,
        action: "initiative_library.updated",
        targetType: "initiative_settings",
        targetId: null,
        targetLabel: `${changes.length} initiative(s)`,
        metadata: {
          changes: changes.map((c) => ({ key: c.initiative_key, isActive: c.is_active })),
          activeCountAfter: activeCount,
        },
      },
      db
    );

    console.log(
      "[admin/initiative-library] updated", changes.length,
      "| active now:", activeCount, "of", library.length
    );

    return NextResponse.json({
      updated: changes.length,
      activeCount,
      totalCount: library.length,
      /**
       * Fewer than this and the recommender has nothing to choose between — the
       * eligibility rules (sales model, budget, hours, already-planned) can
       * easily exclude two or three, leaving a customer with an empty
       * shortlist. Not blocked, just reported.
       */
      tooFewActive: activeCount > 0 && activeCount < 3,
      noneActive: activeCount === 0,
    });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/initiative-library] PUT error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
