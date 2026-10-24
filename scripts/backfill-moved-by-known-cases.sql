/*
 * Set `moved_by` where a PERSON knows who moved it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS NO DERIVED BACKFILL, AND WHY THIS SCRIPT IS A LIST
 *
 * `moved_by` (20261082) records which side asked for a new time. Nothing
 * recorded it before that migration, and the question was asked of every other
 * store before this script was written:
 *
 *   · `crm_activities.booking_rescheduled` carries only
 *     `{kind, from, to, timeZone}`. No actor.
 *   · `audit_trail.SCHEDULING_BOOKING_RESCHEDULED` carries `actor_id` — and on
 *     the client's own move it holds the OWNER's id. `rescheduleBooking` is
 *     called with `userId: booking.user_id`, and the public token route has no
 *     logged-in user, so the audit row asserts the owner did it. Checked on
 *     booking 9cf12726: actor_id = user_id = the owner, for a move the client
 *     made. (That misattribution is a defect in its own right.)
 *   · `scheduling_bookings.booking_source` says how the booking was CREATED.
 *     It says nothing about a later move.
 *
 * So the database cannot answer it, and a query that appeared to would only be
 * re-deriving the same assumption the column exists to replace: that every
 * move was the owner's. Writing that into the data would make the error
 * permanent and indistinguishable from a recorded fact.
 *
 * What remains is testimony. Each row below is here because somebody who was
 * there said so, and the comment records who and when. That is a weaker kind
 * of evidence than a recorded one, and keeping it to an explicit list is how it
 * stays visible as such.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ADDING A ROW
 *
 * Only on a direct statement about a specific booking. Never from a pattern,
 * never in bulk. An attempt nobody can speak to keeps NULL, and the journey
 * says "the time was changed" without naming a side — which is true.
 *
 * Run section 1 first and check the move is the one being described.
 * ─────────────────────────────────────────────────────────────────────────────
 */

-- ── 1. What is about to change, and the move it describes ──────────────────
SELECT
  m.booking_id,
  m.occurrence_number,
  m.start_time        AS moved_to,
  prev.start_time     AS moved_from,
  m.created_at        AS moved_at,
  m.moved_by          AS recorded_now
FROM public.scheduling_meetings m
LEFT JOIN public.scheduling_meetings prev
       ON prev.booking_id = m.booking_id
      AND prev.occurrence_number = m.occurrence_number - 1
WHERE (m.booking_id, m.occurrence_number) IN (
  /* The client rebooked themselves from the public portal on 18 Oct 2026,
     20 Oct 10:00 → 21 Oct 10:00. Owner-reported, same day. */
  ('9cf12726-3f98-4da5-9a57-02cd21b7539e', 2)
);


-- ── 2. The attribution ──────────────────────────────────────────────────────
BEGIN;

UPDATE public.scheduling_meetings m
   SET moved_by   = v.moved_by,
       updated_at = now()
  FROM (VALUES
    /* booking_id, occurrence_number, who */
    ('9cf12726-3f98-4da5-9a57-02cd21b7539e'::uuid, 2, 'client')
  ) AS v(booking_id, occurrence_number, moved_by)
 WHERE m.booking_id = v.booking_id
   AND m.occurrence_number = v.occurrence_number
   /* Never overwrite something already recorded: from here on the application
      writes this column itself, and it was there. */
   AND m.moved_by IS NULL;

COMMIT;


-- ── 3. Confirm ──────────────────────────────────────────────────────────────
SELECT booking_id, occurrence_number, start_time, moved_by
  FROM public.scheduling_meetings
 WHERE moved_by IS NOT NULL
 ORDER BY created_at DESC;
