-- When a contact entered the stage it is sitting in
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT WAS WRONG
--
-- Nothing recorded when a contact moved stage, so everything that asks "how
-- long has this person been stuck" measured from `updated_at` — how long since
-- the ROW was last touched by anything.
--
-- `ConvPipelineStuckDetector` is the main reader. Correcting a phone number,
-- adding a tag or saving a note reset its clock, so a contact genuinely parked
-- in `initial_consultation` for six weeks could read as freshly active and
-- never be reported. The detector partly compensates by also checking
-- `crm_activities` for recent movement, which catches the opposite error
-- (someone untouched but actually progressing) and does nothing for this one.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A TRIGGER
--
-- A stage change can arrive from the contact drawer, the Kanban board, the
-- chat's mutate path, BizQL, a plugin, an import or a direct service-role
-- write. Stamping it in `CRMContactRepository.update` would cover the first few
-- and silently miss the rest, and the ones it missed would look identical to a
-- contact who had genuinely just moved.
--
-- `updated_at` on this same table is already maintained exactly this way by
-- `update_crm_contacts_updated_at` (20260721), so this follows the precedent
-- rather than introducing a pattern.
--
-- This is NOT the kind of trigger that was removed in
-- 20260928_contact_delete_handled_in_app.sql. That one DELETED rows behind the
-- application's back on a rule no reader of the code could see. This one
-- derives a timestamp from the row being written and touches nothing else.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ONLY ON A REAL CHANGE
--
-- `OLD.stage IS DISTINCT FROM NEW.stage`. Saving the drawer re-sends every
-- field including the unchanged stage, so stamping on every write that merely
-- MENTIONS the stage would reproduce the bug this fixes. `IS DISTINCT FROM`
-- rather than `<>` because the column is nullable and `NULL <> NULL` is NULL,
-- which would skip the first stamp on a contact imported without one.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- BACKFILL
--
-- Existing rows get `updated_at`, which is the best available answer and no
-- worse than what every reader uses today. It is deliberately NOT left NULL:
-- a reader cannot tell "never recorded" from "entered the stage at an unknown
-- time", and NULL would make every pre-existing contact invisible to the
-- stuck detector the day this lands.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE crm_contacts
  ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ;

COMMENT ON COLUMN crm_contacts.stage_entered_at IS
  'When this contact entered its current stage. Maintained by trigger on a real stage change only. Readers should fall back to updated_at when NULL.';

-- Best available answer for rows that predate the column. See BACKFILL above.
UPDATE crm_contacts
  SET stage_entered_at = COALESCE(updated_at, created_at)
  WHERE stage_entered_at IS NULL;

-- ── The stamp ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.stamp_crm_contact_stage_entered_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  /*
   * INSERT: the contact enters its first stage now.
   *
   * COALESCE so an import carrying a known history can supply its own value
   * and keep it. Overwriting that would make every migrated contact look like
   * it arrived the day the import ran.
   */
  IF TG_OP = 'INSERT' THEN
    NEW.stage_entered_at := COALESCE(NEW.stage_entered_at, now());
    RETURN NEW;
  END IF;

  -- UPDATE: only when the stage itself actually moved.
  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    NEW.stage_entered_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_crm_contacts_stage_entered_at ON crm_contacts;

/*
 * BEFORE, so the value is written as part of the same row rather than needing a
 * second UPDATE — which would re-fire this trigger and the `updated_at` one.
 */
CREATE TRIGGER stamp_crm_contacts_stage_entered_at
  BEFORE INSERT OR UPDATE ON crm_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_crm_contact_stage_entered_at();

-- The stuck detector scans by stage and age together.
CREATE INDEX IF NOT EXISTS idx_crm_contacts_stage_entered_at
  ON crm_contacts (user_id, stage, stage_entered_at);
