import type { SupabaseClient } from "@supabase/supabase-js";
import { restoreDraft, type RestoredDraft } from "@/lib/intake/draft";

/**
 * Read a company's current v2 intake from the database.
 *
 * Shared by GET /api/intake/draft (which the intake shell hydrates from) and
 * the read-only Settings → "Intake answers" view, so both show the same row.
 *
 * READ-ONLY. `companyId` must come from the authenticated session, never from
 * a request; this module trusts it and scopes every query by it.
 */

/**
 * The company's current v2 intake row.
 *
 * Most recent first so a company with history resumes the latest attempt
 * rather than an abandoned older one.
 */
export async function currentIntakeInput(
  db: SupabaseClient,
  companyId: string
): Promise<Record<string, unknown> | null> {
  const { data } = await db
    .from("planning_inputs")
    .select("*")
    .eq("company_id", companyId)
    .eq("intake_version", 2)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as Record<string, unknown> | null) ?? null;
}

export interface LoadedIntakeDraft {
  restored: RestoredDraft;
  planningInputId: string | null;
  /** `planning_inputs.updated_at`, bumped by trigger on every draft save. */
  updatedAt: string | null;
}

/** The restored draft plus its row id and last-saved time. */
export async function loadIntakeDraft(
  db: SupabaseClient,
  companyId: string
): Promise<LoadedIntakeDraft> {
  const input = await currentIntakeInput(db, companyId);

  if (!input) {
    return { restored: restoreDraft(null), planningInputId: null, updatedAt: null };
  }

  const planningInputId = input.id as string;

  const [{ data: products }, { data: initiatives }] = await Promise.all([
    db
      .from("intake_products")
      .select("*")
      .eq("planning_input_id", planningInputId)
      .order("display_order", { ascending: true }),
    db
      .from("intake_initiatives")
      .select("*")
      .eq("planning_input_id", planningInputId)
      .order("display_order", { ascending: true }),
  ]);

  const restored = restoreDraft(
    input,
    (products ?? []) as Record<string, unknown>[],
    (initiatives ?? []) as Record<string, unknown>[]
  );

  const updatedAt = typeof input.updated_at === "string" ? input.updated_at : null;

  return { restored, planningInputId, updatedAt };
}
