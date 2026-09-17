-- ============================================================
-- Generation Events
-- Logs each AI plan generation and enhancement event so the
-- admin dashboard can show accurate "AI Generations" counts and
-- power an activity feed. One row per successful generation.
-- ============================================================

CREATE TABLE IF NOT EXISTS generation_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- What kind of AI event this was
  event_type TEXT NOT NULL DEFAULT 'plan_generation'
    CHECK (event_type IN ('plan_generation', 'plan_regeneration', 'plan_enhancement')),
  -- Useful metadata for the activity feed
  initiatives_created INT DEFAULT 0,
  suggestions_created INT DEFAULT 0,
  duration_ms INT,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generation_events_company ON generation_events(company_id);
CREATE INDEX IF NOT EXISTS idx_generation_events_created ON generation_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_events_type ON generation_events(event_type);

-- RLS: only service role writes; admins read via service role in API.
ALTER TABLE generation_events ENABLE ROW LEVEL SECURITY;

-- Members can view their own company's events
CREATE POLICY "Members can view own company generation events"
  ON generation_events FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM profiles WHERE id = auth.uid()
    )
  );
