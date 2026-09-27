-- Business OS cron run record (admin reorganisation slice 5, part B).
--
-- Requirement: docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md (§7 slice 5, S5.6, OQ-6)
-- Workplan:    docs/workplans/ADMIN_MODULE_BOS_REORGANISATION_SLICE5_WORKPLAN.md (§5, SA SC-3, SC-5)
-- Rollback:    supabase/SQL Scripts/20261011_bos_cron_runs_rollback.sql (a separate file, so it can
--              never be applied by accident as part of a migration run)
--
-- ── WHAT THIS IS ────────────────────────────────────────────────────────────
-- Two tables and one read function:
--   bos_cron_runs              one row per authorised run of a Business OS cron:
--                              job, start, deadline, finish, outcome word, error
--                              CLASS and numeric counts. No user id, no business
--                              id, no owner text: the CHECKs below refuse it.
--   bos_cron_run_recording     one row: when recording was installed. It lets the
--                              admin page tell "no job has ever recorded" (every
--                              job goes late, then stopped) from "just installed".
--   admin_bos_cron_run_summary per job: runs and bad runs in 24 h / 7 d, the last
--                              Vercel cron start, the latest runs and the latest
--                              bad runs. One round trip for the admin page.
--
-- The only writer is lib/cron/cronRunRecorder.ts (service role), and only for a
-- request proven to be Vercel's own cron call. The only reader is the admin
-- jobs & queues read (service role, behind requireAdmin). Applying this changes
-- nothing a customer sees; the crons keep working whether or not it is applied.
--
-- ── APPLY ORDER (by hand, PROD, Supabase SQL editor) ────────────────────────
--   1. Pre-check (read-only, below). Any STOP: do not apply.
--   2. Apply this file: one paste, one transaction. BEFORE PR-2 deploys (the code
--      tolerates the reverse: jobs run as before, the page says "not installed yet").
--   3. Access check (below): one row, every column true. Any false: run the rollback.
--   4. Dry run (below): always ends in an error ON PURPOSE; its text must start
--      with DRY RUN PASS. Then "nothing kept". Anything else: stop, do not merge,
--      send the text to Dev.
--   Rollback only if step 3 or 4 fails (supabase/SQL Scripts/20261011_bos_cron_runs_rollback.sql).
--
-- The runbook SQL lives here, inside the block comment below, so each query can
-- be copied exactly as written. The SQL editor shows only the last statement's
-- result, so each step is one statement, or one DO block that reports by raising.
--
-- ── DESIGN (why it looks like this) ─────────────────────────────────────────
-- * CHECKs, not code, keep owner text out (FR-R5, SA SC-3): counts must be a
--   small object of numbers with plain keys (the numbers-only path is STRICT, so
--   an array value is refused rather than unwrapped); error_class is a closed list; a
--   failed run always has a class; a running row has no finish fields; a
--   deadline cannot sit more than 20 minutes after its start (so a registry bug
--   cannot hide "did not finish" forever). CHECKs use immutable expressions
--   only: Postgres refuses subqueries there.
-- * "Did not finish" is DERIVED (running AND deadline_at < now), never stored.
-- * RLS on with NO policy. REVOKE ALL from PUBLIC, anon, authenticated AND
--   service_role, then GRANT back exactly what is used (the 20261005/20261010
--   lesson: an enumerated REVOKE goes stale).
-- * The function is SECURITY INVOKER, STABLE, LANGUAGE sql (so its body is
--   checked at creation), with an empty search_path and every name
--   schema-qualified; EXECUTE for service_role only. It clamps its own limits:
--   at most 50 jobs, 1..20 recent runs.
-- * Plain CREATE (tables AND function, never OR REPLACE / IF NOT EXISTS), one
--   transaction: a second paste fails at the first CREATE and changes nothing
--   (the pre-check says "already applied" first).

/* ═══════════════════════════ RUNBOOK SQL ═══════════════════════════════════

-- ── STEP 1: PRE-CHECK (read-only; one SELECT; four rows, each PASS or STOP) ──

SELECT check_id, status, detail
FROM (
  SELECT 'P01 names free (not already applied)' AS check_id,
         CASE WHEN to_regclass('public.bos_cron_runs') IS NULL
               AND to_regclass('public.bos_cron_run_recording') IS NULL
               AND to_regprocedure('public.admin_bos_cron_run_summary(text[],timestamptz,integer)') IS NULL
              THEN 'PASS' ELSE 'STOP: already applied, do not apply again' END AS status,
         'bos_cron_runs=' || COALESCE(to_regclass('public.bos_cron_runs')::text, 'absent')
           || ', bos_cron_run_recording=' || COALESCE(to_regclass('public.bos_cron_run_recording')::text, 'absent') AS detail
  UNION ALL
  SELECT 'P02 Postgres 12+ (jsonb_path_exists)',
         CASE WHEN current_setting('server_version_num')::int >= 120000 THEN 'PASS' ELSE 'STOP' END,
         current_setting('server_version')
  UNION ALL
  SELECT 'P03 gen_random_uuid() resolves',
         CASE WHEN to_regprocedure('gen_random_uuid()') IS NOT NULL THEN 'PASS' ELSE 'STOP' END,
         COALESCE(to_regprocedure('gen_random_uuid()')::text, 'missing')
  UNION ALL
  SELECT 'P04 role service_role exists',
         CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN 'PASS' ELSE 'STOP' END,
         'service_role'
) AS report
ORDER BY check_id;

-- ── STEP 3: ACCESS CHECK (read-only; one row; every column must be true) ────

SELECT
  NOT has_table_privilege('anon', 'public.bos_cron_runs',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')          AS anon_no_runs,
  NOT has_table_privilege('authenticated', 'public.bos_cron_runs',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')          AS authenticated_no_runs,
  NOT has_table_privilege('anon', 'public.bos_cron_run_recording',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')          AS anon_no_recording,
  NOT has_table_privilege('authenticated', 'public.bos_cron_run_recording',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')          AS authenticated_no_recording,
  NOT has_function_privilege('anon',
        'public.admin_bos_cron_run_summary(text[], timestamptz, integer)', 'EXECUTE') AS anon_cannot_execute,
  NOT has_function_privilege('authenticated',
        'public.admin_bos_cron_run_summary(text[], timestamptz, integer)', 'EXECUTE') AS authenticated_cannot_execute,
  has_function_privilege('service_role',
        'public.admin_bos_cron_run_summary(text[], timestamptz, integer)', 'EXECUTE') AS service_role_can_execute,
  NOT (SELECT p.prosecdef FROM pg_proc p
       WHERE p.oid = 'public.admin_bos_cron_run_summary(text[], timestamptz, integer)'::regprocedure)
                                                                                   AS function_is_invoker,
  (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.bos_cron_runs'::regclass)          AS rls_on_runs,
  (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.bos_cron_run_recording'::regclass) AS rls_on_recording,
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
              AND tablename IN ('bos_cron_runs', 'bos_cron_run_recording'))        AS no_policies,
  -- One privilege per call: with a list, has_table_privilege is true if ANY is held.
  (has_table_privilege('service_role', 'public.bos_cron_runs', 'SELECT')
   AND has_table_privilege('service_role', 'public.bos_cron_runs', 'INSERT')
   AND has_table_privilege('service_role', 'public.bos_cron_runs', 'UPDATE')
   AND has_table_privilege('service_role', 'public.bos_cron_runs', 'DELETE')
   AND has_table_privilege('service_role', 'public.bos_cron_run_recording', 'SELECT'))
                                                                                   AS service_role_has_what_it_uses,
  NOT has_table_privilege('service_role', 'public.bos_cron_runs', 'TRUNCATE, REFERENCES, TRIGGER')
                                                                                   AS service_role_no_extra_on_runs,
  NOT has_table_privilege('service_role', 'public.bos_cron_run_recording',
        'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')                   AS service_role_reads_recording_only,
  (SELECT count(*) = 1 FROM public.bos_cron_run_recording)                         AS one_recording_row;

-- ── STEP 4: DRY RUN (always ends in an error ON PURPOSE; nothing is kept) ───
-- Expect the error text to start with "DRY RUN PASS". Anything else (DRY RUN
-- FAIL, or any other error): stop, do not merge, send the full text to Dev.

DO $dry$
DECLARE
  v_now     timestamptz := now();
  v_fail    boolean := false;
  v_report  text := '';
  v_r       record;
  v_rows    integer;
  v_id_ok   uuid := gen_random_uuid();
  v_id_dnf  uuid := gen_random_uuid();
  v_id_old  uuid := gen_random_uuid();
  v_id_keep uuid := gen_random_uuid();
BEGIN
  -- Act as the role the app uses, so the grants are proven, not only the logic.
  SET LOCAL ROLE service_role;

  -- D-1: a normal run: insert running, then finish it.
  INSERT INTO public.bos_cron_runs (id, job, source, started_at, deadline_at)
  VALUES (v_id_ok, 'dry-run-job', 'vercel_cron', v_now - interval '1 minute', v_now + interval '1 minute');
  UPDATE public.bos_cron_runs
     SET finished_at = v_now, outcome = 'succeeded', duration_ms = 1200, http_status = 200, counts = '{"sent": 2}'
   WHERE id = v_id_ok AND outcome = 'running';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 1 THEN v_report := v_report || 'D-1 PASS | ';
  ELSE v_fail := true; v_report := v_report || 'D-1 FAIL: finish updated ' || v_rows || ' rows | '; END IF;

  -- D-2 .. D-7: the CHECKs refuse what must never be stored.
  BEGIN
    INSERT INTO public.bos_cron_runs (job, source, started_at, deadline_at, counts)
    VALUES ('dry-run-job', 'other', v_now, v_now + interval '1 minute', '{"note": "a@b.c"}');
    v_fail := true; v_report := v_report || 'D-2 FAIL: a string count was stored | ';
  EXCEPTION WHEN check_violation THEN v_report := v_report || 'D-2 PASS (numbers only) | ';
  END;
  BEGIN
    INSERT INTO public.bos_cron_runs (job, source, started_at, deadline_at, counts)
    VALUES ('dry-run-job', 'other', v_now, v_now + interval '1 minute', '{"a": [1]}');
    v_fail := true; v_report := v_report || 'D-2a FAIL: an array of numbers was stored | ';
  EXCEPTION WHEN check_violation THEN v_report := v_report || 'D-2a PASS (no array, strict) | ';
  END;
  BEGIN
    INSERT INTO public.bos_cron_runs (job, source, started_at, deadline_at, counts)
    VALUES ('dry-run-job', 'other', v_now, v_now + interval '1 minute', '{"a": []}');
    v_fail := true; v_report := v_report || 'D-2b FAIL: an empty array was stored | ';
  EXCEPTION WHEN check_violation THEN v_report := v_report || 'D-2b PASS (no empty array, strict) | ';
  END;
  BEGIN
    INSERT INTO public.bos_cron_runs (job, source, started_at, deadline_at, counts)
    VALUES ('dry-run-job', 'other', v_now, v_now + interval '1 minute', '{"a": {"b": 1}}');
    v_fail := true; v_report := v_report || 'D-2c FAIL: a nested object was stored | ';
  EXCEPTION WHEN check_violation THEN v_report := v_report || 'D-2c PASS (no nesting) | ';
  END;
  BEGIN
    INSERT INTO public.bos_cron_runs (job, source, started_at, deadline_at, counts)
    VALUES ('dry-run-job', 'other', v_now, v_now + interval '1 minute', '{"a b": 1}');
    v_fail := true; v_report := v_report || 'D-3 FAIL: a bad key was stored | ';
  EXCEPTION WHEN check_violation THEN v_report := v_report || 'D-3 PASS (key rule) | ';
  END;
  BEGIN
    INSERT INTO public.bos_cron_runs (job, source, started_at, deadline_at, finished_at, outcome, error_class)
    VALUES ('dry-run-job', 'other', v_now, v_now + interval '1 minute', v_now, 'failed', 'Timeout sending to a@b.c');
    v_fail := true; v_report := v_report || 'D-4 FAIL: an error message was stored | ';
  EXCEPTION WHEN check_violation THEN v_report := v_report || 'D-4 PASS (class list) | ';
  END;
  BEGIN
    INSERT INTO public.bos_cron_runs (job, source, started_at, deadline_at, finished_at)
    VALUES ('dry-run-job', 'other', v_now, v_now + interval '1 minute', v_now);
    v_fail := true; v_report := v_report || 'D-5 FAIL: running with a finish time | ';
  EXCEPTION WHEN check_violation THEN v_report := v_report || 'D-5 PASS (running consistency) | ';
  END;
  BEGIN
    INSERT INTO public.bos_cron_runs (job, source, started_at, deadline_at, finished_at, outcome)
    VALUES ('dry-run-job', 'other', v_now, v_now + interval '1 minute', v_now, 'failed');
    v_fail := true; v_report := v_report || 'D-6 FAIL: a failure without a class | ';
  EXCEPTION WHEN check_violation THEN v_report := v_report || 'D-6 PASS (failure has a class) | ';
  END;
  BEGIN
    INSERT INTO public.bos_cron_runs (job, source, started_at, deadline_at)
    VALUES ('dry-run-job', 'other', v_now, v_now + interval '21 minutes');
    v_fail := true; v_report := v_report || 'D-7 FAIL: a far-future deadline | ';
  EXCEPTION WHEN check_violation THEN v_report := v_report || 'D-7 PASS (deadline bound) | ';
  END;

  -- D-12 .. D-20: the remaining CHECKs (QA-L5), one refusal each.
  BEGIN
    INSERT INTO public.bos_cron_runs (job, source, started_at, deadline_at)
    VALUES ('Bad Job!', 'other', v_now, v_now + interval '1 minute');
    v_fail := true; v_report := v_report || 'D-12 FAIL: a bad job name | ';
  EXCEPTION WHEN check_violation THEN v_report := v_report || 'D-12 PASS (job rule) | ';
  END;
  BEGIN
    INSERT INTO public.bos_cron_runs (job, source, started_at, deadline_at)
    VALUES ('dry-run-job', 'browser', v_now, v_now + interval '1 minute');
    v_fail := true; v_report := v_report || 'D-13 FAIL: an unknown source | ';
  EXCEPTION WHEN check_violation THEN v_report := v_report || 'D-13 PASS (source list) | ';
  END;
  BEGIN
    INSERT INTO public.bos_cron_runs (job, source, started_at, deadline_at, finished_at, outcome)
    VALUES ('dry-run-job', 'other', v_now, v_now + interval '1 minute', v_now, 'maybe');
    v_fail := true; v_report := v_report || 'D-14 FAIL: an unknown outcome | ';
  EXCEPTION WHEN check_violation THEN v_report := v_report || 'D-14 PASS (outcome list) | ';
  END;
  BEGIN
    INSERT INTO public.bos_cron_runs (job, source, started_at, deadline_at, finished_at, outcome, http_status)
    VALUES ('dry-run-job', 'other', v_now, v_now + interval '1 minute', v_now, 'succeeded', 42);
    v_fail := true; v_report := v_report || 'D-15 FAIL: an impossible HTTP status | ';
  EXCEPTION WHEN check_violation THEN v_report := v_report || 'D-15 PASS (http_status range) | ';
  END;
  BEGIN
    INSERT INTO public.bos_cron_runs (job, source, started_at, deadline_at, finished_at, outcome, duration_ms)
    VALUES ('dry-run-job', 'other', v_now, v_now + interval '1 minute', v_now, 'succeeded', -1);
    v_fail := true; v_report := v_report || 'D-16 FAIL: a negative duration | ';
  EXCEPTION WHEN check_violation THEN v_report := v_report || 'D-16 PASS (duration >= 0) | ';
  END;
  BEGIN
    INSERT INTO public.bos_cron_runs (job, source, started_at, deadline_at, finished_at, outcome, error_class)
    VALUES ('dry-run-job', 'other', v_now, v_now + interval '1 minute', v_now, 'succeeded', 'exception');
    v_fail := true; v_report := v_report || 'D-17 FAIL: an error class on a success | ';
  EXCEPTION WHEN check_violation THEN v_report := v_report || 'D-17 PASS (class only on failure) | ';
  END;
  BEGIN
    INSERT INTO public.bos_cron_runs (job, source, started_at, deadline_at, finished_at, outcome)
    VALUES ('dry-run-job', 'other', v_now, v_now + interval '1 minute', v_now - interval '1 minute', 'succeeded');
    v_fail := true; v_report := v_report || 'D-18 FAIL: a finish before the start | ';
  EXCEPTION WHEN check_violation THEN v_report := v_report || 'D-18 PASS (finish after start) | ';
  END;
  BEGIN
    INSERT INTO public.bos_cron_runs (job, source, started_at, deadline_at)
    VALUES ('dry-run-job', 'other', v_now, v_now);
    v_fail := true; v_report := v_report || 'D-19 FAIL: a deadline not after the start | ';
  EXCEPTION WHEN check_violation THEN v_report := v_report || 'D-19 PASS (deadline after start) | ';
  END;
  BEGIN
    INSERT INTO public.bos_cron_runs (job, source, started_at, deadline_at, counts)
    VALUES ('dry-run-job', 'other', v_now, v_now + interval '1 minute',
            (SELECT jsonb_object_agg('k' || g, g) FROM generate_series(1, 120) AS g));
    v_fail := true; v_report := v_report || 'D-20 FAIL: an oversized counts object | ';
  EXCEPTION WHEN check_violation THEN v_report := v_report || 'D-20 PASS (counts <= 1024 bytes) | ';
  END;

  -- D-8: a running row past its deadline counts as bad ("did not finish").
  INSERT INTO public.bos_cron_runs (id, job, source, started_at, deadline_at)
  VALUES (v_id_dnf, 'dry-run-job', 'other', v_now - interval '10 minutes', v_now - interval '5 minutes');

  -- D-9: the summary, as the admin read calls it.
  SELECT * INTO v_r
  FROM public.admin_bos_cron_run_summary(ARRAY['dry-run-job', 'dry-run-none'], v_now, 10)
  WHERE job = 'dry-run-job';
  IF v_r.runs_24h = 2 AND v_r.bad_24h = 1 AND v_r.last_cron_started_at = v_now - interval '1 minute'
     AND jsonb_array_length(v_r.recent) = 2 AND jsonb_array_length(v_r.recent_bad) = 1
     AND v_r.installed_at IS NOT NULL
  THEN v_report := v_report || 'D-9 PASS (summary) | ';
  ELSE v_fail := true;
       v_report := v_report || format('D-9 FAIL: runs_24h=%s bad_24h=%s last_cron=%s | ',
                                      v_r.runs_24h, v_r.bad_24h, v_r.last_cron_started_at);
  END IF;
  SELECT count(*) INTO v_rows FROM public.admin_bos_cron_run_summary(ARRAY['dry-run-job', 'dry-run-none'], v_now, 10);
  IF v_rows = 2 THEN v_report := v_report || 'D-10 PASS (a job with no runs still gets a row) | ';
  ELSE v_fail := true; v_report := v_report || 'D-10 FAIL: ' || v_rows || ' rows | '; END IF;

  -- D-11: retention: the prune the recorder issues removes a 31-day row, keeps a 29-day one.
  INSERT INTO public.bos_cron_runs (id, job, source, started_at, deadline_at)
  VALUES (v_id_old,  'dry-run-job', 'other', v_now - interval '31 days', v_now - interval '31 days' + interval '1 minute'),
         (v_id_keep, 'dry-run-job', 'other', v_now - interval '29 days', v_now - interval '29 days' + interval '1 minute');
  DELETE FROM public.bos_cron_runs WHERE started_at < v_now - interval '30 days';
  IF NOT EXISTS (SELECT 1 FROM public.bos_cron_runs WHERE id = v_id_old)
     AND EXISTS (SELECT 1 FROM public.bos_cron_runs WHERE id = v_id_keep)
  THEN v_report := v_report || 'D-11 PASS (30-day prune) | ';
  ELSE v_fail := true; v_report := v_report || 'D-11 FAIL: prune | '; END IF;

  RAISE EXCEPTION 'DRY RUN %: % (this error is expected: it rolls everything back)',
    CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END, v_report;
END
$dry$;

-- ── STEP 4, then: NOTHING KEPT (expect 0 and 1; anything else: send it to Dev) ─
-- NOTE: this expects runs_kept = 0 only BEFORE PR-2 is deployed. Once PR-2 is
-- live, every authorised cron run writes a real row, so runs_kept then counts
-- real runs (and grows every few minutes). What "nothing kept" proves is that
-- no row named 'dry-run-job' survives: check with
--   SELECT count(*) FROM public.bos_cron_runs WHERE job = 'dry-run-job';  -- expect 0

SELECT (SELECT count(*) FROM public.bos_cron_runs)          AS runs_kept,
       (SELECT count(*) FROM public.bos_cron_run_recording) AS recording_rows;

══════════════════════════════════════════════════════════════════════════ */

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The run record
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.bos_cron_runs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job         text        NOT NULL CHECK (job ~ '^[a-z][a-z0-9-]{0,63}$'),
  source      text        NOT NULL CHECK (source IN ('vercel_cron', 'other')),
  started_at  timestamptz NOT NULL,
  deadline_at timestamptz NOT NULL,
  finished_at timestamptz NULL,
  outcome     text        NOT NULL DEFAULT 'running'
                          CHECK (outcome IN ('running', 'succeeded', 'partial', 'failed')),
  duration_ms integer     NULL CHECK (duration_ms >= 0),
  http_status smallint    NULL CHECK (http_status BETWEEN 100 AND 599),
  error_class text        NULL CHECK (error_class IN ('http_error', 'exception', 'timeout')),
  counts      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bos_cron_runs_deadline_after_start CHECK (deadline_at > started_at),
  CONSTRAINT bos_cron_runs_deadline_bounded CHECK (deadline_at <= started_at + interval '20 minutes'),
  CONSTRAINT bos_cron_runs_finish_consistent CHECK ((outcome = 'running') = (finished_at IS NULL)),
  CONSTRAINT bos_cron_runs_finish_after_start CHECK (finished_at IS NULL OR finished_at >= started_at),
  CONSTRAINT bos_cron_runs_error_only_on_failure CHECK (error_class IS NULL OR outcome = 'failed'),
  CONSTRAINT bos_cron_runs_failure_has_class CHECK (outcome <> 'failed' OR error_class IS NOT NULL),
  CONSTRAINT bos_cron_runs_running_is_bare CHECK (
    outcome <> 'running' OR (duration_ms IS NULL AND http_status IS NULL AND error_class IS NULL)
  ),
  CONSTRAINT bos_cron_runs_counts_numbers_only CHECK (
    jsonb_typeof(counts) = 'object'
    AND octet_length(counts::text) <= 1024
    -- STRICT on purpose: in the default lax mode `$.*` unwraps arrays, so
    -- {"a":[1]} and {"a":[]} would pass as "numbers only". Strict sees the array.
    AND NOT jsonb_path_exists(counts, 'strict $.* ? (@.type() != "number")')
    AND NOT jsonb_path_exists(counts, '$.keyvalue() ? (!(@.key like_regex "^[a-zA-Z][a-zA-Z0-9]{0,39}$"))')
  )
);

CREATE INDEX bos_cron_runs_job_started_idx ON public.bos_cron_runs (job, started_at DESC);
CREATE INDEX bos_cron_runs_started_idx ON public.bos_cron_runs (started_at);

COMMENT ON TABLE public.bos_cron_runs IS
  'Business OS cron run record (admin reorganisation slice 5): one row per authorised run. Numbers and fixed words only. Server-only; kept 30 days.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. When recording was installed (one row, never pruned)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.bos_cron_run_recording (
  id           smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  installed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.bos_cron_run_recording DEFAULT VALUES;

COMMENT ON TABLE public.bos_cron_run_recording IS
  'One row: when the Business OS cron run record was installed. The baseline for a job that has never recorded a run.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS and privileges
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.bos_cron_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bos_cron_run_recording ENABLE ROW LEVEL SECURITY;
-- No policy at all: no user session reads or writes these.

REVOKE ALL ON TABLE public.bos_cron_runs, public.bos_cron_run_recording
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bos_cron_runs TO service_role; -- DELETE: 30-day retention
GRANT SELECT ON TABLE public.bos_cron_run_recording TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. The summary the admin page reads (SA SC-5)
-- ────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION public.admin_bos_cron_run_summary(
  p_jobs   text[],
  p_now    timestamptz,
  p_recent integer
)
RETURNS TABLE (
  job                  text,
  runs_24h             integer,
  runs_7d              integer,
  bad_24h              integer,
  bad_7d               integer,
  last_cron_started_at timestamptz,
  recent               jsonb,
  recent_bad           jsonb,
  first_run_at         timestamptz,
  installed_at         timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    j.job,
    (SELECT count(*)::integer FROM public.bos_cron_runs r
      WHERE r.job = j.job AND r.started_at > COALESCE(p_now, now()) - interval '24 hours'
        AND r.started_at <= COALESCE(p_now, now())),
    (SELECT count(*)::integer FROM public.bos_cron_runs r
      WHERE r.job = j.job AND r.started_at > COALESCE(p_now, now()) - interval '7 days'
        AND r.started_at <= COALESCE(p_now, now())),
    (SELECT count(*)::integer FROM public.bos_cron_runs r
      WHERE r.job = j.job AND r.started_at > COALESCE(p_now, now()) - interval '24 hours'
        AND r.started_at <= COALESCE(p_now, now())
        AND (r.outcome = 'failed' OR (r.outcome = 'running' AND r.deadline_at < COALESCE(p_now, now())))),
    (SELECT count(*)::integer FROM public.bos_cron_runs r
      WHERE r.job = j.job AND r.started_at > COALESCE(p_now, now()) - interval '7 days'
        AND r.started_at <= COALESCE(p_now, now())
        AND (r.outcome = 'failed' OR (r.outcome = 'running' AND r.deadline_at < COALESCE(p_now, now())))),
    (SELECT max(r.started_at) FROM public.bos_cron_runs r
      WHERE r.job = j.job AND r.source = 'vercel_cron' AND r.started_at <= COALESCE(p_now, now())),
    COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.started_at DESC)
      FROM (
        SELECT r.started_at, r.finished_at, r.deadline_at, r.outcome, r.source,
               r.duration_ms, r.http_status, r.error_class, r.counts
        FROM public.bos_cron_runs r
        WHERE r.job = j.job AND r.started_at <= COALESCE(p_now, now())
        ORDER BY r.started_at DESC
        LIMIT LEAST(GREATEST(COALESCE(p_recent, 10), 1), 20)
      ) x
    ), '[]'::jsonb),
    COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.started_at DESC)
      FROM (
        SELECT r.started_at, r.finished_at, r.deadline_at, r.outcome, r.source,
               r.duration_ms, r.http_status, r.error_class
        FROM public.bos_cron_runs r
        WHERE r.job = j.job AND r.started_at <= COALESCE(p_now, now())
          AND (r.outcome = 'failed' OR (r.outcome = 'running' AND r.deadline_at < COALESCE(p_now, now())))
        ORDER BY r.started_at DESC
        LIMIT LEAST(GREATEST(COALESCE(p_recent, 10), 1), 20)
      ) x
    ), '[]'::jsonb),
    (SELECT min(r.started_at) FROM public.bos_cron_runs r),
    (SELECT i.installed_at FROM public.bos_cron_run_recording i WHERE i.id = 1)
  FROM (
    SELECT DISTINCT u.job
    FROM unnest((COALESCE(p_jobs, ARRAY[]::text[]))[1:50]) AS u(job)
    WHERE u.job IS NOT NULL
  ) j;
$$;

REVOKE ALL ON FUNCTION public.admin_bos_cron_run_summary(text[], timestamptz, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_bos_cron_run_summary(text[], timestamptz, integer)
  TO service_role;

COMMIT;
