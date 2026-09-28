import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * AI generation event log writer.
 *
 * Writes append-only rows into `generation_events` (migrations 011 + 016)
 * using the SERVICE ROLE client — the table has RLS on with a SELECT policy
 * only and deliberately no insert policy, so client sessions cannot forge
 * dashboard metrics.
 *
 * THIS IS THE FIX FOR A SILENT FAILURE. The previous call sites inserted with
 * the user-scoped client, which Postgres rejected with 42501, and wrapped the
 * insert in try/catch — but supabase-js RETURNS `{ error }` instead of
 * throwing, so the catch never fired and the error was never read. The table
 * sat at 0 rows and nothing was logged anywhere. Hence the explicit
 * `if (error)` check below: a write failure must be loud even though it is
 * non-fatal.
 *
 * CONTRACT: logGenerationEvent NEVER throws and never changes the caller's
 * outcome. Metrics logging is strictly observational; a logging failure must
 * not turn a successful generation into an error response. Every failure is
 * swallowed and reported via console.error.
 */

/** The kind of AI work that produced this event. */
export type GenerationEventType =
  | "plan_generation"
  | "plan_regeneration"
  | "plan_enhancement";

export interface LogGenerationEventInput {
  companyId: string;
  userId?: string | null;
  eventType: GenerationEventType;
  status?: "success" | "failed";
  initiativesCreated?: number;
  suggestionsCreated?: number;
  durationMs?: number | null;
  model?: string | null;
  tokensInput?: number | null;
  tokensOutput?: number | null;
  errorMessage?: string | null;
}

/** Columns that exist in migration 011, before 016 is applied. */
type BaseRow = {
  company_id: string;
  user_id: string | null;
  event_type: GenerationEventType;
  initiatives_created: number;
  suggestions_created: number;
  duration_ms: number | null;
  model: string | null;
};

/**
 * PostgREST reports an unknown column as PGRST204 ("column ... does not
 * exist" from the schema cache); Postgres itself uses 42703. Either means
 * migration 016 has not been applied to this database yet.
 */
function isMissingColumnError(code?: string): boolean {
  return code === "PGRST204" || code === "42703";
}

/**
 * Insert one generation-event row.
 *
 * @param input  the event to record (camelCase; mapped to snake_case columns)
 * @param db     optional service-role client to reuse; one is built if omitted
 */
export async function logGenerationEvent(
  input: LogGenerationEventInput,
  db?: SupabaseClient
): Promise<void> {
  try {
    const client =
      db ??
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

    const base: BaseRow = {
      company_id: input.companyId,
      user_id: input.userId ?? null,
      event_type: input.eventType,
      initiatives_created: input.initiativesCreated ?? 0,
      suggestions_created: input.suggestionsCreated ?? 0,
      duration_ms: input.durationMs ?? null,
      model: input.model ?? null,
    };

    const row = {
      ...base,
      status: input.status ?? "success",
      error_message: input.errorMessage ?? null,
      tokens_input: input.tokensInput ?? null,
      tokens_output: input.tokensOutput ?? null,
    };

    const { error } = await client.from("generation_events").insert(row);
    if (!error) return;

    // Migration 016 not applied yet: retry ONCE with only the 011 columns so
    // the count stays accurate on a database that is behind on migrations.
    if (isMissingColumnError(error.code)) {
      console.warn(
        "[generation-events] migration 016 appears to be pending (" +
          error.code +
          "); retrying with base columns only. Apply " +
          "supabase/migrations/016_generation_events_hardening.sql."
      );
      const { error: retryError } = await client
        .from("generation_events")
        .insert(base);
      if (retryError) {
        console.error(
          "[generation-events] write failed:",
          retryError.message,
          retryError.code
        );
      }
      return;
    }

    console.error("[generation-events] write failed:", error.message, error.code);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[generation-events] write failed:", message);
  }
}
