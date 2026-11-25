/*
 * OPT-IN DATA REPAIR — the second half of 20261113, and a correction to it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FIXING, AND WHOSE FAULT IT IS
 *
 * `20261111_a_no_show_keeps_its_hour.sql` refused with TWO counts:
 *
 *     33 overlapping meeting pair(s) and 2 booking pair(s)
 *
 * `20261113_free_the_hours_a_no_show_shares.sql` addressed the first number
 * and not the second. It moved 17 rows in `scheduling_meetings` and left
 * `scheduling_bookings` untouched, so the migration refused again — this time
 * reading `0 overlapping meeting pair(s) and 2 booking pair(s)`.
 *
 * The two remaining pairs are not a separate problem. They are a DESYNC that
 * 20261113 created: a booking carries its own `start_time`, and for a single
 * appointment that time is a mirror of the meeting's. Moving the meeting and
 * leaving the booking row behind left each of these two pointing at an hour
 * its own meeting no longer occupies.
 *
 *     booking 06b2b635   row said 2026-10-28 07:00
 *       meeting e05d6ccf  now at 2026-10-25 07:00   (moved by 20261113)
 *
 *     booking d14f930f   row said 2026-11-03 11:00
 *       meeting 1ce56b36  now at 2026-11-01 11:00   (moved by 20261113)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT COPIES THE MEETING RATHER THAN NUDGING AGAIN
 *
 * Computing a fresh offset for the booking would clear the constraint and
 * leave the two tables disagreeing about when the appointment was — the
 * booking in one place, its meeting in another. The meeting is the authority
 * on WHEN (`SchedulingRepository.list` says so: a NULL there is not
 * "unscheduled", it is "the hours are on the meetings").
 *
 * So each booking is set to the span of its own surviving `no_show` meeting.
 * The target is read from the database rather than typed, which is why the
 * numbers above match 20261113's exactly: it is the same move, finished.
 *
 * Both rows are `eomer3@gmail.com` and `eomer3@walla.co.il`, both in the past,
 * both identical-span duplicates. No client of this business is involved.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ORDER: 20261113, then this, then the migration. Step 1 writes nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

-- ─── STEP 1: READ-ONLY. Each booking beside the meeting it should match. ────

SELECT
  b.id                AS booking_id,
  b.meeting_status,
  b.start_time        AS booking_says,
  m.id                AS its_meeting,
  m.start_time        AS meeting_says,
  b.start_time = m.start_time AS already_in_step
FROM public.scheduling_bookings AS b
JOIN public.scheduling_meetings AS m
  ON m.booking_id = b.id
 AND m.meeting_status = 'no_show'
WHERE b.id IN (
  '06b2b635-b1f1-4ce1-9d7b-2dc8b464309a'::uuid,
  'd14f930f-56d6-478e-a9ee-d9945b36c0c5'::uuid
)
ORDER BY b.start_time;

/*
 * Expect two rows, `already_in_step` false on both. True means this has
 * already run; nothing further is needed.
 */

-- ─── STEP 2: THE REPAIR. Read step 1 first. SAVE THE OUTPUT. ────────────────

BEGIN;

UPDATE public.scheduling_bookings AS b
   SET start_time = m.start_time,
       end_time   = m.end_time
  FROM public.scheduling_meetings AS m
 WHERE m.booking_id = b.id
   AND m.meeting_status = 'no_show'
   AND b.id IN (
     '06b2b635-b1f1-4ce1-9d7b-2dc8b464309a'::uuid,
     'd14f930f-56d6-478e-a9ee-d9945b36c0c5'::uuid
   )
   /* Only while they genuinely disagree, so re-running changes nothing. */
   AND b.start_time <> m.start_time
RETURNING b.id AS booking_id, b.start_time AS now_starts, b.end_time AS now_ends;

COMMIT;

/*
 * Expect 2 rows. Zero means they were already in step.
 *
 * Then re-run 20261111_a_no_show_keeps_its_hour.sql. Its guard should report
 * 0 and 0, and the two constraints go on.
 */

-- ─── STEP 3: UNDO. The spans these two held before 20261113. ────────────────
--
-- Restores the booking rows only. Undoing the MEETINGS is step 3 of 20261113,
-- and both must be undone together or the desync this script fixes comes back.
--
-- BEGIN;
--
-- UPDATE public.scheduling_bookings SET
--   start_time = timestamptz '2026-10-28T07:00:00+00:00',
--   end_time   = timestamptz '2026-10-28T08:00:00+00:00'
--  WHERE id = '06b2b635-b1f1-4ce1-9d7b-2dc8b464309a'::uuid;
--
-- UPDATE public.scheduling_bookings SET
--   start_time = timestamptz '2026-11-03T11:00:00+00:00',
--   end_time   = timestamptz '2026-11-03T12:00:00+00:00'
--  WHERE id = 'd14f930f-56d6-478e-a9ee-d9945b36c0c5'::uuid;
--
-- COMMIT;
