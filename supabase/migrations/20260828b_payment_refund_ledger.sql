-- An append-only ledger of refunds.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A LEDGER, RATHER THAN MORE COLUMNS ON payment_transactions
--
-- Refund state lived in `refunded_amount` on the transaction, written directly
-- by whichever code path happened to run. One path accumulated, the other
-- overwrote. Neither could see the other's work, so the recorded total was
-- whatever the last writer believed. There was no record of an individual
-- refund at all: no id, no time, no reason, no link to Stripe.
--
-- With a ledger, `refunded_amount` stops being something anyone writes and
-- becomes an aggregate recomputed by a trigger. The overwrite-versus-accumulate
-- bug cannot be reintroduced, because there is no longer a field to get wrong.
--
-- It also gives the three writers — the app, the `charge.refunded` webhook, and
-- the reconciliation script — one row to converge on, keyed by the Stripe refund
-- id, instead of three chances to count the same refund three times.
--
-- WHAT MAKES IT SAFE
--
--   UNIQUE (idempotency_key)      a resubmitted request cannot refund twice
--   UNIQUE (processor_refund_id)  Stripe's own id can only be recorded once
--   refund_guard_before()         takes a row lock on the transaction, so two
--                                 concurrent refunds cannot both pass the
--                                 over-refund check. An application-level check
--                                 is a race and cannot be made correct.
--   RLS: SELECT only              a forged INSERT here would make the recompute
--                                 trigger mark a transaction refunded. This is
--                                 the one place a wrong policy is a money bug.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payment_refunds (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- RESTRICT, not CASCADE: deleting a transaction must never silently erase the
  -- record that money was returned.
  transaction_id            UUID NOT NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT,
  invoice_id                UUID REFERENCES payment_invoices(id) ON DELETE SET NULL,

  -- Both units are stored. `amount` matches the DECIMAL(10,2) the rest of the
  -- schema uses; `amount_minor` is what Stripe was actually told, which is the
  -- only figure that can be compared to Stripe without re-deriving it and
  -- re-introducing rounding.
  amount                    NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  amount_minor              BIGINT NOT NULL CHECK (amount_minor > 0),
  currency                  TEXT NOT NULL,

  status                    TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'succeeded', 'failed', 'canceled')),
  reason                    TEXT,

  processor_type            TEXT NOT NULL DEFAULT 'stripe',
  processor_refund_id       TEXT,

  -- Which Stripe account the refund was issued against. NULL means the platform,
  -- explicitly — not "unknown".
  stripe_connect_account_id TEXT,

  idempotency_key           TEXT NOT NULL,
  source                    TEXT NOT NULL CHECK (source IN ('app', 'webhook', 'reconciler', 'manual')),
  initiated_by              UUID,

  failure_code              TEXT,
  failure_message           TEXT,

  metadata                  JSONB NOT NULL DEFAULT '{}',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  succeeded_at              TIMESTAMPTZ
);

-- A resubmitted request returns the original row instead of refunding again.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_refunds_idempotency
  ON payment_refunds(idempotency_key);

-- The app, the webhook and the reconciler all key on this, so they converge on
-- one row rather than counting the same refund up to three times.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_refunds_processor_id
  ON payment_refunds(processor_refund_id)
  WHERE processor_refund_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_refunds_transaction ON payment_refunds(transaction_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_user ON payment_refunds(user_id, created_at DESC);

-- The reconciler's work queue: refunds that reached Stripe but whose outcome was
-- never written back, usually because the process died mid-flight.
CREATE INDEX IF NOT EXISTS idx_payment_refunds_pending
  ON payment_refunds(created_at)
  WHERE status = 'pending';

ALTER TABLE payment_refunds ENABLE ROW LEVEL SECURITY;

-- Readable by its owner. Deliberately NO insert or update policy: every write
-- goes through the service role. A browser session that could insert here could
-- make the recompute trigger below mark any of its transactions fully refunded.
DROP POLICY IF EXISTS payment_refunds_select_own ON payment_refunds;
CREATE POLICY payment_refunds_select_own ON payment_refunds
  FOR SELECT USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Guard: no refund may exceed what is left, and none may cross currencies.
--
-- The FOR UPDATE is the whole point. Two requests that both read
-- `refunded_amount` before either writes would both pass an application-level
-- check and both refund. Serialising on the transaction row is the only way to
-- make that impossible, and it has to live here because the database is the only
-- place both requests meet.
--
-- Pending refunds count against the budget. Moving money is slow, and a second
-- request arriving while the first is still at Stripe must not be told the funds
-- are available.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refund_guard_before()
RETURNS TRIGGER AS $$
DECLARE
  tx_amount   NUMERIC(12,2);
  tx_currency TEXT;
  committed   NUMERIC(12,2);
BEGIN
  SELECT amount, currency INTO tx_amount, tx_currency
  FROM payment_transactions
  WHERE id = NEW.transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund references a transaction that does not exist: %', NEW.transaction_id;
  END IF;

  IF UPPER(NEW.currency) <> UPPER(tx_currency) THEN
    RAISE EXCEPTION 'Refund currency % does not match transaction currency %',
      NEW.currency, tx_currency;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO committed
  FROM payment_refunds
  WHERE transaction_id = NEW.transaction_id
    AND status IN ('pending', 'succeeded')
    AND id <> NEW.id;

  IF committed + NEW.amount > tx_amount THEN
    RAISE EXCEPTION
      'Refund of % would exceed the transaction: % already committed of %',
      NEW.amount, committed, tx_amount;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS refund_guard_before_trigger ON payment_refunds;
CREATE TRIGGER refund_guard_before_trigger
  BEFORE INSERT OR UPDATE OF amount, status, currency ON payment_refunds
  FOR EACH ROW
  EXECUTE FUNCTION refund_guard_before();

-- ─────────────────────────────────────────────────────────────────────────────
-- Recompute the transaction's cached refund state from the ledger.
--
-- Only 'succeeded' refunds count toward the total. A pending refund holds budget
-- in the guard above but has not returned any money yet, and reporting it as
-- refunded would understate revenue for as long as it stayed pending.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recompute_transaction_refund_state()
RETURNS TRIGGER AS $$
DECLARE
  target      UUID;
  tx_amount   NUMERIC(12,2);
  refunded    NUMERIC(12,2);
  last_at     TIMESTAMPTZ;
  new_status  TEXT;
BEGIN
  target := COALESCE(NEW.transaction_id, OLD.transaction_id);

  SELECT amount INTO tx_amount FROM payment_transactions WHERE id = target;
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(amount), 0), MAX(succeeded_at)
    INTO refunded, last_at
  FROM payment_refunds
  WHERE transaction_id = target AND status = 'succeeded';

  new_status := CASE
    WHEN refunded <= 0 THEN 'none'
    WHEN refunded >= tx_amount THEN 'full'
    ELSE 'partial'
  END;

  UPDATE payment_transactions
  SET
    refunded_amount = refunded,
    refund_status   = new_status,
    refunded_at     = last_at,
    -- A fully refunded payment reads 'refunded'; a partial one is still a
    -- successful payment that gave some money back, and saying otherwise would
    -- remove it from revenue entirely.
    status = CASE
      WHEN new_status = 'full' THEN 'refunded'
      WHEN status = 'refunded' AND new_status <> 'full' THEN 'succeeded'
      ELSE status
    END,
    updated_at = NOW()
  WHERE id = target;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recompute_transaction_refund_state_trigger ON payment_refunds;
CREATE TRIGGER recompute_transaction_refund_state_trigger
  AFTER INSERT OR UPDATE OR DELETE ON payment_refunds
  FOR EACH ROW
  EXECUTE FUNCTION recompute_transaction_refund_state();

COMMENT ON TABLE payment_refunds IS
  'One row per refund attempt. payment_transactions.refunded_amount is derived from this table by trigger — never write it directly.';
