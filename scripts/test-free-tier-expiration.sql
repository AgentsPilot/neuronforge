-- Test Script: Set up a user with expiring free tier to test UI notifications
-- This script allows you to test different expiration scenarios

-- ============================================================================
-- SCENARIO 1: Free tier expiring in 5 days (should show CRITICAL alert)
-- ============================================================================

-- Replace 'YOUR_USER_ID' with an actual user ID from your auth.users table
-- You can find user IDs by running: SELECT id, email FROM auth.users LIMIT 10;

UPDATE user_subscriptions
SET
  free_tier_granted_at = NOW() - INTERVAL '25 days',
  free_tier_expires_at = NOW() + INTERVAL '5 days',
  free_tier_initial_amount = 208340,
  account_frozen = FALSE,
  stripe_subscription_id = NULL  -- Make sure user is NOT a paying customer
WHERE user_id = 'YOUR_USER_ID';

-- ============================================================================
-- SCENARIO 2: Free tier expiring in 10 days (should show WARNING alert)
-- ============================================================================

-- UPDATE user_subscriptions
-- SET
--   free_tier_granted_at = NOW() - INTERVAL '20 days',
--   free_tier_expires_at = NOW() + INTERVAL '10 days',
--   free_tier_initial_amount = 208340,
--   account_frozen = FALSE,
--   stripe_subscription_id = NULL
-- WHERE user_id = 'YOUR_USER_ID';

-- ============================================================================
-- SCENARIO 3: Free tier expiring in 2 days (should show CRITICAL alert)
-- ============================================================================

-- UPDATE user_subscriptions
-- SET
--   free_tier_granted_at = NOW() - INTERVAL '28 days',
--   free_tier_expires_at = NOW() + INTERVAL '2 days',
--   free_tier_initial_amount = 208340,
--   account_frozen = FALSE,
--   stripe_subscription_id = NULL
-- WHERE user_id = 'YOUR_USER_ID';

-- ============================================================================
-- SCENARIO 4: Free tier EXPIRED (should show "Purchase tokens" message)
-- ============================================================================

-- UPDATE user_subscriptions
-- SET
--   free_tier_granted_at = NOW() - INTERVAL '31 days',
--   free_tier_expires_at = NOW() - INTERVAL '1 day',
--   free_tier_initial_amount = 208340,
--   account_frozen = TRUE,
--   balance = 0,  -- Frozen accounts have 0 balance
--   stripe_subscription_id = NULL
-- WHERE user_id = 'YOUR_USER_ID';

-- ============================================================================
-- SCENARIO 5: Free tier expiring in 12 days (should show CAUTION alert)
-- ============================================================================

-- UPDATE user_subscriptions
-- SET
--   free_tier_granted_at = NOW() - INTERVAL '18 days',
--   free_tier_expires_at = NOW() + INTERVAL '12 days',
--   free_tier_initial_amount = 208340,
--   account_frozen = FALSE,
--   stripe_subscription_id = NULL
-- WHERE user_id = 'YOUR_USER_ID';

-- ============================================================================
-- RESET: Remove free tier expiration (for cleanup)
-- ============================================================================

-- UPDATE user_subscriptions
-- SET
--   free_tier_granted_at = NULL,
--   free_tier_expires_at = NULL,
--   free_tier_initial_amount = 0,
--   account_frozen = FALSE
-- WHERE user_id = 'YOUR_USER_ID';

-- ============================================================================
-- HELPER: Get your current user ID
-- ============================================================================

-- Run this first to find your user ID:
-- SELECT id, email, created_at FROM auth.users ORDER BY created_at DESC LIMIT 10;

-- ============================================================================
-- VERIFICATION: Check the user's subscription after update
-- ============================================================================

-- SELECT
--   user_id,
--   balance / 10 as pilot_credits,
--   free_tier_granted_at,
--   free_tier_expires_at,
--   EXTRACT(DAY FROM (free_tier_expires_at - NOW())) as days_remaining,
--   free_tier_initial_amount,
--   account_frozen,
--   stripe_subscription_id
-- FROM user_subscriptions
-- WHERE user_id = 'YOUR_USER_ID';
