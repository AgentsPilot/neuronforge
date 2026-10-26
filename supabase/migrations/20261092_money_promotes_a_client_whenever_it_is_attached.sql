-- ─────────────────────────────────────────────────────────────────────────────
-- A client who paid becomes a client, even when the payment is attached late.
--
-- WHAT WAS WRONG
--
-- `promote_contact_on_payment_trigger` (20260920) is declared:
--
--   AFTER INSERT OR UPDATE OF status ON payment_transactions
--   WHEN (NEW.status = 'succeeded' AND NEW.amount > 0 AND NEW.contact_id IS NOT NULL)
--
-- Both halves are right for a payment that already knows its contact. For a
-- SMART LINK they never coincide:
--
--   the client pays before any booking or contact exists, so the webhook's
--   transaction row is INSERTed with `contact_id` NULL and the WHEN clause is
--   false; the contact is then attached seconds later by an UPDATE of
--   `contact_id` — which this trigger does not listen for, because it watches
--   `status` alone.
--
-- So the trigger never ran for a website sale, and `stage_type = 'client'` was
-- unreachable through payment. Measured, 2026-10-25: contact fc2b2153 created
-- 21:54:13 on `inquiry`; transaction 3da56294 (ILS 150, succeeded) attached to
-- it at 21:54:15; the contact's `updated_at` never moved off its creation time.
--
-- THE FIX
--
-- Fire on `contact_id` as well. The WHEN clause is unchanged and still decides
-- everything — succeeded, above zero, against a known contact — so the moment
-- the contact is attached is simply another moment at which that test can
-- become true.
--
-- `status` stays in the list: a row INSERTed pending and later UPDATEd to
-- succeeded is the invoice path, and it still has to promote.
--
-- Safe to fire more than once. `advance_contact_stage` only ever moves a
-- contact FORWARD, from `lead` or `prospect`, and its UPDATE is guarded by
-- `stage IS DISTINCT FROM target_stage`, so a second firing writes nothing. A
-- past client who pays again is left where the business put them.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS promote_contact_on_payment_trigger ON payment_transactions;

CREATE TRIGGER promote_contact_on_payment_trigger
  AFTER INSERT OR UPDATE OF status, contact_id ON payment_transactions
  FOR EACH ROW
  -- Unchanged from 20260920: succeeded, for more than nothing, against a known
  -- contact. A zero-amount row is a free booking's bookkeeping, not a payment.
  WHEN (NEW.status = 'succeeded' AND NEW.amount > 0 AND NEW.contact_id IS NOT NULL)
  EXECUTE FUNCTION promote_contact_on_payment();

-- ─────────────────────────────────────────────────────────────────────────────
-- AND REPAIR THE CONTACTS THE TRIGGER COULD NEVER REACH.
--
-- Every website sale since 20260920 left its buyer short of the client stage.
-- The trigger only governs what happens next, so the backlog is corrected here
-- through the SAME function, rather than a second expression of the rule that
-- could disagree with it.
--
-- `advance_contact_stage` carries every safeguard: it refuses a contact who is
-- already a client or a past client, it refuses a business with no client stage
-- configured, and it writes nothing when the stage already matches. So this
-- promotes exactly those whom the trigger would have promoted at the time.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  paid RECORD;
  moved INTEGER := 0;
BEGIN
  FOR paid IN
    SELECT DISTINCT t.user_id, t.contact_id
      FROM payment_transactions t
     WHERE t.status = 'succeeded'
       AND t.amount > 0
       AND t.contact_id IS NOT NULL
  LOOP
    PERFORM advance_contact_stage(paid.user_id, paid.contact_id, 'client', ARRAY['lead', 'prospect']);
    moved := moved + 1;
  END LOOP;

  RAISE NOTICE 'promote_contact_on_payment backfill: % paid contacts examined', moved;
END $$;
