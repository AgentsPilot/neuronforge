/*
 * Moving a meeting has to release the old hour and take the new one TOGETHER.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS FIXES, WHICH 20261085 INTRODUCED
 *
 * A move writes a SECOND attempt and stamps the first `moved`, in that order,
 * so that a refused insert leaves the old hour still held rather than freeing a
 * time nothing has replaced.
 *
 * That order cannot survive an exclusion constraint. The attempt being left
 * behind still holds its hour while the new one is written, so a 60-minute
 * appointment moved 30 minutes lands ON TOP OF ITSELF and
 * `scheduling_meetings_no_overlap` refuses it — correctly, by its own rule.
 *
 * Proved against the live database: an existing unmarked attempt at 14:30–15:30
 * refused a second attempt at 15:00–16:00 with 23P01.
 *
 * What that cost: the BOOKING's own update succeeds — an exclusion constraint
 * never compares a row with itself — so the job takes the new time while the
 * meetings table keeps the old one. `syncMeeting` swallows the refusal as
 * non-blocking, by design, so nothing surfaces. The result is availability
 * blocking an hour the client was moved OFF, the new hour held by nothing at
 * all, and two clients able to book it. Every reschedule shorter than the
 * appointment's own length, on every booking in the product.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A FUNCTION AND NOT A REORDER
 *
 * Stamping first and inserting second avoids the self-overlap, but opens the
 * failure the original order existed to prevent: a refused insert would leave
 * the appointment holding no time whatsoever.
 *
 * Both have to happen or neither. A function body is one transaction, so the
 * release is rolled back with the insert it was for — which is the only way to
 * get both orderings' guarantees at once. PostgREST reaches it through `rpc()`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE TWO COLUMNS A SESSION'S CALENDAR EVENT NEEDS
 *
 * `scheduling_meetings` could record an event id but not which provider wrote
 * it, so a session's event could be created and never updated or deleted —
 * moving or cancelling one left a stale entry in the owner's diary. The
 * booking has carried both columns since calendar sync existed; these are the
 * same two.
 * ─────────────────────────────────────────────────────────────────────────────
 */

BEGIN;

-- ─── 1. A session's calendar event can be changed, not only created ─────────

ALTER TABLE public.scheduling_meetings
  ADD COLUMN IF NOT EXISTS calendar_sync_provider text;

ALTER TABLE public.scheduling_meetings
  ADD COLUMN IF NOT EXISTS calendar_sync_error text;

COMMENT ON COLUMN public.scheduling_meetings.calendar_sync_provider IS
  'Which calendar wrote external_calendar_event_id. Without it a session''s event could be created and never updated or deleted, because the update and delete paths look the event up by provider — so moving or cancelling one session left a stale entry in the owner''s diary.';

-- ─── 2. One step: release the old hour, take the new one ────────────────────

CREATE OR REPLACE FUNCTION public.move_meeting(
  p_meeting_id uuid,
  p_user_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_moved_by text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_old public.scheduling_meetings;
  v_new_id uuid;
BEGIN
  /*
   * Locked, so two moves of one appointment cannot both read occurrence #2 and
   * both write it. `(booking_id, occurrence_number)` is not unique — it cannot
   * be, since a package's sessions share a booking — so nothing else would
   * catch that.
   */
  SELECT * INTO v_old
    FROM public.scheduling_meetings
   WHERE id = p_meeting_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'meeting % not found for this owner', p_meeting_id
      USING ERRCODE = 'no_data_found';
  END IF;

  /*
   * Re-saving the same hour is not a move. Returning the row unchanged keeps
   * this safe to call from a path that cannot tell whether the time differs,
   * and matches what `syncMeeting` already decides for itself.
   */
  IF v_old.start_time = p_start AND v_old.end_time = p_end THEN
    RETURN v_old.id;
  END IF;

  /*
   * The attempt being left behind stops holding its hour FIRST, so the new
   * attempt does not collide with it. Safe only because of the transaction:
   * if the insert below is refused — the new hour genuinely taken by somebody
   * else — this release is rolled back with it and the appointment keeps the
   * time it had.
   *
   * Only an UNMARKED attempt. `held` and `no_show` are records of what
   * happened and keep saying it; `cancelled` already frees the hour.
   */
  IF v_old.meeting_status IS NULL THEN
    UPDATE public.scheduling_meetings
       SET meeting_status = 'moved'
     WHERE id = v_old.id;
  END IF;

  INSERT INTO public.scheduling_meetings (
    user_id,
    booking_id,
    start_time,
    end_time,
    timezone,
    /* The SAME session: a move is a new attempt at it, not a new session. */
    session_number,
    occurrence_number,
    /* Nobody has said what happened at an appointment that has not happened. */
    meeting_status,
    moved_by,
    created_at
  ) VALUES (
    v_old.user_id,
    v_old.booking_id,
    p_start,
    p_end,
    v_old.timezone,
    v_old.session_number,
    v_old.occurrence_number + 1,
    NULL,
    p_moved_by,
    now()
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.move_meeting(uuid, uuid, timestamptz, timestamptz, text) IS
  'Move one appointment: release the hour its current attempt holds and write the next attempt at the new hour, in one transaction. Both or neither — stamping first avoids a 60-minute meeting moved 30 minutes colliding with itself, and the transaction stops a refused insert from leaving the appointment holding no time at all. Scoped by user_id (CLAUDE.md rule 4). Raises 23P01 when the new hour is genuinely taken, which callers report as "that time has gone".';

GRANT EXECUTE ON FUNCTION public.move_meeting(uuid, uuid, timestamptz, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_meeting(uuid, uuid, timestamptz, timestamptz, text) TO authenticated;

COMMIT;
