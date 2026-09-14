-- Put back the clients the last migration demoted.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT WENT WRONG
--
-- `20260918_promote_client_on_confirmed_booking` corrected contacts that the
-- old quote-request bug had wrongly promoted. Its test for "was never really a
-- client" was: every one of their bookings is against a `sale_mode = 'proposal'`
-- service.
--
-- That test is wrong, and this is the case it misses. A quote that was ACCEPTED
-- and PAID produces exactly the same shape — one proposal-mode booking — and a
-- real, paying client behind it. So the repair demoted two of them.
--
-- The guard it did carry looked for a succeeded `payment_transactions` row with
-- a matching `booking_id`. Proposal payments do not carry one: they are written
-- against the contact and the invoice, not the booking, so the guard matched
-- nothing and protected nobody.
--
-- WHAT THIS DOES
--
-- Restores a contact to the client stage where there is evidence they earned
-- it: money that actually arrived, or a quote they accepted. Scoped to exactly
-- the shape the previous migration touched — all bookings proposal-mode — so it
-- cannot promote anyone that migration never moved.
--
-- `20260918` has been corrected too, so an environment that has not run it yet
-- never makes this mistake in the first place. This file exists for the one
-- that already did.
-- ─────────────────────────────────────────────────────────────────────────────

WITH quote_only_contacts AS (
  SELECT b.contact_id, b.user_id
    FROM scheduling_bookings b
    JOIN scheduling_services sv ON sv.id = b.service_id
   WHERE b.contact_id IS NOT NULL
   GROUP BY b.contact_id, b.user_id
  HAVING COUNT(*) FILTER (WHERE sv.sale_mode IS DISTINCT FROM 'proposal') = 0
),
earned_it AS (
  -- Money that arrived, or a quote the client accepted. Either is enough.
  SELECT q.contact_id, q.user_id
    FROM quote_only_contacts q
   WHERE EXISTS (
           SELECT 1 FROM payment_transactions t
            WHERE t.contact_id = q.contact_id
              AND t.user_id = q.user_id
              AND t.status = 'succeeded'
         )
      OR EXISTS (
           SELECT 1 FROM proposals p
            WHERE p.contact_id = q.contact_id
              AND p.user_id = q.user_id
              AND p.status = 'accepted'
         )
),
client_stage AS (
  -- The stage the owner marked, then the first one typed `client`. Never a
  -- hardcoded key — the same rule the trigger uses.
  SELECT DISTINCT ON (user_id) user_id, stage_key
    FROM crm_pipeline_stages
   WHERE is_primary_client_stage = true OR stage_type = 'client'
   ORDER BY user_id, is_primary_client_stage DESC, position
)
UPDATE crm_contacts c
   SET stage = cs.stage_key,
       updated_at = NOW()
  FROM earned_it e
  JOIN client_stage cs ON cs.user_id = e.user_id
 WHERE c.id = e.contact_id
   AND c.user_id = e.user_id
   -- Only those sitting short of it. Anyone already at or past the client
   -- stage is left exactly where the business put them.
   AND NOT EXISTS (
     SELECT 1
       FROM crm_pipeline_stages s
      WHERE s.user_id = c.user_id
        AND s.stage_key = c.stage
        AND s.stage_type IN ('client', 'past_client')
   );
