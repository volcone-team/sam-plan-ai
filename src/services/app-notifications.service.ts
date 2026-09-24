/**
 * App notifications service (in-app "bell" feed).
 *
 * Server-side writer for the `app_notifications` table (migration 013). This is
 * DISTINCT from the email-focused `notification_log`: this feed is what a user
 * sees inside the product. Writes go through the service-role client (event
 * handlers / cron / API routes create rows; RLS is bypassed). Creating a
 * notification must never break the caller's main flow, so create helpers log
 * and swallow DB errors rather than throwing.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AppNotificationType =
  | "initiative_reminder"
  | "plan_generated"
  | "task_due"
  | "results_due"
  | "system";

export interface CreateAppNotificationInput {
  userId: string;
  companyId?: string | null;
  type: AppNotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  metadata?: Record<string, unknown>;
  dedupeKey?: string | null;
}

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Create a single in-app notification.
 *
 * If `dedupeKey` is provided, the write is a check-then-insert: we first look
 * for an existing (user_id, dedupe_key) row and skip the insert when one is
 * found, so a re-run of the same event is a no-op returning
 * `{ created: false, id: null }`. We deliberately do NOT upsert here: the
 * dedupe uniqueness is a PARTIAL unique index (`... WHERE dedupe_key IS NOT
 * NULL`), and Postgres/PostgREST cannot use a partial index as an
 * `ON CONFLICT (columns)` target, so an upsert would fail at runtime. The
 * partial index still guards against a concurrent duplicate insert: a unique
 * violation (SQLSTATE 23505) on the insert is treated as a benign duplicate.
 * When no `dedupeKey` is given a plain insert is performed.
 *
 * Never throws: on any DB error it logs and returns `{ created: false, id: null }`
 * so the caller's main flow (e.g. sending an email) is never disrupted.
 *
 * @param db Optional injected service-role client to reuse from a caller that
 *           already has one; a fresh client is built when omitted.
 */
export async function createAppNotification(
  input: CreateAppNotificationInput,
  db?: SupabaseClient
): Promise<{ created: boolean; id: string | null }> {
  try {
    const client = db ?? serviceClient();

    const rowValues = {
      user_id: input.userId,
      company_id: input.companyId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      metadata: input.metadata ?? {},
      dedupe_key: input.dedupeKey ?? null,
    };

    // Plain insert shared by both paths. Returns the new id on success, or
    // signals a benign duplicate (partial-index unique violation) so the
    // dedupe path can treat a concurrent insert as a no-op rather than error.
    async function insertRow(): Promise<{
      created: boolean;
      id: string | null;
      duplicate: boolean;
    }> {
      const { data, error } = await client
        .from("app_notifications")
        .insert(rowValues)
        .select("id")
        .single();

      if (error || !data) {
        // 23505 = unique_violation: a concurrent insert won the race on the
        // partial (user_id, dedupe_key) index. Benign; not a real error.
        if (error?.code === "23505") {
          return { created: false, id: null, duplicate: true };
        }
        console.error("[app-notifications] create error:", error?.message);
        return { created: false, id: null, duplicate: false };
      }
      return { created: true, id: data.id as string, duplicate: false };
    }

    if (input.dedupeKey != null) {
      // Check-then-insert: look for an existing row for this (user, key).
      const { data: existing, error: selectError } = await client
        .from("app_notifications")
        .select("id")
        .eq("user_id", input.userId)
        .eq("dedupe_key", input.dedupeKey)
        .maybeSingle();

      if (selectError) {
        console.error(
          "[app-notifications] dedupe check error:",
          selectError.message
        );
        return { created: false, id: null };
      }
      if (existing) {
        // Already exists -> idempotent no-op.
        return { created: false, id: null };
      }

      const result = await insertRow();
      return { created: result.created, id: result.id };
    }

    const result = await insertRow();
    return { created: result.created, id: result.id };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[app-notifications] create error:", message);
    return { created: false, id: null };
  }
}

/**
 * Fan out one notification to many users. Returns the number of rows created.
 *
 * The same base `dedupeKey` is fine across users: the partial UNIQUE index is
 * scoped per (user_id, dedupe_key), so one key stays idempotent per recipient
 * while still allowing every recipient to receive the notification.
 */
export async function createAppNotificationsForUsers(
  userIds: string[],
  input: Omit<CreateAppNotificationInput, "userId">
): Promise<number> {
  const db = serviceClient();
  let created = 0;
  for (const userId of userIds) {
    const result = await createAppNotification({ ...input, userId }, db);
    if (result.created) created++;
  }
  return created;
}
