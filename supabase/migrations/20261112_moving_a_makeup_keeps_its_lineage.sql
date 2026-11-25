-- Moving a make-up must not erase what it makes up for.
--
-- ---------------------------------------------------------------------------
-- THE BUG THIS CLOSES, AND THE MONEY IT MOVED
--
-- `move_meeting` (20261087) writes the next attempt at a session by copying the
-- old row's facts: user, booking, timezone, session number. It does NOT copy
-- `replaces_meeting_id` (20261097), the column that says "this hour stands in
-- for one that was missed".
--
-- So a MAKE-UP that is moved stops being a make-up. Measured on a live account
-- (package 83e8460c):
--
--   session 1          no_show, CHARGED, client paid 399.99, invoice raised
--   session 5 occ 1    the make-up, replaces session 1, carries NO stage
--                      (correct: that hour's money is already in)
--   session 5 occ 2    written by a move. replaces_meeting_id = NULL
--   session 6          booked to replace occ 2, and billed 400.02
--
-- The client paid twice for one delivered hour. Every guard that should have
-- caught it reads `replaces_meeting_id`: `chargeIfSoldPerSession` in
-- `lib/scheduling/makeUpSession.ts` reads the replaced hour's stage, and the
-- shared rule that now backs it (`replacedHourAlreadyPaid`) walks the chain.
-- With the link erased, both of them look at an ordinary session and bill it.
--
-- ---------------------------------------------------------------------------
-- WHAT CHANGES
--
-- One column in one INSERT. The function is otherwise byte-for-byte what
-- 20261087 left: same signature, same lock, same early return for a no-op
-- move, same `moved` stamp on an UNMARKED attempt only, same transaction.
--
-- Its security properties are deliberately unchanged too — no `SECURITY
-- DEFINER`, no pinned `search_path` — because this migration exists to carry
-- one column, and changing how the function resolves its tables would be a
-- second change hiding behind the first. `CREATE OR REPLACE` preserves the
-- EXECUTE grants 20261087 made (service_role, authenticated).
--
-- A move is a new ATTEMPT at the same session, so everything that was true of
-- the session is still true: it is the same session number, and it still stands
-- in for the same missed hour. That is the whole argument for the column.
--
-- ---------------------------------------------------------------------------
-- EXISTING ROWS ARE NOT TOUCHED HERE
--
-- Rows already written by a move carry NULL and keep it. Restoring their
-- lineage is a DATA change with a different risk profile, so it is a separate
-- opt-in script the owner runs once and can read the count of first:
--
--   supabase/SQL Scripts/20261109_restore_moved_makeup_lineage_data.sql
--
-- ---------------------------------------------------------------------------
-- TIMING: either side of the deploy. The deployed code reads this column and
-- never writes it through this function, so a row that starts carrying it is
-- strictly more correct to every existing reader.
--
-- Pre-check: scripts/precheck-makeup-lineage.sql
-- Checker:   scripts/check-makeup-lineage-migration.sql
-- Rollback:  supabase/SQL Scripts/20261112_moving_a_makeup_keeps_its_lineage_rollback.sql
-- ---------------------------------------------------------------------------

BEGIN;

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
  -- stamp 20261109 c4e8b1f07d3a6295
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
    /*
     * And the same thing it stands in for.
     *
     * Omitted until 20261109, which is how a moved MAKE-UP stopped being a
     * make-up: the hour it replaced had already been paid for, the link was
     * the only record of that, and the next replacement was billed a second
     * time. A new attempt at a session inherits what the session is for.
     */
    replaces_meeting_id,
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
    v_old.replaces_meeting_id,
    NULL,
    p_moved_by,
    now()
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.move_meeting(uuid, uuid, timestamptz, timestamptz, text) IS
  'Move one appointment: release the hour its current attempt holds and write the next attempt at the new hour, in one transaction. Both or neither — stamping first avoids a 60-minute meeting moved 30 minutes colliding with itself, and the transaction stops a refused insert from leaving the appointment holding no time at all. The new attempt inherits replaces_meeting_id (20261109): a moved make-up still stands in for the hour it was booked for, and that link is what stops its own replacement being billed for an hour the client already paid. Scoped by user_id (CLAUDE.md rule 4). Raises 23P01 when the new hour is genuinely taken, which callers report as "that time has gone".';

COMMIT;
