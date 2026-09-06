-- Add stripe_email column to track the email used for the Stripe Connect account
-- This is different from the user's login email - it's the email associated with their Stripe Express account

ALTER TABLE stripe_connect_accounts
ADD COLUMN IF NOT EXISTS stripe_email VARCHAR(255);

-- Update the existing record with the correct Stripe email
UPDATE stripe_connect_accounts
SET stripe_email = 'offir.omer+test@gmail.com'
WHERE stripe_account_id = 'acct_1U1C2XG9Cem0sy0O';

-- Add a comment explaining the column
COMMENT ON COLUMN stripe_connect_accounts.stripe_email IS 'Email address used for the Stripe Express account (may differ from user login email)';
