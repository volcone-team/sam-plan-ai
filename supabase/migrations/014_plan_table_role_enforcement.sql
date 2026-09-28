-- ============================================================
-- Role-based write enforcement for plan tables
--
-- GAP THIS CLOSES
--   008_role_write_enforcement.sql added role-scoped write policies to
--   companies, expenses, initiatives, products, results and tasks, but it
--   left three plan tables behind:
--
--     annual_plans    (policies from 002_rls_policies.sql)
--     plan_snapshots  (policies from 007_plan_snapshots.sql)
--     projections     (policies from 002_rls_policies.sql)
--
--   All three have RLS enabled, but their write policies were only
--   COMPANY-scoped -- never ROLE-scoped. Any company member, including a
--   `viewer`, could INSERT/UPDATE/DELETE these rows directly through the
--   anon/authenticated API, bypassing the application's role checks. That is
--   the database half of a privilege-escalation gap; this migration closes it.
--
-- WHAT CHANGES
--   READS stay exactly as they are today: every member of a company may SELECT
--   their own company's plan data. The existing SELECT policies are left
--   untouched on purpose -- nothing here restricts reads.
--
--   WRITES (INSERT / UPDATE / DELETE) now require can_edit_plan()
--   (owner/operator, defined in 008) AND the existing company predicate, so a
--   member of another company can still never write, and team_member/viewer
--   are denied outright.
--
-- SERVICE ROLE
--   The service role BYPASSES RLS entirely. Server routes using the service
--   key are unaffected by this migration -- which is exactly why the
--   API-level role checks added separately still matter. These policies only
--   protect the cookie-based (authenticated) client path.
--
-- HELPERS
--   can_edit_plan(), get_user_role() and get_user_company_id() are NOT
--   redefined here. They already exist (008 and 002) and are only referenced.
--
-- IDEMPOTENCY
--   Every CREATE POLICY is preceded by DROP POLICY IF EXISTS for both the old
--   permissive policy name and the new name, so this file is safe to re-run.
-- ============================================================

-- ============================================================
-- ANNUAL PLANS: only owner/operator can write (company-scoped)
-- Scoped directly on annual_plans.company_id (see 001_initial_schema.sql).
-- ============================================================
DROP POLICY IF EXISTS "Users can insert plans for own company" ON annual_plans;
DROP POLICY IF EXISTS "Editors can insert annual plans" ON annual_plans;
CREATE POLICY "Editors can insert annual plans"
  ON annual_plans FOR INSERT
  WITH CHECK (company_id = get_user_company_id() AND can_edit_plan());

DROP POLICY IF EXISTS "Users can update own company plans" ON annual_plans;
DROP POLICY IF EXISTS "Editors can update annual plans" ON annual_plans;
CREATE POLICY "Editors can update annual plans"
  ON annual_plans FOR UPDATE
  USING (company_id = get_user_company_id() AND can_edit_plan())
  WITH CHECK (company_id = get_user_company_id() AND can_edit_plan());

DROP POLICY IF EXISTS "Users can delete own company plans" ON annual_plans;
DROP POLICY IF EXISTS "Editors can delete annual plans" ON annual_plans;
CREATE POLICY "Editors can delete annual plans"
  ON annual_plans FOR DELETE
  USING (company_id = get_user_company_id() AND can_edit_plan());

-- ============================================================
-- PLAN SNAPSHOTS: only owner/operator can write (company-scoped)
-- Scoped directly on plan_snapshots.company_id (see 007_plan_snapshots.sql).
--
-- NOTE: 007 never created an UPDATE policy, so UPDATEs on plan_snapshots are
-- already denied for every non-service-role caller. Snapshots are immutable
-- historical records and no application flow updates them, so no UPDATE policy
-- is added here -- adding one would widen access rather than restrict it.
-- ============================================================
DROP POLICY IF EXISTS "Users can insert own company snapshots" ON plan_snapshots;
DROP POLICY IF EXISTS "Editors can insert plan snapshots" ON plan_snapshots;
CREATE POLICY "Editors can insert plan snapshots"
  ON plan_snapshots FOR INSERT
  WITH CHECK (company_id = get_user_company_id() AND can_edit_plan());

DROP POLICY IF EXISTS "Users can delete own company snapshots" ON plan_snapshots;
DROP POLICY IF EXISTS "Editors can delete plan snapshots" ON plan_snapshots;
CREATE POLICY "Editors can delete plan snapshots"
  ON plan_snapshots FOR DELETE
  USING (company_id = get_user_company_id() AND can_edit_plan());

-- ============================================================
-- PROJECTIONS: only owner/operator can write (company-scoped)
-- projections carries BOTH company_id and annual_plan_id
-- (see 001_initial_schema.sql), so it is scoped directly on company_id --
-- no join through annual_plans is required, and this matches the existing
-- 002_rls_policies.sql predicate.
-- ============================================================
DROP POLICY IF EXISTS "Users can insert projections for own company" ON projections;
DROP POLICY IF EXISTS "Editors can insert projections" ON projections;
CREATE POLICY "Editors can insert projections"
  ON projections FOR INSERT
  WITH CHECK (company_id = get_user_company_id() AND can_edit_plan());

DROP POLICY IF EXISTS "Users can update own company projections" ON projections;
DROP POLICY IF EXISTS "Editors can update projections" ON projections;
CREATE POLICY "Editors can update projections"
  ON projections FOR UPDATE
  USING (company_id = get_user_company_id() AND can_edit_plan())
  WITH CHECK (company_id = get_user_company_id() AND can_edit_plan());

DROP POLICY IF EXISTS "Users can delete own company projections" ON projections;
DROP POLICY IF EXISTS "Editors can delete projections" ON projections;
CREATE POLICY "Editors can delete projections"
  ON projections FOR DELETE
  USING (company_id = get_user_company_id() AND can_edit_plan());
