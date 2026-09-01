-- How the money actually reaches the business.
--
-- `payment_mode` conflated two different questions: whether services cost money,
-- and whether the platform collects it. Any priced service produced 'upfront',
-- 'invoicing' or 'installments', all of which set needs_stripe_connect — so a
-- business that charges 250 and takes a bank transfer was asked to hand Stripe
-- an ID for an account it will never open, and was never asked for the account
-- number that its invoices actually need.
--
-- This column holds the answer to one plain question the chat now asks:
-- "When someone books a paid session, how does the money reach you?"
--
--   card_online  they pay by card at booking          → needs a processor
--   invoice      an invoice goes out; transfer or call → needs bank details
--   in_person    cash or card in the room             → needs nothing
--   mixed        both, depending on the client        → processor offered
--   none         nothing is charged
--
-- Left NULL for existing accounts on purpose. `shapeFromProfile()` reads across
-- from payment_mode for them (upfront → card_online, invoicing/installments →
-- invoice), so nobody's setup changes until they answer the question themselves.

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS collection_method TEXT;

ALTER TABLE business_profiles
  DROP CONSTRAINT IF EXISTS business_profiles_collection_method_check;

ALTER TABLE business_profiles
  ADD CONSTRAINT business_profiles_collection_method_check
  CHECK (collection_method IS NULL OR collection_method IN ('card_online', 'invoice', 'in_person', 'mixed', 'none'));

COMMENT ON COLUMN business_profiles.collection_method IS
  'How money reaches the business: card_online | invoice | in_person | mixed | none. Decides whether the setup chain asks for a card processor or for bank details. NULL means the question predates this account, and payment_mode is read across instead.';
