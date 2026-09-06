-- Whether THIS invoice may be paid online.
--
-- WHY
--
-- The create-invoice dialog has always had a "Send via Stripe" tick, and it has
-- never meant what it says. It was read once, at send time, to choose between a
-- Stripe-hosted invoice and the business's own branded email — and then thrown
-- away.
--
-- So the client's pay page never saw it. That page asks a different question:
-- "does this BUSINESS have Stripe?" If yes, a card button is drawn. Untick the
-- toggle and the client still gets a card button, still pays through Stripe, and
-- the refund still has to go back through Stripe — while the business believed
-- it had sent a transfer-only invoice.
--
-- This column is where that choice now lives, so the pay page, the email and the
-- PDF all read the same answer.
--
-- WHAT IT IS FOR
--
-- Two situations, one flag:
--
--   * A Stripe business billing one client by transfer — a large amount where
--     the processing fee matters, or a client who will not pay by card.
--   * A business in a country with no Stripe at all, where every invoice is a
--     transfer. The toggle is not shown, and this is simply always false.
--
-- NULL MEANS "as before", and that is the point of allowing it.
--
-- Every invoice written until now has no recorded choice, and inventing one for
-- them would change what their pay pages offer — including invoices already
-- sitting in clients' inboxes. NULL falls through to the business's own
-- capability, which is exactly today's behaviour. Only invoices created after
-- this carry an answer.

ALTER TABLE payment_invoices
  ADD COLUMN IF NOT EXISTS allow_online_payment BOOLEAN;

COMMENT ON COLUMN payment_invoices.allow_online_payment IS
  'Whether this invoice may be paid online (card, via the connected processor). FALSE means collect it by transfer: no card button on the pay page, bank details instead. NULL means no choice was recorded — fall back to the business''s own collection capability, which is how every invoice behaved before this column existed.';

-- The pay page and the invoice list both read this alongside the status, and
-- only the invoices that opted OUT are interesting — the rest fall through to
-- the business capability, so a partial index is the whole of the work.
CREATE INDEX IF NOT EXISTS idx_payment_invoices_transfer_only
  ON payment_invoices(user_id, created_at DESC)
  WHERE allow_online_payment = FALSE;
