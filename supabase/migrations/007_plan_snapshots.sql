-- ============================================================
-- Plan Snapshots
-- Stores a JSON snapshot of the entire plan before regeneration.
-- Users can view historical plans in read-only mode.
-- ============================================================

CREATE TABLE plan_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Plan',
  snapshot JSONB NOT NULL DEFAULT '{}',
  -- snapshot contains: { annualPlan, initiatives, tasks, projections, results, expenses }
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: users can only view their own company's snapshots
ALTER TABLE plan_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company snapshots"
  ON plan_snapshots FOR SELECT
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert own company snapshots"
  ON plan_snapshots FOR INSERT
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Users can delete own company snapshots"
  ON plan_snapshots FOR DELETE
  USING (company_id = get_user_company_id());

-- Index for fast lookup by company
CREATE INDEX idx_plan_snapshots_company ON plan_snapshots(company_id, created_at DESC);
