-- A client's actual payment plan, as opposed to the template.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A NEW TABLE
--
-- `payment_plans` is a TEMPLATE: it hangs off a service, and carries no contact,
-- no booking and no Stripe reference. "3 monthly payments of ₪200" as an offer,
-- not as an agreement with anyone. That is a useful thing to keep, so it is kept
-- as it is, and the per-client instance lives here.
--
-- WHAT OWNS THE SCHEDULE
--
-- Stripe does. Each row points at a Subscription Schedule on the business's
-- CONNECTED account, and Stripe charges each period, retries, chases expired
-- cards and handles SCA — every one of which is a system in its own right.
--
-- But Stripe does not get to hold the information. Insights, detectors and
-- automations query Postgres, and a detector that made a network call per plan
-- would be slow, rate-limited, and unavailable exactly when Stripe is. So every
-- lifecycle event is mirrored here, and this table is complete enough to answer
-- "who is behind, by how much, and for how long" without asking Stripe anything.
--
-- NO CARD DATA. Ever. Only Stripe references and the non-sensitive display
-- metadata Stripe reports back: brand, last four, expiry. The card itself is
-- entered on Stripe's own page during Checkout and never crosses this system.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payment_plan_subscriptions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id                UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,

  -- RESTRICT, not CASCADE: deleting a booking must not silently erase the record
  -- of an agreement to take someone's money every month.
  booking_id                UUID REFERENCES scheduling_bookings(id) ON DELETE RESTRICT,
  service_id                UUID REFERENCES scheduling_services(id) ON DELETE SET NULL,
  payment_plan_id           UUID REFERENCES payment_plans(id) ON DELETE SET NULL,

  -- Nullable until Stripe answers. A row is written BEFORE the subscription is
  -- created, so a crash mid-flight leaves evidence rather than an invisible
  -- half-made plan — the same reasoning as the refund ledger.
  stripe_subscription_id    TEXT,
  stripe_schedule_id        TEXT,
  stripe_price_id           TEXT,
  stripe_customer_id        TEXT,

  -- NULL means the platform, explicitly. Same convention as
  -- payment_transactions, so a refund of any period resolves the same way.
  stripe_connect_account_id TEXT,

  installment_count         INTEGER NOT NULL CHECK (installment_count > 0),
  installment_amount        NUMERIC(12,2) NOT NULL CHECK (installment_amount > 0),
  currency                  TEXT NOT NULL,
  frequency                 TEXT NOT NULL
                              CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly')),

  -- Maintained from invoice.paid. The count of periods actually collected, which
  -- is what "2 of 3 paid" reads from without asking Stripe.
  periods_paid              INTEGER NOT NULL DEFAULT 0 CHECK (periods_paid >= 0),

  status                    TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'active', 'past_due', 'paused', 'completed', 'cancelled')),

  -- What the next charge will be, mirrored from invoice.upcoming. This is what
  -- makes "expected revenue next month" a query rather than an API call.
  next_charge_at            TIMESTAMPTZ,
  next_charge_amount        NUMERIC(12,2),

  -- Why the last period failed, so the business can be told something useful
  -- rather than "payment failed".
  last_failure_code         TEXT,
  last_failure_at           TIMESTAMPTZ,

  -- Card DISPLAY metadata only, mirrored from Stripe. Never a number, never a
  -- CVC, never anything that could be one. Expiry is kept for a reason beyond
  -- display: it makes "this card expires before their final payment" something
  -- an insight can find, instead of something discovered when the charge fails.
  card_brand                TEXT,
  card_last4                TEXT CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
  card_exp_month            INTEGER CHECK (card_exp_month IS NULL OR card_exp_month BETWEEN 1 AND 12),
  card_exp_year             INTEGER,

  metadata                  JSONB NOT NULL DEFAULT '{}',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at              TIMESTAMPTZ,
  cancelled_at              TIMESTAMPTZ
);

-- The webhook keys on these, so redelivery converges on one row instead of
-- creating a second plan. Same argument as processor_refund_id on the ledger.
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_subs_stripe_subscription
  ON payment_plan_subscriptions(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_subs_stripe_schedule
  ON payment_plan_subscriptions(stripe_schedule_id)
  WHERE stripe_schedule_id IS NOT NULL;

-- One live plan per booking. A second would charge the client twice for one
-- appointment, so it is refused by the database rather than by whichever code
-- path happens to check.
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_subs_one_live_per_booking
  ON payment_plan_subscriptions(booking_id)
  WHERE booking_id IS NOT NULL AND status IN ('pending', 'active', 'past_due', 'paused');

CREATE INDEX IF NOT EXISTS idx_plan_subs_user ON payment_plan_subscriptions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_subs_contact ON payment_plan_subscriptions(contact_id);

-- The insight queries: who is behind, and what is coming.
CREATE INDEX IF NOT EXISTS idx_plan_subs_past_due
  ON payment_plan_subscriptions(user_id, last_failure_at DESC)
  WHERE status = 'past_due';

CREATE INDEX IF NOT EXISTS idx_plan_subs_upcoming
  ON payment_plan_subscriptions(user_id, next_charge_at)
  WHERE status IN ('active', 'past_due') AND next_charge_at IS NOT NULL;

ALTER TABLE payment_plan_subscriptions ENABLE ROW LEVEL SECURITY;

-- SELECT only, like the refund ledger. A browser-writable row here would let a
-- client's plan be marked paid, or cancelled, without any money moving.
DROP POLICY IF EXISTS plan_subs_select_own ON payment_plan_subscriptions;
CREATE POLICY plan_subs_select_own ON payment_plan_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Link the projected instalments to the plan and to the invoices Stripe raises.
--
-- `payment_plan_installments` had NO link to payment_invoices at all, so a
-- period could not be joined to the invoice that collected it. The rows are a
-- projection for display — Stripe owns the schedule — but a projection that
-- cannot be reconciled against the money is not worth showing.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE payment_plan_installments
  ADD COLUMN IF NOT EXISTS subscription_id UUID REFERENCES payment_plan_subscriptions(id) ON DELETE CASCADE;

ALTER TABLE payment_plan_installments
  ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES payment_invoices(id) ON DELETE SET NULL;

ALTER TABLE payment_plan_installments
  ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT;

CREATE INDEX IF NOT EXISTS idx_plan_installments_subscription
  ON payment_plan_installments(subscription_id, installment_number);

-- Matching a Stripe invoice back to the period it paid for has to be exact, or
-- a redelivered webhook marks a second period paid.
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_installments_stripe_invoice
  ON payment_plan_installments(stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

COMMENT ON TABLE payment_plan_subscriptions IS
  'A client''s live payment plan. Stripe executes the schedule; this row is the local record every read goes through.';
COMMENT ON COLUMN payment_plan_subscriptions.card_last4 IS
  'Display metadata mirrored from Stripe. No card number is ever stored in this system.';
