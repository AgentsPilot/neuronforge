-- OPT-IN DATA REPAIR: a plan stage that lost its meeting link.
--
-- ---------------------------------------------------------------------------
-- WHAT IT REPAIRS
--
-- The contact drawer lists a package's money PER MEETING, so a stage with no
-- `meeting_id` is attached to no row and drops out of "left to collect". The
-- Money page reads stages directly and counts it, so the two surfaces disagree
-- about what a client owes, and the drawer is the one that understates.
--
-- Found 2026-11-08 on booking da424f7c: stage #3 ($111.02, pending) carried no
-- meeting link while session 4 carried no stage. The drawer showed $110.99 left
-- to collect against a true $222.01.
--
-- ---------------------------------------------------------------------------
-- THE RULE, AND WHY IT IS THIS NARROW
--
-- A stage is relinked ONLY where the pairing is forced:
--
--   * the booking has exactly ONE stage with no meeting_id, and
--   * exactly ONE numbered meeting that no stage already claims, and
--   * that meeting is neither `moved` nor `cancelled`.
--
-- Anything less certain is left alone. Guessing which meeting a stage belongs
-- to decides which session a client is charged for, and a wrong guess is worse
-- than the gap it closes.
--
-- Bookings whose meetings have NO `session_number` are deliberately excluded.
-- Those are single-session bookings where a stage is not meant to name a
-- meeting at all, and 35 of them look like orphans without being any.
--
-- ---------------------------------------------------------------------------
-- HOW THE UNDO WORKS
--
-- Step 2 RETURNS the rows it changed, and that output IS the undo. Save it.
-- Step 3 takes the stage ids from it and nothing else: an unbounded undo would
-- also clear links that were always correct.
-- ---------------------------------------------------------------------------

-- ─── STEP 1: READ-ONLY. What would change, and nothing else runs. ───────────

WITH orphan AS (
  SELECT s.id AS stage_id, s.booking_id, s.user_id, s.installment_number,
         s.amount, s.status, s.label
    FROM public.payment_plan_installments AS s
   WHERE s.meeting_id IS NULL
     AND s.booking_id IS NOT NULL
     AND s.status <> 'cancelled'
),
free_meeting AS (
  SELECT m.id AS meeting_id, m.booking_id, m.session_number, m.start_time
    FROM public.scheduling_meetings AS m
   WHERE m.session_number IS NOT NULL
     AND COALESCE(m.meeting_status, '') NOT IN ('moved', 'cancelled')
     AND NOT EXISTS (
           SELECT 1 FROM public.payment_plan_installments AS t
            WHERE t.meeting_id = m.id
         )
)
SELECT o.stage_id, o.booking_id, o.installment_number, o.amount, o.status,
       o.label, f.meeting_id AS link_to_add, f.session_number, f.start_time
  FROM orphan AS o
  JOIN free_meeting AS f ON f.booking_id = o.booking_id
 WHERE (SELECT count(*) FROM orphan  AS o2 WHERE o2.booking_id = o.booking_id) = 1
   AND (SELECT count(*) FROM free_meeting AS f2 WHERE f2.booking_id = o.booking_id) = 1
 ORDER BY o.booking_id;

-- ─── STEP 2: THE REPAIR. Run only after reading step 1. SAVE THE OUTPUT. ────

BEGIN;

WITH orphan AS (
  SELECT s.id AS stage_id, s.booking_id
    FROM public.payment_plan_installments AS s
   WHERE s.meeting_id IS NULL
     AND s.booking_id IS NOT NULL
     AND s.status <> 'cancelled'
),
free_meeting AS (
  SELECT m.id AS meeting_id, m.booking_id
    FROM public.scheduling_meetings AS m
   WHERE m.session_number IS NOT NULL
     AND COALESCE(m.meeting_status, '') NOT IN ('moved', 'cancelled')
     AND NOT EXISTS (
           SELECT 1 FROM public.payment_plan_installments AS t
            WHERE t.meeting_id = m.id
         )
),
forced AS (
  SELECT o.stage_id, f.meeting_id
    FROM orphan AS o
    JOIN free_meeting AS f ON f.booking_id = o.booking_id
   WHERE (SELECT count(*) FROM orphan       AS o2 WHERE o2.booking_id = o.booking_id) = 1
     AND (SELECT count(*) FROM free_meeting AS f2 WHERE f2.booking_id = o.booking_id) = 1
)
UPDATE public.payment_plan_installments AS s
   SET meeting_id = forced.meeting_id
  FROM forced
 WHERE s.id = forced.stage_id
RETURNING s.id AS stage_id, s.booking_id, s.installment_number, s.amount,
          s.meeting_id AS link_added;

COMMIT;

-- ─── STEP 3: UNDO. Only the ids step 2 returned. ────────────────────────────
--
-- BEGIN;
--
-- UPDATE public.payment_plan_installments
--    SET meeting_id = NULL
--  WHERE id IN (
--    '00000000-0000-0000-0000-000000000000'  -- the stage_id values from step 2
--  );
--
-- COMMIT;
