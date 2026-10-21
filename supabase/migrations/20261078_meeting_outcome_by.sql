/*
 * WHO said what happened at an appointment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS MISSING TODAY
 *
 * `scheduling_bookings.cancelled_by` records who called a JOB off, and it is
 * the only attribution the scheduling side has. Nothing records who marked a
 * meeting held or missed, and nothing records attribution per ATTEMPT at all.
 *
 * That matters now that a booking has several attempts. "The client cancelled
 * the 13:00 and did not turn up for the 14:00" is a different story from "the
 * owner cancelled both", and the journey could not tell them apart — it could
 * only show the one `cancelled_by` on the booking, which describes the latest
 * cancellation and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BOTH TABLES, FOR THE SAME REASON `meeting_status` IS ON BOTH
 *
 * `syncMeeting` copies a booking's appointment fields onto its current attempt,
 * so a fact that must reach the attempt has to be writable on the booking. The
 * pair is temporary in exactly the way `meeting_status` is: Phase 5 drops the
 * booking copy once nothing reads it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BACKFILL IS DELIBERATELY NARROW
 *
 * CANCELLED meetings inherit `scheduling_bookings.cancelled_by`, which is a
 * recorded fact.
 *
 * HELD and NO_SHOW are left NULL, and that is the point. It is tempting to
 * assume the owner marked them, because the owner's drawer is where those
 * buttons are — but it is not the only writer. `LeadResponseDispatchService`
 * completes a booking automatically when a lead replies, and the plugin
 * executor marks outcomes for an agent. Writing `owner` across the board would
 * put a guess in a column that reads as a record, and the whole reason this
 * column exists is to stop the journey guessing.
 *
 * So: history says "nobody recorded who", which is true, and the journey shows
 * no attribution for those rows. Everything from now on carries the real actor.
 *
 * Plan: docs/workplans/BOOKING_MEETINGS_TABLE_PLAN.md (Phase 4c, attribution)
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

/*
 * `system` is a real value, not a placeholder: a lead reply that auto-completes
 * a booking was recorded by no person, and saying `owner` would blame one.
 */
ALTER TABLE public.scheduling_meetings
  ADD COLUMN IF NOT EXISTS outcome_by TEXT
  CHECK (outcome_by IS NULL OR outcome_by IN ('owner', 'client', 'system'));

ALTER TABLE public.scheduling_bookings
  ADD COLUMN IF NOT EXISTS outcome_by TEXT
  CHECK (outcome_by IS NULL OR outcome_by IN ('owner', 'client', 'system'));

/* Cancelled attempts: the booking already knows, so carry it across. */
UPDATE public.scheduling_meetings m
   SET outcome_by = b.cancelled_by,
       updated_at = now()
  FROM public.scheduling_bookings b
 WHERE b.id = m.booking_id
   AND m.meeting_status = 'cancelled'
   AND m.outcome_by IS NULL
   AND b.cancelled_by IS NOT NULL
   AND b.cancelled_by IN ('owner', 'client', 'system');

/* And the booking's own copy, which describes its current attempt. */
UPDATE public.scheduling_bookings b
   SET outcome_by = b.cancelled_by,
       updated_at = now()
 WHERE b.meeting_status = 'cancelled'
   AND b.outcome_by IS NULL
   AND b.cancelled_by IS NOT NULL
   AND b.cancelled_by IN ('owner', 'client', 'system');

COMMENT ON COLUMN public.scheduling_meetings.outcome_by IS
  'Who recorded this attempt''s outcome: owner, client, or system (an automation, with no person behind it). NULL where nobody recorded it — every held and no-show row predating 20261078, which were deliberately NOT backfilled because the owner is not the only writer and a guess here would read as a record.';

COMMENT ON COLUMN public.scheduling_bookings.outcome_by IS
  'Who recorded the CURRENT attempt''s outcome. Copied onto the attempt by syncMeeting; the pair is temporary in the same way meeting_status is. Distinct from cancelled_by, which is about the JOB rather than an appointment.';

COMMIT;
