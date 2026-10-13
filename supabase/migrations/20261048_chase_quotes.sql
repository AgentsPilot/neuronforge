-- ============================================================================
-- Automation #6: one reminder on a quote nobody has answered.
--
-- `quote_awaiting_client` was the only client-blocked gap in the registry with
-- nothing behind it. An unpaid invoice is chased on days 1/3/7, an outstanding
-- intake form after a day, an upcoming meeting before it happens — and an
-- unanswered quote reached nobody at all. Its only reader was the daily
-- briefing, which is opt-in and had sent nothing in thirty days.
--
-- That is the wrong one to have missed. An unpaid invoice is money already
-- earned; an unanswered quote is a sale still winnable, and it decays fastest.
--
-- OPT-IN (DEFAULT false), like every automation that writes to someone. This
-- one writes to a PROSPECT rather than a client, which is a further reason not
-- to default it on: the other chasers address somebody who already has a
-- relationship with the business.
--
-- IDEMPOTENT: every statement is guarded, so applying this twice is harmless.
-- ============================================================================

ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS chase_quotes_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.business_profiles.chase_quotes_enabled IS
  'Owner consent for automation #6: send ONE reminder on a quote still unanswered 72 hours after it was sent, asking whether the client needs more time or more information. Never a sequence — the queue dedupes per proposal, so a quote is followed up once and never again. Opt-in (DEFAULT false). Added 2026-10-10.';

-- ---------------------------------------------------------------------------
-- The queue has to be able to hold the new kind.
--
-- `lead_responses.kind` carries a CHECK constraint listing the kinds, and a row
-- of an unlisted kind is rejected outright — the sweep would fail into its own
-- catch and queue nothing at all, silently.
--
-- Dropped and recreated rather than altered, because Postgres has no ALTER
-- CHECK, and named explicitly so this is repeatable.
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
      'meeting_complete',
      'quote_chase'
    ));
END $$;
