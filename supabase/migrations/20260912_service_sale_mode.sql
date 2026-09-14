-- ============================================================================
-- How a service is sold: bought directly, or quoted first.
--
-- The third fact of the same kind as `is_scheduled` and `collection`
-- (20260901_service_shape), and it settles the same way — by being read rather
-- than asked:
--
--   is_scheduled   does a client pick a time?    → is there a date step?
--   collection     how does the money arrive?    → is there a payment step?
--   sale_mode      can they buy it immediately?  → WHERE the journey stops
--
-- A business that quotes each job has no price to publish and no card to take
-- at the moment a client is interested. Today it has nowhere to live: a service
-- must carry a price, and the journey always runs to payment. So a contractor
-- pricing per site visit, and a therapist proposing a treatment plan, both have
-- to pretend to be something they are not.
--
-- `proposal` cuts the journey in two. The client picks a service and leaves
-- details; the owner quotes; the client accepts and the SAME journey resumes at
-- payment. No new steps, no second widget — one seam.
--
-- Date: 2026-09-12
-- ============================================================================

ALTER TABLE scheduling_services
  ADD COLUMN IF NOT EXISTS sale_mode TEXT NOT NULL DEFAULT 'direct';

ALTER TABLE scheduling_services
  DROP CONSTRAINT IF EXISTS scheduling_services_sale_mode_check;

ALTER TABLE scheduling_services
  ADD CONSTRAINT scheduling_services_sale_mode_check
  CHECK (sale_mode IN ('direct', 'proposal'));

COMMENT ON COLUMN scheduling_services.sale_mode IS
  'direct = the client books and pays in one sitting (today''s behaviour, and the default so no existing service changes). proposal = the client cannot buy immediately; they leave details, the owner sends a quote, and the journey resumes once it is accepted. Read by journeySteps() to decide where the client journey stops.';

-- The public catalogue asks "which of these can be bought right now?" on every
-- page render. Partial, because quoted services are the minority and the index
-- only needs to serve them.
CREATE INDEX IF NOT EXISTS idx_scheduling_services_proposal
  ON scheduling_services(user_id)
  WHERE sale_mode = 'proposal';
