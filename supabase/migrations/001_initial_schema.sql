-- ============================================================
-- SAM Flow AI - Initial Database Schema
-- Phase 11: Supabase Integration
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. COMPANIES
-- Root entity - all data is company-scoped
-- ============================================================
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  fiscal_year INT NOT NULL DEFAULT 2026,
  planning_year INT NOT NULL DEFAULT 2026,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'EUR', 'GBP', 'CAD', 'AUD')),
  prior_year_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  target_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  baseline_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  stretch_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  operating_budget NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. PROFILES (extends Supabase auth.users)
-- ============================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'operator', 'team_member', 'viewer')),
  marketing_signature TEXT,
  stage_of_business TEXT CHECK (stage_of_business IN ('early_stage', 'scaling', 'established_1m', 'established_10m', 'enterprise')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. PRODUCTS
-- What the business sells
-- ============================================================
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  revenue_type TEXT NOT NULL DEFAULT 'one-time' CHECK (revenue_type IN ('one-time', 'recurring')),
  ticket_tier TEXT NOT NULL DEFAULT 'mid' CHECK (ticket_tier IN ('low', 'mid', 'high')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 4. ANNUAL PLANS
-- The top-level planning container for a year
-- ============================================================
CREATE TABLE annual_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year INT NOT NULL,
  baseline_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  stretch_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  operating_budget NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, year)
);

-- ============================================================
-- 5. QUARTERLY PLANS
-- ============================================================
CREATE TABLE quarterly_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  annual_plan_id UUID NOT NULL REFERENCES annual_plans(id) ON DELETE CASCADE,
  quarter INT NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  year INT NOT NULL,
  target_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(annual_plan_id, quarter)
);

-- ============================================================
-- 6. MONTHLY PLANS
-- ============================================================
CREATE TABLE monthly_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quarterly_plan_id UUID NOT NULL REFERENCES quarterly_plans(id) ON DELETE CASCADE,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INT NOT NULL,
  target_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(quarterly_plan_id, month)
);

-- ============================================================
-- 7. WEEKLY PLANS
-- ============================================================
CREATE TABLE weekly_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  monthly_plan_id UUID NOT NULL REFERENCES monthly_plans(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  week_end_date DATE NOT NULL,
  target_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  top_priorities TEXT[] DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 8. PLANNING INPUTS (questionnaire answers)
-- ============================================================
CREATE TABLE planning_inputs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  intake_route TEXT NOT NULL DEFAULT 'full' CHECK (intake_route IN ('quickstart', 'full', 'foundation')),
  completed_at TIMESTAMPTZ,
  -- Q1: Revenue goal
  revenue_goal NUMERIC(12,2) NOT NULL DEFAULT 0,
  revenue_timeframe INT NOT NULL DEFAULT 12 CHECK (revenue_timeframe IN (3, 6, 12)),
  -- Q2: Product IDs
  product_ids UUID[] DEFAULT '{}',
  -- Q3 & Q7: What worked / obstacles
  successful_initiative_types TEXT[] DEFAULT '{}',
  failed_initiatives TEXT DEFAULT '',
  -- Q4: Ideal customer
  ideal_customer_description TEXT DEFAULT '',
  -- Q5: Current assets
  current_assets JSONB DEFAULT '{"emailListSize": 0, "socialFollowing": 0, "websiteMonthlyVisitors": 0, "existingCustomers": 0}',
  -- Q6: Budget & team
  monthly_marketing_budget NUMERIC(10,2) DEFAULT 0,
  team_size INT DEFAULT 1,
  team_roles TEXT[] DEFAULT '{}',
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 9. INITIATIVE TYPES (the library - data, not code)
-- ============================================================
CREATE TABLE initiative_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  channel TEXT NOT NULL,
  description TEXT DEFAULT '',
  owner TEXT NOT NULL DEFAULT 'system' CHECK (owner IN ('system', 'user')),
  -- Complex nested data stored as JSONB
  benchmarks JSONB NOT NULL DEFAULT '{}',
  project_template JSONB NOT NULL DEFAULT '{"tasks": [], "totalEstimatedHours": 0}',
  difficulty JSONB NOT NULL DEFAULT '{"effortToImplement": 5, "skillExpertiseRequired": 5, "timeToResults": 5, "costToRun": 5}',
  ai_context JSONB NOT NULL DEFAULT '{"description": "", "sizingGuidance": "", "recommendationWeights": {}}',
  -- Metadata
  tier INT NOT NULL DEFAULT 1 CHECK (tier BETWEEN 1 AND 3),
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 10. INITIATIVES
-- The core execution unit
-- ============================================================
CREATE TABLE initiatives (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  annual_plan_id UUID NOT NULL REFERENCES annual_plans(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  initiative_type_id UUID NOT NULL REFERENCES initiative_types(id) ON DELETE RESTRICT,
  -- Core attributes
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'one-time' CHECK (kind IN ('one-time', 'recurring', 'evergreen')),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'launched', 'completed', 'paused', 'retired')),
  -- Date anchors
  activation_date DATE NOT NULL,
  event_date DATE,
  -- Planning inputs
  traffic_input INT,
  -- Revenue projections
  revenue_good NUMERIC(12,2) NOT NULL DEFAULT 0,
  revenue_better NUMERIC(12,2) NOT NULL DEFAULT 0,
  revenue_best NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Budget & spending
  planned_budget NUMERIC(12,2) NOT NULL DEFAULT 0,
  actual_spend NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Display
  display_order INT NOT NULL DEFAULT 0,
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 11. RECURRING TEMPLATES
-- Generates recurring initiative instances
-- ============================================================
CREATE TABLE recurring_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  annual_plan_id UUID NOT NULL REFERENCES annual_plans(id) ON DELETE CASCADE,
  initiative_type_id UUID NOT NULL REFERENCES initiative_types(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT,
  frequency_per_quarter INT NOT NULL DEFAULT 1,
  promo_offset_days INT NOT NULL DEFAULT 21,
  spawned_instance_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 12. TASKS
-- Project plan tasks for initiatives
-- ============================================================
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  initiative_id UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  due_date DATE NOT NULL,
  estimated_hours NUMERIC(6,2) NOT NULL DEFAULT 0,
  estimated_hours_range JSONB,
  -- Execution tracking
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed', 'blocked', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  assigned_to_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actual_hours NUMERIC(6,2),
  completed_at TIMESTAMPTZ,
  -- Dependencies
  dependency_ids UUID[] DEFAULT '{}',
  display_order INT NOT NULL DEFAULT 0,
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 13. RESULTS
-- Actual revenue/spend entered weekly
-- ============================================================
CREATE TABLE results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  initiative_id UUID REFERENCES initiatives(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  week_start_date DATE NOT NULL,
  week_end_date DATE NOT NULL,
  -- Revenue & spend
  actual_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  actual_spend NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- Initiative-specific metrics (dynamic keys)
  metrics JSONB DEFAULT '{}',
  -- Metadata
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'integration')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 14. EXPENSES
-- Per-initiative cost line items
-- ============================================================
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  initiative_id UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('advertising', 'talent', 'tools', 'production', 'venue', 'fulfillment', 'other')),
  description TEXT NOT NULL DEFAULT '',
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'integration')),
  source_details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 15. BENCHMARKS (conversion & cost)
-- ============================================================
CREATE TABLE benchmarks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  initiative_type_id UUID NOT NULL REFERENCES initiative_types(id) ON DELETE CASCADE,
  -- Type: conversion or cost
  benchmark_type TEXT NOT NULL DEFAULT 'conversion' CHECK (benchmark_type IN ('conversion', 'cost')),
  -- Field identification
  field_name TEXT NOT NULL,
  field_description TEXT,
  -- Data
  data_conservative NUMERIC(10,4) NOT NULL DEFAULT 0,
  data_moderate NUMERIC(10,4) NOT NULL DEFAULT 0,
  data_aggressive NUMERIC(10,4) NOT NULL DEFAULT 0,
  -- Source
  source TEXT NOT NULL DEFAULT 'published' CHECK (source IN ('first_party', 'partner_shared', 'published', 'industry_report')),
  source_details TEXT,
  initiative_type_version TEXT DEFAULT '1.0',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 16. PROJECTIONS
-- Rolled-up revenue by scenario
-- ============================================================
CREATE TABLE projections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  annual_plan_id UUID NOT NULL REFERENCES annual_plans(id) ON DELETE CASCADE,
  scenario TEXT NOT NULL CHECK (scenario IN ('good', 'better', 'best')),
  period TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('monthly', 'quarterly', 'annual')),
  -- Breakdowns stored as JSONB for flexibility
  by_product JSONB DEFAULT '[]',
  by_initiative JSONB DEFAULT '[]',
  monthly JSONB,
  quarterly JSONB,
  annual JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 17. SUBSCRIPTIONS
-- Billing tier management
-- ============================================================
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE UNIQUE,
  tier TEXT NOT NULL DEFAULT 'starter' CHECK (tier IN ('starter', 'pro', 'mastery')),
  status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('active', 'paused', 'cancelled', 'past_due', 'trial')),
  billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'annual')),
  monthly_price NUMERIC(8,2) NOT NULL DEFAULT 49,
  annual_price NUMERIC(8,2) NOT NULL DEFAULT 490,
  current_price NUMERIC(8,2) NOT NULL DEFAULT 49,
  start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  renewal_date TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  is_trial_active BOOLEAN NOT NULL DEFAULT TRUE,
  trial_ends_at TIMESTAMPTZ,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 18. FEATURE FLAGS (admin-controlled)
-- ============================================================
CREATE TABLE feature_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 19. AI PROMPTS (admin workbook)
-- ============================================================
CREATE TABLE prompts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  version INT NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 20. PROMPT HISTORY (version tracking)
-- ============================================================
CREATE TABLE prompt_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prompt_id UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  version INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Company-scoped queries (most common pattern)
CREATE INDEX idx_profiles_company ON profiles(company_id);
CREATE INDEX idx_products_company ON products(company_id);
CREATE INDEX idx_annual_plans_company ON annual_plans(company_id);
CREATE INDEX idx_initiatives_company ON initiatives(company_id);
CREATE INDEX idx_initiatives_plan ON initiatives(annual_plan_id);
CREATE INDEX idx_initiatives_type ON initiatives(initiative_type_id);
CREATE INDEX idx_tasks_company ON tasks(company_id);
CREATE INDEX idx_tasks_initiative ON tasks(initiative_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_results_company ON results(company_id);
CREATE INDEX idx_results_initiative ON results(initiative_id);
CREATE INDEX idx_expenses_company ON expenses(company_id);
CREATE INDEX idx_expenses_initiative ON expenses(initiative_id);
CREATE INDEX idx_benchmarks_type ON benchmarks(initiative_type_id);
CREATE INDEX idx_projections_company ON projections(company_id);
CREATE INDEX idx_planning_inputs_company ON planning_inputs(company_id);

-- ============================================================
-- AUTO-UPDATE TIMESTAMPS
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'companies', 'profiles', 'products', 'annual_plans',
    'quarterly_plans', 'monthly_plans', 'weekly_plans',
    'planning_inputs', 'initiative_types', 'initiatives',
    'recurring_templates', 'tasks', 'results', 'expenses',
    'benchmarks', 'projections', 'subscriptions',
    'feature_flags', 'prompts'
  ])
  LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()',
      t
    );
  END LOOP;
END $$;
