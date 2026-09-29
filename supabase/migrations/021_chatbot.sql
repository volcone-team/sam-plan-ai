-- ============================================================
-- Workbook chatbot: conversations, messages, and cost accounting
--
-- Users chat with an assistant grounded in the authored workbook tables
-- (migration 018). Conversations persist server-side so the widget can be
-- minimised, reloaded, or reopened on another device without losing context.
--
-- BUDGETS ARE PER COMPANY, NOT PER USER. Several members share one account, so
-- the daily token allowance is pooled across the company — otherwise a 5-seat
-- company would get 5x the budget of a 1-seat company for the same subscription.
-- When the pool is spent, the widget stops and offers an email contact route
-- instead of silently failing.
--
-- Service-role writes only. Message rows carry token counts and a computed cost
-- so the super-admin tools page can report real spend per company and per model.
-- ============================================================

-- ------------------------------------------------------------
-- Conversations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_conversations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- First user message, trimmed — enough to identify a thread in the admin UI
  -- without reading the whole conversation.
  title       TEXT,
  -- Soft close: keeps the transcript for cost reporting after a user clears it.
  closed_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_conv_user
  ON chat_conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conv_company
  ON chat_conversations(company_id, created_at DESC);

-- ------------------------------------------------------------
-- Messages
--
-- Token columns are populated on assistant rows only (the API reports usage per
-- response, and input_tokens already covers the prompt we sent). cost_usd is
-- stored at write time rather than derived on read: model prices change, and a
-- historical report must reflect what the call actually cost.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  company_id      UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  model           TEXT,
  tokens_input    INT,
  tokens_output   INT,
  cost_usd        NUMERIC(12, 6),
  duration_ms     INT,
  -- Set when the assistant turn failed, so failures are visible in the tools
  -- page instead of looking like a conversation that simply stopped.
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_msg_conv
  ON chat_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_chat_msg_company_created
  ON chat_messages(company_id, created_at DESC);
-- Drives the daily budget check: sum tokens for one company since midnight.
CREATE INDEX IF NOT EXISTS idx_chat_msg_company_day
  ON chat_messages(company_id, created_at)
  WHERE role = 'assistant';

-- ------------------------------------------------------------
-- Per-company budget override
--
-- Absent row = use the platform default in app_settings. Present row = this
-- company's own allowance, so a super admin can raise a specific customer's
-- limit without lifting it for everyone.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_budgets (
  company_id       UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  daily_token_cap  INT NOT NULL CHECK (daily_token_cap >= 0),
  updated_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Platform-wide chatbot settings, added to the app_settings singleton.
-- ------------------------------------------------------------
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS chatbot_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Pooled daily token allowance per company. Counts input + output, because both
-- are billed. 200k is roughly 40-60 grounded exchanges; tune from real usage.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS chat_daily_token_cap INT NOT NULL DEFAULT 200000;

-- Shown to users who have exhausted the pool, so they have somewhere to go.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS chat_contact_email TEXT;

-- ------------------------------------------------------------
-- RLS
--
-- Reads are scoped to the owner for conversations/messages so a future
-- client-side history view is safe by default. All writes go through
-- /api/chat with the service-role client, which enforces budgets — there are
-- no INSERT policies on purpose, or a user could forge messages and bypass
-- accounting. chat_budgets is admin-only and has no user-facing policy at all.
-- ------------------------------------------------------------
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_budgets       ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'chat_conversations' AND policyname = 'Users read own conversations'
  ) THEN
    CREATE POLICY "Users read own conversations"
      ON chat_conversations FOR SELECT USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'chat_messages' AND policyname = 'Users read own messages'
  ) THEN
    CREATE POLICY "Users read own messages"
      ON chat_messages FOR SELECT USING (user_id = auth.uid());
  END IF;
END $$;

-- ------------------------------------------------------------
-- Chat model selection.
--
-- Stored rather than read from an env var so a super admin can switch models
-- without a redeploy, and so the choice is audited alongside the other chatbot
-- controls.
--
-- Haiku is the default deliberately: the workbook library is re-sent as system
-- context on every turn, so input tokens dominate chat cost. Haiku's input rate
-- is roughly a quarter of Sonnet's, which matters far more here than it would
-- for one-shot plan generation. Move to Sonnet if answer quality needs it.
--
-- The route validates against its own allowlist before use, so an unexpected
-- value here cannot send traffic to an arbitrary model id.
-- ------------------------------------------------------------
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS chat_model TEXT NOT NULL DEFAULT 'claude-3-5-haiku-20241022';
