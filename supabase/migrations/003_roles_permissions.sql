-- ============================================================
-- SAM Plan AI - Roles & Permissions System
-- Two scopes: 'customer' (inside companies) and 'admin' (internal team)
-- ============================================================

-- ============================================================
-- 1. PERMISSION DEFINITIONS
-- All available permissions in the system
-- ============================================================
CREATE TABLE permission_definitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('customer', 'admin')),
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. ROLES
-- Defines the available roles for each scope
-- ============================================================
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('customer', 'admin')),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(name, scope)
);

-- ============================================================
-- 3. ROLE PERMISSIONS (the mapping)
-- Which permissions are granted to which roles
-- ============================================================
CREATE TABLE role_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permission_definitions(id) ON DELETE CASCADE,
  granted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(role_id, permission_id)
);

-- ============================================================
-- 4. INTERNAL TEAM MEMBERS (admin staff)
-- ============================================================
CREATE TABLE internal_team (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_permissions_scope ON permission_definitions(scope);
CREATE INDEX idx_permissions_category ON permission_definitions(category);
CREATE INDEX idx_roles_scope ON roles(scope);
CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX idx_internal_team_role ON internal_team(role_id);

-- ============================================================
-- SEED: Customer-side permission definitions
-- ============================================================
INSERT INTO permission_definitions (key, label, category, scope, display_order) VALUES
-- Initiatives
('initiatives.view', 'View initiatives', 'Initiatives', 'customer', 1),
('initiatives.create', 'Create initiatives', 'Initiatives', 'customer', 2),
('initiatives.edit', 'Edit initiatives', 'Initiatives', 'customer', 3),
('initiatives.delete', 'Delete initiatives', 'Initiatives', 'customer', 4),
('initiatives.change_status', 'Change initiative status', 'Initiatives', 'customer', 5),
-- Tasks
('tasks.view', 'View tasks', 'Tasks', 'customer', 10),
('tasks.create', 'Create tasks', 'Tasks', 'customer', 11),
('tasks.edit', 'Edit tasks', 'Tasks', 'customer', 12),
('tasks.delete', 'Delete tasks', 'Tasks', 'customer', 13),
('tasks.change_status', 'Change task status', 'Tasks', 'customer', 14),
('tasks.assign', 'Assign tasks to others', 'Tasks', 'customer', 15),
-- Results
('results.view', 'View results', 'Results', 'customer', 20),
('results.create', 'Enter/add results', 'Results', 'customer', 21),
('results.edit', 'Edit results', 'Results', 'customer', 22),
('results.delete', 'Delete results', 'Results', 'customer', 23),
-- Expenses
('expenses.view', 'View expenses', 'Expenses', 'customer', 30),
('expenses.create', 'Add expenses', 'Expenses', 'customer', 31),
('expenses.edit', 'Edit expenses', 'Expenses', 'customer', 32),
('expenses.delete', 'Delete expenses', 'Expenses', 'customer', 33),
-- Planning
('planning.view_annual', 'View Year-at-a-Glance', 'Planning', 'customer', 40),
('planning.edit_quarterly', 'View/edit quarterly plans', 'Planning', 'customer', 41),
('planning.edit_monthly', 'View/edit monthly plans', 'Planning', 'customer', 42),
('planning.edit_weekly', 'View/edit weekly plans', 'Planning', 'customer', 43),
('planning.view_calendar', 'View calendar/timeline', 'Planning', 'customer', 44),
-- Products
('products.view', 'View products', 'Products', 'customer', 50),
('products.create', 'Add products', 'Products', 'customer', 51),
('products.edit', 'Edit products', 'Products', 'customer', 52),
('products.delete', 'Delete products', 'Products', 'customer', 53),
-- Reports
('reports.view_revenue', 'View revenue report', 'Reports', 'customer', 60),
('reports.view_products', 'View products report', 'Reports', 'customer', 61),
('reports.view_expenses', 'View expenses report', 'Reports', 'customer', 62),
('reports.view_roi', 'View ROI report', 'Reports', 'customer', 63),
('reports.export', 'Export CSV', 'Reports', 'customer', 64),
-- Settings
('settings.view', 'View company settings', 'Settings', 'customer', 70),
('settings.edit', 'Edit company settings', 'Settings', 'customer', 71),
('settings.manage_team', 'Manage team members', 'Settings', 'customer', 72),
('settings.manage_billing', 'Manage subscription/billing', 'Settings', 'customer', 73),
-- Questionnaire
('questionnaire.fill', 'Fill questionnaire', 'Questionnaire', 'customer', 80),
('questionnaire.regenerate', 'Regenerate plan', 'Questionnaire', 'customer', 81);

-- ============================================================
-- SEED: Admin-side permission definitions
-- ============================================================
INSERT INTO permission_definitions (key, label, category, scope, display_order) VALUES
-- Dashboard
('admin.dashboard.view', 'View admin dashboard', 'Dashboard', 'admin', 1),
-- Users
('admin.users.view', 'View user list', 'Users', 'admin', 10),
('admin.users.edit', 'Edit user details', 'Users', 'admin', 11),
('admin.users.delete', 'Delete/deactivate users', 'Users', 'admin', 12),
-- Companies
('admin.companies.view', 'View company list', 'Companies', 'admin', 20),
('admin.companies.view_details', 'View company details', 'Companies', 'admin', 21),
('admin.companies.edit', 'Edit company data', 'Companies', 'admin', 22),
('admin.companies.delete', 'Delete companies', 'Companies', 'admin', 23),
-- Questionnaire Management
('admin.questionnaire.view', 'View questions', 'Questionnaire Mgmt', 'admin', 30),
('admin.questionnaire.manage', 'Add/edit/delete questions', 'Questionnaire Mgmt', 'admin', 31),
-- Initiative Library
('admin.initiatives.view', 'View initiative types', 'Initiative Library', 'admin', 40),
('admin.initiatives.manage', 'Add/edit initiative types', 'Initiative Library', 'admin', 41),
('admin.initiatives.delete', 'Delete initiative types', 'Initiative Library', 'admin', 42),
('admin.initiatives.benchmarks', 'Manage benchmarks', 'Initiative Library', 'admin', 43),
-- AI Workbook
('admin.workbook.view', 'View prompts', 'AI Workbook', 'admin', 50),
('admin.workbook.edit', 'Edit prompts', 'AI Workbook', 'admin', 51),
('admin.workbook.upload', 'Upload workbook', 'AI Workbook', 'admin', 52),
('admin.workbook.test', 'Test playground', 'AI Workbook', 'admin', 53),
-- Benchmarks
('admin.benchmarks.view', 'View benchmarks', 'Benchmarks', 'admin', 60),
('admin.benchmarks.manage', 'Add/edit benchmarks', 'Benchmarks', 'admin', 61),
('admin.benchmarks.delete', 'Delete benchmarks', 'Benchmarks', 'admin', 62),
-- Content
('admin.content.university', 'Manage SAM University', 'Content', 'admin', 70),
('admin.content.faq', 'Manage FAQ', 'Content', 'admin', 71),
('admin.content.emails', 'Manage email templates', 'Content', 'admin', 72),
-- Subscriptions
('admin.subscriptions.view', 'View subscriptions', 'Subscriptions', 'admin', 80),
('admin.subscriptions.manage', 'Change subscription tiers', 'Subscriptions', 'admin', 81),
('admin.subscriptions.billing', 'Manage billing', 'Subscriptions', 'admin', 82),
-- Analytics
('admin.analytics.usage', 'View usage analytics', 'Analytics', 'admin', 90),
('admin.analytics.revenue', 'View revenue analytics', 'Analytics', 'admin', 91),
('admin.analytics.engagement', 'View engagement metrics', 'Analytics', 'admin', 92),
-- Settings
('admin.settings.feature_flags', 'Manage feature flags', 'Settings', 'admin', 100),
('admin.settings.platform', 'Manage platform settings', 'Settings', 'admin', 101),
('admin.settings.internal_roles', 'Manage internal team roles', 'Settings', 'admin', 102),
('admin.settings.customer_roles', 'Define customer role privileges', 'Settings', 'admin', 103);

-- ============================================================
-- SEED: Default Customer Roles
-- ============================================================
INSERT INTO roles (name, description, scope, is_default, is_system, display_order) VALUES
('Owner', 'Full access. Manages billing, team, and all features.', 'customer', FALSE, TRUE, 1),
('Operator', 'Runs the cadence. Manages initiatives, tasks, results.', 'customer', FALSE, TRUE, 2),
('Team Member', 'Assigned tasks. Enters results for their work.', 'customer', TRUE, TRUE, 3),
('Viewer', 'Read-only access to all data.', 'customer', FALSE, TRUE, 4);

-- ============================================================
-- SEED: Default Admin (Internal) Roles
-- ============================================================
INSERT INTO roles (name, description, scope, is_default, is_system, display_order) VALUES
('Super Admin', 'Unrestricted access. Cannot be modified.', 'admin', FALSE, TRUE, 1),
('Admin', 'Full admin access minus super-admin settings.', 'admin', FALSE, TRUE, 2),
('Support', 'View customer data, help with issues.', 'admin', FALSE, TRUE, 3),
('Content Manager', 'Manage initiative types, benchmarks, prompts, university.', 'admin', FALSE, TRUE, 4),
('Analyst', 'View analytics and reports, no edit access.', 'admin', FALSE, TRUE, 5);

-- ============================================================
-- SEED: Default Role Permissions for Customer Roles
-- (Owner gets everything, others get subsets)
-- ============================================================

-- Owner: all customer permissions granted
INSERT INTO role_permissions (role_id, permission_id, granted)
SELECT r.id, p.id, TRUE
FROM roles r
CROSS JOIN permission_definitions p
WHERE r.name = 'Owner' AND r.scope = 'customer' AND p.scope = 'customer';

-- Operator: everything except billing and team management
INSERT INTO role_permissions (role_id, permission_id, granted)
SELECT r.id, p.id,
  CASE WHEN p.key IN ('settings.manage_billing', 'settings.manage_team') THEN FALSE ELSE TRUE END
FROM roles r
CROSS JOIN permission_definitions p
WHERE r.name = 'Operator' AND r.scope = 'customer' AND p.scope = 'customer';

-- Team Member: view + create/edit tasks and results, view everything else
INSERT INTO role_permissions (role_id, permission_id, granted)
SELECT r.id, p.id,
  CASE
    WHEN p.key LIKE '%.view%' THEN TRUE
    WHEN p.key IN ('tasks.create', 'tasks.edit', 'tasks.change_status', 'results.create', 'results.edit') THEN TRUE
    WHEN p.key = 'planning.view_annual' THEN TRUE
    WHEN p.key = 'planning.view_calendar' THEN TRUE
    ELSE FALSE
  END
FROM roles r
CROSS JOIN permission_definitions p
WHERE r.name = 'Team Member' AND r.scope = 'customer' AND p.scope = 'customer';

-- Viewer: only view permissions
INSERT INTO role_permissions (role_id, permission_id, granted)
SELECT r.id, p.id,
  CASE WHEN p.key LIKE '%.view%' THEN TRUE ELSE FALSE END
FROM roles r
CROSS JOIN permission_definitions p
WHERE r.name = 'Viewer' AND r.scope = 'customer' AND p.scope = 'customer';

-- ============================================================
-- SEED: Default Role Permissions for Admin Roles
-- ============================================================

-- Super Admin: everything
INSERT INTO role_permissions (role_id, permission_id, granted)
SELECT r.id, p.id, TRUE
FROM roles r
CROSS JOIN permission_definitions p
WHERE r.name = 'Super Admin' AND r.scope = 'admin' AND p.scope = 'admin';

-- Admin: everything except internal_roles
INSERT INTO role_permissions (role_id, permission_id, granted)
SELECT r.id, p.id,
  CASE WHEN p.key = 'admin.settings.internal_roles' THEN FALSE ELSE TRUE END
FROM roles r
CROSS JOIN permission_definitions p
WHERE r.name = 'Admin' AND r.scope = 'admin' AND p.scope = 'admin';

-- Support: view users, companies, subscriptions only
INSERT INTO role_permissions (role_id, permission_id, granted)
SELECT r.id, p.id,
  CASE
    WHEN p.key IN ('admin.dashboard.view', 'admin.users.view', 'admin.companies.view', 'admin.companies.view_details', 'admin.subscriptions.view') THEN TRUE
    ELSE FALSE
  END
FROM roles r
CROSS JOIN permission_definitions p
WHERE r.name = 'Support' AND r.scope = 'admin' AND p.scope = 'admin';

-- Content Manager: initiative library, benchmarks, content, workbook
INSERT INTO role_permissions (role_id, permission_id, granted)
SELECT r.id, p.id,
  CASE
    WHEN p.key LIKE 'admin.initiatives%' THEN TRUE
    WHEN p.key LIKE 'admin.benchmarks%' THEN TRUE
    WHEN p.key LIKE 'admin.content%' THEN TRUE
    WHEN p.key LIKE 'admin.workbook%' THEN TRUE
    WHEN p.key = 'admin.dashboard.view' THEN TRUE
    ELSE FALSE
  END
FROM roles r
CROSS JOIN permission_definitions p
WHERE r.name = 'Content Manager' AND r.scope = 'admin' AND p.scope = 'admin';

-- Analyst: view-only analytics and dashboard
INSERT INTO role_permissions (role_id, permission_id, granted)
SELECT r.id, p.id,
  CASE
    WHEN p.key = 'admin.dashboard.view' THEN TRUE
    WHEN p.key LIKE 'admin.analytics%' THEN TRUE
    WHEN p.key = 'admin.users.view' THEN TRUE
    WHEN p.key = 'admin.companies.view' THEN TRUE
    WHEN p.key = 'admin.subscriptions.view' THEN TRUE
    ELSE FALSE
  END
FROM roles r
CROSS JOIN permission_definitions p
WHERE r.name = 'Analyst' AND r.scope = 'admin' AND p.scope = 'admin';

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE permission_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_team ENABLE ROW LEVEL SECURITY;

-- Permission definitions and roles: readable by all authenticated users
CREATE POLICY "Authenticated users can view permissions" ON permission_definitions FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can view roles" ON roles FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can view role permissions" ON role_permissions FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only admins can modify
CREATE POLICY "Admins can manage permissions" ON permission_definitions FOR ALL USING (is_admin());
CREATE POLICY "Admins can manage roles" ON roles FOR ALL USING (is_admin());
CREATE POLICY "Admins can manage role permissions" ON role_permissions FOR ALL USING (is_admin());
CREATE POLICY "Admins can manage internal team" ON internal_team FOR ALL USING (is_admin());

-- Auto-update timestamps
CREATE TRIGGER set_updated_at BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at_internal_team BEFORE UPDATE ON internal_team FOR EACH ROW EXECUTE FUNCTION update_updated_at();
