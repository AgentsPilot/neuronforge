-- Rollback of supabase/migrations/20261137_issue_reports.sql (Business OS issue reporting slice 1.1a)
-- Run ONLY after supabase/SQL Scripts/20261138_operator_test_account_cleanup_issue_reports_rollback.sql, which restores
-- the 20261134 cleanup function. That function does not name this table, so dropping it then breaks nothing
-- The full restore is the 20261138 rollback, then this file, then the PR revert
-- Refuses while the live cleanup function still names the table, because the 20261138 rollback must run first
-- Refuses when the table holds any row. A row is a real report an account sent us
-- The table is locked before the count, so no write can slip between the count and the DROP
-- Drops the table, its policy and its index. No CASCADE, so an unexpected dependant fails loudly
-- The whole file is one transaction. A refusal changes nothing

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $rollback_guard$
DECLARE
  v_rows bigint;
BEGIN
  IF pg_catalog.to_regclass('public.issue_reports') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports rollback refused: the table does not exist. Nothing was changed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p
              WHERE p.oid = pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)')
                AND position('issue_reports' in p.prosrc) > 0) THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports rollback refused: the live cleanup function still names the table. Run the 20261138 rollback first. Nothing was changed';
  END IF;
  LOCK TABLE public.issue_reports IN ACCESS EXCLUSIVE MODE;
  v_rows := (SELECT count(*) FROM public.issue_reports);
  IF v_rows > 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports rollback refused: the table holds ' || v_rows || ' report(s). Nothing was changed';
  END IF;
END
$rollback_guard$;

DROP TABLE public.issue_reports;

NOTIFY pgrst, 'reload schema';

COMMIT;
