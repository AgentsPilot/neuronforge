-- A client is someone who booked a service.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS REPLACES
--
-- Five routes each decided, on their own, when a contact becomes a client, and
-- they used PAYMENT as the proxy for the relationship:
--
--   website/booking/create   free service      → client immediately
--   website/booking/confirm  payment succeeded → client
--   website/booking/finalize payment succeeded → client
--   stripe/webhook           invoice paid      → client
--   payments/.../mark-paid   marked paid       → client
--
-- Payment is not the relationship. A free intro call is not a client, a quote
-- request is not a client, and a business that bills by invoice has clients who
-- have not paid yet. The owner's own definition is the simple one: a client is
-- someone who booked a service.
--
-- So there is one rule and one place: a booking reaching `confirmed` promotes
-- its contact. Payment still matters — for a pay-first service it is what
-- CAUSES the confirmation — but it is no longer the thing being asked about.
--
-- In the database rather than in a route, because a booking is confirmed from
-- the website, from a smart link, from the assistant, from the owner's own
-- dialog and from a Stripe webhook. A rule that lives in one of those is a rule
-- the next path added will not know about.
--
-- WHAT IT DOES NOT DO
--
-- It never demotes. A contact at or past the client stage keeps their position:
-- where someone sits after they have been a client is the business's judgement,
-- not a consequence of a cancellation.
--
-- It never touches the middle of the pipeline. Nothing here moves anyone to
-- "prospect" or its local equivalent — that is a call only the owner can make.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION promote_contact_on_confirmed_booking()
RETURNS TRIGGER AS $$
DECLARE
  target_stage TEXT;
  current_type TEXT;
BEGIN
  IF NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  /*
   * The stage the OWNER marked, then the first stage typed `client`.
   *
   * Never a hardcoded key. Pipelines are generated per business during
   * onboarding — 'family_enrolled' for a parenting school, 'closed_won' for a
   * sales team, and whatever a Hebrew or Spanish business is given — so the
   * TYPE is the contract and the key is just its name here.
   */
  SELECT stage_key INTO target_stage
    FROM crm_pipeline_stages
   WHERE user_id = NEW.user_id
     AND is_primary_client_stage = true
   LIMIT 1;

  IF target_stage IS NULL THEN
    SELECT stage_key INTO target_stage
      FROM crm_pipeline_stages
     WHERE user_id = NEW.user_id
       AND stage_type = 'client'
     ORDER BY position
     LIMIT 1;
  END IF;

  -- No client stage configured: say nothing rather than invent one.
  IF target_stage IS NULL THEN
    RETURN NEW;
  END IF;

  -- Where the contact stands now, by TYPE.
  SELECT s.stage_type INTO current_type
    FROM crm_contacts c
    LEFT JOIN crm_pipeline_stages s
      ON s.user_id = c.user_id AND s.stage_key = c.stage
   WHERE c.id = NEW.contact_id
     AND c.user_id = NEW.user_id;

  -- Already a client, or past being one. Leave them where the business put them.
  IF current_type IN ('client', 'past_client') THEN
    RETURN NEW;
  END IF;

  UPDATE crm_contacts
     SET stage = target_stage,
         updated_at = NOW()
   WHERE id = NEW.contact_id
     AND user_id = NEW.user_id
     AND stage IS DISTINCT FROM target_stage;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/*
 * On the TRANSITION to confirmed, not on every write.
 *
 * `AFTER UPDATE OF status` alone would re-run on each later edit of an already
 * confirmed booking; the WHEN clause narrows it to the moment it becomes
 * confirmed. INSERT is included because a free service is confirmed on
 * creation and never updated.
 */
DROP TRIGGER IF EXISTS promote_contact_on_confirmed_booking_trigger ON scheduling_bookings;

CREATE TRIGGER promote_contact_on_confirmed_booking_trigger
  AFTER INSERT OR UPDATE OF status ON scheduling_bookings
  FOR EACH ROW
  WHEN (NEW.status = 'confirmed')
  EXECUTE FUNCTION promote_contact_on_confirmed_booking();

COMMENT ON FUNCTION promote_contact_on_confirmed_booking() IS
  'Moves a contact to the business''s client stage when one of their bookings is confirmed. Promotes only — never demotes, and never touches the middle of the pipeline.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Put back the contacts the old rule promoted by mistake.
--
-- A quoted service has no price, so `shouldTakePayment` read false, so the
-- booking route treated it as FREE: it wrote the booking `confirmed` and
-- `paid`, and filed the contact as a client. Asking a contractor for a quote
-- made you their client before they had named a figure.
--
-- Corrected narrowly. Only a contact whose bookings are ALL quote requests —
-- every one of them against a `sale_mode = 'proposal'` service — goes back to
-- the first stage of their pipeline. Anyone with a real booking beside it is
-- left alone, because for them the client stage is right for a different
-- reason, and this is a repair, not a re-run of the rule.
-- ─────────────────────────────────────────────────────────────────────────────
WITH quote_only_contacts AS (
  SELECT b.contact_id, b.user_id
    FROM scheduling_bookings b
    JOIN scheduling_services sv ON sv.id = b.service_id
   WHERE b.contact_id IS NOT NULL
   GROUP BY b.contact_id, b.user_id
  HAVING COUNT(*) FILTER (WHERE sv.sale_mode IS DISTINCT FROM 'proposal') = 0
     /*
      * ...and nothing ever came of the quote.
      *
      * "Every booking is a quote request" is NOT the same as "never became a
      * client". A quote that was accepted and paid produces exactly this shape:
      * one proposal-mode booking, and a real client behind it. Without these
      * two conditions this demoted paying clients — which is what it did.
      *
      * Evidence of a real relationship is money that arrived, or a quote the
      * client accepted. Either one, and they are left alone.
      */
     AND NOT EXISTS (
       SELECT 1 FROM payment_transactions t
        WHERE t.contact_id = b.contact_id
          AND t.user_id = b.user_id
          AND t.status = 'succeeded'
     )
     AND NOT EXISTS (
       SELECT 1 FROM proposals p
        WHERE p.contact_id = b.contact_id
          AND p.user_id = b.user_id
          AND p.status = 'accepted'
     )
),
first_stage AS (
  SELECT DISTINCT ON (user_id) user_id, stage_key
    FROM crm_pipeline_stages
   ORDER BY user_id, position
)
UPDATE crm_contacts c
   SET stage = f.stage_key,
       updated_at = NOW()
  FROM quote_only_contacts q
  JOIN first_stage f ON f.user_id = q.user_id
 WHERE c.id = q.contact_id
   AND c.user_id = q.user_id
   -- Only those the bug moved: sitting at a client stage today.
   --
   -- As EXISTS rather than a join: in `UPDATE ... FROM`, the target table is
   -- not in scope inside a JOIN's ON clause, so matching the contact's current
   -- stage has to happen in the WHERE.
   AND EXISTS (
     SELECT 1
       FROM crm_pipeline_stages s
      WHERE s.user_id = c.user_id
        AND s.stage_key = c.stage
        AND s.stage_type = 'client'
   )
   AND c.stage IS DISTINCT FROM f.stage_key;

-- The bookings themselves were written as confirmed-and-paid for the same
-- reason. A quote request is neither.
UPDATE scheduling_bookings b
   SET status = 'pending',
       payment_status = 'pending',
       updated_at = NOW()
  FROM scheduling_services sv
 WHERE sv.id = b.service_id
   AND sv.sale_mode = 'proposal'
   AND b.status = 'confirmed'
   AND b.payment_status = 'paid'
   -- Nothing was actually collected against them: no transaction, no invoice.
   AND NOT EXISTS (
     SELECT 1 FROM payment_transactions t
      WHERE t.booking_id = b.id AND t.status = 'succeeded'
   );
