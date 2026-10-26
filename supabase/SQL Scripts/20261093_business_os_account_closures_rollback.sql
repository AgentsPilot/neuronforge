-- Rollback of supabase/migrations/20261093_business_os_account_closures.sql (account deletion lifecycle DL-1a)
-- Run ONLY after supabase/SQL Scripts/20261094_operator_test_account_cleanup_account_closures_rollback.sql, which restores
-- the 20261092 cleanup function. That function does not name this table, so dropping it then breaks nothing
-- A rollback of 20261094 alone leaves G-10 refusing every test account check and delete on the link of this table to the
-- login. The full restore is the 20261094 rollback, then this file, then the PR revert (SA F-A, W-1)
-- Refuses when the table holds any row. A row is a live deletion request of a real account
-- The table is locked before the count, so no write can slip between the count and the DROP (SA optimisation)
-- Drops the session cut function, the claim function and the table
-- The whole file is one transaction. A refusal changes nothing

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $rollback_guard$
DECLARE
  v_rows bigint;
BEGIN
  IF pg_catalog.to_regclass('public.business_os_account_closures') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures rollback refused: the table does not exist. Nothing was changed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
              WHERE p.oid = pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)')
                AND position('business_os_account_closures' in p.prosrc) > 0) THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures rollback refused: the live cleanup function still names the table. Run the 20261094 rollback first. Nothing was changed';
  END IF;
  LOCK TABLE public.business_os_account_closures IN ACCESS EXCLUSIVE MODE;
  v_rows := (SELECT count(*) FROM public.business_os_account_closures);
  IF v_rows > 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures rollback refused: the table holds ' || v_rows || ' deletion request(s). Nothing was changed';
  END IF;
END
$rollback_guard$;

DROP FUNCTION IF EXISTS public.business_os_account_closure_cut_sessions(uuid);

DROP FUNCTION IF EXISTS public.business_os_account_closures_claim_due(uuid, integer);

DROP TABLE public.business_os_account_closures;

NOTIFY pgrst, 'reload schema';

COMMIT;
