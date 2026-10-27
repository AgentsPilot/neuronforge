-- 20261095_business_os_export_requests. Module export MX-1a, the request and module job storage
-- Requirement docs/requirements/BUSINESS_OS_EXPORT_REDESIGN_REQUIREMENT.md section 4.4 BQ-29, XC-7, XC-8, XC-9, XC-20
-- Workplan docs/workplans/BUSINESS_OS_EXPORT_MX1A_WORKPLAN.md section 3 with SA Review Notes 2026-10-26 M-1 to M-6
-- Creates public.business_os_export_requests, one row per export click, and public.business_os_export_module_jobs,
-- one row per module of that click. The jobs table is the queue the MX-3 worker drains
-- Creates the start function public.business_os_export_request_start. It holds every limit as a literal and takes
-- one advisory lock per account. An owner may start 2 requests per rolling 24 hours and one at a time. An admin may
-- send 2 per owner per rolling 24 hours, counted apart. A request whose every job failed or was interrupted does not count
-- Creates the claim function public.business_os_export_module_jobs_claim_due and the reap function
-- public.business_os_export_module_jobs_reap. Both run with the rights of their caller and are for service_role only
-- The lease of 420 seconds is a literal in both, with no lease parameter. The claim takes waiting jobs and due notices
-- The reaper judges a stale working job by its parts. All accepted is sent. Any part is interrupted, never sent again
-- No part is a retry, or failed after 3 attempts. A notice claimed 5 times is given up
-- That is a ruled deviation from the durable-queue-drain skill, which uses SECURITY DEFINER and a lease parameter
-- SA MX1A-6 and MX1A-8, the DL-1a O-4 precedent. The notice branch keeps the lease in its predicate
-- Both tables have RLS on and no policy. Browser roles hold nothing. service_role holds SELECT, INSERT, UPDATE and DELETE
-- Apply BEFORE 20261096_operator_test_account_cleanup_export_requests, in the same sitting. From this apply until the
-- 20261096 build is live, every test account check and delete refuses on G-10, because the live 20261094 function has
-- not reviewed the two new links to the login. That fails closed (SA F-A)
-- Pre-check scripts/precheck-export-requests.sql. Checker scripts/check-export-requests-migration.sql
-- Rollback supabase/SQL Scripts/20261095_business_os_export_requests_rollback.sql, run only after the 20261096 rollback
-- The whole file is one transaction. A failed pre-guard or post-condition applies nothing

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $pre_guard$
BEGIN
  IF pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') OR pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Export requests migration refused: anon or authenticated may create objects in schema public. Nothing was applied';
  END IF;
  IF pg_catalog.to_regclass('public.business_os_export_requests') IS NOT NULL OR pg_catalog.to_regclass('public.business_os_export_module_jobs') IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Export requests migration refused: a table of this migration already exists. Nothing was applied';
  END IF;
  IF pg_catalog.to_regprocedure('public.business_os_export_request_start(uuid, text, uuid, text[])') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.business_os_export_module_jobs_claim_due(uuid, integer)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.business_os_export_module_jobs_reap()') IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Export requests migration refused: a function of this migration already exists. Nothing was applied';
  END IF;
  IF pg_catalog.to_regclass('public.business_os_account_closures') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Export requests migration refused: 20261093 is not applied, so 20261094 is not the live base. Nothing was applied';
  END IF;
  IF pg_catalog.to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Export requests migration refused: gen_random_uuid() does not resolve. Nothing was applied';
  END IF;
END
$pre_guard$;

CREATE TABLE public.business_os_export_requests (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid        NOT NULL,
  origin                   text        NOT NULL,
  admin_actor_id           uuid        NULL,
  modules                  text[]      NOT NULL,
  requested_at             timestamptz NOT NULL DEFAULT now(),
  requested_email_sent_at  timestamptz NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT business_os_export_requests_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT business_os_export_requests_origin_check
    CHECK (origin IN ('owner', 'admin')),
  CONSTRAINT business_os_export_requests_admin_shape
    CHECK ((origin = 'admin') = (admin_actor_id IS NOT NULL)),
  CONSTRAINT business_os_export_requests_modules_shape
    CHECK (cardinality(modules) BETWEEN 1 AND 32
           AND array_position(modules, NULL) IS NULL
           AND array_to_string(modules, ',') ~ '^[a-z][a-z0-9_]{1,39}(,[a-z][a-z0-9_]{1,39})*$'
           AND cardinality(string_to_array(array_to_string(modules, ','), ',')) = cardinality(modules))
);

CREATE INDEX business_os_export_requests_user_requested
  ON public.business_os_export_requests (user_id, requested_at DESC);

CREATE TABLE public.business_os_export_module_jobs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        uuid        NOT NULL,
  user_id           uuid        NOT NULL,
  module            text        NOT NULL,
  status            text        NOT NULL DEFAULT 'waiting',
  parts_total       integer     NULL,
  parts             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  row_count         integer     NULL,
  failure_code      text        NULL,
  notice_state      text        NOT NULL DEFAULT 'none',
  notice_attempts   integer     NOT NULL DEFAULT 0,
  notice_sent_at    timestamptz NULL,
  notice_resend_id  text        NULL,
  claimed_by        uuid        NULL,
  claimed_at        timestamptz NULL,
  attempts          integer     NOT NULL DEFAULT 0,
  next_attempt_at   timestamptz NULL,
  last_error_code   text        NULL,
  started_at        timestamptz NULL,
  sent_at           timestamptz NULL,
  finished_at       timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT business_os_export_module_jobs_request_id_fkey
    FOREIGN KEY (request_id) REFERENCES public.business_os_export_requests (id) ON DELETE CASCADE,
  CONSTRAINT business_os_export_module_jobs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT business_os_export_module_jobs_one_per_module
    UNIQUE (request_id, module),
  CONSTRAINT business_os_export_module_jobs_status_check
    CHECK (status IN ('waiting', 'working', 'sent', 'failed', 'interrupted')),
  CONSTRAINT business_os_export_module_jobs_notice_state_check
    CHECK (notice_state IN ('none', 'due', 'sent', 'given_up')),
  CONSTRAINT business_os_export_module_jobs_codes_shape
    CHECK (module ~ '^[a-z][a-z0-9_]{1,39}$'
           AND (failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{1,39}$')
           AND (last_error_code IS NULL OR last_error_code ~ '^[a-z][a-z0-9_]{1,39}$')),
  CONSTRAINT business_os_export_module_jobs_counts_check
    CHECK (attempts >= 0 AND notice_attempts >= 0
           AND (row_count IS NULL OR row_count >= 0)
           AND (parts_total IS NULL OR parts_total >= 1)
           AND (notice_resend_id IS NULL OR char_length(notice_resend_id) <= 128)),
  CONSTRAINT business_os_export_module_jobs_claim_pair
    CHECK ((claimed_by IS NULL) = (claimed_at IS NULL)),
  CONSTRAINT business_os_export_module_jobs_claim_shape
    CHECK ((status <> 'working' OR claimed_by IS NOT NULL) AND (status NOT IN ('waiting', 'sent') OR claimed_by IS NULL)),
  CONSTRAINT business_os_export_module_jobs_waiting_has_no_parts
    CHECK (status <> 'waiting' OR (parts = '[]'::jsonb AND parts_total IS NULL)),
  CONSTRAINT business_os_export_module_jobs_parts_shape
    CHECK (CASE WHEN jsonb_typeof(parts) = 'array'
                THEN (CASE WHEN parts_total IS NULL THEN jsonb_array_length(parts) = 0 ELSE jsonb_array_length(parts) <= parts_total END)
                     AND jsonb_array_length(jsonb_path_query_array(parts, 'strict $[*] ? (@.type() == "object" && @.n.type() == "number" && @.state.type() == "string" && (@.state == "sending" || @.state == "accepted"))')) = jsonb_array_length(parts)
                ELSE false END),
  CONSTRAINT business_os_export_module_jobs_sent_shape
    CHECK ((status = 'sent') = (sent_at IS NOT NULL)
           AND (status <> 'sent' OR CASE WHEN jsonb_typeof(parts) = 'array' AND parts_total IS NOT NULL
                                         THEN jsonb_array_length(parts) = parts_total
                                              AND jsonb_array_length(jsonb_path_query_array(parts, 'strict $[*] ? (@.state == "accepted")')) = parts_total
                                         ELSE false END)),
  CONSTRAINT business_os_export_module_jobs_failure_shape
    CHECK ((status IN ('failed', 'interrupted')) = (failure_code IS NOT NULL)
           AND (status <> 'interrupted' OR (failure_code = 'interrupted'
                                            AND CASE WHEN jsonb_typeof(parts) = 'array' THEN jsonb_array_length(parts) > 0 ELSE false END))),
  CONSTRAINT business_os_export_module_jobs_notice_shape
    CHECK ((status IN ('failed', 'interrupted')) = (notice_state <> 'none')
           AND (notice_state = 'sent') = (notice_sent_at IS NOT NULL)),
  CONSTRAINT business_os_export_module_jobs_finished_shape
    CHECK ((status IN ('sent', 'failed', 'interrupted')) = (finished_at IS NOT NULL))
);

CREATE INDEX business_os_export_module_jobs_user_created
  ON public.business_os_export_module_jobs (user_id, created_at DESC);

CREATE INDEX business_os_export_module_jobs_waiting
  ON public.business_os_export_module_jobs (next_attempt_at NULLS FIRST, created_at)
  WHERE status = 'waiting';

CREATE INDEX business_os_export_module_jobs_notice_due
  ON public.business_os_export_module_jobs (created_at)
  WHERE notice_state = 'due';

CREATE INDEX business_os_export_module_jobs_working
  ON public.business_os_export_module_jobs (claimed_at)
  WHERE status = 'working';

ALTER TABLE public.business_os_export_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.business_os_export_module_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_os_export_requests FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_os_export_requests TO service_role;

REVOKE ALL ON TABLE public.business_os_export_module_jobs FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_os_export_module_jobs TO service_role;

CREATE FUNCTION public.business_os_export_request_start(p_user_id uuid, p_origin text, p_admin_actor_id uuid, p_modules text[])
RETURNS TABLE (result_outcome text, result_request_id uuid, result_retry_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $start$
DECLARE
  v_limit       integer;
  v_retry_from  timestamptz;
  v_request_id  uuid;
BEGIN
  IF p_user_id IS NULL OR p_origin IS NULL OR p_modules IS NULL OR array_ndims(p_modules) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'export request start: invalid arguments';
  END IF;
  IF p_origin NOT IN ('owner', 'admin')
     OR (p_origin = 'admin') <> (p_admin_actor_id IS NOT NULL)
     OR cardinality(p_modules) < 1 OR cardinality(p_modules) > 32
     OR array_position(p_modules, NULL) IS NOT NULL
     OR EXISTS (SELECT 1 FROM unnest(p_modules) AS given(module) WHERE given.module !~ '^[a-z][a-z0-9_]{1,39}$')
     OR cardinality(ARRAY(SELECT DISTINCT given.module FROM unnest(p_modules) AS given(module))) <> cardinality(p_modules) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'export request start: invalid arguments';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('business_os_export_request:' || p_user_id::text, 0));

  IF EXISTS (
    SELECT 1 FROM public.business_os_export_requests AS req
      JOIN public.business_os_export_module_jobs AS job ON job.request_id = req.id
     WHERE req.user_id = p_user_id
       AND req.origin = p_origin
       AND job.status IN ('waiting', 'working')
  ) THEN
    RETURN QUERY SELECT 'in_progress'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  v_limit := CASE WHEN p_origin = 'owner' THEN 2 ELSE 2 END;

  v_retry_from := (
    SELECT req.requested_at FROM public.business_os_export_requests AS req
     WHERE req.user_id = p_user_id
       AND req.origin = p_origin
       AND req.requested_at > now() - interval '24 hours'
       AND EXISTS (SELECT 1 FROM public.business_os_export_module_jobs AS job
                    WHERE job.request_id = req.id AND job.status NOT IN ('failed', 'interrupted'))
     ORDER BY req.requested_at DESC
     OFFSET (v_limit - 1) LIMIT 1);
  IF v_retry_from IS NOT NULL THEN
    RETURN QUERY SELECT 'daily_limit'::text, NULL::uuid, v_retry_from + interval '24 hours';
    RETURN;
  END IF;

  v_request_id := gen_random_uuid();

  INSERT INTO public.business_os_export_requests (id, user_id, origin, admin_actor_id, modules)
  VALUES (v_request_id, p_user_id, p_origin, p_admin_actor_id, p_modules);

  INSERT INTO public.business_os_export_module_jobs (request_id, user_id, module)
  SELECT v_request_id, p_user_id, given.module FROM unnest(p_modules) AS given(module);

  RETURN QUERY SELECT 'started'::text, v_request_id, NULL::timestamptz;
END;
$start$;

REVOKE ALL ON FUNCTION public.business_os_export_request_start(uuid, text, uuid, text[]) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.business_os_export_request_start(uuid, text, uuid, text[]) TO service_role;

CREATE FUNCTION public.business_os_export_module_jobs_claim_due(p_runner uuid, p_batch integer)
RETURNS SETOF public.business_os_export_module_jobs
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $claim$
  WITH due AS (
    SELECT job.id FROM public.business_os_export_module_jobs AS job
     WHERE p_runner IS NOT NULL
       AND (
         (job.status = 'waiting' AND (job.next_attempt_at IS NULL OR job.next_attempt_at <= now()))
         OR (job.notice_state = 'due' AND job.notice_attempts < 5
             AND (job.claimed_at IS NULL OR job.claimed_at < now() - interval '420 seconds'))
       )
     ORDER BY job.created_at
     LIMIT LEAST(GREATEST(coalesce(p_batch, 1), 1), 10)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.business_os_export_module_jobs AS job
     SET status          = CASE WHEN job.status = 'waiting' THEN 'working' ELSE job.status END,
         attempts        = CASE WHEN job.status = 'waiting' THEN job.attempts + 1 ELSE job.attempts END,
         notice_attempts = CASE WHEN job.notice_state = 'due' THEN job.notice_attempts + 1 ELSE job.notice_attempts END,
         started_at      = CASE WHEN job.status = 'waiting' THEN coalesce(job.started_at, now()) ELSE job.started_at END,
         claimed_by      = p_runner,
         claimed_at      = now(),
         updated_at      = now()
    FROM due
   WHERE job.id = due.id
  RETURNING job.*;
$claim$;

REVOKE ALL ON FUNCTION public.business_os_export_module_jobs_claim_due(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.business_os_export_module_jobs_claim_due(uuid, integer) TO service_role;

CREATE FUNCTION public.business_os_export_module_jobs_reap()
RETURNS SETOF public.business_os_export_module_jobs
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $reap$
  WITH stale AS (
    SELECT job.id,
           CASE
             WHEN job.status = 'working' AND job.parts_total IS NOT NULL
                  AND jsonb_array_length(job.parts) = job.parts_total
                  AND jsonb_array_length(jsonb_path_query_array(job.parts, 'strict $[*] ? (@.state == "accepted")')) = job.parts_total
               THEN 'sent'
             WHEN job.status = 'working' AND jsonb_array_length(job.parts) > 0 THEN 'interrupted'
             WHEN job.status = 'working' AND job.attempts >= 3 THEN 'failed'
             WHEN job.status = 'working' THEN 'retry'
             ELSE 'notice_given_up'
           END AS verdict
      FROM public.business_os_export_module_jobs AS job
     WHERE (job.status = 'working' AND job.claimed_at < now() - interval '420 seconds')
        OR (job.notice_state = 'due' AND job.notice_attempts >= 5
            AND (job.claimed_at IS NULL OR job.claimed_at < now() - interval '420 seconds'))
     ORDER BY job.claimed_at NULLS FIRST, job.created_at
     LIMIT 100
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.business_os_export_module_jobs AS job
     SET status          = CASE stale.verdict WHEN 'sent' THEN 'sent' WHEN 'interrupted' THEN 'interrupted'
                                              WHEN 'failed' THEN 'failed' WHEN 'retry' THEN 'waiting' ELSE job.status END,
         failure_code    = CASE stale.verdict WHEN 'interrupted' THEN 'interrupted' WHEN 'failed' THEN 'attempts_exhausted'
                                              ELSE job.failure_code END,
         notice_state    = CASE stale.verdict WHEN 'interrupted' THEN 'due' WHEN 'failed' THEN 'due'
                                              WHEN 'notice_given_up' THEN 'given_up' ELSE job.notice_state END,
         sent_at         = CASE stale.verdict WHEN 'sent' THEN now() ELSE job.sent_at END,
         finished_at     = CASE WHEN stale.verdict IN ('sent', 'interrupted', 'failed') THEN now() ELSE job.finished_at END,
         parts_total     = CASE stale.verdict WHEN 'retry' THEN NULL ELSE job.parts_total END,
         next_attempt_at = CASE stale.verdict WHEN 'retry' THEN now() + interval '60 seconds' * job.attempts ELSE job.next_attempt_at END,
         last_error_code = CASE stale.verdict WHEN 'retry' THEN 'lease_expired' ELSE job.last_error_code END,
         claimed_by      = NULL,
         claimed_at      = NULL,
         updated_at      = now()
    FROM stale
   WHERE job.id = stale.id
  RETURNING job.*;
$reap$;

REVOKE ALL ON FUNCTION public.business_os_export_module_jobs_reap() FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.business_os_export_module_jobs_reap() TO service_role;

DO $post_condition$
DECLARE
  v_table     regclass;
  v_tables    regclass[];
  v_function  regprocedure;
  v_role      text;
  v_privilege text;
  v_count     bigint;
BEGIN
  v_tables := ARRAY[pg_catalog.to_regclass('public.business_os_export_requests'), pg_catalog.to_regclass('public.business_os_export_module_jobs')];
  IF array_position(v_tables, NULL) IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 1: a table is missing so nothing was applied';
  END IF;

  FOREACH v_table IN ARRAY v_tables
  LOOP
    IF NOT (SELECT cls.relrowsecurity FROM pg_catalog.pg_class AS cls WHERE cls.oid = v_table) THEN
      RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 1: row level security is off on ' || v_table::text || ' so nothing was applied';
    END IF;
    v_count := (SELECT count(*) FROM pg_catalog.pg_policy AS pol WHERE pol.polrelid = v_table);
    IF v_count <> 0 THEN
      RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 1: ' || v_table::text || ' has a policy so nothing was applied';
    END IF;

    FOREACH v_role IN ARRAY ARRAY['public', 'anon', 'authenticated']
    LOOP
      FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
      LOOP
        IF pg_catalog.has_table_privilege(v_role, v_table, v_privilege) THEN
          RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 2: ' || v_role || ' holds table ' || v_privilege || ' on ' || v_table::text || ' so nothing was applied';
        END IF;
      END LOOP;
      FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
      LOOP
        IF pg_catalog.has_any_column_privilege(v_role, v_table, v_privilege) THEN
          RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 2: ' || v_role || ' holds column ' || v_privilege || ' on ' || v_table::text || ' so nothing was applied';
        END IF;
      END LOOP;
    END LOOP;

    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
    LOOP
      IF NOT pg_catalog.has_table_privilege('service_role', v_table, v_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 3: service_role lacks ' || v_privilege || ' on ' || v_table::text || ' so nothing was applied';
      END IF;
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER']
    LOOP
      IF pg_catalog.has_table_privilege('service_role', v_table, v_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 3: service_role holds ' || v_privilege || ' on ' || v_table::text || ' so nothing was applied';
      END IF;
    END LOOP;

    v_count := (SELECT count(*) FROM pg_catalog.pg_trigger AS trg WHERE trg.tgrelid = v_table AND NOT trg.tgisinternal);
    IF v_count <> 0 THEN
      RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 4: ' || v_table::text || ' has a trigger so nothing was applied';
    END IF;
  END LOOP;

  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con WHERE con.conrelid = v_tables[1] AND con.contype = 'f');
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 5: the requests table does not have exactly one foreign key so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con WHERE con.conrelid = v_tables[2] AND con.contype = 'f');
  IF v_count <> 2 THEN
    RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 5: the jobs table does not have exactly two foreign keys so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con
               JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
               WHERE con.contype = 'f' AND con.confdeltype = 'c' AND pg_catalog.array_length(con.conkey, 1) = 1
                 AND ((con.conrelid = v_tables[1] AND con.conname = 'business_os_export_requests_user_id_fkey'
                       AND con.confrelid = pg_catalog.to_regclass('auth.users') AND att.attname = 'user_id')
                   OR (con.conrelid = v_tables[2] AND con.conname = 'business_os_export_module_jobs_user_id_fkey'
                       AND con.confrelid = pg_catalog.to_regclass('auth.users') AND att.attname = 'user_id')
                   OR (con.conrelid = v_tables[2] AND con.conname = 'business_os_export_module_jobs_request_id_fkey'
                       AND con.confrelid = v_tables[1] AND att.attname = 'request_id')));
  IF v_count <> 3 THEN
    RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 5: a foreign key is missing, renamed, not single column or not on delete cascade so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con WHERE con.contype = 'f' AND con.confrelid = ANY (v_tables));
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 5: a foreign key other than jobs request_id points at a table of this migration so nothing was applied';
  END IF;

  v_count := (SELECT count(*) FROM pg_catalog.pg_indexes AS idx
               JOIN pg_catalog.pg_class AS ic ON ic.relname = idx.indexname
               JOIN pg_catalog.pg_namespace AS ns ON ns.oid = ic.relnamespace AND ns.nspname = idx.schemaname
               JOIN pg_catalog.pg_index AS ix ON ix.indexrelid = ic.oid
               WHERE idx.schemaname = 'public'
                 AND idx.indexname = 'business_os_export_module_jobs_one_per_module'
                 AND ix.indisunique
                 AND idx.indexdef LIKE '%(request_id, module)');
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 6: the one-per-module unique index is missing so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_indexes AS idx
               WHERE idx.schemaname = 'public'
                 AND ((idx.indexname = 'business_os_export_module_jobs_waiting' AND idx.indexdef LIKE '%WHERE (status = ''waiting''::text)')
                   OR (idx.indexname = 'business_os_export_module_jobs_notice_due' AND idx.indexdef LIKE '%WHERE (notice_state = ''due''::text)')
                   OR (idx.indexname = 'business_os_export_module_jobs_working' AND idx.indexdef LIKE '%WHERE (status = ''working''::text)')));
  IF v_count <> 3 THEN
    RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 6: a queue index is missing or has another predicate so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_indexes AS idx
               WHERE idx.schemaname = 'public'
                 AND idx.indexname IN ('business_os_export_requests_user_requested', 'business_os_export_module_jobs_user_created'));
  IF v_count <> 2 THEN
    RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 6: a per-user index is missing so nothing was applied';
  END IF;

  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con
               WHERE con.contype = 'c' AND con.conrelid = v_tables[1]
                 AND con.conname IN ('business_os_export_requests_origin_check', 'business_os_export_requests_admin_shape',
                                     'business_os_export_requests_modules_shape'));
  IF v_count <> 3 THEN
    RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 7: a named CHECK of the requests table is missing so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con
               WHERE con.contype = 'c' AND con.conrelid = v_tables[2]
                 AND con.conname IN ('business_os_export_module_jobs_status_check', 'business_os_export_module_jobs_notice_state_check',
                                     'business_os_export_module_jobs_codes_shape', 'business_os_export_module_jobs_counts_check',
                                     'business_os_export_module_jobs_claim_pair', 'business_os_export_module_jobs_claim_shape',
                                     'business_os_export_module_jobs_waiting_has_no_parts', 'business_os_export_module_jobs_parts_shape',
                                     'business_os_export_module_jobs_sent_shape', 'business_os_export_module_jobs_failure_shape',
                                     'business_os_export_module_jobs_notice_shape', 'business_os_export_module_jobs_finished_shape'));
  IF v_count <> 12 THEN
    RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 7: a named CHECK of the jobs table is missing so nothing was applied';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    pg_catalog.to_regprocedure('public.business_os_export_request_start(uuid, text, uuid, text[])'),
    pg_catalog.to_regprocedure('public.business_os_export_module_jobs_claim_due(uuid, integer)'),
    pg_catalog.to_regprocedure('public.business_os_export_module_jobs_reap()')]
  LOOP
    IF v_function IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 8: a function is missing so nothing was applied';
    END IF;
    v_count := (SELECT count(*) FROM pg_catalog.pg_proc AS fn
                 WHERE fn.oid = v_function
                   AND NOT fn.prosecdef
                   AND fn.provolatile = 'v'
                   AND fn.proacl IS NOT NULL
                   AND fn.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
                   AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(fn.proacl) AS acl WHERE acl.grantee = 0));
    IF v_count <> 1 THEN
      RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 8: ' || v_function::text || ' is not invoker, not volatile, lacks its search_path or is open to PUBLIC so nothing was applied';
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE = 'Export requests post-condition 8: EXECUTE on ' || v_function::text || ' is not service_role only so nothing was applied';
    END IF;
  END LOOP;
END
$post_condition$;

NOTIFY pgrst, 'reload schema';

COMMIT;
