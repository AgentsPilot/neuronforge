-- The sentence behind a refund, beside the code for it.
--
-- WHY
--
-- `payment_refunds.reason` is one TEXT column doing two jobs, and the dialog
-- made you pick: choose one of the five canned reasons OR type your own. The
-- code comment says it outright — "only one of them is ever sent".
--
-- So a refund is either countable or explained, never both. A ledger row reading
-- `no_show` cannot say the client rang ahead and the owner refunded anyway; one
-- reading "client called, family emergency" cannot be grouped with the other
-- forty no-shows.
--
-- SAME SHAPE AS THE CANCELLATION TABLES
--
-- `reason` keeps the code, `reason_note` takes the prose — matching
-- `scheduling_bookings`, `proposals` and `payment_plan_subscriptions`, so one
-- report can read why money moved and why work stopped without a per-table
-- translation.
--
-- NULLABLE, like the others. Refunds issued before this have no note and never
-- will; backfilling would invent data. Both fields are MANDATORY at the API and
-- in the dialog, where a person is present to answer.
--
-- NOT a rename of `reason`. Rows already carry codes there, `refund_reason` on
-- `payment_transactions` is derived from it (20260903b), and the refund-pattern
-- detector groups on it. Moving it would break all three.

ALTER TABLE payment_refunds
  ADD COLUMN IF NOT EXISTS reason_note TEXT;

COMMENT ON COLUMN payment_refunds.reason_note IS
  'The owner''s own sentence about why the money went back. Never a substitute for reason, which holds the countable code. Null for refunds issued before this column existed.';
