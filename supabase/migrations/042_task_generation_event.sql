-- 042: allow 'task_generation' in generation_events.event_type
--
-- Initiatives whose library key has no workbook task template now get their
-- task list written by Claude at build time (src/lib/workbook/tasks-for-initiatives.ts).
-- Those calls are NOT metered against the customer's ai_uses_month allowance,
-- but their token spend still has to show up in /admin/ai-usage, which reads
-- generation_events. The CHECK from migration 011 lists only the three plan
-- event types, so the insert is rejected with 23514 until this runs.
--
-- Safe to run more than once. Nothing is backfilled: rows written while this
-- was pending were dropped by the constraint, not stored wrongly.
--
-- Until this is applied the task generation still works; only its token
-- logging is skipped, with a warning naming this file.

ALTER TABLE generation_events
  DROP CONSTRAINT IF EXISTS generation_events_event_type_check;

ALTER TABLE generation_events
  ADD CONSTRAINT generation_events_event_type_check
  CHECK (event_type IN (
    'plan_generation',
    'plan_regeneration',
    'plan_enhancement',
    'task_generation'
  ));
