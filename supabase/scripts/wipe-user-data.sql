-- ============================================================
-- WIPE ALL USER DATA — fresh application, config preserved
--
-- ⚠️  DESTRUCTIVE AND IRREVERSIBLE. Back up first. This cannot be undone from
--     within the app.
--
-- Run in the Supabase SQL EDITOR — the only context that can delete auth.users.
-- NOT a migration: a migration re-runs on every deploy, and a destructive
-- statement in the migration history would eventually wipe production.
--
-- DELETES everything a user generated. KEEPS all config: initiative_types, the
-- wb_* workbook tables, subscription_plans / plan_limits / plan_features,
-- stripe_prices, app_settings, email_templates, notification_rules, and ALL
-- triggers and functions — so registration still works after.
--
-- SAFE TO RE-RUN. Every clear is guarded so a missing table (e.g. a migration
-- not yet applied here) is skipped with a notice rather than aborting the whole
-- transaction and leaving the wipe half-done.
--
-- VERIFY IT WORKED. `node scripts/count-user-data.mjs` before and after. It
-- counts every table this clears and separately checks the config tables are
-- still populated — an empty wb_initiative_library is invisible in the UI
-- (the intake picker simply shows nothing) and would look like a broken screen
-- rather than missing data.
-- ============================================================

DO $$
DECLARE
  -- Order does not matter: TRUNCATE ... CASCADE resolves dependencies itself.
  -- `companies` first clears the bulk (products, plans, initiatives, tasks,
  -- results, expenses, subscriptions, invoices, usage, chat budgets, ...).
  -- The rest are tables keyed on profiles/users or Stripe that the companies
  -- cascade does not reach.
  t TEXT;
  targets TEXT[] := ARRAY[
    'companies',
    -- Listed EXPLICITLY even though invoices are company-scoped. The
    -- billing_invoices.company_id FK is `ON DELETE SET NULL` (migration 022),
    -- so the `companies` cascade does not remove these rows — it only blanks
    -- their company_id, leaving orphans that still counted towards "Collected
    -- to date" and showed up in payment history after a supposedly clean wipe.
    'billing_invoices',
    /*
     * Intake v2 (migrations 025 and 026).
     *
     * `planning_inputs`, `intake_products` and `intake_initiatives` all have
     * NOT NULL company_id with ON DELETE CASCADE, so the `companies` truncate
     * above already reaches them. They are named anyway: a wipe that silently
     * misses one leaves the next test run RESUMING into the previous run's
     * answers, which presents as a bug in the intake rather than as stale data.
     *
     * `intake_events` genuinely needs to be here. Its company_id is NULLABLE on
     * purpose — a screen-0 event can fire before a company is resolved on a
     * brand-new signup, and losing it would bias the very funnel being measured
     * — so rows with a NULL company_id are NOT reached by the cascade and would
     * otherwise survive every wipe forever.
     */
    'planning_inputs',
    'intake_products',
    'intake_initiatives',
    'intake_events',
    'generation_events',
    'stripe_webhook_events',
    'two_factor_codes',
    'app_notifications',
    'notification_opt_outs',
    'activity_log',
    'internal_team'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('TRUNCATE TABLE public.%I CASCADE', t);
      RAISE NOTICE 'cleared %', t;
    ELSE
      RAISE NOTICE 'skipped % (does not exist)', t;
    END IF;
  END LOOP;

  -- auth.users LAST. profiles cascades from it, clearing every profile; the
  -- DELETE (not TRUNCATE) lets auth.* child tables — sessions, identities,
  -- refresh tokens — cascade too, which a TRUNCATE would refuse.
  DELETE FROM auth.users;
  RAISE NOTICE 'cleared auth.users';
END $$;

-- ============================================================
-- AFTER YOU RE-REGISTER, promote yourself. Replace the email, then run just
-- this statement on its own. is_admin gates the admin panel; admin_level
-- 'super_admin' unlocks billing and AI tools.
-- ============================================================
-- UPDATE profiles
-- SET is_admin = TRUE, admin_level = 'super_admin'
-- WHERE email = 'YOUR_EMAIL@example.com';
