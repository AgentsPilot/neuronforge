-- What a service needs from its client.
--
-- Booking and payment were modelled as properties of the business: one
-- `online_presence_mode`, one `collection_method`, applied to everything the
-- business sells. That is wrong for most of them. A single practice sells a
-- ₪250 appointment paid by card, a ₪80 download paid by card, a ₪6,000
-- programme billed against an invoice, and a free intro call — four services,
-- four different client journeys, one business.
--
-- Two facts per service settle all of it:
--
--   is_scheduled   does a client pick a time?     → whether the journey has a date step
--   collection     how does the money arrive?     → whether it has a payment step
--
-- Everything above them is then derived rather than asked. Working hours are
-- required only if some service needs a time. Stripe is required only if some
-- priced service is collected online — so a consultancy that invoices for a
-- living is never asked to hand a card processor its ID. Company and bank
-- details are required only if something is invoiced.
--
-- That is also why the onboarding chat no longer asks "how do you collect
-- money?": it was never a question a non-technical user could answer about
-- their business as a whole, and the services already contain the answer.

ALTER TABLE scheduling_services
  ADD COLUMN IF NOT EXISTS is_scheduled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE scheduling_services
  ADD COLUMN IF NOT EXISTS collection TEXT;

-- Nullable because a length may genuinely be absent, not because a service is
-- unbooked: a workshop can run two hours and still be sold as a product. The
-- column was NOT NULL, which is why every service was implicitly an appointment
-- and the build coerced missing durations to 60 minutes.
ALTER TABLE scheduling_services
  ALTER COLUMN duration_minutes DROP NOT NULL;

ALTER TABLE scheduling_services
  DROP CONSTRAINT IF EXISTS scheduling_services_collection_check;

ALTER TABLE scheduling_services
  ADD CONSTRAINT scheduling_services_collection_check
  CHECK (collection IS NULL OR collection IN ('online', 'invoice'));

COMMENT ON COLUMN scheduling_services.is_scheduled IS
  'Does booking this service involve picking a time? Defaults true so every existing service keeps its current behaviour. False for a product or deliverable, whose client journey has no date step — its duration, if it has one, is kept and shown regardless.';

COMMENT ON COLUMN scheduling_services.collection IS
  'How money for this service arrives: online (card at the moment of booking — requires a connected processor) | invoice (billed afterwards; transfer, Bit or cash — requires no processor). NULL where the service is free, or where nobody has said yet.';

-- Backfill from whatever the business already answered, so no account changes
-- behaviour on deploy. The per-service answer only diverges from the
-- business-wide one once somebody edits a service.
UPDATE scheduling_services s
SET collection = CASE
    WHEN p.collection_method IN ('card_online', 'mixed') THEN 'online'
    WHEN p.collection_method = 'invoice' THEN 'invoice'
    -- Paid in the room, in cash or on a card machine: the money never moves
    -- through the platform, so there is nothing to collect and no invoice to
    -- carry bank details. NULL keeps that true, and keeps such a business from
    -- being asked for paperwork it has never needed.
    WHEN p.collection_method = 'in_person' THEN NULL
    -- Older accounts predate collection_method and only have payment_mode,
    -- which conflated "has a price" with "takes cards".
    WHEN p.payment_mode = 'upfront' THEN 'online'
    WHEN p.payment_mode IN ('invoicing', 'installments') THEN 'invoice'
    ELSE NULL
  END
FROM business_profiles p
WHERE p.user_id = s.user_id
  AND s.collection IS NULL
  -- Free services are not collected at all; leaving them NULL keeps that true.
  AND s.price IS NOT NULL
  AND s.price > 0;
