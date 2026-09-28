-- ============================================================
-- Generation Events Hardening
--
-- WHY THIS MIGRATION EXISTS
-- `generation_events` (migration 011) had RLS enabled and only a
-- SELECT policy. Every write site used the user-scoped client, so
-- Postgres rejected every insert with 42501 and the table sat at
-- 0 rows. The failure was invisible: supabase-js RETURNS `{ error }`
-- rather than throwing, and both call sites wrapped the insert in a
-- try/catch that therefore never fired, and never checked the
-- returned error.
--
-- WRITES ARE SERVICE-ROLE ONLY — BY DESIGN.
-- This migration deliberately does NOT add an INSERT policy. Like
-- `activity_log` (migration 015), this is an append-only metrics log:
-- if a client session could insert, the numbers on the admin
-- dashboard would be forgeable by any logged-in user. The correct
-- fix is in the application code, which now writes through the
-- service-role client (the service role bypasses RLS entirely).
-- See src/lib/generation-events.ts.
--
-- WHAT THIS MIGRATION ADDS
--   * status / error_message  - failed generations are now logged too,
--     so a broken AI path is visible instead of simply absent.
--   * tokens_input / tokens_output - cost + usage tracking.
--   * backfilled              - marks the synthetic rows created below
--     so they are distinguishable from real observed events.
--   * A one-time backfill that reproduces the old dashboard ESTIMATE
--     as real, timestamped rows, so removing the estimate fallback in
--     /api/admin/stats does not drop the visible number to 0.
--
-- duration_ms and model already exist from migration 011.
-- Everything below is idempotent and safe to re-run.
-- ============================================================

-- ---- Columns (all guarded with IF NOT EXISTS) ----

ALTER TABLE generation_events
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'success';

ALTER TABLE generation_events
  ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE generation_events
  ADD COLUMN IF NOT EXISTS tokens_input INT;

ALTER TABLE generation_events
  ADD COLUMN IF NOT EXISTS tokens_output INT;

-- Synthetic rows from the backfill below are flagged so analytics can
-- exclude them if it ever needs "only genuinely observed" events.
ALTER TABLE generation_events
  ADD COLUMN IF NOT EXISTS backfilled BOOLEAN NOT NULL DEFAULT false;

-- ---- Constraints (ADD CONSTRAINT has no IF NOT EXISTS; guard it) ----

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'generation_events_status_check'
      AND conrelid = 'generation_events'::regclass
  ) THEN
    ALTER TABLE generation_events
      ADD CONSTRAINT generation_events_status_check
      CHECK (status IN ('success', 'failed'));
  END IF;
END $$;

-- ---- Indexes (existing ones from 011 are left untouched) ----

-- Success-rate queries filter on status over a trailing window.
CREATE INDEX IF NOT EXISTS idx_generation_events_status
  ON generation_events(status);

-- ---- One-time backfill ----
--
-- Guarded by `WHERE NOT EXISTS (SELECT 1 FROM generation_events)`: it
-- runs only while the table is still completely empty, so re-running
-- this file (or running it after real events have been recorded) can
-- never duplicate history.
--
-- This reconstructs exactly what /api/admin/stats used to estimate:
--   (# companies with >= 1 initiative) + (# plan_snapshots)
-- but as real rows with real timestamps and company attribution.
-- user_id is NULL because the original actor was never recorded.

-- One 'plan_generation' per company that has at least one initiative,
-- dated at that company's earliest initiative.
INSERT INTO generation_events (
  company_id, user_id, event_type, initiatives_created, status, backfilled, created_at
)
SELECT
  i.company_id,
  NULL,
  'plan_generation',
  COUNT(*)::int,
  'success',
  true,
  MIN(i.created_at)
FROM initiatives i
WHERE i.company_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM generation_events)
GROUP BY i.company_id;

-- One 'plan_regeneration' per snapshot: a snapshot exists precisely
-- because a plan was superseded by a regeneration.
INSERT INTO generation_events (
  company_id, user_id, event_type, status, backfilled, created_at
)
SELECT
  s.company_id,
  NULL,
  'plan_regeneration',
  'success',
  true,
  s.created_at
FROM plan_snapshots s
WHERE NOT EXISTS (
  SELECT 1 FROM generation_events WHERE backfilled = false
)
AND NOT EXISTS (
  SELECT 1 FROM generation_events WHERE event_type = 'plan_regeneration'
);

-- NOTE: the second insert's guard differs from the first because the
-- first insert has, by then, already populated the table. It checks
-- instead that (a) no real (non-backfilled) events exist and (b) no
-- regeneration rows have been backfilled yet — same "run at most
-- once, only on virgin data" semantics.
