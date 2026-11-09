-- Rollback for 20261112_moving_a_makeup_keeps_its_lineage.sql
--
-- Restores `move_meeting` exactly as 20261087 left it: the INSERT drops
-- `replaces_meeting_id` again, so a moved make-up once more stops being a
-- make-up and its replacement can be billed for an hour the client has already
-- paid for. That is the defect, not a side effect, so this is a last resort.
--
-- `CREATE OR REPLACE` preserves the EXECUTE grants either way.
--
-- Rows written WHILE 20261109 was live keep their inherited link. Nothing
-- undoes that and nothing should: the link is a true statement about what the
-- session stands in for, and every reader of it treats a present link as more
-- information rather than different information.

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
  v_old public.scheduling_meetings;
  v_new_id uuid;
BEGIN
  SELECT * INTO v_old
    FROM public.scheduling_meetings
   WHERE id = p_meeting_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'meeting % not found for this owner', p_meeting_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_old.start_time = p_start AND v_old.end_time = p_end THEN
    RETURN v_old.id;
  END IF;

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
    session_number,
    occurrence_number,
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

COMMIT;
