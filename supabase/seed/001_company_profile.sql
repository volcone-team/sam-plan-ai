-- ============================================================
-- SEED: Company + Admin Profile
-- Run this in your Supabase SQL Editor.
--
-- IMPORTANT: Replace 'YOUR_AUTH_USER_ID' below with your actual
-- user ID from Supabase Auth > Users table.
-- (It's the UUID shown next to your email in the dashboard)
-- ============================================================

-- 1. Insert the company
INSERT INTO companies (id, name, description, fiscal_year, planning_year, currency, prior_year_revenue, target_revenue, baseline_revenue, stretch_revenue, operating_budget)
VALUES (
  '8a3f2c91-7e4d-4b2a-9d1f-6c5e8a2b3f4d',
  'Elevate Coaching',
  'A premium coaching and consulting firm specializing in executive leadership development and sales transformation for service-based businesses',
  2026,
  2026,
  'USD',
  450000,
  750000,
  495000,
  900000,
  346500
)
ON CONFLICT (id) DO NOTHING;

-- 2. Insert the admin profile
-- ⚠️ REPLACE the ID below with your actual auth.users UUID
-- Find it: Supabase Dashboard > Authentication > Users > copy the UUID
INSERT INTO profiles (id, company_id, email, first_name, last_name, role, is_active, is_admin)
VALUES (
  '00000000-0000-0000-0000-000000000000',  -- ← REPLACE THIS with your real auth user ID
  '8a3f2c91-7e4d-4b2a-9d1f-6c5e8a2b3f4d',
  'admin@samplanai.com',  -- ← REPLACE with your actual email
  'Admin',
  'User',
  'owner',
  TRUE,
  TRUE
)
ON CONFLICT (id) DO NOTHING;
