-- How a contact moves through the pipeline.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE MODEL, IN THE OWNER'S WORDS
--
--   books a quote, or a free consultation   →  lead        (פנייה)
--   the meeting is COMPLETED                →  prospect    (ייעוץ ראשוני)
--   money ARRIVES                           →  client      (לקוח)
--
-- A service paid for up front reaches the client stage on the first step,
-- because the money arrives with the booking. Nothing else is a shortcut: a
-- confirmed booking is not a client, an accepted quote is not a client, and a
-- free consultation is not a client however many times it is rebooked.
--
-- This REPLACES the rule in `20260918`, which promoted on a booking being
-- confirmed. That was one step too eager — a free consultation is confirmed the
-- moment it is booked, and the person who booked it is a lead.
--
-- WHY NOT `scheduling_bookings.payment_status`
--
-- Because a free booking is written `paid`: the create route reads a price of
-- zero as nothing left to collect, which is true and is not the same as money
-- having arrived. Every free consultation would be a client. So the signal is a
-- `payment_transactions` row that SUCCEEDED for more than nothing — money that
-- actually moved, whoever moved it and by whatever route.
--
-- WHAT NEITHER TRIGGER DOES
--
-- Demote. Each moves a contact FORWARD or leaves them alone: a client who books
-- a follow-up consultation stays a client, and where someone sits after the
-- work ends is the business's judgement, not a side effect.
-- ─────────────────────────────────────────────────────────────────────────────

/*
 * The stage of a given type for a business, by its own configuration.
 *
 * Pipelines are generated per business during onboarding, so the stage TYPE is
 * the contract and the key is only its local name — 'family_enrolled' here,
 * 'closed_won' for a sales team, whatever a Spanish or Hebrew business is
 * given. `is_primary_client_stage` wins where it is set; otherwise the earliest
 * stage of that type.
 */
CREATE OR REPLACE FUNCTION pipeline_stage_of_type(p_user_id UUID, p_type TEXT)
RETURNS TEXT AS $$
  SELECT stage_key
    FROM crm_pipeline_stages
   WHERE user_id = p_user_id
     AND (stage_type = p_type OR (p_type = 'client' AND is_primary_client_stage = true))
   ORDER BY (p_type = 'client' AND is_primary_client_stage) DESC NULLS LAST, position
   LIMIT 1;
$$ LANGUAGE sql STABLE;

/*
 * Move a contact forward to `p_target_type`, never backward.
 *
 * `p_only_from` names the types this move is allowed to leave. A completed
 * meeting promotes a lead to prospect and must not touch a client; money
 * promotes anyone who is not already a client or past one.
 */
CREATE OR REPLACE FUNCTION advance_contact_stage(
  p_user_id UUID,
  p_contact_id UUID,
  p_target_type TEXT,
  p_only_from TEXT[]
) RETURNS VOID AS $$
DECLARE
  target_stage TEXT;
  current_type TEXT;
BEGIN
  IF p_contact_id IS NULL THEN
    RETURN;
  END IF;

  target_stage := pipeline_stage_of_type(p_user_id, p_target_type);
  IF target_stage IS NULL THEN
    -- No stage of that type configured: say nothing rather than invent one.
    RETURN;
  END IF;

  SELECT s.stage_type INTO current_type
    FROM crm_contacts c
    LEFT JOIN crm_pipeline_stages s
      ON s.user_id = c.user_id AND s.stage_key = c.stage
   WHERE c.id = p_contact_id
     AND c.user_id = p_user_id;

  -- An unrecognised or empty stage counts as the beginning, so a contact
  -- created before the pipeline existed can still be moved.
  IF current_type IS NULL THEN
    current_type := 'lead';
  END IF;

  IF NOT (current_type = ANY (p_only_from)) THEN
    RETURN;
  END IF;

  UPDATE crm_contacts
     SET stage = target_stage,
         updated_at = NOW()
   WHERE id = p_contact_id
     AND user_id = p_user_id
     AND stage IS DISTINCT FROM target_stage;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Money arrives → client.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION promote_contact_on_payment()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM advance_contact_stage(
    NEW.user_id,
    NEW.contact_id,
    'client',
    -- From anywhere short of it. A past client who pays again is left where the
    -- business put them.
    ARRAY['lead', 'prospect']
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS promote_contact_on_payment_trigger ON payment_transactions;

CREATE TRIGGER promote_contact_on_payment_trigger
  AFTER INSERT OR UPDATE OF status ON payment_transactions
  FOR EACH ROW
  -- Succeeded, for more than nothing, against a known contact. A zero-amount
  -- row is a free booking's bookkeeping, not a payment.
  WHEN (NEW.status = 'succeeded' AND NEW.amount > 0 AND NEW.contact_id IS NOT NULL)
  EXECUTE FUNCTION promote_contact_on_payment();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The meeting happened → prospect.
--
-- Only from `lead`. A client who has a session marked completed is still a
-- client; this is the step between "they got in touch" and "we have talked".
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION advance_contact_on_completed_booking()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM advance_contact_stage(NEW.user_id, NEW.contact_id, 'prospect', ARRAY['lead']);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS advance_contact_on_completed_booking_trigger ON scheduling_bookings;

CREATE TRIGGER advance_contact_on_completed_booking_trigger
  AFTER UPDATE OF status ON scheduling_bookings
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION advance_contact_on_completed_booking();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The confirmed-booking rule goes.
--
-- It promoted to client one step too early: a free consultation is confirmed on
-- creation, and the person who booked it has not become a client by doing so.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS promote_contact_on_confirmed_booking_trigger ON scheduling_bookings;
DROP FUNCTION IF EXISTS promote_contact_on_confirmed_booking();

COMMENT ON FUNCTION advance_contact_stage(UUID, UUID, TEXT, TEXT[]) IS
  'Moves a contact forward to a stage of the given type, only from the listed types. Never demotes.';
COMMENT ON FUNCTION promote_contact_on_payment() IS
  'Money that actually arrived makes a contact a client. Not booking.payment_status, which reads paid for a free booking.';
COMMENT ON FUNCTION advance_contact_on_completed_booking() IS
  'A completed meeting moves a lead to prospect. Leaves clients alone.';
