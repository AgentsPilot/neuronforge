-- Rollback of supabase/migrations/20261095_business_os_export_requests.sql (module export MX-1a)
-- Run ONLY after supabase/SQL Scripts/20261096_operator_test_account_cleanup_export_requests_rollback.sql, which restores
-- the 20261094 cleanup function. That function does not name these tables, so dropping them then breaks nothing
-- A rollback of 20261096 alone leaves G-10 refusing every test account check and delete on the links of these tables to
-- the login. The full restore is the 20261096 rollback, then this file, then the PR revert (SA F-A)
-- Refuses when either table is missing, when the live cleanup function still names either table, or when either holds
-- a row. A row is the export history of a real account
-- Both tables are locked before the count, so no write can slip between the count and the DROP
-- Drops the reap, claim and start functions, then the jobs table, then the requests table
-- The whole file is one transaction. A refusal changes nothing

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $rollback_guard$
DECLARE
  v_rows bigint;
BEGIN
  IF pg_catalog.to_regclass('public.business_os_export_requests') IS NULL OR pg_catalog.to_regclass('public.business_os_export_module_jobs') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Export requests rollback refused: a table of 20261095 does not exist. Nothing was changed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
              WHERE p.oid = pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)')
                AND (position('business_os_export_requests' in p.prosrc) > 0 OR position('business_os_export_module_jobs' in p.prosrc) > 0)) THEN
    RAISE EXCEPTION USING MESSAGE = 'Export requests rollback refused: the live cleanup function still names an export table. Run the 20261096 rollback first. Nothing was changed';
  END IF;
  LOCK TABLE public.business_os_export_requests, public.business_os_export_module_jobs IN ACCESS EXCLUSIVE MODE;
  v_rows := (SELECT count(*) FROM public.business_os_export_requests) + (SELECT count(*) FROM public.business_os_export_module_jobs);
  IF v_rows > 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Export requests rollback refused: the tables hold ' || v_rows || ' row(s) of export history. Nothing was changed';
  END IF;
END
$rollback_guard$;

DROP FUNCTION IF EXISTS public.business_os_export_module_jobs_reap();

DROP FUNCTION IF EXISTS public.business_os_export_module_jobs_claim_due(uuid, integer);

DROP FUNCTION IF EXISTS public.business_os_export_request_start(uuid, text, uuid, text[]);

DROP TABLE public.business_os_export_module_jobs;

DROP TABLE public.business_os_export_requests;

NOTIFY pgrst, 'reload schema';

COMMIT;
