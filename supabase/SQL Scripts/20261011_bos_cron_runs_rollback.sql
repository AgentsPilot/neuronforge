-- ROLLBACK for supabase/migrations/20261011_bos_cron_runs.sql
-- (admin reorganisation slice 5, part B).
--
-- A separate file on purpose: it lives outside supabase/migrations/, so no
-- migration run can ever apply it by accident.
--
-- WHEN: only if the migration's access check (step 3) or dry run (step 4)
-- fails, or on instruction. Losing the run history is acceptable: it is
-- monitoring data, 30 days of it, with no owner content.
--
-- ORDER: PR-2 may stay deployed. The recorder treats a missing table as "not
-- installed yet": every cron keeps running exactly as before, and the admin
-- page says "Could not check: run recording is not installed yet". Reverting
-- PR-2 first is optional.
--
-- HOW: paste this whole file into the Supabase SQL editor on PROD and run it
-- once. It is safe to run twice. Then run the check at the bottom.

BEGIN;

DROP FUNCTION IF EXISTS public.admin_bos_cron_run_summary(text[], timestamptz, integer);
DROP TABLE IF EXISTS public.bos_cron_runs;
DROP TABLE IF EXISTS public.bos_cron_run_recording;

COMMIT;

-- CHECK (expect three nulls):
-- SELECT to_regclass('public.bos_cron_runs'),
--        to_regclass('public.bos_cron_run_recording'),
--        to_regprocedure('public.admin_bos_cron_run_summary(text[],timestamptz,integer)');
