-- ============================================================
-- SAM Flow AI - Row Level Security Policies
-- Ensures complete data isolation between companies.
-- No company can see, modify, or delete another company's data.
-- ============================================================

-- ============================================================
-- HELPER FUNCTION: Get the current user's company_id
-- Used in all RLS policies to scope data to the user's company.
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_company_id()
RETURNS UUID AS $$
  SELECT company_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- HELPER FUNCTION: Check if current user is admin
-- ============================================================
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM profiles WHERE id = auth.uid()),
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- 1. COMPANIES
-- Users can only see/edit their own company.
-- ============================================================
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company"
  ON companies FOR SELECT
  USING (id = get_user_company_id());

CREATE POLICY "Users can update own company"
  ON companies FOR UPDATE
  USING (id = get_user_company_id());

CREATE POLICY "Anyone can insert a company (signup)"
  ON companies FOR INSERT
  WITH CHECK (TRUE);

CREATE POLICY "Admins can view all companies"
  ON companies FOR SELECT
  USING (is_admin());

-- ============================================================
-- 2. PROFILES
-- Users can see profiles in their own company.
-- Users can only update their own profile.
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view profiles in own company"
  ON profiles FOR SELECT
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "Anyone can insert own profile (signup)"
  ON profiles FOR INSERT
  WITH CHECK (id = auth.uid());

CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT
  USING (is_admin());

-- ============================================================
-- 3. PRODUCTS
-- Scoped to company_id
-- ============================================================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company products"
  ON products FOR SELECT
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert products for own company"
  ON products FOR INSERT
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update own company products"
  ON products FOR UPDATE
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can delete own company products"
  ON products FOR DELETE
  USING (company_id = get_user_company_id());

-- ============================================================
-- 4. ANNUAL PLANS
-- Scoped to company_id
-- ============================================================
ALTER TABLE annual_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company plans"
  ON annual_plans FOR SELECT
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert plans for own company"
  ON annual_plans FOR INSERT
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update own company plans"
  ON annual_plans FOR UPDATE
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can delete own company plans"
  ON annual_plans FOR DELETE
  USING (company_id = get_user_company_id());

-- ============================================================
-- 5. QUARTERLY PLANS
-- Scoped via annual_plan -> company_id
-- ============================================================
ALTER TABLE quarterly_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own quarterly plans"
  ON quarterly_plans FOR SELECT
  USING (annual_plan_id IN (SELECT id FROM annual_plans WHERE company_id = get_user_company_id()));

CREATE POLICY "Users can insert own quarterly plans"
  ON quarterly_plans FOR INSERT
  WITH CHECK (annual_plan_id IN (SELECT id FROM annual_plans WHERE company_id = get_user_company_id()));

CREATE POLICY "Users can update own quarterly plans"
  ON quarterly_plans FOR UPDATE
  USING (annual_plan_id IN (SELECT id FROM annual_plans WHERE company_id = get_user_company_id()));

CREATE POLICY "Users can delete own quarterly plans"
  ON quarterly_plans FOR DELETE
  USING (annual_plan_id IN (SELECT id FROM annual_plans WHERE company_id = get_user_company_id()));

-- ============================================================
-- 6. MONTHLY PLANS
-- Scoped via quarterly_plan -> annual_plan -> company_id
-- ============================================================
ALTER TABLE monthly_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own monthly plans"
  ON monthly_plans FOR SELECT
  USING (quarterly_plan_id IN (
    SELECT qp.id FROM quarterly_plans qp
    JOIN annual_plans ap ON qp.annual_plan_id = ap.id
    WHERE ap.company_id = get_user_company_id()
  ));

CREATE POLICY "Users can insert own monthly plans"
  ON monthly_plans FOR INSERT
  WITH CHECK (quarterly_plan_id IN (
    SELECT qp.id FROM quarterly_plans qp
    JOIN annual_plans ap ON qp.annual_plan_id = ap.id
    WHERE ap.company_id = get_user_company_id()
  ));

CREATE POLICY "Users can update own monthly plans"
  ON monthly_plans FOR UPDATE
  USING (quarterly_plan_id IN (
    SELECT qp.id FROM quarterly_plans qp
    JOIN annual_plans ap ON qp.annual_plan_id = ap.id
    WHERE ap.company_id = get_user_company_id()
  ));

CREATE POLICY "Users can delete own monthly plans"
  ON monthly_plans FOR DELETE
  USING (quarterly_plan_id IN (
    SELECT qp.id FROM quarterly_plans qp
    JOIN annual_plans ap ON qp.annual_plan_id = ap.id
    WHERE ap.company_id = get_user_company_id()
  ));

-- ============================================================
-- 7. WEEKLY PLANS
-- Scoped via monthly_plan -> quarterly_plan -> annual_plan -> company_id
-- ============================================================
ALTER TABLE weekly_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own weekly plans"
  ON weekly_plans FOR SELECT
  USING (monthly_plan_id IN (
    SELECT mp.id FROM monthly_plans mp
    JOIN quarterly_plans qp ON mp.quarterly_plan_id = qp.id
    JOIN annual_plans ap ON qp.annual_plan_id = ap.id
    WHERE ap.company_id = get_user_company_id()
  ));

CREATE POLICY "Users can insert own weekly plans"
  ON weekly_plans FOR INSERT
  WITH CHECK (monthly_plan_id IN (
    SELECT mp.id FROM monthly_plans mp
    JOIN quarterly_plans qp ON mp.quarterly_plan_id = qp.id
    JOIN annual_plans ap ON qp.annual_plan_id = ap.id
    WHERE ap.company_id = get_user_company_id()
  ));

CREATE POLICY "Users can update own weekly plans"
  ON weekly_plans FOR UPDATE
  USING (monthly_plan_id IN (
    SELECT mp.id FROM monthly_plans mp
    JOIN quarterly_plans qp ON mp.quarterly_plan_id = qp.id
    JOIN annual_plans ap ON qp.annual_plan_id = ap.id
    WHERE ap.company_id = get_user_company_id()
  ));

CREATE POLICY "Users can delete own weekly plans"
  ON weekly_plans FOR DELETE
  USING (monthly_plan_id IN (
    SELECT mp.id FROM monthly_plans mp
    JOIN quarterly_plans qp ON mp.quarterly_plan_id = qp.id
    JOIN annual_plans ap ON qp.annual_plan_id = ap.id
    WHERE ap.company_id = get_user_company_id()
  ));

-- ============================================================
-- 8. PLANNING INPUTS
-- Scoped to company_id
-- ============================================================
ALTER TABLE planning_inputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own planning inputs"
  ON planning_inputs FOR SELECT
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert planning inputs for own company"
  ON planning_inputs FOR INSERT
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update own planning inputs"
  ON planning_inputs FOR UPDATE
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can delete own planning inputs"
  ON planning_inputs FOR DELETE
  USING (company_id = get_user_company_id());

-- ============================================================
-- 9. INITIATIVE TYPES
-- Shared library — all authenticated users can read.
-- Only admins can write.
-- ============================================================
ALTER TABLE initiative_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated users can view initiative types"
  ON initiative_types FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can insert initiative types"
  ON initiative_types FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update initiative types"
  ON initiative_types FOR UPDATE
  USING (is_admin());

CREATE POLICY "Admins can delete initiative types"
  ON initiative_types FOR DELETE
  USING (is_admin());

-- ============================================================
-- 10. INITIATIVES
-- Scoped to company_id
-- ============================================================
ALTER TABLE initiatives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company initiatives"
  ON initiatives FOR SELECT
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert initiatives for own company"
  ON initiatives FOR INSERT
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update own company initiatives"
  ON initiatives FOR UPDATE
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can delete own company initiatives"
  ON initiatives FOR DELETE
  USING (company_id = get_user_company_id());

-- ============================================================
-- 11. RECURRING TEMPLATES
-- Scoped to company_id
-- ============================================================
ALTER TABLE recurring_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own recurring templates"
  ON recurring_templates FOR SELECT
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert recurring templates for own company"
  ON recurring_templates FOR INSERT
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update own recurring templates"
  ON recurring_templates FOR UPDATE
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can delete own recurring templates"
  ON recurring_templates FOR DELETE
  USING (company_id = get_user_company_id());

-- ============================================================
-- 12. TASKS
-- Scoped to company_id
-- ============================================================
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company tasks"
  ON tasks FOR SELECT
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert tasks for own company"
  ON tasks FOR INSERT
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update own company tasks"
  ON tasks FOR UPDATE
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can delete own company tasks"
  ON tasks FOR DELETE
  USING (company_id = get_user_company_id());

-- ============================================================
-- 13. RESULTS
-- Scoped to company_id
-- ============================================================
ALTER TABLE results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company results"
  ON results FOR SELECT
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert results for own company"
  ON results FOR INSERT
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update own company results"
  ON results FOR UPDATE
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can delete own company results"
  ON results FOR DELETE
  USING (company_id = get_user_company_id());

-- ============================================================
-- 14. EXPENSES
-- Scoped to company_id
-- ============================================================
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company expenses"
  ON expenses FOR SELECT
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert expenses for own company"
  ON expenses FOR INSERT
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update own company expenses"
  ON expenses FOR UPDATE
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can delete own company expenses"
  ON expenses FOR DELETE
  USING (company_id = get_user_company_id());

-- ============================================================
-- 15. BENCHMARKS
-- Shared library — all authenticated users can read.
-- Only admins can write.
-- ============================================================
ALTER TABLE benchmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated users can view benchmarks"
  ON benchmarks FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can insert benchmarks"
  ON benchmarks FOR INSERT
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update benchmarks"
  ON benchmarks FOR UPDATE
  USING (is_admin());

CREATE POLICY "Admins can delete benchmarks"
  ON benchmarks FOR DELETE
  USING (is_admin());

-- ============================================================
-- 16. PROJECTIONS
-- Scoped to company_id
-- ============================================================
ALTER TABLE projections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company projections"
  ON projections FOR SELECT
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert projections for own company"
  ON projections FOR INSERT
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update own company projections"
  ON projections FOR UPDATE
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can delete own company projections"
  ON projections FOR DELETE
  USING (company_id = get_user_company_id());

-- ============================================================
-- 17. SUBSCRIPTIONS
-- Scoped to company_id
-- ============================================================
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription"
  ON subscriptions FOR SELECT
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert own subscription"
  ON subscriptions FOR INSERT
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can update own subscription"
  ON subscriptions FOR UPDATE
  USING (company_id = get_user_company_id());

CREATE POLICY "Admins can view all subscriptions"
  ON subscriptions FOR SELECT
  USING (is_admin());

-- ============================================================
-- 18. FEATURE FLAGS
-- All authenticated users can read. Only admins can write.
-- ============================================================
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated users can view feature flags"
  ON feature_flags FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage feature flags"
  ON feature_flags FOR ALL
  USING (is_admin());

-- ============================================================
-- 19. PROMPTS
-- All authenticated users can read. Only admins can write.
-- ============================================================
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated users can view prompts"
  ON prompts FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage prompts"
  ON prompts FOR ALL
  USING (is_admin());

-- ============================================================
-- 20. PROMPT HISTORY
-- All authenticated users can read. Only admins can write.
-- ============================================================
ALTER TABLE prompt_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated users can view prompt history"
  ON prompt_history FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage prompt history"
  ON prompt_history FOR ALL
  USING (is_admin());
