-- ============================================================================
-- Automation #5: mark a meeting that has already happened as completed.
-- ============================================================================
--
-- WHY THIS ONE
--
-- An automation-coverage measurement across all six accounts on 2026-10-06
-- found that the platform can perform 0.4% of what owners actually do -- and
-- 0% on four of the six. The gap is not adoption: every automation that exists
-- is switched on for the reporting account. There are simply only four, and
-- almost nothing an owner does falls inside them.
--
-- Ranked by volume across accounts, the work nothing can take:
--
--     88  SCHEDULING_BOOKING_CREATED
--     75  SCHEDULING_SERVICE_UPDATED
--     52  SCHEDULING_BOOKING_COMPLETED   <-- this one
--     52  SCHEDULING_SERVICE_PUBLISHED
--     49  BUSINESS_BRANDING_UPDATED
--
-- `SCHEDULING_BOOKING_COMPLETED` is the best first candidate on every axis:
--
--   * pure toil -- the meeting happened, and somebody has to click to say so
--   * no judgement in it, so nothing is lost by the platform deciding
--   * NOTHING IS SENT TO A CLIENT, which makes it the lowest-risk automation
--     on the board: the worst case is a status an owner flips back
--   * the detection ALREADY EXISTS. `meeting_unmarked` has been a gap since it
--     was written (lib/business-os/gaps/definitions.ts), with a 12-hour
--     staleness window and `action: 'mark_meeting'`. The platform has been
--     finding this work and telling the owner to do it by hand.
--
-- So this migration does not add detection. It adds the hand-over.
--
-- OPT-IN, NOT ON BY DEFAULT
--
-- `DEFAULT false`, unlike `payment_reminder_enabled` which defaults true. This
-- automation WRITES TO THE OWNER'S OWN RECORDS rather than sending a message,
-- and a status changing without anyone asking is worse than an email nobody
-- minded. The advisor card asks; until it is answered the column stays false
-- and nothing happens.
--
-- IDEMPOTENT: both statements are guarded, so applying this twice is harmless.
-- ============================================================================

ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS auto_complete_meetings_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.business_profiles.auto_complete_meetings_enabled IS
  'Owner consent for automation #5: mark a confirmed booking completed once its start time has passed and the staleness window has elapsed. Opt-in (DEFAULT false) because it writes to the owner''s own records rather than sending anything. Added 2026-10-06.';

-- ---------------------------------------------------------------------------
-- The queue has to be able to hold the new kind.
--
-- `lead_responses.kind` carries a CHECK constraint listing the kinds, and
-- `20260923_meeting_reminder.sql` extended it the same way for
-- `meeting_reminder`. A row of an unlisted kind is rejected outright, so the
-- sweep would fail silently into its own catch and queue nothing at all.
--
-- The constraint is dropped and recreated rather than altered because Postgres
-- has no ALTER CHECK, and it is named explicitly so this is repeatable.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lead_responses_kind_check'
      AND conrelid = 'public.lead_responses'::regclass
  ) THEN
    ALTER TABLE public.lead_responses DROP CONSTRAINT lead_responses_kind_check;
  END IF;

  ALTER TABLE public.lead_responses
    ADD CONSTRAINT lead_responses_kind_check
    CHECK (kind IN (
      'invite',
      'chase',
      'invoice_chase',
      'intake_chase',
      'meeting_reminder',
      'meeting_complete'
    ));
END $$;
