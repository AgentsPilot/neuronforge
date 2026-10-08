-- Rollback of supabase/migrations/20261041_operator_test_account_cleanup.sql. GENERATED, never edit by hand.
-- Drops the function, the secret table and the schema. Then remove TEST_CLEANUP_SECRET from Vercel.

DROP FUNCTION IF EXISTS public.operator_test_account_cleanup(text, text, text, text, uuid, text);
DROP TABLE IF EXISTS operator_private.secrets;
DROP SCHEMA IF EXISTS operator_private;

NOTIFY pgrst, 'reload schema';
