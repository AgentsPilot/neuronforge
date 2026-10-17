-- 20261074_business_os_data_exports. Data export DE-8a, the Phase 1 export foundation
-- Requirement docs/requirements/BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md section 0.4.1 and 0.12
-- Workplan docs/workplans/BUSINESS_OS_DATA_EXPORT_DE8A_WORKPLAN.md sections 3 and 4
-- Creates the jobs table public.business_os_data_exports, the start function public.business_os_data_export_start
-- and the private bucket business-data-exports of 50 MB for application/zip only
-- The table and the function are for service_role only. Browser roles hold nothing (SA Q-1 and Q-4)
-- The start function enforces one export at a time and three per rolling 24 hours inside the database
-- Apply right after the deploy, then 20261075_operator_test_account_cleanup_data_exports
-- Pre-check scripts/precheck-business-os-data-exports.sql. Checker scripts/check-business-os-data-exports.sql
-- Probe scripts/probe-business-os-data-exports.sql. Rollback scripts/rollback-business-os-data-exports.sql
-- The whole file is one transaction. A failed pre-guard or post-condition applies nothing

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $pre_guard$
BEGIN
  IF pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') OR pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Data exports migration refused: anon or authenticated may create objects in schema public. Nothing was applied';
  END IF;
  IF pg_catalog.to_regclass('public.business_os_data_exports') IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Data exports migration refused: table public.business_os_data_exports already exists. Nothing was applied';
  END IF;
  IF pg_catalog.to_regprocedure('public.business_os_data_export_start(uuid, uuid, text)') IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Data exports migration refused: function public.business_os_data_export_start already exists. Nothing was applied';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets AS bucket WHERE bucket.id = 'business-data-exports') THEN
    RAISE EXCEPTION USING MESSAGE = 'Data exports migration refused: bucket business-data-exports already exists. Nothing was applied';
  END IF;
END
$pre_guard$;

CREATE TABLE public.business_os_data_exports (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  requested_by        uuid        NOT NULL,
  requested_by_kind   text        NOT NULL,
  status              text        NOT NULL DEFAULT 'running',
  failure_reason      text        NULL,
  bytes               bigint      NULL,
  file_count          integer     NULL,
  row_count           integer     NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz NULL,
  ready_at            timestamptz NULL,
  expires_at          timestamptz NULL,
  expired_at          timestamptz NULL,
  owner_downloaded_at timestamptz NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT business_os_data_exports_status_check
    CHECK (status IN ('queued', 'running', 'ready', 'failed', 'expired')),
  CONSTRAINT business_os_data_exports_kind_check
    CHECK (requested_by_kind IN ('owner', 'admin')),
  CONSTRAINT business_os_data_exports_owner_is_requester
    CHECK (requested_by_kind <> 'owner' OR requested_by = user_id),
  CONSTRAINT business_os_data_exports_failure_reason_check
    CHECK (failure_reason IS NULL OR failure_reason IN ('over_ceiling', 'timeout', 'error')),
  CONSTRAINT business_os_data_exports_failed_has_reason
    CHECK ((status = 'failed') = (failure_reason IS NOT NULL)),
  CONSTRAINT business_os_data_exports_finished_shape
    CHECK ((status IN ('queued', 'running')) = (finished_at IS NULL)),
  CONSTRAINT business_os_data_exports_ready_shape
    CHECK ((status IN ('ready', 'expired')) = (ready_at IS NOT NULL)),
  CONSTRAINT business_os_data_exports_expiry_shape
    CHECK ((ready_at IS NULL) = (expires_at IS NULL) AND (ready_at IS NULL OR expires_at = ready_at + interval '72 hours')),
  CONSTRAINT business_os_data_exports_expired_shape
    CHECK ((status = 'expired') = (expired_at IS NOT NULL)),
  CONSTRAINT business_os_data_exports_download_shape
    CHECK (owner_downloaded_at IS NULL OR ready_at IS NOT NULL),
  CONSTRAINT business_os_data_exports_counts_check
    CHECK ((bytes IS NULL OR bytes >= 0) AND (file_count IS NULL OR file_count >= 0) AND (row_count IS NULL OR row_count >= 0))
);

CREATE UNIQUE INDEX business_os_data_exports_one_in_progress
  ON public.business_os_data_exports (user_id)
  WHERE status IN ('queued', 'running');

CREATE INDEX business_os_data_exports_user_created
  ON public.business_os_data_exports (user_id, created_at DESC);

CREATE INDEX business_os_data_exports_ready_expiry
  ON public.business_os_data_exports (expires_at)
  WHERE status = 'ready';

ALTER TABLE public.business_os_data_exports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_os_data_exports FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_os_data_exports TO service_role;

CREATE FUNCTION public.business_os_data_export_start(p_user_id uuid, p_requested_by uuid, p_requested_by_kind text)
RETURNS TABLE (result_outcome text, result_job_id uuid, result_retry_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $start$
DECLARE
  v_in_progress_since timestamptz;
  v_third_newest      timestamptz;
  v_job_id            uuid;
BEGIN
  IF p_user_id IS NULL OR p_requested_by IS NULL OR p_requested_by_kind IS NULL
     OR p_requested_by_kind NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'data export start: invalid arguments';
  END IF;
  IF p_requested_by_kind = 'owner' AND p_requested_by <> p_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'data export start: an owner export must be requested by the owner';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('business_os_data_export:' || p_user_id::text, 0));

  UPDATE public.business_os_data_exports AS job
     SET status = 'failed', failure_reason = 'timeout', finished_at = now(), updated_at = now()
   WHERE job.user_id = p_user_id
     AND job.status = 'running'
     AND job.created_at < now() - interval '90 seconds';

  v_in_progress_since := (
    SELECT min(job.created_at) FROM public.business_os_data_exports AS job
     WHERE job.user_id = p_user_id AND job.status IN ('queued', 'running'));
  IF v_in_progress_since IS NOT NULL THEN
    RETURN QUERY SELECT 'in_progress'::text, NULL::uuid, v_in_progress_since + interval '90 seconds';
    RETURN;
  END IF;

  v_third_newest := (
    SELECT job.created_at FROM public.business_os_data_exports AS job
     WHERE job.user_id = p_user_id
       AND job.status IN ('running', 'ready', 'expired')
       AND job.created_at > now() - interval '24 hours'
     ORDER BY job.created_at DESC
     OFFSET 2 LIMIT 1);
  IF v_third_newest IS NOT NULL THEN
    RETURN QUERY SELECT 'daily_limit'::text, NULL::uuid, v_third_newest + interval '24 hours';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.business_os_data_exports AS new_job (user_id, requested_by, requested_by_kind, status)
    VALUES (p_user_id, p_requested_by, p_requested_by_kind, 'running')
    RETURNING new_job.id INTO v_job_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT 'in_progress'::text, NULL::uuid, now() + interval '90 seconds';
    RETURN;
  END;

  RETURN QUERY SELECT 'started'::text, v_job_id, NULL::timestamptz;
END;
$start$;

REVOKE ALL ON FUNCTION public.business_os_data_export_start(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.business_os_data_export_start(uuid, uuid, text) TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('business-data-exports', 'business-data-exports', false, 52428800, ARRAY['application/zip']::text[]);

DO $post_condition$
DECLARE
  v_table     regclass;
  v_function  regprocedure;
  v_role      text;
  v_privilege text;
  v_count     bigint;
  v_names     text;
BEGIN
  v_table := pg_catalog.to_regclass('public.business_os_data_exports');
  IF v_table IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Data exports post-condition 1: the table is missing so nothing was applied';
  END IF;
  IF NOT (SELECT cls.relrowsecurity FROM pg_catalog.pg_class AS cls WHERE cls.oid = v_table) THEN
    RAISE EXCEPTION USING MESSAGE = 'Data exports post-condition 1: row level security is off so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_policies AS pol
               WHERE pol.schemaname = 'public' AND pol.tablename = 'business_os_data_exports');
  IF v_count <> 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Data exports post-condition 1: the table has a policy so nothing was applied';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['public', 'anon', 'authenticated']
  LOOP
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    LOOP
      IF pg_catalog.has_table_privilege(v_role, v_table, v_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Data exports post-condition 2: ' || v_role || ' holds table ' || v_privilege || ' so nothing was applied';
      END IF;
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
    LOOP
      IF pg_catalog.has_any_column_privilege(v_role, v_table, v_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Data exports post-condition 2: ' || v_role || ' holds column ' || v_privilege || ' so nothing was applied';
      END IF;
    END LOOP;
  END LOOP;

  FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
  LOOP
    IF NOT pg_catalog.has_table_privilege('service_role', v_table, v_privilege) THEN
      RAISE EXCEPTION USING MESSAGE = 'Data exports post-condition 3: service_role lacks ' || v_privilege || ' so nothing was applied';
    END IF;
  END LOOP;
  FOREACH v_privilege IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER']
  LOOP
    IF pg_catalog.has_table_privilege('service_role', v_table, v_privilege) THEN
      RAISE EXCEPTION USING MESSAGE = 'Data exports post-condition 3: service_role holds ' || v_privilege || ' so nothing was applied';
    END IF;
  END LOOP;

  v_count := (SELECT count(*) FROM pg_catalog.pg_indexes AS idx
               JOIN pg_catalog.pg_class AS ic ON ic.relname = idx.indexname
               JOIN pg_catalog.pg_namespace AS ns ON ns.oid = ic.relnamespace AND ns.nspname = idx.schemaname
               JOIN pg_catalog.pg_index AS ix ON ix.indexrelid = ic.oid
               WHERE idx.schemaname = 'public'
                 AND idx.indexname = 'business_os_data_exports_one_in_progress'
                 AND ix.indisunique
                 AND idx.indexdef LIKE '%(user_id) WHERE (status = ANY (ARRAY[''queued''::text, ''running''::text]))');
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Data exports post-condition 4: the one-in-progress unique index is missing or has another predicate so nothing was applied';
  END IF;

  v_function := pg_catalog.to_regprocedure('public.business_os_data_export_start(uuid, uuid, text)');
  IF v_function IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Data exports post-condition 5: the start function is missing so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_proc AS fn
               WHERE fn.oid = v_function
                 AND NOT fn.prosecdef
                 AND fn.provolatile = 'v'
                 AND fn.proacl IS NOT NULL
                 AND fn.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
                 AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(fn.proacl) AS acl WHERE acl.grantee = 0));
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Data exports post-condition 5: the start function is not invoker, not volatile, lacks its search_path or is open to PUBLIC so nothing was applied';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Data exports post-condition 5: EXECUTE is not service_role only so nothing was applied';
  END IF;

  v_count := (SELECT count(*) FROM storage.buckets AS bucket
               WHERE bucket.id = 'business-data-exports'
                 AND bucket.name = 'business-data-exports'
                 AND bucket.public = false
                 AND bucket.file_size_limit = 52428800
                 AND bucket.allowed_mime_types = ARRAY['application/zip']::text[]);
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Data exports post-condition 6: the bucket is missing, public, not 50 MB or not zip only so nothing was applied';
  END IF;

  v_names := (SELECT string_agg(pol.policyname, ', ' ORDER BY pol.policyname) FROM pg_catalog.pg_policies AS pol
               WHERE pol.schemaname = 'storage' AND pol.tablename = 'objects'
                 AND (COALESCE(pol.qual, '') || COALESCE(pol.with_check, '')) LIKE '%business-data-exports%');
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Data exports post-condition 7: storage policies name the bucket so nothing was applied: ' || v_names;
  END IF;
  v_names := (SELECT string_agg(pol.policyname, ', ' ORDER BY pol.policyname) FROM pg_catalog.pg_policies AS pol
               WHERE pol.schemaname = 'storage' AND pol.tablename = 'objects'
                 AND pol.roles && ARRAY['public', 'anon', 'authenticated']::name[]
                 AND (COALESCE(pol.qual, '') || COALESCE(pol.with_check, '')) NOT LIKE '%bucket_id%');
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Data exports post-condition 7: storage policies open every bucket to browser roles so nothing was applied: ' || v_names;
  END IF;

  v_count := (SELECT count(*) FROM pg_catalog.pg_trigger AS trg WHERE trg.tgrelid = v_table AND NOT trg.tgisinternal);
  IF v_count <> 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Data exports post-condition 8: the table has a trigger so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con WHERE con.conrelid = v_table AND con.contype = 'f');
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Data exports post-condition 8: the table does not have exactly one foreign key so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con
               JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
               WHERE con.conrelid = v_table AND con.contype = 'f'
                 AND con.confrelid = pg_catalog.to_regclass('auth.users')
                 AND con.confdeltype = 'c'
                 AND pg_catalog.array_length(con.conkey, 1) = 1
                 AND att.attname = 'user_id');
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Data exports post-condition 8: the foreign key is not user_id to auth.users on delete cascade so nothing was applied';
  END IF;
END
$post_condition$;

NOTIFY pgrst, 'reload schema';

COMMIT;
