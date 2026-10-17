BEGIN;

SET LOCAL lock_timeout = '5s';

DO $rollback_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects AS obj WHERE obj.bucket_id = 'business-data-exports') THEN
    RAISE EXCEPTION 'Data exports rollback refused: the bucket business-data-exports still holds files. Empty it in the Storage dashboard first. Nothing was changed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS fn
              WHERE fn.oid = pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text)')
                AND position('a824848e0a538477' IN fn.prosrc) > 0) THEN
    RAISE EXCEPTION 'Data exports rollback refused: the test-account cleanup function of 20261075 is still live. Run supabase/SQL Scripts/20261075_operator_test_account_cleanup_data_exports_rollback.sql first. Nothing was changed';
  END IF;
END
$rollback_guard$;

DROP FUNCTION IF EXISTS public.business_os_data_export_start(uuid, uuid, text);

DROP TABLE IF EXISTS public.business_os_data_exports;

DO $rollback_check$
BEGIN
  IF pg_catalog.to_regprocedure('public.business_os_data_export_start(uuid, uuid, text)') IS NOT NULL
     OR pg_catalog.to_regclass('public.business_os_data_exports') IS NOT NULL THEN
    RAISE EXCEPTION 'Data exports rollback did not remove the function and the table. Nothing was changed';
  END IF;
  RAISE NOTICE 'Data exports rollback done. The empty bucket business-data-exports stays: delete it in the Storage dashboard';
END
$rollback_check$;

NOTIFY pgrst, 'reload schema';

COMMIT;
