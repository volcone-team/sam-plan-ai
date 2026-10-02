-- ============================================================
-- PURGE UNATTRIBUTED INVOICES
--
-- Removes rows from billing_invoices that belong to no company in THIS
-- database, which inflate "Collected to date" and appear in the admin payment
-- history with a blank Company column.
--
-- HOW THEY GOT THERE. Two causes, both now fixed in code:
--
--   1. The admin resync pulled `stripe.invoices.list()`, which is ACCOUNT-wide,
--      not app-wide. Every invoice the Stripe account had ever issued was
--      stored, with company_id left null when no local customer matched —
--      including test purchases from before the database was reset.
--
--   2. billing_invoices.company_id is `ON DELETE SET NULL` (migration 022). The
--      wipe script truncates `companies`, so invoices belonging to wiped
--      companies were NOT deleted — their company_id was merely nulled, and
--      they kept counting as revenue afterwards.
--
-- Run in the Supabase SQL EDITOR. Deleting these loses nothing: Stripe remains
-- the ledger of record, and anything still attributable is re-importable via
-- Admin > Subscriptions > Billing & Stripe > Resync.
--
-- SAFE TO RE-RUN. Only ever touches rows with a NULL company_id, so invoices
-- for live customers are untouched.
-- ============================================================

-- Look before you delete: how many rows, and how much they were inflating the
-- total by (amount_paid is in minor units, hence / 100.0).
SELECT
  COUNT(*)                                        AS orphan_invoices,
  COALESCE(SUM(amount_paid) FILTER (WHERE status = 'paid'), 0) / 100.0
                                                  AS inflated_revenue_usd
FROM billing_invoices
WHERE company_id IS NULL;

-- Then delete them.
DELETE FROM billing_invoices
WHERE company_id IS NULL;

-- Verify: both figures should now be 0 and the Overview tab should show only
-- what this app actually collected.
SELECT
  COUNT(*)                                        AS remaining_orphans,
  COALESCE(SUM(amount_paid) FILTER (WHERE status = 'paid'), 0) / 100.0
                                                  AS revenue_usd
FROM billing_invoices
WHERE company_id IS NULL;
