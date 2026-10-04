-- Read-only checker for 20261025_business_os_credit_charges_activity_indexes.sql
-- (Admin AI Activity view, slice B0-prime; FR-B11, AC-B16, SA-B1-1, SA-B1-2).
-- Workplan: docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B1_WORKPLAN.md
--
-- HOW TO RUN (Supabase SQL editor, production). The editor shows only the
-- LAST result set of a multi-statement run, so:
--   * SECTION 1 is one statement with one result set. Select it alone, from
--     its SET line down to its final semicolon, and run it.
--   * Every EXPLAIN block below is SELF-CONTAINED. Select ONE block (from its
--     BEGIN to its ROLLBACK) and run it alone. Paste each output, labelled.
--
-- Nothing here writes. Section 1 sets default_transaction_read_only; every
-- block opens a READ ONLY transaction and ends in ROLLBACK.
--
-- BEFORE the migration, section 1 is expected to read VERDICT FAIL, with the
-- four existing indexes PASS and the two new ones FAIL ("missing"). That is
-- the "before" record (it replaces running
-- scripts/check-admin-ai-activity-indexes.sql again, SA-B1-4).
-- AFTER the migration, every row must read PASS.

-- ============================================================================
-- SECTION 1 - the indexes on the charge table (one result set)
-- ============================================================================

SET default_transaction_read_only = on;

WITH expected (sort_order, index_name, expected_def) AS (
  VALUES
    (10, 'business_os_credit_charges_pkey',
         'CREATE UNIQUE INDEX business_os_credit_charges_pkey ON public.business_os_credit_charges USING btree (id)'),
    (11, 'business_os_credit_charges_action_id_key',
         'CREATE UNIQUE INDEX business_os_credit_charges_action_id_key ON public.business_os_credit_charges USING btree (action_id)'),
    (12, 'business_os_credit_charges_user_period_idx',
         'CREATE INDEX business_os_credit_charges_user_period_idx ON public.business_os_credit_charges USING btree (user_id, period_start, created_at DESC)'),
    (13, 'business_os_credit_charges_group_idx',
         'CREATE INDEX business_os_credit_charges_group_idx ON public.business_os_credit_charges USING btree (group_id)'),
    (20, 'business_os_credit_charges_kind_created_idx',
         'CREATE INDEX business_os_credit_charges_kind_created_idx ON public.business_os_credit_charges USING btree (kind, created_at DESC, id DESC)'),
    (21, 'business_os_credit_charges_adjusts_action_idx',
         'CREATE INDEX business_os_credit_charges_adjusts_action_idx ON public.business_os_credit_charges USING btree (adjusts_action_id) WHERE (adjusts_action_id IS NOT NULL)')
),
live AS (
  SELECT pg_indexes.indexname::text AS index_name,
         pg_indexes.indexdef::text AS live_def
  FROM pg_indexes
  WHERE pg_indexes.schemaname = 'public'
    AND pg_indexes.tablename = 'business_os_credit_charges'
),
new_index_state AS (
  SELECT count(*) FILTER (WHERE pg_index.indisvalid AND pg_index.indisready) AS usable,
         COALESCE(string_agg(index_class.relname || ' ' || pg_size_pretty(pg_relation_size(index_class.oid)), ', '), 'none') AS sizes
  FROM pg_class AS index_class
  JOIN pg_index ON pg_index.indexrelid = index_class.oid
  JOIN pg_namespace ON pg_namespace.oid = index_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND index_class.relname IN ('business_os_credit_charges_kind_created_idx', 'business_os_credit_charges_adjusts_action_idx')
),
ledger_counts AS (
  SELECT count(*) FILTER (WHERE charge_row.kind = 'charge') AS charges,
         count(*) FILTER (WHERE charge_row.kind = 'adjustment') AS adjustments,
         count(*) FILTER (WHERE charge_row.kind = 'charge' AND charge_row.user_id IS NULL) AS deleted_account_charges
  FROM public.business_os_credit_charges AS charge_row
),
busiest_account AS (
  SELECT charge_row.user_id::text AS account_id, count(*) AS charges
  FROM public.business_os_credit_charges AS charge_row
  WHERE charge_row.kind = 'charge' AND charge_row.user_id IS NOT NULL
  GROUP BY charge_row.user_id
  ORDER BY count(*) DESC, charge_row.user_id
  LIMIT 1
),
checks AS (
  SELECT expected.sort_order,
         'index ' || expected.index_name AS check_name,
         CASE WHEN live.live_def = expected.expected_def THEN 'PASS' ELSE 'FAIL' END AS status,
         COALESCE(live.live_def, 'missing') AS detail
  FROM expected
  LEFT JOIN live ON live.index_name = expected.index_name
  UNION ALL
  SELECT 30, 'no other index on the table',
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(string_agg(live.index_name || ': ' || live.live_def, ' | '), 'none')
  FROM live
  WHERE live.index_name NOT IN (SELECT expected.index_name FROM expected)
  UNION ALL
  SELECT 31, 'both new indexes valid and ready',
         CASE WHEN new_index_state.usable = 2 THEN 'PASS' ELSE 'FAIL' END,
         new_index_state.usable || ' of 2 usable, sizes ' || new_index_state.sizes
  FROM new_index_state
  UNION ALL
  SELECT 80, 'ledger size', 'INFO',
         ledger_counts.charges || ' charge rows and ' || ledger_counts.adjustments || ' adjustment rows and '
           || ledger_counts.deleted_account_charges || ' charge rows of deleted accounts'
  FROM ledger_counts
  UNION ALL
  SELECT 81, 'busiest account id, for block E6', 'INFO',
         COALESCE((SELECT busiest_account.account_id || ' (' || busiest_account.charges || ' charges)' FROM busiest_account), 'none')
  UNION ALL
  SELECT 90, 'checked at utc', 'INFO', (now() AT TIME ZONE 'UTC')::text
)
SELECT sort_order, check_name, status, detail
FROM (
  SELECT 0 AS sort_order, 'VERDICT' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'FAIL' ELSE 'PASS' END AS status,
         (SELECT count(*) FROM checks WHERE checks.status = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.status = 'FAIL') || ' fail' AS detail
  UNION ALL
  SELECT checks.sort_order, checks.check_name, checks.status, checks.detail FROM checks
) AS report
ORDER BY report.sort_order;

-- ============================================================================
-- SECTION 2 - the six reads with enable_seqscan = off (literal values)
-- Each block: run it ALONE. Expected plans are in the workplan, section A.
-- The window literals cover everything since the cut-over.
-- ============================================================================

-- E1 - run this block alone. All accounts, newest first, the page of 100.
-- Expect: Index Scan on business_os_credit_charges_kind_created_idx, no Sort node.
BEGIN READ ONLY;
SET LOCAL enable_seqscan = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, created_at, cost_usd
FROM public.business_os_credit_charges
WHERE kind = 'charge'
  AND user_id IS NOT NULL
  AND created_at >= '2026-09-29T16:50:53.914Z'
  AND created_at < '2027-01-01T00:00:00Z'
ORDER BY created_at DESC, id DESC
LIMIT 100;
ROLLBACK;

-- E2 - run this block alone. The exact count with the E1 filters.
-- Expect: Index Scan (or Bitmap Index Scan) on business_os_credit_charges_kind_created_idx.
BEGIN READ ONLY;
SET LOCAL enable_seqscan = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM public.business_os_credit_charges
WHERE kind = 'charge'
  AND user_id IS NOT NULL
  AND created_at >= '2026-09-29T16:50:53.914Z'
  AND created_at < '2027-01-01T00:00:00Z';
ROLLBACK;

-- E3 - run this block alone. All accounts, most expensive first.
-- Expect: business_os_credit_charges_kind_created_idx, then a top-N heapsort (expected, documented).
BEGIN READ ONLY;
SET LOCAL enable_seqscan = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, created_at, cost_usd
FROM public.business_os_credit_charges
WHERE kind = 'charge'
  AND user_id IS NOT NULL
  AND created_at >= '2026-09-29T16:50:53.914Z'
  AND created_at < '2027-01-01T00:00:00Z'
ORDER BY cost_usd DESC, id DESC
LIMIT 100;
ROLLBACK;

-- E4 - run this block alone. Adjustments of a page of charges (FR-B12), by id, unwindowed.
-- Expect: Index Scan or Bitmap Index Scan on business_os_credit_charges_adjusts_action_idx.
BEGIN READ ONLY;
SET LOCAL enable_seqscan = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, adjusts_action_id, cost_usd, credits
FROM public.business_os_credit_charges
WHERE kind = 'adjustment'
  AND adjusts_action_id = ANY (ARRAY[
    'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'::uuid,
    'aaaaaaaa-aaaa-4aaa-8aaa-000000000002'::uuid,
    'aaaaaaaa-aaaa-4aaa-8aaa-000000000003'::uuid
  ])
ORDER BY created_at DESC, id DESC;
ROLLBACK;

-- E5 - run this block alone. The deleted-account bucket (user_id IS NULL), one page.
-- Expect: business_os_credit_charges_kind_created_idx with a filter on user_id.
BEGIN READ ONLY;
SET LOCAL enable_seqscan = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, created_at, cost_usd
FROM public.business_os_credit_charges
WHERE kind = 'charge'
  AND user_id IS NULL
  AND created_at >= '2026-09-29T16:50:53.914Z'
  AND created_at < '2027-01-01T00:00:00Z'
ORDER BY created_at DESC, id DESC
LIMIT 1000;
ROLLBACK;

-- E6 - run this block alone, AFTER replacing the account id below with the one
-- section 1 printed as "busiest account id, for block E6".
-- Expect: business_os_credit_charges_user_period_idx or ..._kind_created_idx; either is acceptable.
BEGIN READ ONLY;
SET LOCAL enable_seqscan = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, created_at, cost_usd
FROM public.business_os_credit_charges
WHERE kind = 'charge'
  AND user_id = '00000000-0000-4000-8000-00000000e6e6'
  AND created_at >= '2026-09-29T16:50:53.914Z'
  AND created_at < '2027-01-01T00:00:00Z'
ORDER BY created_at DESC, id DESC
LIMIT 100;
ROLLBACK;

-- ============================================================================
-- SECTION 3 - GENERIC plans for E1, E2 and E4 (SA-B1-2 iii)
-- force_generic_plan makes the planner plan WITHOUT the parameter values, the
-- way a cached prepared statement runs. An index that is usable here is usable
-- however PostgREST binds its filters.
-- Each block: run it ALONE. If a block fails half-way and a re-run reports
-- "prepared statement ... already exists", run DEALLOCATE <name>; first.
-- ============================================================================

-- G1 (E1, generic) - run this block alone.
-- Expect: Index Scan on business_os_credit_charges_kind_created_idx, no Sort node.
BEGIN READ ONLY;
SET LOCAL enable_seqscan = off;
SET LOCAL plan_cache_mode = force_generic_plan;
PREPARE activity_g1 (text, timestamptz, timestamptz, integer) AS
  SELECT id, created_at, cost_usd
  FROM public.business_os_credit_charges
  WHERE kind = $1
    AND user_id IS NOT NULL
    AND created_at >= $2
    AND created_at < $3
  ORDER BY created_at DESC, id DESC
  LIMIT $4;
EXPLAIN (ANALYZE, BUFFERS) EXECUTE activity_g1('charge', '2026-09-29T16:50:53.914Z', '2027-01-01T00:00:00Z', 100);
DEALLOCATE activity_g1;
ROLLBACK;

-- G2 (E2, generic) - run this block alone.
-- Expect: Index Scan (or Bitmap Index Scan) on business_os_credit_charges_kind_created_idx.
BEGIN READ ONLY;
SET LOCAL enable_seqscan = off;
SET LOCAL plan_cache_mode = force_generic_plan;
PREPARE activity_g2 (text, timestamptz, timestamptz) AS
  SELECT count(*)
  FROM public.business_os_credit_charges
  WHERE kind = $1
    AND user_id IS NOT NULL
    AND created_at >= $2
    AND created_at < $3;
EXPLAIN (ANALYZE, BUFFERS) EXECUTE activity_g2('charge', '2026-09-29T16:50:53.914Z', '2027-01-01T00:00:00Z');
DEALLOCATE activity_g2;
ROLLBACK;

-- G4 (E4, generic) - run this block alone.
-- Expect: Index Scan or Bitmap Index Scan on business_os_credit_charges_adjusts_action_idx.
BEGIN READ ONLY;
SET LOCAL enable_seqscan = off;
SET LOCAL plan_cache_mode = force_generic_plan;
PREPARE activity_g4 (text, uuid[]) AS
  SELECT id, adjusts_action_id, cost_usd, credits
  FROM public.business_os_credit_charges
  WHERE kind = $1
    AND adjusts_action_id = ANY ($2)
  ORDER BY created_at DESC, id DESC;
EXPLAIN (ANALYZE, BUFFERS) EXECUTE activity_g4('adjustment', ARRAY['aaaaaaaa-aaaa-4aaa-8aaa-000000000001'::uuid, 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002'::uuid]);
DEALLOCATE activity_g4;
ROLLBACK;

-- ============================================================================
-- SECTION 4 - latency today at DEFAULT planner settings (P-6 companion)
-- At about a hundred rows the planner will often prefer a sequential scan
-- here; that is expected and correct. This section records the timing only.
-- ============================================================================

-- L1 (E1 at default settings) - run this block alone.
BEGIN READ ONLY;
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, created_at, cost_usd
FROM public.business_os_credit_charges
WHERE kind = 'charge'
  AND user_id IS NOT NULL
  AND created_at >= '2026-09-29T16:50:53.914Z'
  AND created_at < '2027-01-01T00:00:00Z'
ORDER BY created_at DESC, id DESC
LIMIT 100;
ROLLBACK;

-- L2 (E2 at default settings) - run this block alone.
BEGIN READ ONLY;
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM public.business_os_credit_charges
WHERE kind = 'charge'
  AND user_id IS NOT NULL
  AND created_at >= '2026-09-29T16:50:53.914Z'
  AND created_at < '2027-01-01T00:00:00Z';
ROLLBACK;
