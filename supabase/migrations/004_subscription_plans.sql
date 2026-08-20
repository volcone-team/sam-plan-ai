-- ============================================================
-- SAM Plan AI - Admin-Configurable Subscription Plans
-- Replaces hardcoded TIER_CONFIGS with database-driven plans
-- ============================================================

-- ============================================================
-- 1. SUBSCRIPTION PLANS (admin-editable)
-- ============================================================
CREATE TABLE subscription_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  tagline TEXT DEFAULT '',
  monthly_price NUMERIC(8,2) NOT NULL DEFAULT 0,
  annual_price NUMERIC(8,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. PLAN LIMITS (per-plan usage caps)
-- limit_value: -1 = unlimited, 0 = disabled, >0 = capped
-- ============================================================
CREATE TABLE plan_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  limit_key TEXT NOT NULL,
  limit_label TEXT NOT NULL,
  limit_value INT NOT NULL DEFAULT -1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(plan_id, limit_key)
);

-- ============================================================
-- 3. PLAN FEATURES (per-plan feature toggles)
-- ============================================================
CREATE TABLE plan_features (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  feature_label TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(plan_id, feature_key)
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_plan_limits_plan ON plan_limits(plan_id);
CREATE INDEX idx_plan_features_plan ON plan_features(plan_id);

-- ============================================================
-- SEED: Default Plans
-- ============================================================
INSERT INTO subscription_plans (name, description, tagline, monthly_price, annual_price, is_active, is_default, display_order) VALUES
('Starter', 'For solo operators getting started with revenue planning.', 'Get started', 49, 490, TRUE, TRUE, 1),
('Pro', 'For growing teams that need collaboration and deeper analytics.', 'Most popular', 149, 1490, TRUE, FALSE, 2),
('Mastery', 'For serious operators who want the full system plus expert reviews.', 'Full access', 0, 4997, TRUE, FALSE, 3);

-- ============================================================
-- SEED: Default Limits per Plan
-- ============================================================

-- Starter limits
INSERT INTO plan_limits (plan_id, limit_key, limit_label, limit_value)
SELECT id, 'max_users', 'Max team members', 1 FROM subscription_plans WHERE name = 'Starter'
UNION ALL
SELECT id, 'max_initiatives', 'Max initiatives/year', 10 FROM subscription_plans WHERE name = 'Starter'
UNION ALL
SELECT id, 'plan_regenerations', 'Plan regenerations/month', 1 FROM subscription_plans WHERE name = 'Starter'
UNION ALL
SELECT id, 'ai_uses_month', 'AI generation uses/month', 5 FROM subscription_plans WHERE name = 'Starter'
UNION ALL
SELECT id, 'max_products', 'Max products', 3 FROM subscription_plans WHERE name = 'Starter'
UNION ALL
SELECT id, 'csv_exports_month', 'CSV exports/month', 0 FROM subscription_plans WHERE name = 'Starter';

-- Pro limits
INSERT INTO plan_limits (plan_id, limit_key, limit_label, limit_value)
SELECT id, 'max_users', 'Max team members', 5 FROM subscription_plans WHERE name = 'Pro'
UNION ALL
SELECT id, 'max_initiatives', 'Max initiatives/year', -1 FROM subscription_plans WHERE name = 'Pro'
UNION ALL
SELECT id, 'plan_regenerations', 'Plan regenerations/month', 3 FROM subscription_plans WHERE name = 'Pro'
UNION ALL
SELECT id, 'ai_uses_month', 'AI generation uses/month', 20 FROM subscription_plans WHERE name = 'Pro'
UNION ALL
SELECT id, 'max_products', 'Max products', 10 FROM subscription_plans WHERE name = 'Pro'
UNION ALL
SELECT id, 'csv_exports_month', 'CSV exports/month', -1 FROM subscription_plans WHERE name = 'Pro';

-- Mastery limits
INSERT INTO plan_limits (plan_id, limit_key, limit_label, limit_value)
SELECT id, 'max_users', 'Max team members', 10 FROM subscription_plans WHERE name = 'Mastery'
UNION ALL
SELECT id, 'max_initiatives', 'Max initiatives/year', -1 FROM subscription_plans WHERE name = 'Mastery'
UNION ALL
SELECT id, 'plan_regenerations', 'Plan regenerations/month', -1 FROM subscription_plans WHERE name = 'Mastery'
UNION ALL
SELECT id, 'ai_uses_month', 'AI generation uses/month', -1 FROM subscription_plans WHERE name = 'Mastery'
UNION ALL
SELECT id, 'max_products', 'Max products', -1 FROM subscription_plans WHERE name = 'Mastery'
UNION ALL
SELECT id, 'csv_exports_month', 'CSV exports/month', -1 FROM subscription_plans WHERE name = 'Mastery';

-- ============================================================
-- SEED: Default Features per Plan
-- ============================================================

-- Starter features
INSERT INTO plan_features (plan_id, feature_key, feature_label, enabled)
SELECT id, 'advanced_analytics', 'Advanced Analytics', FALSE FROM subscription_plans WHERE name = 'Starter'
UNION ALL
SELECT id, 'custom_initiative_types', 'Custom Initiative Types', FALSE FROM subscription_plans WHERE name = 'Starter'
UNION ALL
SELECT id, 'ai_weekly_insights', 'AI Weekly Insights', FALSE FROM subscription_plans WHERE name = 'Starter'
UNION ALL
SELECT id, 'multi_user', 'Multi-User Access', FALSE FROM subscription_plans WHERE name = 'Starter'
UNION ALL
SELECT id, 'benchmark_contribution', 'Benchmark Contribution', TRUE FROM subscription_plans WHERE name = 'Starter'
UNION ALL
SELECT id, 'priority_support', 'Priority Support', FALSE FROM subscription_plans WHERE name = 'Starter'
UNION ALL
SELECT id, 'annual_reviews', 'Annual Plan Reviews', FALSE FROM subscription_plans WHERE name = 'Starter';

-- Pro features
INSERT INTO plan_features (plan_id, feature_key, feature_label, enabled)
SELECT id, 'advanced_analytics', 'Advanced Analytics', TRUE FROM subscription_plans WHERE name = 'Pro'
UNION ALL
SELECT id, 'custom_initiative_types', 'Custom Initiative Types', FALSE FROM subscription_plans WHERE name = 'Pro'
UNION ALL
SELECT id, 'ai_weekly_insights', 'AI Weekly Insights', TRUE FROM subscription_plans WHERE name = 'Pro'
UNION ALL
SELECT id, 'multi_user', 'Multi-User Access', TRUE FROM subscription_plans WHERE name = 'Pro'
UNION ALL
SELECT id, 'benchmark_contribution', 'Benchmark Contribution', TRUE FROM subscription_plans WHERE name = 'Pro'
UNION ALL
SELECT id, 'priority_support', 'Priority Support', FALSE FROM subscription_plans WHERE name = 'Pro'
UNION ALL
SELECT id, 'annual_reviews', 'Annual Plan Reviews', FALSE FROM subscription_plans WHERE name = 'Pro';

-- Mastery features
INSERT INTO plan_features (plan_id, feature_key, feature_label, enabled)
SELECT id, 'advanced_analytics', 'Advanced Analytics', TRUE FROM subscription_plans WHERE name = 'Mastery'
UNION ALL
SELECT id, 'custom_initiative_types', 'Custom Initiative Types', TRUE FROM subscription_plans WHERE name = 'Mastery'
UNION ALL
SELECT id, 'ai_weekly_insights', 'AI Weekly Insights', TRUE FROM subscription_plans WHERE name = 'Mastery'
UNION ALL
SELECT id, 'multi_user', 'Multi-User Access', TRUE FROM subscription_plans WHERE name = 'Mastery'
UNION ALL
SELECT id, 'benchmark_contribution', 'Benchmark Contribution', TRUE FROM subscription_plans WHERE name = 'Mastery'
UNION ALL
SELECT id, 'priority_support', 'Priority Support', TRUE FROM subscription_plans WHERE name = 'Mastery'
UNION ALL
SELECT id, 'annual_reviews', 'Annual Plan Reviews', TRUE FROM subscription_plans WHERE name = 'Mastery';

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated can view plans" ON subscription_plans FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can manage plans" ON subscription_plans FOR ALL USING (is_admin());

CREATE POLICY "All authenticated can view limits" ON plan_limits FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can manage limits" ON plan_limits FOR ALL USING (is_admin());

CREATE POLICY "All authenticated can view features" ON plan_features FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can manage features" ON plan_features FOR ALL USING (is_admin());

-- Auto-update timestamps
CREATE TRIGGER set_updated_at_plans BEFORE UPDATE ON subscription_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at();
