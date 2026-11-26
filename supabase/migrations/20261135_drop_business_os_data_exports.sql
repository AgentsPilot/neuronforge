-- 20261135_drop_business_os_data_exports. Module export MX-7 (E10), the last slice of the export redesign
-- Workplan docs/workplans/BUSINESS_OS_EXPORT_MX7_WORKPLAN.md sections 4.1, 4.3 and 8.2
-- Drops the start function public.business_os_data_export_start(uuid, uuid, text) and then the table public.business_os_data_exports
-- Both are the old ZIP export of 20261074 (data export DE-8a). Nothing has called them since MX-3.1 (2026-10-30)
-- Apply order. After 20261134_operator_test_account_cleanup_drop_data_exports AND after the deploy of the MX-7 merge is Ready, in the same sitting
-- The guard refuses unless the live 8 argument cleanup function no longer names the table, so this cannot run before 20261134 (SR-6)
-- Timing. From the 20261134 paste until the checker of this file passes, admin deletes and test-account cleanup refuse (fail closed)
-- No known undo for data. The rows are gone for good. They held dates, counts and two ids each, never content
-- Rollback supabase/SQL Scripts/20261135_drop_business_os_data_exports_rollback.sql re-creates the empty table and the start function only
-- Never run scripts/rollback-business-os-data-exports.sql (DE-8a) after this file
-- The bucket business-data-exports is not touched here. It is deleted in the Storage dashboard after this file and its checker
-- Pre-check scripts/precheck-drop-data-exports.sql. Checker scripts/check-drop-data-exports-migration.sql
-- No IF EXISTS and no CASCADE. A hidden dependent makes the paste fail with nothing dropped
-- The whole file is one transaction. A failed guard or post-condition applies nothing

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $drop_guard$
BEGIN
  IF pg_catalog.to_regclass('public.business_os_data_exports') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Drop refused: table public.business_os_data_exports does not exist. Nothing was dropped';
  END IF;
  IF pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Drop refused: the 8 argument cleanup function is missing. Apply 20261134 first. Nothing was dropped';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS fn
              WHERE fn.oid = pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)')
                AND position('business_os_data_exports' IN fn.prosrc) > 0) THEN
    RAISE EXCEPTION USING MESSAGE = 'Drop refused: the live cleanup function still names business_os_data_exports. Apply 20261134 first. Nothing was dropped';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS fn
              WHERE position('business_os_data_exports' IN fn.prosrc) > 0
                AND fn.oid IS DISTINCT FROM pg_catalog.to_regprocedure('public.business_os_data_export_start(uuid, uuid, text)')) THEN
    RAISE EXCEPTION USING MESSAGE = 'Drop refused: a function other than the start function names business_os_data_exports. Nothing was dropped';
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_os_data_exports AS job WHERE job.status IN ('queued', 'running')) THEN
    RAISE EXCEPTION USING MESSAGE = 'Drop refused: an export job is queued or running. Nothing was dropped';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint AS con
              WHERE con.contype = 'f'
                AND con.confrelid = pg_catalog.to_regclass('public.business_os_data_exports')
                AND con.conrelid <> con.confrelid) THEN
    RAISE EXCEPTION USING MESSAGE = 'Drop refused: a foreign key of another table points at business_os_data_exports. Nothing was dropped';
  END IF;
  IF pg_catalog.to_regprocedure('public.business_os_data_export_start(uuid, uuid, text)') IS NULL
     OR (SELECT count(*) FROM pg_catalog.pg_proc AS fn
          JOIN pg_catalog.pg_namespace AS ns ON ns.oid = fn.pronamespace
          WHERE ns.nspname = 'public' AND fn.proname = 'business_os_data_export_start') <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Drop refused: the start function is not exactly business_os_data_export_start(uuid, uuid, text). Nothing was dropped';
  END IF;
END
$drop_guard$;

LOCK TABLE public.business_os_data_exports IN ACCESS EXCLUSIVE MODE;

DROP FUNCTION public.business_os_data_export_start(uuid, uuid, text);

DROP TABLE public.business_os_data_exports;

DO $drop_check$
BEGIN
  IF pg_catalog.to_regclass('public.business_os_data_exports') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.business_os_data_export_start(uuid, uuid, text)') IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Drop post-condition: the table or the start function is still there so nothing was dropped';
  END IF;
END
$drop_check$;

NOTIFY pgrst, 'reload schema';

COMMIT;
