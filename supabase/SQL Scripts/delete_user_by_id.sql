-- ============================================================================
-- DELETE USER DATA BY ID - FOR TESTING ONLY
-- ============================================================================
-- This script deletes all data associated with a specific user ID
-- USE WITH CAUTION - This action is irreversible
--
-- Usage:
-- 1. Replace 'USER_ID_HERE' with the actual user UUID
-- 2. Run this script in Supabase SQL Editor
-- ============================================================================

-- IMPORTANT: Set the user ID you want to delete
-- Example: SET user_id = '123e4567-e89b-12d3-a456-426614174000';
DO $$
DECLARE
    user_id UUID := 'USER_ID_HERE'; -- Replace with actual user ID
BEGIN
    RAISE NOTICE 'Starting deletion for user ID: %', user_id;

    -- Delete user's agent executions
    DELETE FROM agent_executions WHERE user_id = user_id;
    RAISE NOTICE 'Deleted agent_executions';

    -- Delete user's agent versions
    DELETE FROM agent_versions WHERE user_id = user_id;
    RAISE NOTICE 'Deleted agent_versions';

    -- Delete user's agents
    DELETE FROM agents WHERE user_id = user_id;
    RAISE NOTICE 'Deleted agents';

    -- Delete user's plugin connections
    DELETE FROM plugin_connections WHERE user_id = user_id;
    RAISE NOTICE 'Deleted plugin_connections';

    -- Delete user's subscriptions
    DELETE FROM subscriptions WHERE user_id = user_id;
    RAISE NOTICE 'Deleted subscriptions';

    -- Delete user's usage records
    DELETE FROM usage_records WHERE user_id = user_id;
    RAISE NOTICE 'Deleted usage_records';

    -- Delete user's contact submissions
    DELETE FROM contact_submissions WHERE user_id = user_id;
    RAISE NOTICE 'Deleted contact_submissions';

    -- Delete user's memory records
    DELETE FROM user_memory WHERE user_id = user_id;
    RAISE NOTICE 'Deleted user_memory';

    -- Delete user's API keys
    DELETE FROM user_api_keys WHERE user_id = user_id;
    RAISE NOTICE 'Deleted user_api_keys';

    -- Delete user's audit logs
    DELETE FROM audit_logs WHERE user_id = user_id;
    RAISE NOTICE 'Deleted audit_logs';

    -- Delete user profile (this should be done before auth.users)
    DELETE FROM profiles WHERE id = user_id;
    RAISE NOTICE 'Deleted profile';

    -- NOTE: Deleting from auth.users requires admin privileges
    -- If you have RLS enabled, you may need to run this separately as a service role
    -- DELETE FROM auth.users WHERE id = user_id;
    -- RAISE NOTICE 'Deleted auth.users record';

    RAISE NOTICE 'User deletion complete for user ID: %', user_id;
END $$;

-- ============================================================================
-- ALTERNATIVE: Delete by email address
-- ============================================================================
-- Uncomment and modify this section if you want to delete by email instead
/*
DO $$
DECLARE
    user_email TEXT := 'user@example.com'; -- Replace with actual email
    user_id UUID;
BEGIN
    -- Get user ID from email
    SELECT id INTO user_id FROM auth.users WHERE email = user_email;

    IF user_id IS NULL THEN
        RAISE NOTICE 'No user found with email: %', user_email;
        RETURN;
    END IF;

    RAISE NOTICE 'Found user ID: % for email: %', user_id, user_email;

    -- Delete all user data (same as above)
    DELETE FROM agent_executions WHERE user_id = user_id;
    DELETE FROM agent_versions WHERE user_id = user_id;
    DELETE FROM agents WHERE user_id = user_id;
    DELETE FROM plugin_connections WHERE user_id = user_id;
    DELETE FROM subscriptions WHERE user_id = user_id;
    DELETE FROM usage_records WHERE user_id = user_id;
    DELETE FROM contact_submissions WHERE user_id = user_id;
    DELETE FROM user_memory WHERE user_id = user_id;
    DELETE FROM user_api_keys WHERE user_id = user_id;
    DELETE FROM audit_logs WHERE user_id = user_id;
    DELETE FROM profiles WHERE id = user_id;

    RAISE NOTICE 'User deletion complete for email: %', user_email;
END $$;
*/

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these after deletion to verify cleanup
-- Replace 'USER_ID_HERE' with the user ID you deleted

/*
-- Check if any records remain
SELECT 'agent_executions' as table_name, COUNT(*) FROM agent_executions WHERE user_id = 'USER_ID_HERE'
UNION ALL
SELECT 'agent_versions', COUNT(*) FROM agent_versions WHERE user_id = 'USER_ID_HERE'
UNION ALL
SELECT 'agents', COUNT(*) FROM agents WHERE user_id = 'USER_ID_HERE'
UNION ALL
SELECT 'plugin_connections', COUNT(*) FROM plugin_connections WHERE user_id = 'USER_ID_HERE'
UNION ALL
SELECT 'subscriptions', COUNT(*) FROM subscriptions WHERE user_id = 'USER_ID_HERE'
UNION ALL
SELECT 'usage_records', COUNT(*) FROM usage_records WHERE user_id = 'USER_ID_HERE'
UNION ALL
SELECT 'contact_submissions', COUNT(*) FROM contact_submissions WHERE user_id = 'USER_ID_HERE'
UNION ALL
SELECT 'user_memory', COUNT(*) FROM user_memory WHERE user_id = 'USER_ID_HERE'
UNION ALL
SELECT 'user_api_keys', COUNT(*) FROM user_api_keys WHERE user_id = 'USER_ID_HERE'
UNION ALL
SELECT 'audit_logs', COUNT(*) FROM audit_logs WHERE user_id = 'USER_ID_HERE'
UNION ALL
SELECT 'profiles', COUNT(*) FROM profiles WHERE id = 'USER_ID_HERE';
*/

-- ============================================================================
-- NOTES
-- ============================================================================
-- 1. This script deletes data in the correct order to respect foreign key constraints
-- 2. The auth.users deletion is commented out as it requires service role privileges
-- 3. To delete auth.users record, go to Supabase Dashboard > Authentication > Users
--    and manually delete the user, OR use the service role key via API
-- 4. Always backup your data before running deletion scripts
-- 5. For production, consider soft deletes with a 'deleted_at' timestamp instead
