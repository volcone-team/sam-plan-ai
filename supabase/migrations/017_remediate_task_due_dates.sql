-- ============================================================
-- Remediate task due dates written by the reversed calculation
--
-- THE DEFECT
-- /api/generate-plan computed a task's due date as:
--     due_date = <15th of the activation month> + daysBeforeEvent
-- It ADDED the lead time instead of subtracting it, so preparation tasks
-- landed AFTER the event they prepare for. A webinar on Sep 14 had its
-- promo emails due Sep 28 and its content build due Oct 5.
--
-- WHY THE FIX IS EXACT, NOT A GUESS
-- The same code also set every initiative's event_date to that same 15th.
-- So for an affected task:
--     due_date  = event_date + L        (L = the original lead time)
-- therefore:
--     L         = due_date - event_date
--     corrected = event_date - L = 2 * event_date - due_date
-- The original lead time is fully recoverable from the two stored columns.
-- No task metadata is needed and nothing is invented.
--
-- SELECTION
--   due_date > event_date   - the signature of the defect. A correctly
--                             scheduled preparation task is on or before its
--                             event, so this predicate selects exactly the
--                             misplaced rows and nothing else.
--   status = 'not_started'  - tasks the user has started or completed are left
--                             alone. Moving a date someone has already worked
--                             to is worse than leaving it wrong; they can see
--                             and edit it. Applied uniformly, not case by case.
--   event_date IS NOT NULL  - without an anchor the lead time is
--                             unrecoverable. Those rows are reported, not
--                             guessed at.
--
-- IDEMPOTENT BY CONSTRUCTION
-- After correction, corrected <= event_date, so the `due_date > event_date`
-- predicate no longer matches the row. A second run selects zero rows. There
-- is no bookkeeping flag to keep in sync.
--
-- KNOWN LIMITATION
-- A task whose due date a user deliberately edited to after the event is
-- indistinguishable from a buggy one and will be moved. Restricting to
-- 'not_started' limits the blast radius.
-- ============================================================

-- ---- Report BEFORE ----
DO $$
DECLARE
  v_fixable INT;
  v_no_anchor INT;
  v_skipped_status INT;
BEGIN
  SELECT COUNT(*) INTO v_fixable
  FROM tasks t JOIN initiatives i ON i.id = t.initiative_id
  WHERE i.event_date IS NOT NULL AND t.due_date > i.event_date
    AND t.status = 'not_started';

  SELECT COUNT(*) INTO v_skipped_status
  FROM tasks t JOIN initiatives i ON i.id = t.initiative_id
  WHERE i.event_date IS NOT NULL AND t.due_date > i.event_date
    AND t.status <> 'not_started';

  SELECT COUNT(*) INTO v_no_anchor
  FROM tasks t JOIN initiatives i ON i.id = t.initiative_id
  WHERE i.event_date IS NULL;

  RAISE NOTICE '[017] to correct: %', v_fixable;
  RAISE NOTICE '[017] left alone (already started/completed): %', v_skipped_status;
  RAISE NOTICE '[017] unremediatable (initiative has no event_date): %', v_no_anchor;
END $$;

-- ---- Correct ----
-- corrected = event_date - (due_date - event_date)
UPDATE tasks t
SET due_date  = i.event_date - (t.due_date - i.event_date),
    updated_at = NOW()
FROM initiatives i
WHERE i.id = t.initiative_id
  AND i.event_date IS NOT NULL
  AND t.due_date > i.event_date
  AND t.status = 'not_started';

-- ---- Verify ----
DO $$
DECLARE
  v_remaining INT;
BEGIN
  SELECT COUNT(*) INTO v_remaining
  FROM tasks t JOIN initiatives i ON i.id = t.initiative_id
  WHERE i.event_date IS NOT NULL AND t.due_date > i.event_date
    AND t.status = 'not_started';

  RAISE NOTICE '[017] remaining after correction (expect 0): %', v_remaining;
  IF v_remaining <> 0 THEN
    RAISE EXCEPTION '[017] remediation incomplete: % rows still due after their event', v_remaining;
  END IF;
END $$;
