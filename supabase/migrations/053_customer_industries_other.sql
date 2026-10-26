-- ============================================================
-- 053: CUSTOMER INDUSTRIES "OTHER" TEXT
--
-- planning_inputs.customer_industries (025) is a multi-select that includes
-- "Other". Picking it reveals a short optional text input ("Which
-- industry?"), stored here. Data only: the recommendations do not read it.
-- Cleared on save whenever "Other" is not among customer_industries
-- (src/lib/intake/draft.ts), capped at 200 characters in the form and on save.
--
-- Code does not depend on this being applied first: until it is, the draft
-- save is refused for the missing column and retried without it
-- (src/lib/intake/draft-columns.ts), so only this one answer is not kept.
--
-- Writes no data. Safe to re-run.
-- ============================================================

ALTER TABLE planning_inputs
  ADD COLUMN IF NOT EXISTS customer_industries_other TEXT;

COMMENT ON COLUMN planning_inputs.customer_industries_other IS
  'Intake v2 screen 7: free text revealed by Other in customer_industries ("Which industry?"). Optional, max 200 characters, NULL unless Other is selected. Stored for data only; not used by recommendations.';
