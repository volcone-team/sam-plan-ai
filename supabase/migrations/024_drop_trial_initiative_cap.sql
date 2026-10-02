-- ============================================================
-- Drop the trial initiative cap
--
-- Migration 023 added app_settings.trial_initiative_cap to limit how many
-- initiatives a trial account could create. It is removed: a trial now simply
-- grants the default plan's (Starter's) limits for a number of DAYS, with no
-- separate initiative allowance. The feature was a second place for limits to
-- live and drift, and "a trial is time-boxed Starter" is both simpler and what
-- was intended.
--
-- Enforcement no longer reads this column (see src/lib/billing/enforce.ts), so
-- dropping it is safe. IF EXISTS makes this idempotent and harmless on a database
-- where 023 was never applied.
-- ============================================================

ALTER TABLE app_settings
  DROP COLUMN IF EXISTS trial_initiative_cap;
