-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  POST-APPLY CHECKS — SUPABASE SQL EDITOR. READ ONLY. SAFE ON PRODUCTION. ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- HOW TO RUN: Supabase dashboard → SQL Editor → new query → paste this whole
-- file → Run. Nothing to install, no variables, no flags.
--
-- Run it AFTER applying 20261005 and 20261005b. Run it again whenever you want
-- to know the module is still intact — it writes nothing and can be run any
-- number of times.
--
-- ── WHY IT IS SAFE ──────────────────────────────────────────────────────────
-- Chiefly because **this file is one `SET` and one `SELECT`**: a `SELECT` over
-- catalogs and counts writes nothing, and there is no INSERT, UPDATE, DELETE or
-- DDL below. The `SET default_transaction_read_only = on` is the second line of
-- defence — it makes Postgres reject writes on this connection with error 25006,
-- for transactions started after it. Whether that covers the SELECT in this same
-- paste depends on how the editor submits it, which cannot be established from
-- here, so **the last row of the output measures it** instead of this comment
-- claiming it.
--
-- ⚠️ The setting outlives the script on that connection. If you then re-run the
-- APPLY on the same tab it will fail with "cannot execute … in a read-only
-- transaction". One line clears it:
--
--     RESET default_transaction_read_only;
--
-- ── HOW TO READ THE OUTPUT ──────────────────────────────────────────────────
-- One result grid, one row per check, with a `status` column:
--
--     PASS   the property holds
--     FAIL   the property does NOT hold; `what_to_do` says what to do
--     WARN   true and expected, but somebody should know
--     INFO   a number for the record
--
-- If the whole query fails with `relation "public.business_os_account_plans"
-- does not exist`, that IS the answer: the first migration has not been applied.
-- Run the pre-flight instead.
--
-- Row 0 is `OVERALL`. **The apply is verified when OVERALL says PASS.** Rows are
-- used rather than `RAISE`: the SQL editor does not display NOTICE or WARNING
-- output, and a check you cannot see is not a check. It also means one run
-- reports EVERY problem, instead of stopping at the first.
--
-- ── WHAT THIS CANNOT ANSWER ─────────────────────────────────────────────────
-- Behaviour needs writes: that the trigger really records a fact, that a failing
-- plan write cannot fail a product write, that a trial cannot be restarted, the
-- reset function, the shadow RPC's arithmetic. Those live in
-- scripts/verify-bos-entitlements-migration.sql, **which must not be run on
-- production** — see its header for what that costs and how the gap is closed.
-- Everything below is structure and data, which is all that can be established
-- without writing.

SET default_transaction_read_only = on;

WITH
plan_tables(name) AS (
  VALUES ('business_os_account_plans'),
         ('business_os_entitlement_overrides'),
         ('business_os_entitlement_shadow_events')
),
tbl AS (
  SELECT t.name,
         c.oid,
         c.relrowsecurity,
         c.relacl,
         pg_get_userbyid(c.relowner) AS owner
  FROM plan_tables t
  LEFT JOIN pg_class c
    ON c.oid = to_regclass('public.' || t.name)
),
-- Privileges straight from the ACL, not via has_table_privilege(): a role that
-- does not exist would make has_table_privilege() raise and take the whole
-- report down with it.
table_grants AS (
  SELECT t.name,
         COALESCE(r.rolname, 'PUBLIC') AS grantee,
         a.privilege_type
  FROM tbl t
  CROSS JOIN LATERAL aclexplode(t.relacl) a
  LEFT JOIN pg_roles r ON r.oid = a.grantee
  WHERE t.oid IS NOT NULL
),
fns AS (
  SELECT p.oid,
         p.proname,
         p.prosecdef,
         p.proacl,
         pg_get_userbyid(p.proowner) AS owner,
         COALESCE(array_to_string(p.proconfig, ','), '') AS cfg
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND p.proname IN ('business_os_record_shadow_events',
                      'business_os_reset_plan_state',
                      'business_os_plan_fact_onboarding',
                      'business_os_plan_fact_profile')
),
fn_grants AS (
  SELECT f.proname,
         COALESCE(r.rolname, 'PUBLIC') AS grantee,
         a.privilege_type
  FROM fns f
  CROSS JOIN LATERAL aclexplode(f.proacl) a
  LEFT JOIN pg_roles r ON r.oid = a.grantee
),
-- ── data ────────────────────────────────────────────────────────────────────
tenants AS (
  SELECT user_id FROM public.business_profiles
  UNION
  SELECT user_id FROM public.onboarding_conversations
),
counts AS (
  SELECT
    (SELECT count(*) FROM tenants) AS tenants,
    (SELECT count(*) FROM public.business_os_account_plans) AS plan_rows,
    (SELECT count(*) FROM public.business_os_account_plans WHERE origin = 'backfill') AS backfilled,
    (SELECT count(*) FROM tenants t
       LEFT JOIN public.business_os_account_plans p ON p.user_id = t.user_id
      WHERE p.user_id IS NULL) AS missing,
    (SELECT count(*) FROM public.business_os_account_plans
      WHERE origin = 'backfill'
        AND (cohort <> 'champion' OR cohort_expires_at IS NOT NULL OR tier IS NOT NULL)) AS malformed,
    (SELECT count(*) FROM public.business_os_account_plans p
      WHERE (p.onboarding_started_at IS NULL
             AND EXISTS (SELECT 1 FROM public.onboarding_conversations o WHERE o.user_id = p.user_id))
         OR (p.profile_created_at IS NULL
             AND EXISTS (SELECT 1 FROM public.business_profiles b WHERE b.user_id = p.user_id))) AS unhealed,
    (SELECT count(*) FROM public.business_os_account_plans p
      WHERE p.origin IN ('onboarding_trigger', 'profile_trigger')
        AND (EXISTS (SELECT 1 FROM public.onboarding_conversations o
                      WHERE o.user_id = p.user_id AND o.created_at < p.created_at)
             OR EXISTS (SELECT 1 FROM public.business_profiles b
                         WHERE b.user_id = p.user_id AND b.created_at < p.created_at))) AS window_rows,
    (SELECT count(*) FROM public.business_os_account_plans
      WHERE cohort = 'champion' AND cohort_expires_at IS NULL) AS open_ended_champions,
    (SELECT count(*) FROM public.business_os_account_plans
      WHERE cohort = 'champion' AND cohort_expires_at IS NULL AND profile_created_at IS NULL) AS open_ended_no_profile,
    (SELECT count(*) FROM public.business_os_account_plans WHERE cohort = 'trial') AS trials,
    (SELECT count(*) FROM public.business_os_account_plans WHERE tier IS NOT NULL) AS with_tier,
    (SELECT count(*) FROM public.business_os_account_plans
      WHERE origin IN ('onboarding_trigger', 'profile_trigger')) AS trigger_origin_rows,
    (SELECT count(*) FROM public.business_os_entitlement_overrides WHERE ended_at IS NULL) AS active_overrides,
    (SELECT count(*) FROM public.business_os_entitlement_shadow_events) AS shadow_events
),
results AS (
  -- ── A. objects ────────────────────────────────────────────────────────────
  SELECT 10 AS sort, 'A1 tables exist' AS step,
         CASE WHEN count(*) FILTER (WHERE oid IS NULL) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
         CASE WHEN count(*) FILTER (WHERE oid IS NULL) = 0
              THEN 'all three tables are present'
              ELSE 'missing: ' || string_agg(name, ', ') FILTER (WHERE oid IS NULL) END AS finding,
         CASE WHEN count(*) FILTER (WHERE oid IS NULL) = 0 THEN ''
              ELSE 'Apply supabase/migrations/20261005_business_os_entitlements.sql.' END AS what_to_do
  FROM tbl

  UNION ALL
  SELECT 11, 'A2 RLS enabled',
         CASE WHEN count(*) FILTER (WHERE oid IS NOT NULL AND NOT relrowsecurity) = 0 THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN count(*) FILTER (WHERE oid IS NOT NULL AND NOT relrowsecurity) = 0
              THEN 'row level security is on for every table'
              ELSE 'RLS OFF on: ' || string_agg(name, ', ') FILTER (WHERE oid IS NOT NULL AND NOT relrowsecurity) END,
         CASE WHEN count(*) FILTER (WHERE oid IS NOT NULL AND NOT relrowsecurity) = 0 THEN ''
              ELSE 'RLS-off plus no policies means anyone with a table grant reads everything. '
                   || 'Re-apply 20261005 or ALTER TABLE … ENABLE ROW LEVEL SECURITY.' END
  FROM tbl

  UNION ALL
  SELECT 12, 'A3 no policies',
         CASE WHEN (SELECT count(*) FROM pg_policies pol
                     WHERE pol.schemaname = 'public'
                       AND pol.tablename IN (SELECT name FROM plan_tables)) = 0
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*)::text FROM pg_policies pol
           WHERE pol.schemaname = 'public'
             AND pol.tablename IN (SELECT name FROM plan_tables)) || ' policy/policies defined',
         'This module defines none: every read and write goes through service_role in the '
           || 'repository layer. A policy here would be someone else''s change.'

  UNION ALL
  -- The one that matters: nobody except service_role may touch these tables.
  SELECT 13, 'A4 client roles have no grant',
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN count(*) = 0
              THEN 'no grants to anon, authenticated or PUBLIC'
              ELSE string_agg(DISTINCT grantee || ' on ' || name, ', ') END,
         CASE WHEN count(*) = 0 THEN ''
              ELSE 'An account could read or write its own entitlements. Re-apply the REVOKE '
                   || 'statements at the end of 20261005.' END
  FROM table_grants
  WHERE grantee IN ('anon', 'authenticated', 'PUBLIC')

  UNION ALL
  SELECT 14, 'A10 service_role can work',
         CASE WHEN count(DISTINCT name || '.' || privilege_type) = 9 THEN 'PASS' ELSE 'FAIL' END,
         -- DISTINCT because the same privilege granted by two grantors is two ACL
         -- rows and one permission; counting rows would fail a healthy database.
         count(DISTINCT name || '.' || privilege_type) || ' of 9 expected grants (SELECT/INSERT/UPDATE × 3 tables)',
         CASE WHEN count(DISTINCT name || '.' || privilege_type) = 9 THEN ''
              ELSE 'Every repository call would fail with "permission denied". Re-apply the '
                   || 'GRANT statements at the end of 20261005.' END
  FROM table_grants
  WHERE grantee = 'service_role' AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE')

  UNION ALL
  -- ── functions ─────────────────────────────────────────────────────────────
  SELECT 20, 'A8 four functions',
         CASE WHEN count(*) = 4 THEN 'PASS' ELSE 'FAIL' END,
         count(*) || ' of the 4 entitlement functions exist',
         CASE WHEN count(*) = 4 THEN '' ELSE 'Re-apply 20261005.' END
  FROM fns

  UNION ALL
  SELECT 21, 'A6 search_path pinned',
         CASE WHEN count(*) FILTER (WHERE position('search_path=' in cfg) = 0) = 0 AND count(*) = 4
              THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN count(*) FILTER (WHERE position('search_path=' in cfg) = 0) = 0
              THEN 'all four pin search_path'
              ELSE 'not pinned: ' || string_agg(proname, ', ') FILTER (WHERE position('search_path=' in cfg) = 0) END,
         'An unpinned search_path on a SECURITY DEFINER function is a privilege-escalation '
           || 'route: a caller-controlled schema could shadow a table name.'
  FROM fns

  UNION ALL
  SELECT 22, 'A7 trigger functions are DEFINER with lock_timeout',
         CASE WHEN count(*) = 2
                   AND count(*) FILTER (WHERE prosecdef) = 2
                   AND count(*) FILTER (WHERE position('lock_timeout=2s' in cfg) > 0) = 2
              THEN 'PASS' ELSE 'FAIL' END,
         count(*) || ' fact function(s); ' || count(*) FILTER (WHERE prosecdef) || ' SECURITY DEFINER; '
           || count(*) FILTER (WHERE position('lock_timeout=2s' in cfg) > 0) || ' with lock_timeout=2s',
         'DEFINER so a user''s own INSERT can write the plan table; lock_timeout=2s so a lock on '
           || 'the plan table can never stall a customer''s onboarding message.'
  FROM fns WHERE proname LIKE 'business_os_plan_fact_%'

  UNION ALL
  SELECT 23, 'A5 callable functions are INVOKER',
         CASE WHEN count(*) = 2 AND count(*) FILTER (WHERE prosecdef) = 0 THEN 'PASS' ELSE 'FAIL' END,
         count(*) || ' callable function(s); ' || count(*) FILTER (WHERE prosecdef) || ' are SECURITY DEFINER',
         'record_shadow_events and reset_plan_state run as their caller (service_role) on '
           || 'purpose: DEFINER would make them usable by anyone who could reach them.'
  FROM fns WHERE proname NOT LIKE 'business_os_plan_fact_%'

  UNION ALL
  SELECT 24, 'A5 no client EXECUTE',
         CASE WHEN count(*) FILTER (WHERE grantee IN ('anon', 'authenticated', 'PUBLIC')) = 0
                   AND (SELECT count(*) FROM fns WHERE proacl IS NULL) = 0
              THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN (SELECT count(*) FROM fns WHERE proacl IS NULL) > 0
              THEN (SELECT string_agg(proname, ', ') FROM fns WHERE proacl IS NULL)
                   || ' has a NULL ACL, i.e. the default EXECUTE to PUBLIC'
              WHEN count(*) FILTER (WHERE grantee IN ('anon', 'authenticated', 'PUBLIC')) > 0
              THEN string_agg(DISTINCT grantee || ' → ' || proname, ', ')
                   FILTER (WHERE grantee IN ('anon', 'authenticated', 'PUBLIC'))
              ELSE 'no client role can execute any of the four' END,
         CASE WHEN count(*) FILTER (WHERE grantee IN ('anon', 'authenticated', 'PUBLIC')) = 0
                   AND (SELECT count(*) FROM fns WHERE proacl IS NULL) = 0 THEN ''
              ELSE 'Re-apply the REVOKE … FROM PUBLIC, anon, authenticated lines in 20261005.' END
  FROM fn_grants

  UNION ALL
  SELECT 25, 'A10 service_role can execute the callable two',
         CASE WHEN count(DISTINCT proname) = 2 THEN 'PASS' ELSE 'FAIL' END,
         count(DISTINCT proname) || ' of 2 have EXECUTE for service_role',
         -- QA P-3: the same DISTINCT count as the status. With count(*) here, a
         -- grant made by two grantors produced a PASS row carrying a failure
         -- message — in the grid that goes into the PR.
         CASE WHEN count(DISTINCT proname) = 2 THEN '' ELSE 'The shadow writer and the admin reset would both fail.' END
  FROM fn_grants
  WHERE grantee = 'service_role' AND privilege_type = 'EXECUTE'
    AND proname NOT LIKE 'business_os_plan_fact_%'

  UNION ALL
  -- Ownership is a deployment property (Q-14): recorded, never asserted.
  SELECT 26, 'function owners', 'INFO',
         COALESCE(string_agg(proname || '=' || owner, ', ' ORDER BY proname), 'no functions'),
         'For the record. SECURITY DEFINER runs as the owner, so this is who the fact triggers '
           || 'write as.'
  FROM fns

  UNION ALL
  -- ── triggers ──────────────────────────────────────────────────────────────
  SELECT 30, 'A9 triggers bound correctly',
         CASE WHEN (SELECT count(*) FROM pg_trigger t
                    JOIN pg_class c ON c.oid = t.tgrelid
                    JOIN pg_proc p ON p.oid = t.tgfoid
                    WHERE NOT t.tgisinternal
                      AND (t.tgtype & 4) <> 0 AND (t.tgtype & 1) <> 0 AND (t.tgtype & 2) = 0
                      AND ((t.tgname = 'business_os_plan_on_onboarding'
                            AND c.relname = 'onboarding_conversations'
                            AND p.proname = 'business_os_plan_fact_onboarding')
                        OR (t.tgname = 'business_os_plan_on_profile'
                            AND c.relname = 'business_profiles'
                            AND p.proname = 'business_os_plan_fact_profile'))) = 2
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
           JOIN pg_proc p ON p.oid = t.tgfoid
           WHERE NOT t.tgisinternal
             AND (t.tgtype & 4) <> 0 AND (t.tgtype & 1) <> 0 AND (t.tgtype & 2) = 0
             AND ((t.tgname = 'business_os_plan_on_onboarding'
                   AND c.relname = 'onboarding_conversations'
                   AND p.proname = 'business_os_plan_fact_onboarding')
               OR (t.tgname = 'business_os_plan_on_profile'
                   AND c.relname = 'business_profiles'
                   AND p.proname = 'business_os_plan_fact_profile')))::text
           || ' of 2 AFTER INSERT … FOR EACH ROW triggers bound to their own table and function',
         'Checked by binding, not by name: a trigger with the right name on the wrong table '
           || 'would record facts for the wrong tenant.'

  UNION ALL
  -- ── constraints ───────────────────────────────────────────────────────────
  SELECT 40, 'A11 CHECK constraints',
         CASE WHEN (SELECT count(*) FROM (
                      VALUES ('business_os_account_plans_tier_versioned', '%plan_version > 0%'),
                             ('business_os_account_plans_tier_expiry_needs_tier', '%tier_expires_at IS NULL%'),
                             ('business_os_account_plans_cohort_expiry_needs_cohort', '%cohort_expires_at IS NULL%')
                    ) AS e(cname, pattern)
                    WHERE EXISTS (
                      SELECT 1 FROM pg_constraint k
                      WHERE k.conrelid = to_regclass('public.business_os_account_plans')
                        AND k.contype = 'c' AND k.conname = e.cname
                        AND pg_get_constraintdef(k.oid) LIKE e.pattern)) = 3
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM (
            VALUES ('business_os_account_plans_tier_versioned', '%plan_version > 0%'),
                   ('business_os_account_plans_tier_expiry_needs_tier', '%tier_expires_at IS NULL%'),
                   ('business_os_account_plans_cohort_expiry_needs_cohort', '%cohort_expires_at IS NULL%')
          ) AS e(cname, pattern)
          WHERE EXISTS (
            SELECT 1 FROM pg_constraint k
            WHERE k.conrelid = to_regclass('public.business_os_account_plans')
              AND k.contype = 'c' AND k.conname = e.cname
              AND pg_get_constraintdef(k.oid) LIKE e.pattern))::text
           || ' of 3 present AND checking what their name claims',
         'Each is matched against its definition, not just its name: a constraint renamed onto a '
           || 'different expression would otherwise pass. A-1''s tier_expires_at rule is one of them.'

  UNION ALL
  -- ── B. the data the backfill produced ─────────────────────────────────────
  SELECT 50, 'B1 every tenant has a plan row',
         CASE WHEN c.missing = 0 THEN 'PASS' ELSE 'FAIL' END,
         c.missing || ' of ' || c.tenants || ' tenant(s) have no plan row',
         CASE WHEN c.missing = 0 THEN ''
              ELSE 'Apply supabase/migrations/20261005b_business_os_entitlements_backfill.sql. '
                   || 'It is re-runnable.' END
  FROM counts c

  UNION ALL
  SELECT 51, 'B2 backfilled rows are open-ended champions',
         CASE WHEN c.malformed = 0 THEN 'PASS' ELSE 'FAIL' END,
         c.malformed || ' backfilled row(s) are not (champion, no expiry, no tier)',
         CASE WHEN c.malformed = 0 THEN ''
              ELSE 'U-2/B-14: every account that existed at rollout becomes a champion with no '
                   || 'end date. A row that is not is either an admin edit or a bug.' END
  FROM counts c

  UNION ALL
  -- Non-vacuity: without this, B1 and B2 both pass on a database where the
  -- backfill never ran and there is nothing to be wrong.
  SELECT 52, 'B3 the backfill actually ran',
         CASE WHEN c.tenants = 0 OR c.backfilled > 0 THEN 'PASS' ELSE 'FAIL' END,
         c.backfilled || ' row(s) with origin=backfill, for ' || c.tenants || ' tenant(s)',
         CASE WHEN c.tenants = 0 OR c.backfilled > 0 THEN ''
              ELSE 'Tenants exist but nothing was backfilled: 20261005b has not been applied, and '
                   || 'B1/B2 above proved nothing.' END
  FROM counts c

  UNION ALL
  SELECT 53, 'B4 facts were healed',
         CASE WHEN c.unhealed = 0 THEN 'PASS' ELSE 'FAIL' END,
         c.unhealed || ' plan row(s) are missing a fact their own history could supply',
         CASE WHEN c.unhealed = 0 THEN ''
              ELSE 'Re-run 20261005b — its heal step fills exactly these. (A NULL fact with no '
                   || 'history is normal and is not counted here.)' END
  FROM counts c

  UNION ALL
  -- Q-5: a pre-existing tenant caught by a trigger between the two migrations
  -- is recorded as a trial when it should be a champion. Not an error.
  SELECT 54, 'Q-5 migration-window rows',
         CASE WHEN c.window_rows = 0 THEN 'PASS' ELSE 'WARN' END,
         c.window_rows || ' pre-existing tenant(s) were caught by a trigger between the two migrations',
         CASE WHEN c.window_rows = 0
              THEN 'The two migrations were applied close enough together that nobody fell in the gap.'
              ELSE 'They are recorded as trials. Harmless while the mode is off; the launch '
                   || 'operation makes them champions at switch-on. Their facts were healed by '
                   || '20261005b. Note the number in the PR.' END
  FROM counts c

  UNION ALL
  -- ── C. numbers for the record ─────────────────────────────────────────────
  SELECT 60, 'C counts', 'INFO',
         'tenants=' || c.tenants || ', plan_rows=' || c.plan_rows || ', backfilled=' || c.backfilled
           || ', trials=' || c.trials || ', with_tier=' || c.with_tier
           || ', open_ended_champions=' || c.open_ended_champions
           || ', of those with no business profile=' || c.open_ended_no_profile
           || ', active_overrides=' || c.active_overrides || ', shadow_events=' || c.shadow_events,
         'open_ended_no_profile is the S1-T11a trim list: accounts that opened onboarding once and '
           || 'never came back, currently champions for ever.'
  FROM counts c

  UNION ALL
  -- The trigger's real-traffic proof (see §4.20 step 8). It is 0 immediately
  -- after the apply and should stop being 0 once new signups arrive.
  SELECT 61, 'trigger rows since apply',
         CASE WHEN c.trigger_origin_rows > 0 THEN 'PASS' ELSE 'INFO' END,
         c.trigger_origin_rows || ' plan row(s) created by a trigger rather than the backfill',
         CASE WHEN c.trigger_origin_rows > 0
              THEN 'The fact triggers are working on real traffic — this is the evidence the probe '
                   || 'suite would have produced, taken from production instead of written into it.'
              ELSE 'Expected to be 0 right after the apply. Re-run this check after the next signup '
                   || '(§4.20 step 8); if it is still 0 once new tenants exist, the triggers are not '
                   || 'firing.' END
  FROM counts c

  UNION ALL
  -- What the read-only setting actually did (SA R-2): measured, not asserted.
  SELECT 70, 'read-only state', 'INFO',
         'this statement: transaction_read_only=' || current_setting('transaction_read_only')
           || '; this connection from now on: default_transaction_read_only='
           || current_setting('default_transaction_read_only'),
         CASE WHEN current_setting('transaction_read_only') = 'on'
              THEN 'Both on: the database refused writes for this statement too. '
              ELSE 'The setting took effect for the CONNECTION but not for this statement — the '
                   || 'editor ran the paste inside a transaction that had already started. Harmless '
                   || 'here (this file contains no write). '
         END
           || 'The connection is read-only from now on, so re-running the APPLY on this tab would '
           || 'fail with "cannot execute … in a read-only transaction". Clear it with: '
           || 'RESET default_transaction_read_only;'
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
             THEN 'The apply is NOT verified. Read every FAIL row below.'
           WHEN EXISTS (SELECT 1 FROM results WHERE status = 'WARN')
             THEN 'Verified, with something to note in the PR. Read the WARN row(s).'
           ELSE 'Verified. Paste this grid into the PR and §4.20 step 7.'
         END AS what_to_do
  UNION ALL
  SELECT * FROM results
) AS report
ORDER BY sort;
