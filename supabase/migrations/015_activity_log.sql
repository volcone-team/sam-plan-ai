-- ============================================================
-- Admin Activity / Audit Log
-- An append-only record of privileged admin mutations (user
-- created/deleted, role changed, company created/deleted,
-- notification rules updated, ...). This is the "who did what,
-- to whom, when" trail for the admin panel.
--
-- DESIGN: the log must OUTLIVE the things it describes.
--
--   * actor_user_id uses ON DELETE SET NULL (never CASCADE). The
--     app hard-deletes users, and an audit trail that disappears
--     when you delete the user is useless — the delete itself is
--     exactly the event you need to keep.
--   * actor_email is a DENORMALIZED snapshot of the acting admin's
--     email at write time, so the actor stays identifiable after
--     their profile row is gone and actor_user_id has gone NULL.
--   * target_id deliberately has NO foreign key. The target of an
--     action is frequently the row being deleted; an FK would
--     either block the delete or null/cascade the history away.
--   * target_label is a snapshot of the target's name/email at the
--     time of the action, for the same reason.
--   * company_id is a nullable scope hint (ON DELETE SET NULL) —
--     deleting a company must not erase the record of it being
--     deleted.
--
-- WRITES ARE SERVICE-ROLE ONLY. Rows are inserted from server-side
-- API routes using the service-role key, which bypasses RLS. There
-- are deliberately NO insert/update/delete policies below, so no
-- client-side session (admin or otherwise) can forge, edit, or
-- erase an audit row.
--
-- Rows are APPEND-ONLY by design: nothing in the app updates or
-- deletes activity_log rows. Retention/pruning, if ever needed, is
-- an explicit out-of-band operation.
--
-- Tables:
--   activity_log - append-only admin audit trail
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_log (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- SET NULL, not CASCADE: hard-deleting the actor must not erase history.
  actor_user_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- Snapshot of the actor's email so they remain identifiable afterwards.
  actor_email    TEXT,
  -- Dotted verb, e.g. 'user.created', 'company.deleted'.
  action         TEXT NOT NULL,
  -- e.g. 'user', 'company', 'notification_rules'.
  target_type    TEXT,
  -- No FK on purpose: the target is often deleted, the log must survive.
  target_id      UUID,
  -- Snapshot of the target's name/email at the time of the action.
  target_label   TEXT,
  company_id     UUID REFERENCES companies(id) ON DELETE SET NULL,
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary feed query: newest activity first.
CREATE INDEX IF NOT EXISTS idx_activity_log_created
  ON activity_log(created_at DESC);

-- Filter by action type (e.g. show only 'user.deleted').
CREATE INDEX IF NOT EXISTS idx_activity_log_action
  ON activity_log(action);

-- Filter by actor ("what has this admin been doing?").
CREATE INDEX IF NOT EXISTS idx_activity_log_actor
  ON activity_log(actor_user_id);

-- ---- RLS: admins READ everything; nobody writes from a client. ----
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Admins can read the full audit trail. is_admin() is the helper
-- defined in 002_rls_policies.sql (referenced here, not redefined).
CREATE POLICY "Admins can view all activity"
  ON activity_log FOR SELECT
  USING (is_admin());

-- NO INSERT / UPDATE / DELETE policies by design. Writes go through
-- the service role (which bypasses RLS) and audit rows must never be
-- editable or removable from a client session.
