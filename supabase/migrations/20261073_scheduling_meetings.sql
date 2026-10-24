/*
 * A meeting gets its own row.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 *
 * `20261072` gave the meeting its own STATE. It did not give it its own ROW, so
 * a booking still holds exactly one meeting: a reschedule overwrites the
 * previous attempt, and three no-shows are indistinguishable from one.
 *
 * The booking is the JOB. A meeting is an APPOINTMENT within it, and a job may
 * have several — a package of six sessions, or one consultation the client
 * missed twice before turning up.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A NARROW TABLE AND NOT MORE BOOKINGS
 *
 * The obvious move is "one child booking per meeting". `scheduling_bookings` is
 * THIRTY-SEVEN columns wide — intake JSONB, calendar sync, payment ids, cancel
 * fields, booking source — and a meeting needs about twelve of them. Spawning a
 * child booking per meeting would roughly double the row count of the widest
 * table in the system, each row carrying twenty-five columns it will never use.
 *
 * This does the opposite. Package meetings ALREADY live in
 * `scheduling_bookings` today at full width, so migrating them out makes the
 * wide table smaller. At a million meetings that difference is the whole
 * argument.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING READS THIS YET, AND THAT IS DELIBERATE
 *
 * This migration creates the table and backfills it. Every reader still asks
 * `scheduling_bookings`, and the application keeps writing times there. The
 * rows here are a shadow copy until the readers move, one at a time, each with
 * its own test.
 *
 * So this is reversible by dropping the table. Nothing depends on it.
 *
 * TWO THINGS DELIBERATELY NOT DONE HERE:
 *
 *   · The OVERLAP CONSTRAINT stays on `scheduling_bookings`. It is what stops
 *     two clients booking one slot, availability still reads bookings, and
 *     moving the guard before the readers would leave the real check on a table
 *     nobody is asking. It comes across when availability does.
 *
 *   · `payment_plan_installments.meeting_id` is NOT added. An instalment today
 *     binds to a child booking — that is how "bill after session 3" finds its
 *     session — and repointing it is its own migration, after this one, while
 *     `booking_id` is still valid. Doing both at once would leave the money
 *     with no correct answer for the time in between.
 *
 * Plan: docs/workplans/BOOKING_MEETINGS_TABLE_PLAN.md (Phase 1)
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

CREATE TABLE IF NOT EXISTS public.scheduling_meetings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  /*
   * Carried rather than joined. Every query here is "this owner's meetings",
   * and CLAUDE.md rule 4 wants `.eq('user_id', userId)` reachable without a
   * join to the parent — a filter that depends on a join is a filter somebody
   * eventually forgets.
   */
  user_id     uuid NOT NULL,

  /* The JOB this appointment belongs to. Cascade: a deleted booking has no
     meetings left to describe. */
  booking_id  uuid NOT NULL REFERENCES public.scheduling_bookings(id) ON DELETE CASCADE,

  start_time  timestamptz NOT NULL,
  end_time    timestamptz NOT NULL,
  /* The zone the appointment was agreed in, for display. Instants above are
     absolute and need none. */
  timezone    text,

  /*
   * What happened AT THIS APPOINTMENT.
   *
   * NULL means nobody has said yet, which is the ordinary state of a past
   * meeting — owners quote from the van and rarely tick one first. It is not
   * "did not happen", and the three values below are the only answers.
   */
  meeting_status text,

  /* Which of the N this is. 1 for a booking with a single appointment. */
  occurrence_number integer NOT NULL DEFAULT 1,

  /*
   * PER APPOINTMENT, not per job: each occurrence is its own entry in the
   * owner's calendar and earns its own reminders. A package of six is six
   * calendar events and six reminder pairs, which is exactly why these cannot
   * stay on the booking.
   */
  external_calendar_event_id text,
  calendar_synced_at   timestamptz,
  reminder_24hr_sent   boolean NOT NULL DEFAULT false,
  reminder_2hr_sent    boolean NOT NULL DEFAULT false,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

/* Named, so a refusal says which value was rejected. NULL passes: the check is
   about what a WRITTEN value may be. */
ALTER TABLE public.scheduling_meetings
  DROP CONSTRAINT IF EXISTS scheduling_meetings_status_check;

ALTER TABLE public.scheduling_meetings
  ADD CONSTRAINT scheduling_meetings_status_check
  CHECK (meeting_status IS NULL OR meeting_status IN ('held', 'no_show', 'cancelled'));

/* An appointment cannot end before it starts. The booking table has no such
   guard and has rows to prove it; a new table can start clean. */
ALTER TABLE public.scheduling_meetings
  DROP CONSTRAINT IF EXISTS scheduling_meetings_time_order_check;

ALTER TABLE public.scheduling_meetings
  ADD CONSTRAINT scheduling_meetings_time_order_check
  CHECK (end_time > start_time);

/*
 * The two questions this table is asked, and nothing else:
 *   "this owner's meetings in this window"  — every calendar, every availability check
 *   "this job's meetings"                   — the journey, the client's portal
 */
CREATE INDEX IF NOT EXISTS idx_meetings_user_time
  ON public.scheduling_meetings (user_id, start_time);

CREATE INDEX IF NOT EXISTS idx_meetings_booking
  ON public.scheduling_meetings (booking_id, occurrence_number);

/*
 * Partial, for the question the chasers ask: which appointments are still
 * unanswered. The marked ones are the majority over time and are never the
 * subject of that search.
 */
CREATE INDEX IF NOT EXISTS idx_meetings_unmarked
  ON public.scheduling_meetings (user_id, start_time)
  WHERE meeting_status IS NULL;

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BACKFILL
 *
 * One meeting per booking that has a time. A booking with no `start_time` is a
 * service that is bought rather than booked — a course, a product — and has no
 * appointment to record.
 *
 * `occurrence_number` comes from the booking where it has one (a package child
 * already carries it) and is 1 otherwise.
 *
 * Guarded by NOT EXISTS so re-running this migration cannot double the rows.
 * ─────────────────────────────────────────────────────────────────────────────
 */
INSERT INTO public.scheduling_meetings (
  user_id, booking_id, start_time, end_time, timezone,
  meeting_status, occurrence_number,
  external_calendar_event_id, calendar_synced_at,
  reminder_24hr_sent, reminder_2hr_sent,
  created_at
)
SELECT
  b.user_id,
  b.id,
  b.start_time,
  /* A row with no end is given its start plus an hour rather than being
     skipped: the time-order check would refuse NULL, and a meeting with no
     recorded end is still a meeting that happened. */
  COALESCE(b.end_time, b.start_time + interval '1 hour'),
  b.timezone,
  b.meeting_status,
  COALESCE(b.occurrence_number, 1),
  b.external_calendar_event_id,
  b.calendar_synced_at,
  COALESCE(b.reminder_24hr_sent, false),
  COALESCE(b.reminder_2hr_sent, false),
  b.created_at
FROM public.scheduling_bookings b
WHERE b.start_time IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.scheduling_meetings m WHERE m.booking_id = b.id
  );

COMMENT ON TABLE public.scheduling_meetings IS
  'One APPOINTMENT. The booking it belongs to is the JOB, which may have several — a package of sessions, or a consultation missed before it was held. Nothing read this at creation (20261073); readers move one at a time.';

COMMENT ON COLUMN public.scheduling_meetings.meeting_status IS
  'What happened at this appointment. NULL means nobody has said yet, which is the ordinary state of a past meeting. held | no_show | cancelled.';

COMMIT;
