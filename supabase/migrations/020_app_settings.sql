-- ============================================================
-- App settings (admin-controlled, single row)
--
-- A 'global' singleton for platform-wide toggles an admin can flip at runtime
-- without a redeploy. Follows the same shape as notification_rules: one row,
-- id = 'global', stamped with who changed it.
--
-- First setting: deter_devtools.
--
-- HONEST SCOPE NOTE — this is a deterrent, NOT a security control.
-- Blocking the context menu and DevTools shortcuts cannot protect client code.
-- The browser bundle is served to every visitor by definition (that is how the
-- app runs), so it is readable via curl, view-source:, the browser menu, a
-- proxy, or simply disabling JavaScript. Anyone determined enough to want the
-- code already has it. What this DOES do is stop casual over-the-shoulder
-- poking during demos. It is a toggle so it can be turned off, because it also
-- gets in the way of legitimate debugging.
--
-- Real protection lives server-side: secrets stay in route handlers and env
-- vars (never shipped to the client), every /api route is authorization-guarded,
-- and RLS constrains the database.
-- ============================================================

CREATE TABLE IF NOT EXISTS app_settings (
  id             TEXT PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  -- Discourage casual inspection: blocks the context menu and DevTools
  -- shortcuts in the browser. Off by default — opt in deliberately.
  deter_devtools BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the singleton so readers always find a row.
INSERT INTO app_settings (id) VALUES ('global')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Readable by anyone signed in: the client layout needs the flag to decide
-- whether to attach its listeners. Nothing here is sensitive — the flag's value
-- is self-evident from the page's behaviour anyway.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'app_settings' AND policyname = 'Authenticated can read app settings'
  ) THEN
    CREATE POLICY "Authenticated can read app settings"
      ON app_settings FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
END $$;

-- Writes go through the service-role client in /api/admin/settings, which is
-- guarded by requireAdmin(). No write policy here on purpose.
