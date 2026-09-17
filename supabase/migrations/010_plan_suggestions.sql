-- ============================================================
-- Plan Suggestions
-- Holds AI "enhance plan" proposals awaiting the user's accept/reject.
-- Nothing is applied to the live plan until a suggestion is accepted.
--
-- suggestion_type:
--   new_initiative   -> AI proposes a brand-new initiative to add
--   budget_change    -> adjust an existing initiative's planned budget
--   date_change      -> adjust an existing initiative's activation/event date
--   target_change    -> adjust revenue targets (annual plan or initiative)
--   product_update   -> suggest a change to a product
--
-- status:
--   pending   -> awaiting user decision (default)
--   accepted  -> user approved; applied to the live plan
--   rejected  -> user declined; ignored
-- ============================================================

CREATE TABLE plan_suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Groups all suggestions produced by a single "enhance" run
  batch_id UUID NOT NULL,

  suggestion_type TEXT NOT NULL CHECK (suggestion_type IN (
    'new_initiative', 'budget_change', 'date_change', 'target_change', 'product_update'
  )),

  -- The entity this suggestion targets (null for brand-new initiatives)
  target_id UUID,
  target_label TEXT,           -- human-readable name of the target (e.g. initiative/product name)

  -- Short human-readable summary shown in the review UI
  title TEXT NOT NULL,
  rationale TEXT DEFAULT '',   -- why the AI suggests this

  -- For change-type suggestions: what it is now vs. what AI proposes
  current_value JSONB,
  proposed_value JSONB NOT NULL DEFAULT '{}',

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);

-- RLS: users see and act on only their own company's suggestions
ALTER TABLE plan_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company suggestions"
  ON plan_suggestions FOR SELECT
  USING (company_id = get_user_company_id());

CREATE POLICY "Users can insert own company suggestions"
  ON plan_suggestions FOR INSERT
  WITH CHECK (company_id = get_user_company_id());

CREATE POLICY "Editors can update own company suggestions"
  ON plan_suggestions FOR UPDATE
  USING (company_id = get_user_company_id() AND can_edit_plan());

CREATE POLICY "Editors can delete own company suggestions"
  ON plan_suggestions FOR DELETE
  USING (company_id = get_user_company_id() AND can_edit_plan());

-- Fast lookup of a company's latest pending batch
CREATE INDEX idx_plan_suggestions_company ON plan_suggestions(company_id, created_at DESC);
CREATE INDEX idx_plan_suggestions_batch ON plan_suggestions(batch_id);
CREATE INDEX idx_plan_suggestions_status ON plan_suggestions(status);
