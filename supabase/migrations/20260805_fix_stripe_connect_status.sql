-- Clean up invalid/stale stripe_connect_accounts records
-- The stripe_account_id 'acct_1U00k05a6Q8ObW0E' does not exist in Stripe Connect
-- This removes the stale record so users see accurate "Stripe not connected" status

DELETE FROM stripe_connect_accounts
WHERE stripe_account_id = 'acct_1U00k05a6Q8ObW0E';
