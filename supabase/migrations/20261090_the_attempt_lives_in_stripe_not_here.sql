-- Drop `attempt_id` from the money tables. The join lives in Stripe.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THESE COLUMNS WERE FOR
--
-- A booking is written only once the client has finished paying, so the charge,
-- the subscription and every instalment are created a minute earlier, when
-- there is no booking id to store. Something has to say afterwards what the
-- money was for, and these columns were one attempt at it: have the Stripe
-- webhook copy the booking ATTEMPT onto each row as it wrote them, then read it
-- back when the booking appeared.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THEY ARE GOING
--
-- Because the copy only happens if the webhook runs, and the webhook is the
-- part that fails. It can arrive twice and be deduped, be delayed past the
-- redirect, or die between claiming an event and finishing it. So the local
-- mirror was empty in exactly the cases it was built to survive — observed on
-- three consecutive live orders, every one of which had the attempt in Stripe
-- and nothing in these columns.
--
-- Stripe already holds the answer. `payment-intent` and `checkout` put the
-- attempt in the object's metadata when they create it, and the Search API
-- matches on it exactly. `linkPaymentsToBooking` asks Stripe, which is the
-- system that actually took the money, and is right whether or not any webhook
-- ever ran. Two mechanisms where the cheap one breaks whenever the expensive
-- one is needed is not redundancy; it is a second thing to keep working.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SAFE TO RUN
--
-- Nothing reads or writes these columns: the webhook stamping, the repository
-- fields and the attempt-keyed lookups were all removed with the code that used
-- them. One row carries a value, written by hand while testing the idea.
--
-- The indexes go with the columns automatically; they are named here only so
-- that re-running on a database where the columns were already dropped is a
-- no-op rather than an error.

DROP INDEX IF EXISTS public.idx_payment_transactions_attempt;
DROP INDEX IF EXISTS public.idx_payment_plan_subscriptions_attempt;
DROP INDEX IF EXISTS public.idx_payment_plan_installments_attempt;
DROP INDEX IF EXISTS public.idx_payment_invoices_attempt;

ALTER TABLE public.payment_transactions        DROP COLUMN IF EXISTS attempt_id;
ALTER TABLE public.payment_plan_subscriptions  DROP COLUMN IF EXISTS attempt_id;
ALTER TABLE public.payment_plan_installments   DROP COLUMN IF EXISTS attempt_id;
ALTER TABLE public.payment_invoices            DROP COLUMN IF EXISTS attempt_id;
