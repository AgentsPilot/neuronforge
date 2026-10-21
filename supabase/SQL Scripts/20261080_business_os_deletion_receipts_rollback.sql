-- Rollback of supabase/migrations/20261080_business_os_deletion_receipts.sql (data export DE-10b.1)
-- Run ONLY after supabase/SQL Scripts/20261081_operator_account_cleanup_anonymise_rollback.sql, which restores the
-- 20261077 cleanup function. That function does not name this table, so dropping it then breaks nothing
-- Refuses when the table holds any row. A receipt is the proof that a deletion happened and must never be dropped
-- The whole file is one transaction. A refusal changes nothing

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $rollback_guard$
DECLARE
  v_rows bigint;
BEGIN
  IF pg_catalog.to_regclass('public.business_os_deletion_receipts') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Deletion receipts rollback refused: the table does not exist. Nothing was changed';
  END IF;
  IF pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Deletion receipts rollback refused: the 20261081 cleanup function is still applied. Run its rollback first. Nothing was changed';
  END IF;
  v_rows := (SELECT count(*) FROM public.business_os_deletion_receipts);
  IF v_rows > 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Deletion receipts rollback refused: the table holds ' || v_rows || ' receipt(s), which are proof of deletions. Nothing was changed';
  END IF;
END
$rollback_guard$;

DROP TABLE public.business_os_deletion_receipts;

NOTIFY pgrst, 'reload schema';

COMMIT;
