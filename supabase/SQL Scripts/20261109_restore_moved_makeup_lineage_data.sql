-- OPT-IN DATA REPAIR for rows 20261109 was too late for. Run it once, after the migration.
--
-- ---------------------------------------------------------------------------
-- WHAT IT REPAIRS
--
-- Before 20261109, `move_meeting` wrote the next attempt at a session without
-- `replaces_meeting_id`. So every make-up that was ever MOVED lost the only
-- record of the hour it stands in for, and the rule that stops a replacement
-- being billed twice for one delivered hour reads exactly that column.
--
-- A row is repaired only when the attempt BEFORE it, on the same booking and
-- the same session number, carries a link that this row does not. That pair is
-- the signature of a move: same session, consecutive occurrences, and a link
-- that existed a moment earlier. Nothing else is touched.
--
-- ---------------------------------------------------------------------------
-- HOW THE UNDO WORKS, AND WHY IT IS NOT A MARKER
--
-- A first version of this script stamped `moved_by` so the repair could be
-- identified later. `moved_by` has a CHECK constraint on its values, so that
-- failed outright:
--
--   23514 new row for relation "scheduling_meetings" violates check
--         constraint "scheduling_meetings_moved_by_check"
--
-- It failed inside the transaction, so nothing was written. The lesson is kept
-- rather than worked around: no column here is free text, and inventing a
-- marker in one that is constrained is how a repair becomes a second defect.
--
-- So step 2 RETURNS the rows it changed, and that output IS the undo. Save it.
-- Step 3 takes the ids from it and nothing else, which is a narrower undo than
-- a marker would have given.
-- ---------------------------------------------------------------------------

-- ─── STEP 1: READ-ONLY. What would change, and nothing else runs. ───────────

SELECT
  m.id AS attempt_id,
  m.booking_id,
  m.session_number,
  m.occurrence_number,
  m.meeting_status,
  m.start_time,
  prev.id AS previous_attempt,
  prev.replaces_meeting_id AS link_to_restore
FROM public.scheduling_meetings AS m
JOIN public.scheduling_meetings AS prev
  ON prev.booking_id = m.booking_id
 AND prev.user_id = m.user_id
 AND prev.session_number = m.session_number
 AND prev.occurrence_number = m.occurrence_number - 1
WHERE m.replaces_meeting_id IS NULL
  AND prev.replaces_meeting_id IS NOT NULL
ORDER BY m.booking_id, m.session_number, m.occurrence_number;

-- ─── STEP 2: THE REPAIR. Run only after reading step 1. SAVE THE OUTPUT. ────
--
-- The returned `attempt_id` list is the only record of which rows this wrote.
-- Nothing else distinguishes a repaired row from one that always had its link.

BEGIN;

UPDATE public.scheduling_meetings AS m
   SET replaces_meeting_id = prev.replaces_meeting_id
  FROM public.scheduling_meetings AS prev
 WHERE prev.booking_id = m.booking_id
   AND prev.user_id = m.user_id
   AND prev.session_number = m.session_number
   AND prev.occurrence_number = m.occurrence_number - 1
   AND m.replaces_meeting_id IS NULL
   AND prev.replaces_meeting_id IS NOT NULL
RETURNING m.id AS attempt_id, m.booking_id, m.session_number, m.occurrence_number,
          m.replaces_meeting_id AS link_restored;

COMMIT;

-- ─── STEP 3: UNDO. Only the ids step 2 returned. ────────────────────────────
--
-- Paste the `attempt_id` values from step 2 in place of the example, and
-- nothing else: an unbounded undo would also clear links that were never
-- repaired.
--
-- BEGIN;
--
-- UPDATE public.scheduling_meetings
--    SET replaces_meeting_id = NULL
--  WHERE id IN (
--    '00000000-0000-0000-0000-000000000000'  -- the ids step 2 returned
--  );
--
-- COMMIT;
