-- ============================================================
-- RETENTION CALL BOOKING URLS
--
-- Two of the cancellation flow's save-offers are a booking button and nothing
-- else: the "plan reset call" shown to someone who fell behind, and the
-- "strategy call" shown to someone not seeing results. Without a URL those
-- screens have a primary button that goes nowhere, which is worse than not
-- showing them at all — so the screens stay hidden until one of these is set.
--
-- IN `app_settings`, NOT AN ENV VAR. A booking link is a marketing asset that
-- changes when a calendar moves, a coach changes or the provider changes.
-- Env vars need a redeploy to edit and are invisible to the person who owns the
-- calendar; this is editable from the admin UI, exactly like
-- chat_contact_email, which was added for the same reason.
--
-- PROVIDER-AGNOSTIC. Any https URL works — Calendly, GoHighLevel, SavvyCal,
-- a plain contact page. Nothing validates the host, because tying the product
-- to one booking vendor would be a pointless constraint.
--
-- TWO COLUMNS, EITHER SUFFICIENT. The two screens may use different calendars,
-- so each has its own field; filling in only the reset-call URL makes both
-- screens use it (see resolveBookingUrls in src/lib/billing/booking.ts). That
-- avoids forcing someone with one calendar to paste the same link twice.
--
-- SAFE TO RE-RUN: every statement is guarded.
-- ============================================================

ALTER TABLE app_settings
  -- 2b: the free 15-minute plan reset call.
  ADD COLUMN IF NOT EXISTS retention_reset_call_url TEXT,
  -- 2c: the 1:1 strategy call.
  ADD COLUMN IF NOT EXISTS retention_strategy_call_url TEXT;

COMMENT ON COLUMN app_settings.retention_reset_call_url IS
  'Booking link for the cancellation flow''s plan-reset call. Any https URL. Empty hides that screen.';

COMMENT ON COLUMN app_settings.retention_strategy_call_url IS
  'Booking link for the cancellation flow''s strategy call. Falls back to the reset-call URL when empty.';
