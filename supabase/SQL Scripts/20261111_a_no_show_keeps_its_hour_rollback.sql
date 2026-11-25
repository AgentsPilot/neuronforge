/*
 * ROLLBACK for 20261111_a_no_show_keeps_its_hour.sql.
 *
 * Puts both exclusion constraints back to the rule 20261084 and 20261085 left
 * them with: `meeting_status IS NULL OR meeting_status = 'held'`, under which a
 * no-show frees its hour.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS DIRECTION CANNOT BE REFUSED
 *
 * It only ever RELAXES what is allowed, so no existing row can violate it. That
 * is also the warning: once this has run, an hour already marked `no_show` is
 * on sale again, and if anybody takes it the forward migration will refuse
 * until that pair is resolved. Run `scripts/precheck-no-show-holds-its-hour.sql`
 * before re-applying.
 *
 * APPLY THE APPLICATION HALF WITH IT. `MEETING_HOLDS_SLOT_FILTER` and
 * `holdsSlot` must come back to the same rule in the same deploy — revert the
 * commit, do not run this alone. A database that frees a no-show's hour while
 * the application holds it is the exact disagreement
 * `oneDefinitionOfATakenHour.guard.test.ts` was written to catch: the client is
 * offered an hour, and the write is refused with a 23P01 they cannot act on.
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

ALTER TABLE public.scheduling_meetings
  DROP CONSTRAINT IF EXISTS scheduling_meetings_no_overlap;

ALTER TABLE public.scheduling_meetings
  ADD CONSTRAINT scheduling_meetings_no_overlap
  EXCLUDE USING gist (
    user_id WITH =,
    tstzrange(start_time, end_time) WITH &&
  )
  WHERE (
    meeting_status IS NULL OR meeting_status = 'held'
  );

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
    AND (meeting_status IS NULL OR meeting_status = 'held')
    AND start_time IS NOT NULL
    AND end_time IS NOT NULL
    AND end_time > start_time
  );

COMMIT;
