-- ============================================================
-- PRODUCT RECURRING INTERVAL
--
-- A recurring product is billed per month OR per year. The intake has asked
-- this since migration 026 (intake_products.recurring_interval), but
-- `products` had nowhere to keep the answer, so every recurring product was
-- treated, and shown, as monthly ("$497 /mo") — including annual ones.
--
-- SAME VOCABULARY AS THE INTAKE: 'month' | 'year', matching
-- intake_products.recurring_interval exactly.
--
-- NULLABLE, AND NULL IS MEANINGFUL: a one-time product has no interval, and a
-- recurring row written before this migration has an unrecorded one. The app
-- reads NULL on a recurring product as monthly, which is what it assumed
-- before, so existing rows display exactly as they did.
--
-- SAFE TO RE-RUN: every statement is guarded. No data is changed.
-- ============================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS recurring_interval TEXT;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_recurring_interval_check;

ALTER TABLE products
  ADD CONSTRAINT products_recurring_interval_check
  CHECK (recurring_interval IS NULL OR recurring_interval IN ('month', 'year'));

COMMENT ON COLUMN products.recurring_interval IS
  'How a recurring product is billed: month | year. Mirrors intake_products.recurring_interval. NULL for one-time products and for recurring rows saved before migration 055 (read as month).';
