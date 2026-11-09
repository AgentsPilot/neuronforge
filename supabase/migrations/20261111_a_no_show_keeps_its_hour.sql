/*
 * A missed appointment keeps its hour.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * A no-show freed its slot. Both halves agreed on it — `holdsSlot`,
 * `MEETING_HOLDS_SLOT_FILTER` and these two constraints — so it was not drift;
 * it was a decision, and the decision was wrong.
 *
 * The hour was spent. The client booked it, the owner kept it clear and waited,
 * and nothing else could have filled it. Afterwards the platform described that
 * time as available, which is a day the business did not have.
 *
 * The money had already said so. A missed session is CHARGED —
 * `lib/scheduling/replacementCharge.ts` exists for that case, and
 * `makeUpSession.ts` keeps the missed row because "the missed hour stays
 * missed, which is the true record and the thing the money hangs on". An hour
 * the client has paid for cannot also be an hour we are selling to someone
 * else.
 *
 * The original argument for freeing it was that the owner, having just marked
 * the no-show, invites that client to pick another time while the old hour sits
 * blocked. That much is true and it does not follow: the time they pick is a
 * DIFFERENT hour, and the one they missed is in the past, where nothing can be
 * booked anyway. What freeing it actually bought was a hazard that
 * `syncMeeting` already describes — a FUTURE meeting left marked `no_show` read
 * as free, "so availability offers that hour to somebody else and two clients
 * arrive for it".
 *
 * `cancelled` and `moved` still free an hour, and keep their own meanings: the
 * work was called off, or the appointment is now elsewhere and this row is what
 * it left behind. Nobody waited and nobody is charged.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE APPLICATION HALF LANDS WITH THIS
 *
 * `MEETING_HOLDS_SLOT_FILTER` gains `meeting_status.eq.no_show` and `holdsSlot`
 * returns true for it, in the same commit. They are pinned to each other by
 * `lib/scheduling/__tests__/oneDefinitionOfATakenHour.guard.test.ts`, which
 * compares this SQL against that TypeScript as text — precisely so that one of
 * them cannot move without the other.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RUN THE PRECHECK FIRST
 *
 *     scripts/precheck-no-show-holds-its-hour.sql
 *
 * An hour readable as free could legitimately have been sold twice: the client
 * missed it, it went back on sale, somebody else took it. Both rows are correct
 * under the rule in force when they were written, and widening these
 * constraints makes the pair illegal. Postgres validates an EXCLUDE against
 * existing rows, so one such pair refuses the migration.
 *
 * Section 0 below refuses it FIRST, with the count and a pointer, rather than
 * letting a bare 23P01 from somewhere inside a gist index be the only
 * explanation. Nothing is half-applied either way — this is one transaction —
 * but a readable failure is the difference between a five-minute fix and an
 * afternoon.
 *
 * Rollback: 20261111_a_no_show_keeps_its_hour_rollback.sql
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

-- ─── 0. Refuse early, and say why ────────────────────────────────────────────

DO $$
DECLARE
  v_meetings integer;
  v_bookings integer;
BEGIN
  SELECT COUNT(*) INTO v_meetings
    FROM public.scheduling_meetings AS a
    JOIN public.scheduling_meetings AS b
      ON b.user_id = a.user_id
     AND b.id <> a.id
     AND tstzrange(b.start_time, b.end_time) && tstzrange(a.start_time, a.end_time)
   WHERE a.meeting_status = 'no_show'
     AND (b.meeting_status IS NULL OR b.meeting_status IN ('held', 'no_show'));

  SELECT COUNT(*) INTO v_bookings
    FROM public.scheduling_bookings AS a
    JOIN public.scheduling_bookings AS b
      ON b.user_id = a.user_id
     AND b.id <> a.id
     AND tstzrange(b.start_time, b.end_time) && tstzrange(a.start_time, a.end_time)
   WHERE a.meeting_status = 'no_show'
     AND a.status IN ('confirmed', 'pending', 'completed')
     AND a.start_time IS NOT NULL AND a.end_time IS NOT NULL
     AND a.end_time > a.start_time
     AND b.status IN ('confirmed', 'pending', 'completed')
     AND (b.meeting_status IS NULL OR b.meeting_status IN ('held', 'no_show'))
     AND b.start_time IS NOT NULL AND b.end_time IS NOT NULL
     AND b.end_time > b.start_time;

  IF v_meetings > 0 OR v_bookings > 0 THEN
    RAISE EXCEPTION
      'Cannot hold no-show hours yet: % overlapping meeting pair(s) and % booking pair(s) already share an hour with a no-show. Run scripts/precheck-no-show-holds-its-hour.sql to list them and resolve each before re-applying.',
      v_meetings, v_bookings;
  END IF;
END
$$;

-- ─── 1. The meetings table ───────────────────────────────────────────────────

ALTER TABLE public.scheduling_meetings
  DROP CONSTRAINT IF EXISTS scheduling_meetings_no_overlap;

ALTER TABLE public.scheduling_meetings
  ADD CONSTRAINT scheduling_meetings_no_overlap
  EXCLUDE USING gist (
    user_id WITH =,
    tstzrange(start_time, end_time) WITH &&
  )
  WHERE (
    /*
     * Positively what HOLDS, never `NOT IN (…)`. In SQL `NULL NOT IN (…)` is
     * NULL rather than true, so the negated form drops every unmarked
     * meeting — nearly all of them — and the whole diary becomes bookable.
     *
     * `no_show` joins `held` here: both record an hour that was spent, one
     * attended and one waited through, and neither may be written over
     * retrospectively.
     */
    meeting_status IS NULL OR meeting_status IN ('held', 'no_show')
  );

COMMENT ON CONSTRAINT scheduling_meetings_no_overlap ON public.scheduling_meetings IS
  'One hour, one meeting, per business. Holds for an unmarked, held or missed meeting — the hour was spent in all three — and releases for cancelled and moved. Mirrors scheduling_bookings_no_overlap and must stay in step with holdsSlot() and MEETING_HOLDS_SLOT_FILTER. Needed because a package is one booking with no time of its own, which the bookings constraint skips. A 23P01 from this means the hour went between the check and the write — tell the client it has gone, do not report a fault.';

-- ─── 2. The bookings mirror ──────────────────────────────────────────────────

ALTER TABLE public.scheduling_bookings
  DROP CONSTRAINT IF EXISTS scheduling_bookings_no_overlap;

ALTER TABLE public.scheduling_bookings
  ADD CONSTRAINT scheduling_bookings_no_overlap
  EXCLUDE USING gist (
    user_id WITH =,
    tstzrange(start_time, end_time) WITH &&
  )
  WHERE (
    status IN ('confirmed', 'pending', 'completed')
    /* The meeting's own answer, matching `holdsSlot`. An appointment that was
       called off or moved does not hold its time; one that was missed does,
       because the hour was kept for it and is charged for. */
    AND (meeting_status IS NULL OR meeting_status IN ('held', 'no_show'))
    AND start_time IS NOT NULL
    AND end_time IS NOT NULL
    AND end_time > start_time
  );

COMMENT ON CONSTRAINT scheduling_bookings_no_overlap ON public.scheduling_bookings IS
  'One slot, one booking, per business. Covers SLOT_HOLDING_STATUSES whose meeting was not called off or moved — the same rule as holdsSlot() and MEETING_HOLDS_SLOT_FILTER, which this must stay in step with. Skips bookings with no times (products) and any inverted range. A 23P01 from this means the slot was taken between the check and the write — tell the client it has gone, do not report a fault.';

COMMENT ON COLUMN public.scheduling_meetings.meeting_status IS
  'The meeting''s own outcome: held, no_show, cancelled, or moved. NULL means nobody has said yet, which is the normal state of a future appointment and reads as HOLDING its hour. held and no_show also hold it: the hour was spent either way, and a missed session is charged. cancelled and moved release it. `moved` is system-written by syncMeeting on the attempt a reschedule supersedes, and is distinct from cancelled so that a reschedule is never counted as a lost client.';

COMMIT;
