/*
 * WHO moved the appointment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE JOURNEY WAS ASSERTING SOMETHING IT DID NOT KNOW
 *
 * The rail draws a line between two attempts and labels it "שינית את המועד" —
 * YOU changed the time. Nothing backed that. The line is inferred from the
 * attempt sequence alone, so it said "you" for every move, including the ones
 * the client made themselves from the public booking portal.
 *
 * Reported on booking 9cf12726, moved by the client on 18 Oct: the owner read
 * a card telling them they had done something they had not, with no way to see
 * that the client had asked for the new time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ON THE ATTEMPT THE MOVE CREATED
 *
 * An attempt exists because something put it there. For the first one that is
 * the booking itself; for every later one it is a move, and this records who
 * made it. So the line at the END of attempt #1 is read from attempt #2's
 * `moved_by` — the move that produced it.
 *
 * NULL means nobody recorded it, which is every row written before this
 * migration and every attempt #1. The journey says "המועד שונה" there — the
 * move happened, and it does not claim an actor. That is deliberately NOT
 * backfilled to 'owner': assuming the owner is precisely the bug.
 *
 * Shares the vocabulary of `outcome_by` (20261078) on purpose. Two columns
 * answering "which side did this" should not disagree about what the sides are
 * called.
 *
 * Plan: docs/workplans/BOOKING_MEETINGS_TABLE_PLAN.md (Phase 4e)
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

ALTER TABLE public.scheduling_meetings
  ADD COLUMN IF NOT EXISTS moved_by text
  CHECK (moved_by IS NULL OR moved_by IN ('owner', 'client', 'system'));

COMMENT ON COLUMN public.scheduling_meetings.moved_by IS
  'Who caused this attempt to exist, for attempts created by a reschedule: owner, client or system. NULL on attempt #1 (the booking created it, not a move) and on every row predating 20261082. Deliberately not backfilled — the journey labelled every move as the owner''s, and guessing the same thing again in the data would make the error permanent. Read by the contact drawer for the line between two attempts.';

COMMIT;
