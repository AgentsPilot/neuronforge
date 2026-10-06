-- Why an individual payment period was stopped.
--
-- WHY THIS EXISTS SEPARATELY FROM 20260928d
--
-- That migration put `cancel_reason` / `cancel_note` / `cancelled_by` on
-- `payment_plan_subscriptions`, which is the right home for a STRIPE plan: the
-- subscription row is the plan, and stopping it is one decision about one row.
--
-- A plan billed by invoice has no subscription row at all. Its periods live in
-- `payment_plan_installments` with `subscription_id` NULL — written by
-- `createInstallmentsForBooking` for a booking, and by `ProposalAcceptanceService`
-- for a quote. So the one place a stop reason could be recorded did not exist for
-- the two plan shapes that are not Stripe, and stopping one recorded nothing
-- countable.
--
-- SAME THREE COLUMNS, SAME NAMES, on purpose — matching `scheduling_bookings`,
-- `proposals` and `payment_plan_subscriptions` exactly, so one report can union
-- cancellations across every shape without a translation layer per table. Codes
-- come from `lib/business-os/cancellationReasons.ts`.
--
-- PER PERIOD, NOT PER PLAN, because that is the grain the stop actually works at:
-- stopping a plan closes the periods that have not been collected and leaves the
-- ones that have alone. A plan-level column could not say which were which, and a
-- plan can fund more than one booking.
--
-- NULLABLE, like the others: periods cancelled before this shipped have no code
-- and never will. Backfilling a default would invent data in the column the
-- analytics are meant to trust. Mandatory at the API, where a person is present.

ALTER TABLE payment_plan_installments
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

ALTER TABLE payment_plan_installments
  ADD COLUMN IF NOT EXISTS cancel_note TEXT;

ALTER TABLE payment_plan_installments
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT
  CHECK (cancelled_by IS NULL OR cancelled_by IN ('client', 'owner', 'system'));

ALTER TABLE payment_plan_installments
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

COMMENT ON COLUMN payment_plan_installments.cancel_reason IS
  'Why this period was stopped, from STOP_REASONS. Null for periods cancelled before this column existed. Group with canonicalReason().';

COMMENT ON COLUMN payment_plan_installments.cancel_note IS
  'The sentence the owner typed. Never a substitute for cancel_reason, and not a refund reason — that is its own field on the refund.';

COMMENT ON COLUMN payment_plan_installments.cancelled_by IS
  'Who stopped it: client, owner or system. The same three values every other cancellation surface uses.';

COMMENT ON COLUMN payment_plan_installments.cancelled_at IS
  'When it was stopped. Unlike payment_plan_subscriptions, this table had no such column — status went to cancelled with no timestamp, so nothing could say when a plan stopped billing.';
