-- The prerequisites the refund migrations expect to already exist.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY NOT APPLY THE WHOLE MIGRATIONS DIRECTORY
--
-- It reaches for Supabase extensions, auth helpers, storage, and a hundred
-- tables the refund triggers never touch. Any one of them failing would stop
-- this from running, and none of them is what is under test.
--
-- So this creates ONLY what the four refund migrations build on: the three
-- tables they read and write, with the columns they use. The migrations
-- themselves are then applied verbatim by `run.sh` — the ledger table, the
-- guard, and all three trigger functions come from the real files, because a
-- hand-copied trigger would only ever test the copy.
--
-- Types match production deliberately: NUMERIC(12,2), not float. The rounding
-- behaviour is part of what these tests are checking.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;

-- `payment_refunds.user_id` has a FK to this. A stub is enough — nothing under
-- test reads a user's attributes, only the id.
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY
);

-- The RLS policy in the ledger migration calls this. It returns NULL here,
-- which is correct for a service-role connection: every write in production
-- goes through the service role too.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
  SELECT NULL::UUID;
$$ LANGUAGE sql STABLE;

CREATE TABLE IF NOT EXISTS scheduling_bookings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL,
  payment_status TEXT DEFAULT 'pending',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Without the refund columns: `20260828d_invoice_refund_state.sql` adds them,
-- and letting it do so is part of what is being exercised.
CREATE TABLE IF NOT EXISTS payment_invoices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL,
  booking_id     UUID REFERENCES scheduling_bookings(id) ON DELETE SET NULL,
  invoice_number TEXT,
  amount         NUMERIC(12,2) NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'ILS',
  status         TEXT NOT NULL DEFAULT 'draft',
  paid_at        TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- These refund columns predate the ledger (20260723_enhance_payments and
-- 20260828a), so they are prerequisites rather than something a refund
-- migration creates.
CREATE TABLE IF NOT EXISTS payment_transactions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL,
  invoice_id               UUID REFERENCES payment_invoices(id) ON DELETE SET NULL,
  booking_id               UUID REFERENCES scheduling_bookings(id) ON DELETE SET NULL,
  amount                   NUMERIC(12,2) NOT NULL,
  currency                 TEXT NOT NULL DEFAULT 'ILS',
  status                   TEXT NOT NULL DEFAULT 'succeeded',
  refunded_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  refund_status            TEXT NOT NULL DEFAULT 'none',
  refunded_at              TIMESTAMPTZ,
  refund_reason            TEXT,
  stripe_payment_intent_id TEXT,
  stripe_charge_id         TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
