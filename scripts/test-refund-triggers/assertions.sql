-- What the refund triggers must do, checked against a real Postgres.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- These three functions carry the only guarantees this system has that
-- application code cannot provide, and they had ZERO tests:
--
--   refund_guard_before()               no refund may exceed the charge
--   recompute_transaction_refund_state() the transaction's refund columns
--   propagate_refund_to_invoice()        the invoice's
--   propagate_refund_to_booking()        the booking's
--
-- Every assertion below raises on failure, so a non-zero exit from psql means a
-- broken guarantee. Written as SQL rather than through a driver because the
-- concurrency case cannot be expressed in one session at all — see run.sh.
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION assert(condition BOOLEAN, what TEXT) RETURNS VOID AS $$
BEGIN
  IF NOT condition THEN
    RAISE EXCEPTION 'FAILED: %', what;
  END IF;
  RAISE NOTICE '  ok  %', what;
END;
$$ LANGUAGE plpgsql;

/*
 * A booking, its invoice, and the payment that settled it.
 *
 * Deliberately linked all three ways production links them, so the propagation
 * triggers have somewhere to propagate to.
 */
CREATE OR REPLACE FUNCTION seed(charge NUMERIC, currency TEXT DEFAULT 'ILS')
RETURNS UUID AS $$
DECLARE
  owner   UUID := '11111111-1111-1111-1111-111111111111';
  booking UUID;
  invoice UUID;
  tx      UUID;
BEGIN
  INSERT INTO auth.users (id) VALUES (owner) ON CONFLICT DO NOTHING;

  INSERT INTO scheduling_bookings (user_id, payment_status)
  VALUES (owner, 'paid') RETURNING id INTO booking;

  INSERT INTO payment_invoices (user_id, booking_id, amount, currency, status, paid_at)
  VALUES (owner, booking, charge, currency, 'paid', NOW()) RETURNING id INTO invoice;

  INSERT INTO payment_transactions (user_id, invoice_id, booking_id, amount, currency, status)
  VALUES (owner, invoice, booking, charge, currency, 'succeeded') RETURNING id INTO tx;

  RETURN tx;
END;
$$ LANGUAGE plpgsql;

/*
 * Parameters are prefixed, because PL/pgSQL resolves a bare name to the
 * variable OR the column and calls the ambiguity an error at runtime.
 *
 * That is not a style point here: the first version of this file used bare
 * names, and the ambiguity error was caught by the `WHEN OTHERS` in the guard
 * tests below — so "the guard refused this refund" passed while the guard had
 * never run. Hence `assert_refused`, which checks WHY it failed.
 */
CREATE OR REPLACE FUNCTION refund_of(
  p_tx UUID,
  p_amount NUMERIC,
  p_status TEXT DEFAULT 'succeeded',
  p_reason TEXT DEFAULT NULL,
  p_currency TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  refund_id UUID;
  tx_currency TEXT;
BEGIN
  SELECT t.currency INTO tx_currency FROM payment_transactions t WHERE t.id = p_tx;

  INSERT INTO payment_refunds (
    user_id, transaction_id, invoice_id, amount, amount_minor, currency,
    status, reason, idempotency_key, source, succeeded_at
  )
  SELECT
    t.user_id, t.id, t.invoice_id, p_amount, (p_amount * 100)::BIGINT,
    COALESCE(p_currency, tx_currency),
    p_status, p_reason, gen_random_uuid()::TEXT, 'app',
    /*
     * clock_timestamp(), not NOW().
     *
     * NOW() is the TRANSACTION's start time, so two refunds seeded in one DO
     * block would carry identical timestamps — a tie production never has,
     * since each refund arrives in its own request. Using the transaction clock
     * would test an ordering that only this harness can produce.
     */
    CASE WHEN p_status = 'succeeded' THEN clock_timestamp() ELSE NULL END
  FROM payment_transactions t
  WHERE t.id = p_tx
  RETURNING id INTO refund_id;

  RETURN refund_id;
END;
$$ LANGUAGE plpgsql;

/*
 * The refund must be refused BY THE GUARD, for the stated reason.
 *
 * `WHEN OTHERS` alone would accept a typo, a missing column or an ambiguous
 * name as proof that the guard works — which is exactly what happened while
 * writing this file.
 */
CREATE OR REPLACE FUNCTION assert_refused(
  p_tx UUID,
  p_amount NUMERIC,
  p_currency TEXT,
  p_expected TEXT,
  what TEXT
) RETURNS VOID AS $$
DECLARE
  message TEXT;
BEGIN
  BEGIN
    PERFORM refund_of(p_tx, p_amount, 'succeeded', NULL, p_currency);
    RAISE EXCEPTION 'FAILED: % — the refund was ACCEPTED', what;
  EXCEPTION WHEN OTHERS THEN
    message := SQLERRM;
  END;

  IF message LIKE 'FAILED:%' THEN
    RAISE EXCEPTION '%', message;
  END IF;

  IF message NOT LIKE p_expected THEN
    RAISE EXCEPTION 'FAILED: % — refused, but for the wrong reason: %', what, message;
  END IF;

  RAISE NOTICE '  ok  %', what;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  tx UUID;
BEGIN
  RAISE NOTICE 'refund_guard_before';

  -- ── refusing more than the charge ──────────────────────────────────────────
  tx := seed(200);
  PERFORM assert_refused(tx, 250, NULL, '%would exceed the transaction%',
    'a refund larger than the charge is refused');

  -- ── refusing the SECOND refund that would take it over ─────────────────────
  tx := seed(200);
  PERFORM refund_of(tx, 150);
  PERFORM assert_refused(tx, 100, NULL, '%would exceed the transaction%',
    'a second refund cannot take the total over the charge');

  -- ── a pending refund HOLDS budget ──────────────────────────────────────────
  --
  -- Money in flight is not money available. A second request arriving while the
  -- first is still at Stripe must not be told the funds are free.
  tx := seed(200);
  PERFORM refund_of(tx, 150, 'pending');
  PERFORM assert_refused(tx, 100, NULL, '%would exceed the transaction%',
    'a pending refund holds budget against a second one');

  -- ── a FAILED refund releases it ────────────────────────────────────────────
  tx := seed(200);
  PERFORM refund_of(tx, 150, 'failed');
  PERFORM refund_of(tx, 200);
  PERFORM assert(TRUE, 'a failed refund does not hold budget');

  -- ── currencies may not be crossed ──────────────────────────────────────────
  tx := seed(200, 'ILS');
  PERFORM assert_refused(tx, 100, 'USD', '%does not match transaction currency%',
    'a refund in another currency is refused');

  -- ── exactly the full amount is allowed ─────────────────────────────────────
  tx := seed(200);
  PERFORM refund_of(tx, 200);
  PERFORM assert(TRUE, 'a refund of exactly the charge is allowed');
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  tx    UUID;
  state RECORD;
BEGIN
  RAISE NOTICE 'recompute_transaction_refund_state';

  -- ── partial ────────────────────────────────────────────────────────────────
  tx := seed(200);
  PERFORM refund_of(tx, 50, 'succeeded', 'client changed their mind');

  SELECT * INTO state FROM payment_transactions WHERE id = tx;
  PERFORM assert(state.refunded_amount = 50, 'a partial refund sets refunded_amount');
  PERFORM assert(state.refund_status = 'partial', 'a partial refund sets refund_status');
  /*
   * The status stays 'succeeded'.
   *
   * Flipping it would remove the sale from every revenue query that filters on
   * succeeded — the whole payment, not just the refunded part.
   */
  PERFORM assert(state.status = 'succeeded', 'a partial refund leaves the payment succeeded');
  PERFORM assert(state.refunded_at IS NOT NULL, 'a refund stamps refunded_at');
  -- Captured on every refund since the ledger existed, and written by nothing
  -- until 20260903b.
  PERFORM assert(
    state.refund_reason = 'client changed their mind',
    'the refund reason reaches the transaction'
  );

  -- ── full, reached in two steps ─────────────────────────────────────────────
  PERFORM refund_of(tx, 150, 'succeeded', 'service not delivered');

  SELECT * INTO state FROM payment_transactions WHERE id = tx;
  PERFORM assert(state.refunded_amount = 200, 'refunds accumulate');
  PERFORM assert(state.refund_status = 'full', 'refunding the rest makes it full');
  PERFORM assert(state.status = 'refunded', 'a fully refunded payment reads refunded');
  -- The most recent one, matching refunded_at — the two must describe the same
  -- event, not different ones.
  PERFORM assert(
    state.refund_reason = 'service not delivered',
    'the most recent reason wins'
  );

  -- ── a pending refund moves no money ────────────────────────────────────────
  tx := seed(200);
  PERFORM refund_of(tx, 100, 'pending');

  SELECT * INTO state FROM payment_transactions WHERE id = tx;
  PERFORM assert(state.refunded_amount = 0, 'a pending refund does not count as refunded');
  PERFORM assert(state.refund_status = 'none', 'a pending refund leaves refund_status none');

  -- ── reversal ───────────────────────────────────────────────────────────────
  --
  -- A refund deleted or marked failed must put the payment back, or a mistaken
  -- refund would leave a sale permanently understated.
  tx := seed(200);
  PERFORM refund_of(tx, 200);
  DELETE FROM payment_refunds WHERE transaction_id = tx;

  SELECT * INTO state FROM payment_transactions WHERE id = tx;
  PERFORM assert(state.refunded_amount = 0, 'removing a refund clears refunded_amount');
  PERFORM assert(state.status = 'succeeded', 'removing a full refund restores the payment');
  PERFORM assert(state.refund_reason IS NULL, 'removing a refund clears the reason');
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  tx      UUID;
  invoice RECORD;
BEGIN
  RAISE NOTICE 'propagate_refund_to_invoice';

  tx := seed(200);
  PERFORM refund_of(tx, 50);

  SELECT i.* INTO invoice
  FROM payment_invoices i
  JOIN payment_transactions t ON t.invoice_id = i.id
  WHERE t.id = tx;

  PERFORM assert(invoice.refunded_amount = 50, 'the invoice learns what was refunded');
  PERFORM assert(invoice.refund_status = 'partial', 'the invoice reads partial');
  PERFORM assert(invoice.status = 'partially_refunded', 'the invoice status follows');

  PERFORM refund_of(tx, 150);

  SELECT i.* INTO invoice
  FROM payment_invoices i
  JOIN payment_transactions t ON t.invoice_id = i.id
  WHERE t.id = tx;

  PERFORM assert(invoice.refund_status = 'full', 'a full refund reaches the invoice');
  PERFORM assert(invoice.status = 'refunded', 'the invoice status reads refunded');

  -- Back to paid when the refund goes away.
  DELETE FROM payment_refunds WHERE transaction_id = tx;

  SELECT i.* INTO invoice
  FROM payment_invoices i
  JOIN payment_transactions t ON t.invoice_id = i.id
  WHERE t.id = tx;

  PERFORM assert(invoice.status = 'paid', 'removing the refund restores the invoice to paid');
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  owner   UUID := '11111111-1111-1111-1111-111111111111';
  booking UUID;
  tx_a    UUID;
  tx_b    UUID;
  state   TEXT;
BEGIN
  RAISE NOTICE 'propagate_refund_to_booking';

  -- ── one payment, fully refunded ────────────────────────────────────────────
  tx_a := seed(200);
  PERFORM refund_of(tx_a, 200);

  SELECT b.payment_status INTO state
  FROM scheduling_bookings b
  JOIN payment_transactions t ON t.booking_id = b.id
  WHERE t.id = tx_a;

  PERFORM assert(state = 'refunded', 'a fully refunded booking reads refunded');

  -- ── a plan: several payments on one booking ────────────────────────────────
  --
  -- THE case this trigger exists for. Reading the one transaction that changed
  -- is what marked a whole booking refunded after one period of twelve came
  -- back.
  INSERT INTO scheduling_bookings (user_id, payment_status)
  VALUES (owner, 'paid') RETURNING id INTO booking;

  INSERT INTO payment_transactions (user_id, booking_id, amount, currency, status)
  VALUES (owner, booking, 100, 'ILS', 'succeeded') RETURNING id INTO tx_a;

  INSERT INTO payment_transactions (user_id, booking_id, amount, currency, status)
  VALUES (owner, booking, 100, 'ILS', 'succeeded') RETURNING id INTO tx_b;

  PERFORM refund_of(tx_a, 100);

  SELECT payment_status INTO state FROM scheduling_bookings WHERE id = booking;
  PERFORM assert(
    state = 'paid',
    'refunding one payment of two leaves the booking paid'
  );

  PERFORM refund_of(tx_b, 100);

  SELECT payment_status INTO state FROM scheduling_bookings WHERE id = booking;
  PERFORM assert(state = 'refunded', 'refunding both marks the booking refunded');

  -- ── a partial refund is not a refunded booking ─────────────────────────────
  --
  -- `payment_status` has no 'partially_refunded'. A booking still holding money
  -- is `paid`, which is true — and writing a fourth value would drop it out of
  -- every reader comparing against the three.
  tx_a := seed(200);
  PERFORM refund_of(tx_a, 50);

  SELECT b.payment_status INTO state
  FROM scheduling_bookings b
  JOIN payment_transactions t ON t.booking_id = b.id
  WHERE t.id = tx_a;

  PERFORM assert(state = 'paid', 'a partially refunded booking stays paid');
END $$;

SELECT 'ALL ASSERTIONS PASSED' AS result;
