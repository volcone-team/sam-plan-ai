-- ============================================================
-- Role-based write enforcement
-- Adds a helper to check the current user's role, then rewrites
-- INSERT/UPDATE/DELETE policies to require edit-capable roles.
--
-- Access roles:
--   owner, operator       -> full write access
--   team_member           -> can update tasks/results only
--   viewer                -> read-only
-- ============================================================

-- Helper: get current user's role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: can the current user edit plan structure? (owner/operator)
CREATE OR REPLACE FUNCTION can_edit_plan()
RETURNS BOOLEAN AS $$
  SELECT get_user_role() IN ('owner', 'operator');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: can the current user complete tasks / log results? (owner/operator/team_member)
CREATE OR REPLACE FUNCTION can_execute()
RETURNS BOOLEAN AS $$
  SELECT get_user_role() IN ('owner', 'operator', 'team_member');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- INITIATIVES: only owner/operator can write
-- ============================================================
DROP POLICY IF EXISTS "Users can insert initiatives for own company" ON initiatives;
CREATE POLICY "Editors can insert initiatives"
  ON initiatives FOR INSERT
  WITH CHECK (company_id = get_user_company_id() AND can_edit_plan());

DROP POLICY IF EXISTS "Users can update own company initiatives" ON initiatives;
CREATE POLICY "Editors can update initiatives"
  ON initiatives FOR UPDATE
  USING (company_id = get_user_company_id() AND can_edit_plan());

DROP POLICY IF EXISTS "Users can delete own company initiatives" ON initiatives;
CREATE POLICY "Editors can delete initiatives"
  ON initiatives FOR DELETE
  USING (company_id = get_user_company_id() AND can_edit_plan());

-- ============================================================
-- PRODUCTS: only owner/operator can write
-- ============================================================
DROP POLICY IF EXISTS "Users can insert products for own company" ON products;
CREATE POLICY "Editors can insert products"
  ON products FOR INSERT
  WITH CHECK (company_id = get_user_company_id() AND can_edit_plan());

DROP POLICY IF EXISTS "Users can update own company products" ON products;
CREATE POLICY "Editors can update products"
  ON products FOR UPDATE
  USING (company_id = get_user_company_id() AND can_edit_plan());

DROP POLICY IF EXISTS "Users can delete own company products" ON products;
CREATE POLICY "Editors can delete products"
  ON products FOR DELETE
  USING (company_id = get_user_company_id() AND can_edit_plan());

-- ============================================================
-- TASKS: owner/operator full write; team_member can update (complete)
-- ============================================================
DROP POLICY IF EXISTS "Users can insert tasks for own company" ON tasks;
CREATE POLICY "Editors can insert tasks"
  ON tasks FOR INSERT
  WITH CHECK (company_id = get_user_company_id() AND can_edit_plan());

DROP POLICY IF EXISTS "Users can update own company tasks" ON tasks;
CREATE POLICY "Executors can update tasks"
  ON tasks FOR UPDATE
  USING (company_id = get_user_company_id() AND can_execute());

DROP POLICY IF EXISTS "Users can delete own company tasks" ON tasks;
CREATE POLICY "Editors can delete tasks"
  ON tasks FOR DELETE
  USING (company_id = get_user_company_id() AND can_edit_plan());

-- ============================================================
-- RESULTS: owner/operator/team_member can write
-- ============================================================
DROP POLICY IF EXISTS "Users can insert results for own company" ON results;
CREATE POLICY "Executors can insert results"
  ON results FOR INSERT
  WITH CHECK (company_id = get_user_company_id() AND can_execute());

DROP POLICY IF EXISTS "Users can update own company results" ON results;
CREATE POLICY "Executors can update results"
  ON results FOR UPDATE
  USING (company_id = get_user_company_id() AND can_execute());

DROP POLICY IF EXISTS "Users can delete own company results" ON results;
CREATE POLICY "Editors can delete results"
  ON results FOR DELETE
  USING (company_id = get_user_company_id() AND can_edit_plan());

-- ============================================================
-- EXPENSES: owner/operator/team_member can write
-- ============================================================
DROP POLICY IF EXISTS "Users can insert expenses for own company" ON expenses;
CREATE POLICY "Executors can insert expenses"
  ON expenses FOR INSERT
  WITH CHECK (company_id = get_user_company_id() AND can_execute());

DROP POLICY IF EXISTS "Users can update own company expenses" ON expenses;
CREATE POLICY "Executors can update expenses"
  ON expenses FOR UPDATE
  USING (company_id = get_user_company_id() AND can_execute());

DROP POLICY IF EXISTS "Users can delete own company expenses" ON expenses;
CREATE POLICY "Editors can delete expenses"
  ON expenses FOR DELETE
  USING (company_id = get_user_company_id() AND can_edit_plan());

-- ============================================================
-- COMPANIES: only owner/operator can update
-- ============================================================
DROP POLICY IF EXISTS "Users can update own company" ON companies;
CREATE POLICY "Editors can update company"
  ON companies FOR UPDATE
  USING (id = get_user_company_id() AND can_edit_plan());
