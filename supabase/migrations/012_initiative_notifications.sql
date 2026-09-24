-- ============================================================
-- Initiative Notifications
-- Automatic, date-triggered reminder emails for upcoming
-- initiatives ("your webinar goes live in 2 days"), with
-- admin-tunable rules and an editable email template.
--
-- Tables:
--   email_templates        - editable subject/body with {{variables}}
--   notification_rules      - global singleton admin config
--   notification_log        - idempotency + audit (UNIQUE = at-most-once)
--   notification_opt_outs   - unsubscribe state (row present = opted out)
-- ============================================================

-- email_templates created FIRST: notification_rules.template_key FKs to it.
CREATE TABLE IF NOT EXISTS email_templates (
  key         TEXT PRIMARY KEY,
  subject     TEXT NOT NULL,
  body_html   TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Global admin config. Keyed singleton: CHECK (id = 'global') + PK means
-- exactly one row can ever exist.
CREATE TABLE IF NOT EXISTS notification_rules (
  id             TEXT PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  lead_times     INT[] NOT NULL DEFAULT '{7,2,1}',
  recipient_rule TEXT NOT NULL DEFAULT 'owners_operators'
                   CHECK (recipient_rule IN ('all', 'owners_operators')),
  template_key   TEXT NOT NULL DEFAULT 'initiative_reminder'
                   REFERENCES email_templates(key),
  updated_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency + audit. The UNIQUE constraint is the at-most-once guarantee:
-- one (initiative, date_field, lead_days, recipient) can only be claimed once.
CREATE TABLE IF NOT EXISTS notification_log (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  initiative_id       UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
  recipient_user_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_email     TEXT NOT NULL,
  date_field          TEXT NOT NULL CHECK (date_field IN ('activation_date', 'event_date')),
  lead_days           INT NOT NULL,
  trigger_date        DATE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'sent', 'failed')),
  provider_message_id TEXT,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_notification_offset_recipient
    UNIQUE (initiative_id, date_field, lead_days, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_log_initiative ON notification_log(initiative_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_created ON notification_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_log_status ON notification_log(status);

-- Unsubscribe state. Presence of a row == opted out. A dedicated table (not a
-- profiles column) records WHEN they opted out and leaves room for future
-- per-category opt-outs without touching profiles.
CREATE TABLE IF NOT EXISTS notification_opt_outs (
  user_id     UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  category    TEXT NOT NULL DEFAULT 'initiative_reminder',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- RLS: all writes go through the service role (cron / unsubscribe / admin
--      API), which bypasses RLS. Optional member-read policies mirror 011. ----
ALTER TABLE email_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_opt_outs ENABLE ROW LEVEL SECURITY;

-- Members may read their own company's send log (optional in-app surfacing).
CREATE POLICY "Members can view own company notification log"
  ON notification_log FOR SELECT
  USING (
    initiative_id IN (
      SELECT i.id FROM initiatives i
      WHERE i.company_id IN (
        SELECT company_id FROM profiles WHERE id = auth.uid()
      )
    )
  );

-- A logged-in user may see/clear their own opt-out (for a future settings UI).
CREATE POLICY "Users manage own opt-out"
  ON notification_opt_outs FOR SELECT
  USING (user_id = auth.uid());

-- ---- Seeds ----
-- Default reminder template (referenced by the rules singleton's default).
INSERT INTO email_templates (key, subject, body_html)
VALUES (
  'initiative_reminder',
  'Your {{channel}} "{{initiativeName}}" goes live in {{daysUntil}} days',
  '<p>Hi {{firstName}},</p><p>Your {{channel}} <strong>{{initiativeName}}</strong> is scheduled for {{activationDate}} — that''s {{daysUntil}} days away.</p><p>Now is a good time to make sure everything is ready.</p>'
)
ON CONFLICT (key) DO NOTHING;

-- Global rules singleton with safe defaults.
INSERT INTO notification_rules (id)
VALUES ('global')
ON CONFLICT (id) DO NOTHING;
