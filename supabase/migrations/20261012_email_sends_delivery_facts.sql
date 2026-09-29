-- The eight states a sent email can actually be in, enforced by the database —
-- and the trigger fix that has to land with it.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1: `complained` IS A REAL STATUS AND THE SCHEMA NEVER SAID SO
--
-- `email_sends.status` was created as:
--
--     status TEXT DEFAULT 'pending'  -- 'pending','sent','delivered','opened',
--                                    -- 'clicked','bounced','failed'
--
-- A comment listing seven values, and nothing else. Meanwhile
-- `app/api/webhooks/resend/route.ts` writes an EIGHTH — `complained` — when a
-- recipient marks mail as spam. The column is TEXT with no constraint, so
-- Postgres stored it and every type that described the column was wrong.
--
-- What that cost, all of it live before this migration:
--
--   * `crm.email.status.complained` had no translation in any of the three
--     locales, and `t()` returns the KEY on a miss. The guard around it,
--     `t(...) || email.status`, cannot fire — a key is a truthy string — so the
--     first spam complaint rendered a badge reading the raw key at the user.
--   * `buildJourneySteps` in `CRMContactDrawerV2` matched `complained` against
--     no branch of its status ladder and fell through to a `: 'completed'`
--     default, painting a spam complaint as a green tick on the booking journey.
--   * `BookingConfirmationEmail.status` omitted it, which is precisely why the
--     compiler could not catch the line above.
--
-- A constraint would have made the first write fail loudly instead. The roster
-- now lives in `lib/business-os/emailSendStatus.ts`, which this list must match.
--
-- `delivered`, `opened` and `clicked` stay in the CHECK even though nothing
-- writes them: the webhook records those three as TIMESTAMPS and deliberately
-- leaves `status` alone, because a delivered email is still, accurately, one
-- that was sent. Excluding them would reject any future decision to promote a
-- status without another migration.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE stray TEXT;
BEGIN
  -- Refuse rather than silently drop a row that does not fit. All 87 rows on
  -- this database read 'sent', so this is expected to pass; it exists so that
  -- the migration cannot quietly discard a value somebody is relying on.
  SELECT string_agg(DISTINCT status, ', ') INTO stray
    FROM email_sends
   WHERE status IS NOT NULL
     AND status NOT IN (
       'pending','sent','delivered','opened','clicked','bounced','complained','failed'
     );

  IF stray IS NOT NULL THEN
    RAISE EXCEPTION
      'email_sends.status holds values outside the roster: %. Add them to lib/business-os/emailSendStatus.ts and to this CHECK, or correct the rows, then re-run.', stray;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_sends_status_check'
  ) THEN
    ALTER TABLE email_sends
      ADD CONSTRAINT email_sends_status_check
      CHECK (status IN (
        'pending','sent','delivered','opened','clicked','bounced','complained','failed'
      ));
  END IF;
END $$;

COMMENT ON COLUMN email_sends.status IS
  'One of the values in lib/business-os/emailSendStatus.ts (EMAIL_SEND_STATUSES), enforced by email_sends_status_check. `bounced` and `complained` are terminal and are NOT the same thing: a bounce is a broken address, a complaint is a working address whose owner did not want the mail. `delivered`/`opened`/`clicked` are recorded as timestamps and do not rewrite this column.';

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2: `contact_id` MAY BE NULL — AND THE TRIGGER HAS TO LEARN THAT FIRST
--
-- Owner-facing mail — a daily briefing, a dispute alert, a lead notification —
-- belongs to no client, so it could not be recorded at all while this column was
-- NOT NULL. That is why fourteen of the fifteen senders on this platform wrote
-- no `email_sends` row, and why a delivery event for any of them can only ever
-- resolve to "no row carries this message id".
--
-- DROPPING THE CONSTRAINT ALONE IS NOT SAFE.
--
-- `log_email_activity_trigger` fires `AFTER INSERT OR UPDATE OF status` and, when
-- the row reads `sent`, inserts into `crm_activities` — whose own `contact_id` is
-- itself NOT NULL (20260722_create_crm_tables.sql). So the first owner-mail
-- insert would violate THAT constraint, and because the trigger runs inside the
-- same transaction it would roll the whole `email_sends` insert back. Owner mail
-- would not merely go unrecorded; the send would throw.
--
-- So the function is replaced in the same migration, guarded on the column that
-- is about to become nullable. A CRM activity for mail that belongs to no
-- contact has nowhere to appear anyway — contact timelines filter on
-- `contact_id`, so a NULL row is correctly invisible in all of them.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION log_email_activity()
RETURNS TRIGGER AS $$
DECLARE
  activity_title TEXT;
  activity_desc TEXT;
BEGIN
  -- `NEW.contact_id IS NOT NULL` first: owner mail has no contact to log
  -- against, and crm_activities.contact_id is NOT NULL. Without this guard the
  -- insert below aborts the caller's transaction.
  IF NEW.contact_id IS NOT NULL
     AND NEW.status = 'sent'
     AND (OLD IS NULL OR OLD.status != 'sent') THEN
    activity_title := 'Email Sent: ' || NEW.subject;

    IF NEW.sequence_id IS NOT NULL THEN
      activity_desc := 'Automated email from sequence';
    ELSIF NEW.campaign_id IS NOT NULL THEN
      activity_desc := 'Campaign email';
    ELSE
      activity_desc := 'Manual email';
    END IF;

    INSERT INTO crm_activities (
      user_id,
      contact_id,
      activity_type,
      title,
      description,
      auto_logged,
      source_capability,
      source_entity_id,
      activity_date
    ) VALUES (
      NEW.user_id,
      NEW.contact_id,
      'email',
      activity_title,
      activity_desc,
      true,
      'email_automation',
      NEW.id,
      NEW.sent_at
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE email_sends ALTER COLUMN contact_id DROP NOT NULL;

COMMENT ON COLUMN email_sends.contact_id IS
  'NULL means the mail went to the business OWNER, not to a client — a briefing, a dispute alert. Client-scoped queries filter on this column, so a NULL row appears in no contact timeline, which is the point. Dashboard counts that mean "business activity" must exclude owner mail; see app/api/business-os/stats/route.ts. The log_email_activity trigger is guarded on this being NOT NULL because crm_activities.contact_id is itself NOT NULL.';

-- `user_id` stays NOT NULL. It is the tenant boundary, and nothing here relaxes
-- it: every row still belongs to exactly one account.
