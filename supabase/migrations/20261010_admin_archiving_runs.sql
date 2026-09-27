-- Admin Archiving, Slice 2 (M1): the archive, its run log and the move function.
--
-- Requirement: docs/requirements/ADMIN_ARCHIVING_MODULE_REQUIREMENT.md (§5, §13, D-1)
-- Workplan:    docs/workplans/ADMIN_ARCHIVING_SLICE_2_RUNS_WORKPLAN.md (§4, §5)
--
-- ── WHAT THIS IS ────────────────────────────────────────────────────────────
-- Two tables and one function:
--   archive_runs               the run log: who archived what, when, with which
--                              cutoff, and how many rows moved. Never archived,
--                              never purged: it holds counts, not content.
--   archived_records           one row per archived record, the whole source row
--                              kept as jsonb in `payload`.
--   archive_audit_trail_batch  moves one batch of audit_trail rows older than a
--                              run's cutoff into archived_records, atomically.
--
-- NOTHING WRITES TO THESE TABLES YET. The admin route that starts a run arrives
-- in Slice 2b and is refused server-side (ARCHIVE_RUNS_ENABLED = false) until
-- Slice 3 adds erasure and export over the archive. Applying this migration is
-- therefore invisible to customers.
--
-- ── APPLY ORDER (by hand, PROD, Supabase SQL editor) ────────────────────────
--   1. Pre-check (read-only, below). Any STOP: do not apply.
--        Run on PROD 2026-09-26: all five rows PASS.
--   2. Apply this file: one paste, one transaction. BEFORE the 2a code deploys,
--      because the admin page's GET now reads both tables.
--   3. Access check (below): one row, nine values, all must be true.
--        Any false: run the rollback.
--   4. Dry run (below), then the "nothing kept" query. The dry run always ends
--        in an error on purpose; its text must start with DRY RUN PASS.
--        Anything else: stop, do not merge, send the text to Dev.
--   Rollback (below) only if step 3 or 4 fails; if 2a is already deployed,
--   revert it first.
--
-- The runbook SQL lives ONLY here (SA R-5). Each query sits inside the block
-- comment below so it can be copied exactly as written; the SQL editor shows
-- only the last statement's result, so each step is one statement or one DO
-- block that reports by raising an error.
--
-- ── DESIGN (why it looks like this) ─────────────────────────────────────────
-- * SECURITY INVOKER, empty search_path, every name schema-qualified. The only
--   caller holds the service-role key; definer rights would buy nothing and
--   would add to the anon-callable SECURITY DEFINER backlog (TQ-3).
-- * SEPARATE STATEMENTS for select, copy and delete (C-3). All sub-statements
--   of ONE statement share one snapshot, so a data-modifying CTE could not see
--   the rows it had just copied: the "delete only what is now archived" guard
--   would then delete nothing, or a "fix" that dropped it would lose rows.
-- * The delete removes ONLY rows now present in archived_records, and the
--   batch raises if deleted <> selected. Rows are locked FOR UPDATE, so every
--   selected row is either newly copied or already archived; anything else
--   means a row was not archived, and the whole batch rolls back.
-- * Blocking FOR UPDATE with lock_timeout 5s, not SKIP LOCKED: skipping could
--   report "done" while locked eligible rows remain (SA Q-3).
-- * The ONLY run-state guard is the final UPDATE of archive_runs (this run,
--   this source, still running, exactly this cutoff). It is in the same
--   transaction as the move, so the run's row count can never disagree with
--   the archive, and a takeover or a wrong cutoff rolls the batch back (Q-4).
-- * archived_records.user_id has NO foreign key to auth.users (SA R-1, which
--   supersedes C-11). ON DELETE SET NULL would null the column while `payload`
--   kept the personal data, and erasure/purge by user_id could no longer find
--   the row. A plain indexed uuid keeps erasure working whenever it runs.
-- * archive_runs.started_by has no foreign key either: deleting an admin's
--   auth user must neither be blocked nor erase the record of what they did
--   (the RC-9 precedent in 20261005).
-- * No GIN index and no custom compression: the space saving is dropping
--   audit_trail's secondary indexes (F-3, C-9c). No `destination` column (C-9a).
-- * RLS on with NO policy, REVOKE ALL (never an enumeration: a list goes stale
--   when Postgres adds a privilege) from PUBLIC, anon, authenticated AND
--   service_role, then the service_role side GRANTED back explicitly, so it
--   holds exactly what it uses and nothing inherited (the 20261005 lesson, CR-1).
-- * Plain CREATE TABLE, not IF NOT EXISTS: a taken name fails the apply and
--   the transaction rolls back, instead of silently skipping over drift.
--
-- audit_trail itself is only read and deleted from. Its schema, indexes,
-- policies and its BEFORE INSERT trigger (trigger_sync_audit_user_email, which
-- fills user_email) are untouched; that trigger never fires here, because
-- nothing is inserted into audit_trail.

/* ═══════════════════════════ RUNBOOK SQL ═══════════════════════════════════

-- ── STEP 1: PRE-CHECK (read-only; one SELECT; five rows, each PASS or STOP) ──

WITH t AS (
  SELECT 'public.audit_trail'::regclass AS rel
),
cols AS (
  SELECT a.attname,
         format_type(a.atttypid, a.atttypmod) AS typ,
         a.attnotnull
  FROM pg_attribute a, t
  WHERE a.attrelid = t.rel
    AND a.attnum > 0
    AND NOT a.attisdropped
)
SELECT check_id, status, detail
FROM (
  SELECT 'P01 column types' AS check_id,
         CASE WHEN count(*) FILTER (
                     WHERE c.typ = e.want
                       AND (e.col <> 'created_at' OR c.attnotnull)
                   ) = 3
              THEN 'PASS' ELSE 'STOP' END AS status,
         string_agg(
           e.col || ' = ' || COALESCE(c.typ || CASE WHEN c.attnotnull THEN ' NOT NULL' ELSE '' END, 'MISSING'),
           '; ' ORDER BY e.ord
         ) AS detail
  FROM (VALUES (1, 'id',         'uuid'),
               (2, 'created_at', 'timestamp with time zone'),
               (3, 'user_id',    'uuid')) AS e(ord, col, want)
  LEFT JOIN cols c ON c.attname = e.col

  UNION ALL

  SELECT 'P02 triggers that fire on DELETE',
         CASE WHEN count(*) FILTER (WHERE (tg.tgtype::int & 8) <> 0) = 0 THEN 'PASS' ELSE 'STOP' END,
         COALESCE(
           string_agg(tg.tgname || CASE WHEN (tg.tgtype::int & 8) <> 0 THEN ' (fires on DELETE)' ELSE '' END, '; '),
           'no triggers'
         )
  FROM t
  LEFT JOIN pg_trigger tg ON tg.tgrelid = t.rel AND NOT tg.tgisinternal

  UNION ALL

  SELECT 'P03 rules on audit_trail',
         CASE WHEN count(r.rulename) = 0 THEN 'PASS' ELSE 'STOP' END,
         COALESCE(string_agg(r.rulename || ': ' || r.definition, '; '), 'no rules')
  FROM (SELECT 1) AS one
  LEFT JOIN pg_rules r ON r.schemaname = 'public' AND r.tablename = 'audit_trail'

  UNION ALL

  SELECT 'P06 foreign keys pointing at audit_trail',
         CASE WHEN count(c.oid) = 0 THEN 'PASS' ELSE 'STOP' END,
         COALESCE(string_agg(c.conrelid::regclass::text || '.' || c.conname, '; '), 'none')
  FROM t
  LEFT JOIN pg_constraint c ON c.confrelid = t.rel AND c.contype = 'f'

  UNION ALL

  SELECT 'P09 service_role can SELECT and DELETE audit_trail',
         CASE WHEN has_table_privilege('service_role', 'public.audit_trail', 'SELECT')
               AND has_table_privilege('service_role', 'public.audit_trail', 'DELETE')
              THEN 'PASS' ELSE 'STOP' END,
         'select = ' || has_table_privilege('service_role', 'public.audit_trail', 'SELECT')
           || ', delete = ' || has_table_privilege('service_role', 'public.audit_trail', 'DELETE')
) AS report
ORDER BY check_id;

-- ── STEP 3: ACCESS CHECK, AC-11 (read-only; one row; all nine must be true) ─
-- Any false: stop, run the rollback, send the row to Dev.

SELECT
  NOT has_table_privilege('anon', 'public.archived_records',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')          AS anon_no_archived_records,
  NOT has_table_privilege('anon', 'public.archive_runs',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')          AS anon_no_archive_runs,
  NOT has_table_privilege('authenticated', 'public.archived_records',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')          AS authenticated_no_archived_records,
  NOT has_table_privilege('authenticated', 'public.archive_runs',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')          AS authenticated_no_archive_runs,
  NOT has_function_privilege('anon',
        'public.archive_audit_trail_batch(uuid, timestamptz, integer)', 'EXECUTE') AS anon_cannot_execute,
  NOT has_function_privilege('authenticated',
        'public.archive_audit_trail_batch(uuid, timestamptz, integer)', 'EXECUTE') AS authenticated_cannot_execute,
  NOT (SELECT p.prosecdef FROM pg_proc p
       WHERE p.oid = 'public.archive_audit_trail_batch(uuid, timestamptz, integer)'::regprocedure)
                                                                                   AS function_is_invoker,
  NOT has_table_privilege('service_role', 'public.archived_records',
        'REFERENCES, TRIGGER')                                                     AS service_role_no_extra_on_archived_records,
  NOT has_table_privilege('service_role', 'public.archive_runs',
        'REFERENCES, TRIGGER')                                                     AS service_role_no_extra_on_archive_runs;

-- ── STEP 4: DRY RUN on real rows (AC-5, AC-4 per C-10, AC-6) ─────────────────
-- Always ends in an error ON PURPOSE: the error rolls everything back, and its
-- text is the report. Expect it to start with "DRY RUN PASS".
-- Anything else (DRY RUN FAIL, SKIPPED, or any other error): stop, do not
-- merge, and send the full text to Dev. Nothing was kept either way.

DO $dry$
DECLARE
  v_cutoff      timestamptz;
  v_eligible    bigint;
  v_arch_before bigint;
  v_live        bigint;
  v_arch        bigint;
  v_expected    jsonb;
  v_run         uuid;
  v_bad_run     uuid;
  v_r           record;
  v_loops       integer := 0;
  v_fail        boolean := false;
  v_report      text := '';
BEGIN
  -- A cutoff that makes the 10 oldest real rows eligible (more if they share a timestamp).
  SELECT a.created_at + interval '1 microsecond' INTO v_cutoff
  FROM public.audit_trail a
  ORDER BY a.created_at, a.id
  OFFSET 9 LIMIT 1;
  IF v_cutoff IS NULL THEN
    RAISE EXCEPTION 'DRY RUN SKIPPED: audit_trail has fewer than 10 rows';
  END IF;
  SELECT count(*) INTO v_eligible FROM public.audit_trail WHERE created_at < v_cutoff;
  SELECT count(*) INTO v_arch_before FROM public.archived_records;
  SELECT jsonb_agg(to_jsonb(a)) INTO v_expected FROM public.audit_trail a WHERE a.created_at < v_cutoff;
  v_report := format('eligible=%s | ', v_eligible);

  -- Act as the role the app uses, so the grants are proven, not only the logic.
  SET LOCAL ROLE service_role;

  -- D-1 (AC-5): a batch on a run that is not running raises at the final guard,
  -- AFTER its copy and its delete, and both tables are unchanged afterwards.
  INSERT INTO public.archive_runs (source, retention_days, cutoff, status, started_by)
  VALUES ('audit_trail', 365, v_cutoff, 'partial', gen_random_uuid())
  RETURNING id INTO v_bad_run;
  BEGIN
    PERFORM * FROM public.archive_audit_trail_batch(v_bad_run, v_cutoff, 5);
    v_fail := true;
    v_report := v_report || 'D-1 FAIL: no error on a non-running run | ';
  EXCEPTION WHEN OTHERS THEN
    v_report := v_report || 'D-1 raised: ' || SQLERRM || ' | ';
  END;
  SELECT count(*) INTO v_live FROM public.audit_trail WHERE created_at < v_cutoff;
  SELECT count(*) INTO v_arch FROM public.archived_records;
  IF v_live = v_eligible AND v_arch = v_arch_before THEN
    v_report := v_report || 'D-1 PASS (AC-5): both tables unchanged | ';
  ELSE
    v_fail := true;
    v_report := v_report || format('D-1 FAIL: live %s->%s archived %s->%s | ',
                                   v_eligible, v_live, v_arch_before, v_arch);
  END IF;

  -- D-2 (AC-4 per C-10): drain a running run. Nothing is left before the cutoff,
  -- everything eligible is archived exactly once, the run log agrees, and every
  -- payload is identical to the live row it came from.
  INSERT INTO public.archive_runs (source, retention_days, cutoff, status, started_by)
  VALUES ('audit_trail', 365, v_cutoff, 'running', gen_random_uuid())
  RETURNING id INTO v_run;
  LOOP
    SELECT * INTO v_r FROM public.archive_audit_trail_batch(v_run, v_cutoff, 1000);
    v_loops := v_loops + 1;
    EXIT WHEN v_r.selected_count = 0 OR v_loops >= 50;
  END LOOP;
  SELECT count(*) INTO v_live FROM public.audit_trail WHERE created_at < v_cutoff;
  SELECT count(*) INTO v_arch FROM public.archived_records WHERE archive_run_id = v_run;
  IF v_live = 0
     AND v_arch = v_eligible
     AND (SELECT rows_archived FROM public.archive_runs WHERE id = v_run) = v_eligible
     AND NOT EXISTS (
       SELECT jsonb_array_elements(v_expected)
       EXCEPT
       SELECT r.payload FROM public.archived_records r WHERE r.archive_run_id = v_run)
  THEN
    v_report := v_report || format('D-2 PASS (AC-4): 0 left, %s archived, run log agrees, payloads identical | ', v_arch);
  ELSE
    v_fail := true;
    v_report := v_report || format('D-2 FAIL: left %s, archived %s of %s | ', v_live, v_arch, v_eligible);
  END IF;

  -- D-3 (AC-6): running again changes nothing and duplicates nothing.
  SELECT * INTO v_r FROM public.archive_audit_trail_batch(v_run, v_cutoff, 1000);
  IF v_r.selected_count = 0 AND v_r.inserted_count = 0 AND v_r.deleted_count = 0
     AND (SELECT count(*) = count(DISTINCT source_id)
          FROM public.archived_records WHERE archive_run_id = v_run)
     AND (SELECT count(*) FROM public.archived_records WHERE archive_run_id = v_run) = v_eligible
  THEN
    v_report := v_report || 'D-3 PASS (AC-6): re-run is a no-op, no duplicates | ';
  ELSE
    v_fail := true;
    v_report := v_report || 'D-3 FAIL: re-run changed something | ';
  END IF;

  RAISE EXCEPTION 'DRY RUN %: % (this error is expected: it rolls everything back)',
    CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END, v_report;
END
$dry$;

-- ── STEP 4, then: NOTHING KEPT (expect 0, 0; anything else: send it to Dev) ─

SELECT (SELECT count(*) FROM public.archive_runs)     AS runs_kept,
       (SELECT count(*) FROM public.archived_records) AS archived_kept;

-- ── ROLLBACK (only if step 3 or 4 fails; if 2a is already deployed, revert it first)
-- Refuses if any row has been archived: those rows would be the only copy.

DO $rb$
BEGIN
  IF to_regclass('public.archived_records') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.archived_records) THEN
      RAISE EXCEPTION 'ROLLBACK REFUSED: archived_records holds rows, and they are the only copy';
    END IF;
  END IF;
  DROP FUNCTION IF EXISTS public.archive_audit_trail_batch(uuid, timestamptz, integer);
  DROP TABLE IF EXISTS public.archived_records;
  DROP TABLE IF EXISTS public.archive_runs;
END
$rb$;

══════════════════════════════════════════════════════════════════════════ */

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The run log. Created first, because archived_records references it.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.archive_runs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source         text        NOT NULL,
  retention_days integer     NOT NULL CHECK (retention_days IN (365, 180, 90)),
  cutoff         timestamptz NOT NULL,
  status         text        NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  rows_archived  bigint      NOT NULL DEFAULT 0 CHECK (rows_archived >= 0),
  batches        integer     NOT NULL DEFAULT 0 CHECK (batches >= 0),
  started_by     uuid        NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  last_batch_at  timestamptz NULL,
  finished_at    timestamptz NULL,
  error_code     text        NULL CHECK (error_code ~ '^[a-z_]{1,64}$')
);

-- One running run per source (FR-8, TQ-1). A second start hits this and gets 409.
CREATE UNIQUE INDEX archive_runs_one_running_per_source
  ON public.archive_runs (source) WHERE status = 'running';

CREATE INDEX archive_runs_started_at_idx
  ON public.archive_runs (started_at DESC);

COMMENT ON TABLE public.archive_runs IS
  'Admin Archiving run log: one row per run (source, retention, cutoff, rows moved, status). Counts only. Never archived and never purged.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. The archive. One row per archived record; the whole source row in payload.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.archived_records (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source              text        NOT NULL,
  source_id           text        NOT NULL,
  -- Copied out of the row as a real column so erasure, export and purge can
  -- reach archived rows by account. No FK on purpose (see the header).
  user_id             uuid        NULL,
  original_created_at timestamptz NOT NULL,
  payload             jsonb       NOT NULL,
  archived_at         timestamptz NOT NULL DEFAULT now(),
  archive_run_id      uuid        NOT NULL REFERENCES public.archive_runs(id),
  CONSTRAINT archived_records_source_row_unique UNIQUE (source, source_id)
);

CREATE INDEX archived_records_source_created_idx
  ON public.archived_records (source, original_created_at);

CREATE INDEX archived_records_user_id_idx
  ON public.archived_records (user_id) WHERE user_id IS NOT NULL;

COMMENT ON TABLE public.archived_records IS
  'Admin Archiving: rows moved out of operational tables, one per record, the whole row in payload. Purged with the activity-history option; erased by user_id.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS and privileges
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.archive_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archived_records ENABLE ROW LEVEL SECURITY;
-- No policy at all: nothing reads these with a user session.

-- REVOKE ALL from every API role, service_role included, then GRANT back
-- exactly what the module uses. An enumerated REVOKE left service_role holding
-- REFERENCES and TRIGGER from the Supabase defaults (SA CR-1); REVOKE ALL
-- cannot go stale. Foreign-key checks run as the table owner, so service_role
-- needs no REFERENCES for archive_run_id.
REVOKE ALL ON TABLE public.archive_runs, public.archived_records
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, DELETE ON TABLE public.archived_records TO service_role; -- no UPDATE: archive rows are immutable; DELETE: Slice 3 erasure and purge
GRANT SELECT, INSERT, UPDATE ON TABLE public.archive_runs     TO service_role; -- no DELETE: the run log is never deleted

-- ────────────────────────────────────────────────────────────────────────────
-- 4. The move function (C-3, D-1)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.archive_audit_trail_batch(
  p_run_id     uuid,
  p_cutoff     timestamptz,
  p_batch_size integer
)
RETURNS TABLE (selected_count integer, inserted_count integer, deleted_count integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
  v_ids      uuid[];
  v_selected integer;
  v_inserted integer;
  v_deleted  integer;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION 'archive_audit_trail_batch: batch size % out of range', p_batch_size
      USING ERRCODE = '22023';
  END IF;

  -- (1) Select and lock the batch, oldest first. No exclusions for this source (FR-9).
  SELECT array_agg(s.id) INTO v_ids
  FROM (
    SELECT a.id
    FROM public.audit_trail a
    WHERE a.created_at < p_cutoff
    ORDER BY a.created_at, a.id
    LIMIT p_batch_size
    FOR UPDATE
  ) s;
  v_selected := COALESCE(cardinality(v_ids), 0);

  -- (2) Copy. A separate statement from (3), so (3) sees these rows (C-3).
  INSERT INTO public.archived_records
    (source, source_id, user_id, original_created_at, payload, archive_run_id)
  SELECT 'audit_trail', a.id::text, a.user_id, a.created_at, to_jsonb(a), p_run_id
  FROM public.audit_trail a
  WHERE a.id = ANY (v_ids)
  ON CONFLICT (source, source_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- (3) Delete ONLY rows that now exist in the archive (FR-5, FR-6).
  DELETE FROM public.audit_trail a
  WHERE a.id = ANY (v_ids)
    AND EXISTS (
      SELECT 1 FROM public.archived_records r
      WHERE r.source = 'audit_trail' AND r.source_id = a.id::text
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Every locked row is copied now or was archived before. Anything else means
  -- a row was not archived: stop, and roll the batch back.
  IF v_deleted <> v_selected THEN
    RAISE EXCEPTION 'archive_audit_trail_batch: invariant broken (selected %, deleted %)',
      v_selected, v_deleted;
  END IF;

  -- (4) Bookkeeping, and the ONLY run-state guard: this run, this source, still
  -- running, with exactly this cutoff. Last, and in the same transaction.
  UPDATE public.archive_runs r
     SET rows_archived = r.rows_archived + v_deleted,
         batches       = r.batches + CASE WHEN v_selected > 0 THEN 1 ELSE 0 END,
         last_batch_at = now()
   WHERE r.id = p_run_id
     AND r.source = 'audit_trail'
     AND r.status = 'running'
     AND r.cutoff = p_cutoff;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'archive_audit_trail_batch: run % is not running with this cutoff; % rows rolled back',
      p_run_id, v_deleted;
  END IF;

  RETURN QUERY SELECT v_selected, v_inserted, v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_audit_trail_batch(uuid, timestamptz, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.archive_audit_trail_batch(uuid, timestamptz, integer)
  TO service_role;

COMMIT;
