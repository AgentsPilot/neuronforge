SET default_transaction_read_only = on;

-- Probe C-9 for 20261099_business_os_first_plan_payments_view (MK5B-FU-1, SA-WP-M5F condition M5F-C4)
-- Paste and run after the checker shows all_ok. Read only. EXPLAIN only, never ANALYZE, so the query is planned and not run
-- It plans the Converted this month read in the exact shape the app sends: one mode, the current UTC month, keyset order on user_id, at most 1000 rows
-- Set livemode below to the mode on the Subscriptions page chip
-- Look for business_os_billing_events_paid_month_idx in the plan. That is the expected path for the month range
-- This is information for SA, not part of all_ok. At a small table size Postgres may still prefer a plain scan, which is fine
EXPLAIN
SELECT first_rows.user_id, first_rows.first_payment_at
FROM public.business_os_first_plan_payments AS first_rows
WHERE first_rows.livemode = false
  AND first_rows.first_payment_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
  AND first_rows.first_payment_at < (date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC'
ORDER BY first_rows.user_id ASC
LIMIT 1000;
