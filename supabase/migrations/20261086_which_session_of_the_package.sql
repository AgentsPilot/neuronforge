/*
 * Which SESSION of the package, kept apart from which ATTEMPT at it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE COLUMN WAS BEING ASKED TWO QUESTIONS
 *
 * `occurrence_number` counts ATTEMPTS. #2 is the same appointment at a new
 * time, written when the clock moves, and it supersedes #1 — that is what
 * `syncMeeting` means by it and what 20261085 reads to free an abandoned hour.
 *
 * A package made it mean something else as well. Six sessions on one booking
 * numbered 1..6 are six DIFFERENT appointments, all still to happen, and none
 * supersedes another. Nothing on the row said which meaning applied: only the
 * booking did, by whether it had a clock of its own.
 *
 * Two things broke on that ambiguity, and the second is the reason for this
 * column rather than a comment:
 *
 *   1. 20261085's backfill would stamp sessions 1..5 `moved` and put five of a
 *      client's six booked hours back on sale. Fixed there by excluding
 *      bookings with no clock — necessary, and not sufficient.
 *
 *   2. A package session could not be MOVED at all. Under the old shape each
 *      session was its own booking, so rescheduling one was an ordinary
 *      reschedule. With six meetings on one booking, writing attempt #2 of
 *      session 3 would land on the number session 4 already uses, and the
 *      sessions would renumber themselves.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SO THE TWO QUESTIONS GET TWO COLUMNS
 *
 *   `session_number`    which appointment of the package this is. NULL on an
 *                       ordinary booking, which has one.
 *   `occurrence_number` which attempt at THAT appointment. Unchanged, and it
 *                       keeps every meaning it already had.
 *
 * Moving session 3 therefore writes `session_number = 3, occurrence_number = 2`
 * and stamps the old row `moved`. The hour goes back on sale, the time already
 * emailed to the client survives in the journey, and sessions 1, 2, 4, 5 and 6
 * are untouched. That is the same mechanism a single meeting already uses,
 * applied one session at a time.
 *
 * Nullable and additive: every existing row keeps answering exactly as before,
 * and nothing has to be backfilled. An ordinary booking's meetings have no
 * session, which is the truth about them.
 *
 * Plan: docs/workplans/PACKAGE_MEETINGS_PHASE_5.md
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

ALTER TABLE public.scheduling_meetings
  ADD COLUMN IF NOT EXISTS session_number integer;

COMMENT ON COLUMN public.scheduling_meetings.session_number IS
  'Which appointment of a package this is, counted from the order sold. NULL on an ordinary booking, which has exactly one appointment. Kept separate from occurrence_number, which counts ATTEMPTS at this one appointment and is what a reschedule increments: moving session 3 writes session_number 3, occurrence_number 2. Collapsing the two renumbers a package''s sessions the first time one of them is moved, and makes session 2 look like it supersedes session 1.';

/*
 * The read every package surface makes: this job's sessions, in the order
 * sold. Partial, because it answers nothing about an ordinary booking and
 * those are the overwhelming majority of the table.
 */
CREATE INDEX IF NOT EXISTS idx_meetings_session
  ON public.scheduling_meetings (booking_id, session_number, occurrence_number)
  WHERE session_number IS NOT NULL;

COMMIT;
