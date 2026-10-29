-- ============================================================
-- 058: CONSENT FROM INVITED ACCOUNTS
--
-- People created by an admin (company or user) or invited from Settings never
-- saw the signup checkboxes, so their terms acceptance and promotional consent
-- were NULL ("never asked"). They are now asked on /auth/set-password, the
-- first screen they reach, because nobody else may consent on their behalf.
--
-- 1. profiles.terms_accepted_via  'signup' | 'invite' (NULL on older rows,
--    which all came from the public signup).
--
--    WHY IT IS NEEDED. The GHL registration event ("registered - not - paid")
--    treats a non-null terms_accepted_at as proof of a PUBLIC signup. Stamping
--    it for invited people without this marker would put every admin-created
--    owner, comped companies included, into the not-paid workflow.
--
-- 2. ghl_events.event_type gains 'consent': an invited OWNER's choice, tagged
--    "buyer - opted - dnd" (unticked) or "buyer - opted - communication"
--    (ticked). Team members are recorded but never become GHL contacts.
--
-- Code does not depend on this being applied. Until it is, invited users can
-- still set a password and their promotional choice is saved, but terms
-- acceptance is not recorded for them and no consent tag is queued.
--
-- No DO block: the event_type CHECK is named ghl_events_event_type_check both
-- by 052 and by Postgres's default naming for 044's inline CHECK.
--
-- SAFE TO RE-RUN.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS terms_accepted_via TEXT;

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_terms_accepted_via_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_terms_accepted_via_check
  CHECK (terms_accepted_via IS NULL OR terms_accepted_via IN ('signup', 'invite'));

COMMENT ON COLUMN profiles.terms_accepted_via IS
  'Where terms_accepted_at was given: signup (public signup) or invite (set-password screen after an admin or owner invite). NULL on rows from before 058, which came from the public signup.';

ALTER TABLE ghl_events
  DROP CONSTRAINT IF EXISTS ghl_events_event_type_check;
ALTER TABLE ghl_events
  ADD CONSTRAINT ghl_events_event_type_check
  CHECK (event_type IN ('buyer_state', 'founder', 'cancellation', 'finished_intake', 'plan_generated', 'first_login', 'login_trigger', 'marketing_suppression', 'registered', 'consent'));

COMMENT ON COLUMN ghl_events.event_type IS
  'What happened, not what to write (the tags columns say that). buyer_state: purchase or tier change. founder: founding-member cohort. cancellation: subscription ended. finished_intake / plan_generated: lifecycle milestones. first_login: one-shot. login_trigger: dropped by the client. marketing_suppression: ayr / 10x suppression tag. registered (052): public-signup owner who has not paid; adds registered - not - paid plus buyer - opted - dnd or buyer - opted - communication. consent (058): an invited owner answered the promotional box on /auth/set-password; adds buyer - opted - dnd or buyer - opted - communication.';
