import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Admin activity / audit log writer.
 *
 * Writes append-only rows into `activity_log` (migration 015) using the
 * SERVICE ROLE client — the table has no insert policy, so client sessions
 * cannot forge or edit audit rows.
 *
 * CONTRACT: logActivity NEVER throws and never changes the caller's outcome.
 * Audit logging is strictly observational; a logging failure must not turn a
 * successful admin action into an error response. Every failure is swallowed
 * and reported via console.error.
 *
 * Callers should log AFTER the action succeeds, and should capture
 * `targetLabel` (email / name) BEFORE a delete, since it is unreadable after.
 */

/** Dotted verb describing the action, e.g. 'user.created'. */
export type ActivityAction = string;

export interface LogActivityInput {
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: ActivityAction;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  companyId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Insert one audit row.
 *
 * @param input  the event to record (camelCase; mapped to snake_case columns)
 * @param db     optional service-role client to reuse; one is built if omitted
 */
export async function logActivity(
  input: LogActivityInput,
  db?: SupabaseClient
): Promise<void> {
  try {
    const client =
      db ??
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

    const row = {
      actor_user_id: input.actorUserId ?? null,
      actor_email: input.actorEmail ?? null,
      action: input.action,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      target_label: input.targetLabel ?? null,
      company_id: input.companyId ?? null,
      metadata: input.metadata ?? {},
    };

    const { error } = await client.from("activity_log").insert(row);
    if (error) {
      console.error("[activity-log] write failed:", error.message);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[activity-log] write failed:", message);
  }
}
