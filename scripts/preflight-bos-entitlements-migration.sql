-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  PRE-FLIGHT — SUPABASE SQL EDITOR. READ ONLY. SAFE ON PRODUCTION.        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- HOW TO RUN: open the Supabase dashboard → SQL Editor → new query → paste this
-- whole file → Run. Nothing to install, no variables to set, no flags.
--
-- Run it BEFORE applying either migration. It writes nothing.
--
-- ── WHY IT IS SAFE ──────────────────────────────────────────────────────────
-- Two reasons, in order of how much weight they carry:
--
--   1. **This file is one `SET` and one `SELECT`.** A `SELECT` over catalogs and
--      counts writes nothing, and there is no INSERT, UPDATE, DELETE or DDL
--      anywhere below. That is the guarantee, and it holds however the editor
--      chooses to run the paste.
--   2. The first statement is `SET default_transaction_read_only = on`, which
--      makes POSTGRES reject any write on this connection with error 25006.
--      That covers transactions started AFTER it — so if the editor wrapped this
--      paste in one transaction that had already begun, the SELECT below is not
--      itself read-only. **We cannot establish which from here, so the last row
--      of the output MEASURES it** rather than this comment claiming it.
--
-- ⚠️ The setting lives as long as the editor's connection does, and that is the
-- one thing it can cost you: **the APPLY step (runbook step 4) will fail with
-- "cannot execute CREATE TABLE in a read-only transaction" if it runs on this
-- same connection.** One line clears it, on any tab:
--
--     RESET default_transaction_read_only;
--
-- ── HOW TO READ THE OUTPUT ──────────────────────────────────────────────────
-- One result grid, one row per check, with a `status` column:
--
--     PASS   expected, nothing to do
--     FAIL   STOP. Do not apply. `what_to_do` says what to do instead.
--     WARN   a decision is needed before applying; read `what_to_do`
--     INFO   a fact for the record, not a judgement
--
-- Row 0 is `OVERALL`. If it says PASS, and no row says WARN, you are clear to
-- apply. Everything is rows on purpose: the SQL editor does NOT display
-- `RAISE NOTICE`/`WARNING` output, so a check written that way would be a check
-- you never see.
--
-- ── WHY A PRE-FLIGHT AT ALL (SA P-1) ────────────────────────────────────────
-- The migrations are applied straight to production with no branch database in
-- front of them. Most of what could go wrong is knowable beforehand:
--
--   1. Is anything already there? `CREATE TABLE IF NOT EXISTS` SILENTLY SKIPS a
--      table that already exists with a different shape, and the post-apply
--      checks would then pass over real drift.
--   2. Do the three Supabase roles exist? The migration REVOKEs from `anon` and
--      `authenticated` and GRANTs to `service_role`; a missing role aborts it.
--   3. Is any tenant missing its `auth.users` row? The backfill's FK would abort
--      the whole insert. Better decided now than mid-apply.
--   4. Could a tenant be counted twice? Only if `business_profiles.user_id`
--      stopped being unique — which would multiply the backfill's rows.
--   5. How big is the work, and is the database quiet enough for the moment the
--      triggers need their lock?
--
-- Timing: the editor prints its own execution time under the grid. That time is
-- the backfill's READ cost (this file performs the same scan and counts instead
-- of inserting); the insert adds the write on top.

SET default_transaction_read_only = on;

WITH
-- ── the nine objects the migration creates ──────────────────────────────────
expected(kind, name) AS (
  VALUES
    ('table',    'business_os_account_plans'),
    ('table',    'business_os_entitlement_overrides'),
    ('table',    'business_os_entitlement_shadow_events'),
    ('function', 'business_os_plan_fact_onboarding'),
    ('function', 'business_os_plan_fact_profile'),
    ('function', 'business_os_record_shadow_events'),
    ('function', 'business_os_reset_plan_state'),
    ('trigger',  'business_os_plan_on_onboarding'),
    ('trigger',  'business_os_plan_on_profile')
),
present AS (
  SELECT e.kind, e.name
  FROM expected e
  WHERE (e.kind = 'table' AND to_regclass('public.' || e.name) IS NOT NULL)
     OR (e.kind = 'function' AND EXISTS (
           SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = e.name))
     OR (e.kind = 'trigger' AND EXISTS (
           SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname = e.name))
),
present_list AS (
  SELECT count(*) AS n,
         COALESCE(string_agg(kind || ' ' || name, ', ' ORDER BY kind, name), '') AS names
  FROM present
),
-- ── roles (R-4) ─────────────────────────────────────────────────────────────
roles_expected(rolname) AS (VALUES ('anon'), ('authenticated'), ('service_role')),
roles_missing AS (
  SELECT count(*) AS n,
         COALESCE(string_agg(r.rolname, ', ' ORDER BY r.rolname), '') AS names
  FROM roles_expected r
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles g WHERE g.rolname = r.rolname)
),
-- ── the tenant set the backfill will walk ───────────────────────────────────
tenants AS (
  SELECT user_id FROM public.business_profiles
  UNION
  SELECT user_id FROM public.onboarding_conversations
),
tenant_count AS (SELECT count(*) AS n FROM tenants),
orphans AS (
  SELECT count(*) AS n
  FROM tenants t
  LEFT JOIN auth.users u ON u.id = t.user_id
  WHERE u.id IS NULL
),
-- The backfill's own SELECT, counted rather than inserted: same union, same
-- group, same two joins, no write.
backfill_rows AS (
  SELECT count(*) AS n
  FROM tenants
  LEFT JOIN (
    SELECT user_id, MIN(created_at) AS first_message_at
    FROM public.onboarding_conversations GROUP BY user_id
  ) AS onboarding ON onboarding.user_id = tenants.user_id
  LEFT JOIN public.business_profiles AS profiles ON profiles.user_id = tenants.user_id
  WHERE tenants.user_id IS NOT NULL
),
sizes AS (
  SELECT (SELECT count(*) FROM public.onboarding_conversations) AS onboarding_rows,
         (SELECT count(*) FROM public.business_profiles)        AS profile_rows,
         (SELECT count(*) FROM auth.users)                      AS auth_users
),
-- Activity, split into "anywhere in the database" (context) and "on the two
-- tables the apply needs a lock on" (the actual question — QA P-4).
--
-- A Supabase project always has something running: replication, the dashboard,
-- background jobs. A row that warns on any of those would warn every time, and a
-- row that always warns stops being read. What matters is whether anything holds
-- a lock on `onboarding_conversations` or `business_profiles`.
activity AS (
  SELECT count(*) FILTER (WHERE state <> 'idle')                        AS active_queries,
         count(*) FILTER (WHERE state = 'idle in transaction')          AS idle_in_transaction,
         COALESCE(max(EXTRACT(epoch FROM (now() - xact_start)))::int, 0) AS longest_txn_seconds
  FROM pg_stat_activity
  WHERE datname = current_database() AND pid <> pg_backend_pid()
),
parent_locks AS (
  SELECT count(*)                                                        AS holders,
         COALESCE(max(EXTRACT(epoch FROM (now() - a.xact_start)))::int, 0) AS longest_seconds,
         COALESCE(string_agg(DISTINCT a.state, ', '), '')                AS states
  FROM pg_stat_activity a
  WHERE a.datname = current_database()
    AND a.pid <> pg_backend_pid()
    AND EXISTS (
      SELECT 1 FROM pg_locks l
      WHERE l.pid = a.pid
        AND l.relation IN (
          to_regclass('public.onboarding_conversations'),
          to_regclass('public.business_profiles')
        )
    )
),
results AS (
  -- 1. Is the database clean?
  SELECT 1 AS sort,
         '1. clean' AS step,
         CASE WHEN p.n = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
         CASE WHEN p.n = 0
              THEN 'None of the nine objects exists yet.'
              ELSE p.n || ' of the nine already exist: ' || p.names END AS finding,
         CASE WHEN p.n = 0
              THEN 'Apply 20261005, then 20261005b.'
              ELSE 'DO NOT APPLY. Either the migration already ran (run '
                   || 'check-bos-entitlements-migration.sql instead) or a previous attempt '
                   || 'half-landed (run rollback-bos-entitlements-migration.sql first). '
                   || 'Applying now would SKIP these objects and the post-apply checks could '
                   || 'pass over a table with the wrong shape.' END AS what_to_do
  FROM present_list p

  UNION ALL
  -- 2. Do the three Supabase roles exist? (QA R-4)
  SELECT 2, '2. roles',
         CASE WHEN r.n = 0 THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN r.n = 0
              THEN 'anon, authenticated and service_role all exist.'
              ELSE 'missing role(s): ' || r.names END,
         CASE WHEN r.n = 0
              THEN 'The migration''s REVOKE/GRANT statements will resolve.'
              ELSE 'DO NOT APPLY: 20261005 REVOKEs from anon/authenticated and GRANTs to '
                   || 'service_role, and a missing role aborts it. Find out why the role is '
                   || 'absent before changing the migration.' END
  FROM roles_missing r

  UNION ALL
  -- 3. Would the backfill's foreign key hold?
  SELECT 3, '3. orphans',
         CASE WHEN o.n = 0 THEN 'PASS' ELSE 'WARN' END,
         CASE WHEN o.n = 0
              THEN 'Every tenant has an auth.users row, so the backfill FK will hold.'
              ELSE o.n || ' tenant(s) have NO auth.users row.' END,
         CASE WHEN o.n = 0
              THEN ''
              ELSE 'DECIDE BEFORE APPLYING. The backfill inserts into a table with an FK to '
                   || 'auth.users, so it would abort in full (nothing partially applied). Either '
                   || 'add a guard to the backfill''s SELECT — AND EXISTS (SELECT 1 FROM auth.users '
                   || 'u WHERE u.id = tenants.user_id) — skipping those accounts deliberately, or '
                   || 'find out why they exist. Paste 2 at the bottom of this file lists them.' END
  FROM orphans o

  UNION ALL
  -- 4. Could one tenant produce more than one row? (QA R-5)
  SELECT 4, '4. one row per tenant',
         CASE WHEN b.n = t.n THEN 'PASS' ELSE 'FAIL' END,
         'backfill would insert ' || b.n || ' row(s) for ' || t.n || ' tenant(s).',
         CASE WHEN b.n = t.n
              THEN ''
              ELSE 'DO NOT APPLY. More rows than tenants means business_profiles.user_id is no '
                   || 'longer unique, so the backfill''s LEFT JOIN multiplies rows — and '
                   || 'business_os_reset_plan_state''s scalar sub-selects would later raise '
                   || '"more than one row returned by a subquery". Restore uniqueness first.' END
  FROM backfill_rows b CROSS JOIN tenant_count t

  UNION ALL
  -- 5. How big is the work?
  SELECT 5, '5. size', 'INFO',
         'tenants=' || t.n || ', rows the backfill would insert=' || b.n
           || ', onboarding_conversations=' || s.onboarding_rows
           || ', business_profiles=' || s.profile_rows
           || ', auth.users=' || s.auth_users,
         'The editor''s execution time below is the backfill''s READ cost; the insert adds the '
           || 'write on top. 20261005b sets statement_timeout = 10min.'
  FROM sizes s CROSS JOIN tenant_count t CROSS JOIN backfill_rows b

  UNION ALL
  -- 6. Is now a quiet moment ON THE TWO TABLES THAT MATTER? (QA P-4)
  --
  -- Scoped to sessions holding a lock on a parent table, not to every
  -- transaction in the database — otherwise this row warns on a healthy Supabase
  -- project every time, and a row that always warns is a row nobody reads. The
  -- database-wide numbers stay in the finding as context.
  SELECT 6, '6. quiet on the parent tables',
         CASE WHEN p.holders = 0 OR p.longest_seconds < 5 THEN 'PASS' ELSE 'WARN' END,
         'sessions holding a lock on onboarding_conversations / business_profiles='
           || p.holders
           || CASE WHEN p.holders > 0
                   THEN ' (oldest ' || p.longest_seconds || 's, state: ' || p.states || ')'
                   ELSE '' END
           || ' — for context, database-wide: active=' || a.active_queries
           || ', idle in transaction=' || a.idle_in_transaction
           || ', longest open transaction=' || a.longest_txn_seconds || 's',
         CASE WHEN p.holders = 0 OR p.longest_seconds < 5
              THEN 'Nothing is holding either parent table. The database-wide numbers are normal '
                   || 'on a live project (replication, dashboard, background jobs) and are not a '
                   || 'reason to wait.'
              ELSE 'Step 4 of the apply needs an ACCESS EXCLUSIVE lock on both parent tables for '
                   || 'the instant it creates the triggers, and waits 5s for it. Something has held '
                   || 'one for longer than that, so the apply would probably fail with 55P03 — '
                   || 'safely (nothing applied), but you would rather know now. This is an '
                   || 'indicator, not a verdict: re-run this in a quieter minute, and if it '
                   || 'persists, find the session in Dashboard → Database → Query performance.' END
  FROM parent_locks p CROSS JOIN activity a

  UNION ALL
  -- 7. What success looks like (QA R-6).
  SELECT 7, '7. what next', 'INFO',
         'Clear to apply when: row 1 PASS, row 2 PASS, row 3 PASS, row 4 PASS, row 6 PASS.',
         'Then apply supabase/migrations/20261005_business_os_entitlements.sql, then '
           || '20261005b_..._backfill.sql, then run check-bos-entitlements-migration.sql. '
           || 'Full runbook: docs/workplans/business-os-subscription-entitlements.md §4.20.'

  UNION ALL
  -- 8. What the read-only setting ACTUALLY did (SA R-2).
  --
  -- Not an assertion — a measurement. `default_transaction_read_only` applies to
  -- transactions started AFTER the SET, so if the editor wrapped this whole
  -- paste in one implicit transaction that had already begun, the SELECT you are
  -- reading is NOT itself read-only. Nothing is at risk either way (this file
  -- contains no write), but the answer is worth having, and this row is where it
  -- arrives the first time anyone runs it.
  SELECT 8, '8. read-only state', 'INFO',
         'this statement: transaction_read_only=' || current_setting('transaction_read_only')
           || '; this connection from now on: default_transaction_read_only='
           || current_setting('default_transaction_read_only'),
         CASE WHEN current_setting('transaction_read_only') = 'on'
              THEN 'Both on: the database refused writes for this statement too. '
              ELSE 'The setting took effect for the CONNECTION but not for this statement — the '
                   || 'editor ran the paste inside a transaction that had already started. Harmless '
                   || 'here (nothing below writes), and worth knowing. '
         END
           || 'Either way the connection is read-only from now on, so a later query of yours may '
           || 'fail with "cannot execute … in a read-only transaction" — and THE APPLY STEP WILL '
           || 'TOO. Clear it with: RESET default_transaction_read_only;'
)
SELECT sort, step, status, finding, what_to_do
FROM (
  SELECT 0 AS sort, 'OVERALL' AS step,
         CASE
           WHEN EXISTS (SELECT 1 FROM results WHERE status = 'FAIL') THEN 'FAIL'
           WHEN EXISTS (SELECT 1 FROM results WHERE status = 'WARN') THEN 'WARN'
           ELSE 'PASS'
         END AS status,
         (SELECT count(*) FROM results WHERE status = 'PASS') || ' pass, '
           || (SELECT count(*) FROM results WHERE status = 'WARN') || ' warn, '
           || (SELECT count(*) FROM results WHERE status = 'FAIL') || ' fail' AS finding,
         CASE
           WHEN EXISTS (SELECT 1 FROM results WHERE status = 'FAIL')
             THEN 'STOP — do not apply anything. Read the FAIL row(s) below.'
           WHEN EXISTS (SELECT 1 FROM results WHERE status = 'WARN')
             THEN 'Read the WARN row(s) below and decide before applying.'
           ELSE 'Clear to apply. Follow §4.20 from step 4.'
         END AS what_to_do
  UNION ALL
  SELECT * FROM results
) AS report
ORDER BY sort;


-- ════════════════════════════════════════════════════════════════════════════
-- PASTE 2 (optional) — only if row 3 said WARN: which tenants have no login row.
-- Ids only: no names, no emails. Still read-only.
-- ════════════════════════════════════════════════════════════════════════════
--
-- SELECT t.user_id AS tenant_without_auth_user
-- FROM (
--   SELECT user_id FROM public.business_profiles
--   UNION
--   SELECT user_id FROM public.onboarding_conversations
-- ) AS t
-- LEFT JOIN auth.users u ON u.id = t.user_id
-- WHERE u.id IS NULL
-- LIMIT 20;


-- ════════════════════════════════════════════════════════════════════════════
-- PASTE 3 (optional) — how the planner intends to do the backfill's scan.
-- Worth a glance only if row 5 shows a table far larger than you expected.
-- EXPLAIN without ANALYZE executes nothing.
-- ════════════════════════════════════════════════════════════════════════════
--
-- EXPLAIN
-- SELECT tenants.user_id
-- FROM (
--   SELECT user_id FROM public.business_profiles
--   UNION
--   SELECT user_id FROM public.onboarding_conversations
-- ) AS tenants
-- LEFT JOIN (
--   SELECT user_id, MIN(created_at) AS first_message_at
--   FROM public.onboarding_conversations GROUP BY user_id
-- ) AS onboarding ON onboarding.user_id = tenants.user_id
-- LEFT JOIN public.business_profiles AS profiles ON profiles.user_id = tenants.user_id;
