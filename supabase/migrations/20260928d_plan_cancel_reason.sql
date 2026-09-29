-- Why a payment plan was stopped.
--
-- WHY
--
-- `cancelPlan` already accepted a `reason`, and it went nowhere useful. The value
-- was read in exactly one place — the `refundGroup` call — which only runs when
-- the caller ALSO asked for a refund. So:
--
--   stop a plan and refund       the reason became the REFUND's reason
--   stop a plan, no refund       the reason was silently thrown away
--
-- There was no reason column on this table at all, so plans were the one way of
-- calling something off that recorded nothing countable. Bookings, quote
-- declines and stopped quotes all do now.
--
-- SAME SHAPE AS THE OTHERS, on purpose
--
-- `cancel_reason` / `cancel_note` / `cancelled_by`, matching
-- `scheduling_bookings` exactly, so one report can union cancellations across
-- bookings, quotes and plans without a translation layer per table. Codes come
-- from `lib/business-os/cancellationReasons.ts`.
--
-- `cancelled_at` already exists here and is written by `close()`, so it is not
-- re-added.
--
-- NULLABLE, like the others: plans stopped before this shipped have no code and
-- never will, and backfilling a default would invent data in the column the
-- analytics are meant to trust. Mandatory at the API, where a person is present.

ALTER TABLE payment_plan_subscriptions
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

ALTER TABLE payment_plan_subscriptions
  ADD COLUMN IF NOT EXISTS cancel_note TEXT;

ALTER TABLE payment_plan_subscriptions
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT
  CHECK (cancelled_by IS NULL OR cancelled_by IN ('client', 'owner', 'system'));

COMMENT ON COLUMN payment_plan_subscriptions.cancel_reason IS
  'Why the plan was stopped, from STOP_REASONS. Null for plans stopped before this column existed. Group with canonicalReason().';

COMMENT ON COLUMN payment_plan_subscriptions.cancel_note IS
  'The sentence the owner typed. Never a substitute for cancel_reason, and not the refund reason — that is its own field on the refund.';

COMMENT ON COLUMN payment_plan_subscriptions.cancelled_by IS
  'Who stopped it. Always the owner today; the column exists so the first automated stop does not have to claim it was.';

CREATE INDEX IF NOT EXISTS idx_plan_subs_cancel_reason
  ON payment_plan_subscriptions (user_id, cancel_reason)
  WHERE status = 'cancelled';
