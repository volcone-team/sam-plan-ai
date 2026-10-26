-- ============================================================
-- 052: GHL 'registered' EVENT
--
-- ghl_events.event_type (044) gains 'registered': a company owner signed up
-- through the public signup and has not paid. Producer:
-- src/lib/ghl/producers/registration.ts. Tags:
--   sam plan ai app - registered - not - paid   (always)
--   sam plan ai app - buyer - opted - dnd       (promotional consent unticked)
--
-- 044 declared the CHECK inline, so the DO block drops every CHECK on
-- ghl_events whose definition mentions event_type, by definition, and the
-- widened one is re-added as ghl_events_event_type_check.
--
-- Code does not depend on this being applied: until it is, the insert is
-- refused with 23514 and the producer reports "not delivered" without
-- affecting signup or /api/me.
--
-- Writes no data. Safe to re-run.
-- ============================================================

-- 1. Drop the existing event_type CHECK, whatever it is called.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.contype = 'c'
       AND c.conrelid = to_regclass('public.ghl_events')
       AND pg_get_constraintdef(c.oid) ILIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE ghl_events DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
$$;

-- 2. The widened CHECK.
ALTER TABLE ghl_events
  DROP CONSTRAINT IF EXISTS ghl_events_event_type_check;
ALTER TABLE ghl_events
  ADD CONSTRAINT ghl_events_event_type_check
  CHECK (event_type IN ('buyer_state', 'founder', 'cancellation', 'finished_intake', 'plan_generated', 'first_login', 'login_trigger', 'marketing_suppression', 'registered'));

COMMENT ON COLUMN ghl_events.event_type IS
  'What happened, not what to write (the tags columns say that). buyer_state: purchase or tier change - one buyer tag added, the others removed (entering active also removes registered - not - paid). founder: founding-member cohort, add only. cancellation: subscription ended. finished_intake / plan_generated: lifecycle milestones. first_login: one-shot, guarded by profiles.ghl_first_login_at. login_trigger: dropped by the client, nothing enqueues it. marketing_suppression: the Customer - SAM Plan AI tag in the ayr / 10x accounts. registered (052): one per company, owner signed up through the public signup and has not paid - adds registered - not - paid, plus buyer - opted - dnd when promotional consent was refused.';
