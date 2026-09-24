-- ============================================================
-- App Notifications (in-app bell feed)
-- Per-user, in-app notification feed powering the notification
-- bell / dropdown. This is DISTINCT from the email-focused
-- notification_log (012): notification_log tracks outbound email
-- sends for idempotency/audit, while app_notifications is what a
-- user sees inside the product.
--
-- Writes are SERVICE-ROLE only (event handlers / cron / API routes
-- create rows via the service role, which bypasses RLS). Users only
-- read their own feed and mark their own items read.
--
-- dedupe_key enables idempotent event -> notification creation: a
-- writer passes a stable key (e.g.
-- 'initiative_reminder:<initiative_id>:<lead_days>:<trigger_date>')
-- and the partial UNIQUE index guarantees the same event can't
-- produce duplicate rows for the same user (upsert / ON CONFLICT
-- DO NOTHING). Rows with a NULL dedupe_key are unconstrained.
--
-- Tables:
--   app_notifications - per-user in-app notification feed
-- ============================================================

CREATE TABLE IF NOT EXISTS app_notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN (
                'initiative_reminder',
                'plan_generated',
                'task_due',
                'results_due',
                'system'
              )),
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  dedupe_key  TEXT,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary feed query: a user's notifications, newest-first.
CREATE INDEX IF NOT EXISTS idx_app_notifications_user_created
  ON app_notifications(user_id, created_at DESC);

-- Fast unread-count / unread badge (partial: only unread rows).
CREATE INDEX IF NOT EXISTS idx_app_notifications_user_unread
  ON app_notifications(user_id) WHERE read_at IS NULL;

-- De-dupe safeguard: a stable dedupe_key is unique per user. Rows with
-- a NULL dedupe_key are unconstrained (partial unique index), so ad-hoc
-- notifications without a key are always allowed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_notifications_dedupe
  ON app_notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ---- RLS: writes are service-role (bypasses RLS). Users read/update
--      only their own rows; admins may view all (mirrors 002/012). ----
ALTER TABLE app_notifications ENABLE ROW LEVEL SECURITY;

-- A user can read only their own notifications.
CREATE POLICY "Users can view own notifications"
  ON app_notifications FOR SELECT
  USING (user_id = auth.uid());

-- A user can update only their own notifications (e.g. mark as read).
-- The API normally writes via the service role, but this keeps a future
-- direct-from-client mark-read working and consistent with 012.
CREATE POLICY "Users can update own notifications"
  ON app_notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Admins may view all notifications.
CREATE POLICY "Admins can view all notifications"
  ON app_notifications FOR SELECT
  USING (is_admin());
