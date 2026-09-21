-- P0-PAY-RLS: no browser-side writes to the Business OS payment tables or the
-- credit ledger.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- Read live on production on 2026-09-21 (read-only SQL, by the user). RLS is on,
-- but twelve tables carry PERMISSIVE owner policies that allow WRITES to role
-- PUBLIC, and both `anon` and `authenticated` hold INSERT/UPDATE/DELETE on all
-- of them:
--
--   credit_transactions             "Users can insert their own transactions"            INSERT
--   payment_automation_executions   "Users can view their own automation executions"     ALL
--   payment_automation_rules        "Users can manage their own automation rules"        ALL
--   payment_events                  "Users can view their own payment events"            ALL
--   payment_invoices                insert / update / delete their own invoices          INSERT, UPDATE, DELETE
--   payment_methods                 insert / update / delete their own payment methods   INSERT, UPDATE, DELETE
--   payment_plan_installments       "Users can manage their own installments"            ALL
--   payment_plans                   "Users can manage their own payment plans"           ALL
--   payment_processors              "Users can manage their own payment processors"      ALL
--   payment_reminders               "Users can manage their own payment reminders"       ALL
--   payment_transactions            insert / update / delete their own transactions      INSERT, UPDATE, DELETE
--   saved_payment_methods           "Users can manage their contacts saved payment methods" ALL
--
-- `FOR ALL` covers INSERT, UPDATE and DELETE. With no WITH CHECK, Postgres
-- re-uses USING as the write check, so a row stays writable as long as it keeps
-- the caller's own `user_id` — nothing constrains which columns or what values.
-- Any signed-in user can therefore run, from the devtools console with the
-- public anon key:
--
--   supabase.from('payment_invoices').update({ status: 'paid', amount: 0 }).eq('user_id', myId)
--   supabase.from('payment_transactions').insert({ user_id: myId, amount: 100000, status: 'succeeded' })
--   supabase.from('credit_transactions').insert({ user_id: myId, credits_delta: 999999 })
--
-- and mark their own invoices paid, fabricate revenue, delete a refund's source
-- transaction, disable a reminder, or forge ledger rows. It leaves no API log,
-- no correlationId and no audit entry. It also makes the money model advisory:
-- `payment_transactions` is what `get_revenue` counts, and trigger T4
-- (`update_invoice_on_payment`) flips the linked invoice to `paid` from a
-- transaction row.
--
-- WHAT THIS CHANGES
--
--   1. The eight `FOR ALL` policies are CONVERTED, not dropped: each is replaced
--      by a `FOR SELECT` policy of the same name plus " (read-only)", carrying
--      the *same* USING expression and the same roles, copied verbatim from
--      `pg_policies` at run time. Two of them are named "Users can view ..." but
--      are `cmd = ALL` — on at least some of these tables the ALL policy may be
--      the ONLY policy, so owner reads depend on it. A plain DROP would silently
--      kill the payments UI.
--   2. The INSERT / UPDATE / DELETE-only policies are dropped. Those are
--      write-only; reads never depended on them.
--   3. Every write privilege is revoked from `anon` and `authenticated` on all
--      twelve tables. SELECT is kept.
--   4. EXECUTE on `public.update_overdue_installments()` is revoked from PUBLIC,
--      `anon` and `authenticated` (QA-2). Revoking table privileges alone does
--      NOT close that one: the function is SECURITY DEFINER, so it runs as its
--      owner and bypasses both RLS and the grants above. It kept PostgreSQL's
--      default `EXECUTE TO PUBLIC` (unlike the four queue claim/reap functions,
--      which carry explicit revokes), so it is callable at
--      `POST /rest/v1/rpc/update_overdue_installments` with the public anon key
--      — and its `UPDATE payment_plan_installments SET status = 'overdue'` has
--      no `user_id` predicate, so one unauthenticated call flips every tenant's
--      installments. Confirmed live on prod 2026-09-21:
--      `has_function_privilege` is true for BOTH `anon` and `authenticated`.
--      `FROM PUBLIC` is required — the grant is the default PUBLIC one, so
--      revoking from the two roles alone would be a no-op. This is a FUNCTION
--      privilege, so the `bypassrls` caveat about table privileges does not
--      apply. Nothing in the repo calls it (zero `.rpc('update_overdue_installments')`
--      hits; the only other occurrences are its own definition and an inventory
--      row in `scripts/check-migrations.sql`), no cron is wired to it, and
--      `PaymentReminderService.processOverdueItems` does its own user-scoped
--      UPDATE through the service role instead.
--
-- Policies and grants both, on purpose: without the grant a policy is
-- unreachable, and without the policy the grant is unusable. Either alone closes
-- the hole today, but a future dashboard edit that restores one of them would
-- re-open it.
--
-- WHAT THIS DOES NOT TOUCH
--
--   * SELECT. Every SELECT policy is left alone, the eight ALL policies keep
--     their read half under the new name, and SELECT stays granted to `anon` and
--     `authenticated`. Post-conditions below ABORT the whole transaction if any
--     of the twelve tables would be left without a PERMISSIVE SELECT policy or
--     without `authenticated`'s SELECT.
--   * Service-role policies (`credit_transactions`, `billing_events`,
--     `boost_pack_purchases`). The service role bypasses RLS anyway; every
--     server write path keeps working unchanged. The sweep in step 2 skips any
--     policy whose USING/WITH CHECK mentions `service_role`, and any policy
--     whose roles do not include `public` / `anon` / `authenticated`.
--   * `billing_events` and `boost_pack_purchases` themselves — they have no user
--     write policy and are not in this file.
--   * `anon`'s SELECT grant. It is inert (the owner policies require
--     `auth.uid() = user_id`, which is NULL for an unauthenticated caller) and
--     revoking it would turn reads issued before session hydration into 403s.
--     Same decision as the `user_subscriptions` lock-down.
--   * Triggers and functions. `log_payment_activity`, `update_invoice_on_payment`,
--     `recompute_transaction_refund_state`, `propagate_refund_to_invoice` and
--     `move_plan_stage_with_invoice` are SECURITY INVOKER, so they run with the
--     privileges of whoever wrote the source row — and every app writer of those
--     source rows is the service role (see the workplan's blast radius), which
--     bypasses RLS and holds the grants. The queue claim/reap functions
--     (`claim_due_payment_reminders`, `reap_stale_payment_reminders`,
--     `claim_due_payment_automation_executions`,
--     `reap_stale_payment_automation_executions`) are SECURITY DEFINER and are
--     unaffected by these grants — they already carry explicit
--     `REVOKE ALL ... FROM anon, authenticated`, so they are not reachable from
--     a browser. `update_overdue_installments()` is the same shape WITHOUT that
--     revoke: unaffected by these grants therefore still open, which is why
--     item 4 above closes it here rather than leaving it to a follow-up. Its
--     BODY is untouched — only the EXECUTE privilege changes.
--
-- CODE THAT MUST SHIP FIRST: NONE.
--
-- The blast-radius sweep (workplan §3, 2026-09-21) found no RLS-respecting
-- writer to any of the twelve tables. Every writer is `supabaseServer` /
-- `supabaseAdmin`: the payment repositories default to `supabaseServer` and are
-- exported as singletons, every `settleInvoicePaid` call site passes
-- `supabaseServer`, the reminder / automation / retry drains use the
-- service-role singletons, and no `'use client'` module writes any of them.
-- ONE exception, deliberately not fixed — `RewardService` is built with the
-- BROWSER client in `app/v2/agents/[id]/page.tsx` and
-- `app/(protected)/agents/[id]/page.tsx` and INSERTs `credit_transactions`. That
-- path is the same accepted degradation as D-3 of the `user_subscriptions`
-- lock-down (it awards credits from the browser, which IS the vulnerability).
-- See the ORDERING note below: it matters which of the two migrations is applied
-- first.
--
-- ORDERING against 20261001_user_subscriptions_write_lockdown.sql
--
-- `RewardService.awardAgentSharingReward` upserts `user_subscriptions.balance`
-- FIRST and inserts the `credit_transactions` ledger row SECOND, and on a failed
-- ledger insert it returns `success: true` ("Credits awarded but transaction
-- logging failed"). So:
--   * 20261001 already applied  -> the reward stops at the balance upsert, this
--     file changes nothing about that path. This is the expected state.
--   * 20261001 NOT yet applied  -> this file makes the balance move WITHOUT a
--     ledger row: credits granted, nothing recorded. Do not apply this file
--     first. Confirm 20261001 is live (pre-check step 0) or apply it in the same
--     session, before this one.
--
-- This is the one irreversible *data* consequence in the change, so it is
-- ENFORCED in the transaction (SA RC-1), not left to a human reading this
-- comment: the guard below aborts if `authenticated` still holds UPDATE on
-- `public.user_subscriptions`, which is the precise privilege that lets the
-- balance upsert land. Prod is already past that point; a fresh environment
-- (the Preview project in docs/ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md) is not.
-- This file only READS `user_subscriptions` — it never drops a policy on it or
-- revokes anything from it.
--
-- ---------------------------------------------------------------------------
-- PRE-CHECK (run FIRST; read-only; SAVE THE OUTPUT — see ROLLBACK):
--
--   -- 0. is the user_subscriptions lock-down already applied? (see ORDERING)
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'user_subscriptions' ORDER BY policyname;
--   -- expect NO "Users can update ..." policy left.
--
--   -- 1. RLS state of the twelve tables
--   SELECT c.relname, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname IN (
--     'credit_transactions','payment_automation_executions','payment_automation_rules',
--     'payment_events','payment_invoices','payment_methods','payment_plan_installments',
--     'payment_plans','payment_processors','payment_reminders','payment_transactions',
--     'saved_payment_methods')
--   ORDER BY c.relname;
--
--   -- 2. EVERY policy on those tables, not only the write-capable ones. This is
--   --    the true before-state and the ONLY backup of the policies this file
--   --    drops (SA RC-2: the Supabase SQL editor does not surface a script's
--   --    RAISE NOTICE output, so the apply transcript is NOT a second copy).
--   --    Exporting it and pasting it into the workplan is a hard gate — the
--   --    apply must not start until it is saved.
--   --    Two decisions come out of this output BEFORE applying (SA RC-3):
--   --      * does every one of the twelve tables have at least one PERMISSIVE
--   --        SELECT policy? If one does not, post-condition (a) will abort the
--   --        migration — stop and send the output to the Dev rather than
--   --        discovering it mid-apply. `payment_methods` is the likeliest
--   --        candidate (no reader and no writer anywhere in the repo).
--   --      * is any write-capable policy present that is not in the WHY table?
--   SELECT tablename, policyname, permissive, cmd, roles, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename IN (
--     'credit_transactions','payment_automation_executions','payment_automation_rules',
--     'payment_events','payment_invoices','payment_methods','payment_plan_installments',
--     'payment_plans','payment_processors','payment_reminders','payment_transactions',
--     'saved_payment_methods')
--   ORDER BY tablename, cmd, policyname;
--
--   -- 3. grants
--   SELECT table_name, grantee, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')
--     AND table_name IN (
--     'credit_transactions','payment_automation_executions','payment_automation_rules',
--     'payment_events','payment_invoices','payment_methods','payment_plan_installments',
--     'payment_plans','payment_processors','payment_reminders','payment_transactions',
--     'saved_payment_methods')
--   ORDER BY table_name, grantee, privilege_type;
--
--   -- 4. the SECURITY DEFINER overdue helper (QA-2)
--   SELECT has_function_privilege('anon',          'public.update_overdue_installments()', 'EXECUTE') AS anon_exec,
--          has_function_privilege('authenticated', 'public.update_overdue_installments()', 'EXECUTE') AS auth_exec;
--   -- Prod on 2026-09-21: both true. Both must be false after applying.
--   -- If the function does not exist in this environment the query ERRORS with
--   -- `undefined_function`; that is fine — the migration skips step 4 in that case.
--
-- Expect `rls_enabled = true` and `rls_forced = false` on all twelve. With FORCE
-- RLS the table owner is subject to RLS too, which is a different world — STOP
-- and escalate rather than applying. STOP and send the output to the Dev if
-- query 2 shows a write-capable policy (cmd ALL / INSERT / UPDATE / DELETE with
-- `roles` including public / anon / authenticated) that is NOT in the WHY table
-- above and does not mention `service_role`: this file converts eight policies
-- by exact name and sweeps the rest by shape, and an unexpected one means the
-- live schema has drifted since 2026-09-21.
--
-- POST-CHECK (read-only): re-run queries 1-3. Expect
--   * `rls_enabled = true` still on all twelve;
--   * the eight ALL policies replaced by "<same name> (read-only)", cmd SELECT,
--     same `qual`, still PERMISSIVE;
--   * no PERMISSIVE policy left with cmd ALL/INSERT/UPDATE/DELETE and roles
--     public/anon/authenticated, except the service-role ones on
--     `credit_transactions`;
--   * every table still showing at least one PERMISSIVE SELECT policy;
--   * `anon` and `authenticated` holding `SELECT` and nothing else;
--   * query 4 returning false / false (QA-2).
-- Then the browser check in the apply guide (an UPDATE from a signed-in session
-- must fail 42501). One gap the grant queries above cannot see: a COLUMN-level
-- write grant. `has_table_privilege(..., 'INSERT')` returns false for one and
-- `REVOKE ... ON <table>` does not remove one. Unlikely on Supabase defaults;
-- to close it, add:
--   SELECT table_name, grantee, column_name, privilege_type
--   FROM information_schema.column_privileges
--   WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')
--     AND privilege_type <> 'SELECT'
--     AND table_name LIKE ANY (ARRAY['payment%','credit_transactions','saved_payment_methods']);
-- Expect zero rows.
--
-- ROLLBACK
--
-- Half of this file is self-inverting and half is not, so READ BOTH PARTS.
--
--   (a) The eight converted policies. The original USING expression is preserved
--       verbatim in the "(read-only)" twin, so this block restores the read half
--       exactly, roles included — the twin preserves `roles` as well as `qual`,
--       so the block below reads both back rather than assuming `TO public`
--       (QA-5). WITH CHECK is NOT preserved (SA RC-5): a `FOR SELECT` policy
--       cannot carry one, so if any original had a `with_check` distinct from its
--       `qual`, this block restores a *different* policy than was live. The
--       original `with_check` is in the PRE-CHECK query-2 export — read it from
--       there and add `WITH CHECK (...)` to the CREATE below when it differs.
--
--   BEGIN;
--   DO $rb$
--   DECLARE r record; orig text; orig_roles name[]; rolelist text;
--   BEGIN
--     FOR r IN SELECT * FROM (VALUES
--       ('payment_automation_executions','Users can view their own automation executions'),
--       ('payment_automation_rules','Users can manage their own automation rules'),
--       ('payment_events','Users can view their own payment events'),
--       ('payment_plan_installments','Users can manage their own installments'),
--       ('payment_plans','Users can manage their own payment plans'),
--       ('payment_processors','Users can manage their own payment processors'),
--       ('payment_reminders','Users can manage their own payment reminders'),
--       ('saved_payment_methods','Users can manage their contacts saved payment methods')
--     ) AS t(tbl, pol) LOOP
--       SELECT p.qual, p.roles INTO orig, orig_roles FROM pg_policies p
--        WHERE p.schemaname='public' AND p.tablename=r.tbl AND p.policyname = r.pol || ' (read-only)';
--       IF orig IS NULL THEN RAISE EXCEPTION 'no read-only twin for % on %', r.pol, r.tbl; END IF;
--       SELECT string_agg(quote_ident(x), ', ') INTO rolelist FROM unnest(orig_roles) AS x;
--       EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO %s USING (%s)', r.pol, r.tbl, rolelist, orig);
--       EXECUTE format('DROP POLICY %I ON public.%I', r.pol || ' (read-only)', r.tbl);
--     END LOOP;
--   END $rb$;
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON
--     public.credit_transactions, public.payment_automation_executions,
--     public.payment_automation_rules, public.payment_events, public.payment_invoices,
--     public.payment_methods, public.payment_plan_installments, public.payment_plans,
--     public.payment_processors, public.payment_reminders, public.payment_transactions,
--     public.saved_payment_methods TO anon, authenticated;
--   COMMIT;
--
--   TRIM THAT GRANT to what pre-check query 3 actually showed (QA-5): as written
--   it hands all six privileges to both roles on all twelve tables, which is a
--   superset of the live 2026-09-21 state if any table held fewer.
--
--   (a2) The function revoke, if it has to go back (it re-opens a platform-wide
--       write path — do not, unless something legitimately calls it as a
--       non-service role):
--
--   GRANT EXECUTE ON FUNCTION public.update_overdue_installments() TO PUBLIC;
--
--   (b) The dropped INSERT/UPDATE/DELETE policies on `credit_transactions`,
--       `payment_invoices`, `payment_methods` and `payment_transactions` are NOT
--       recoverable from anything this file leaves behind. Their names, quals and
--       with_checks exist only in the PRE-CHECK query 2 output — that export IS
--       the backup, and the only one (SA RC-2: the SQL editor does not show a
--       script's RAISE NOTICE output, so do not count on the transcript).
--       Recreate them from the export by hand.
--
-- Rolling back re-opens the hole. Prefer fixing forward.
-- ---------------------------------------------------------------------------

BEGIN;

-- DROP/CREATE POLICY takes ACCESS EXCLUSIVE on tables the payments UI reads and
-- the Stripe webhook writes. Fail fast rather than queue every query behind our
-- lock request: on a lock timeout nothing is changed and the file can be re-run.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Fail closed if RLS is not actually on, or is FORCEd: with RLS disabled this
-- file would look like a fix while the table stayed wide open, and with FORCE
-- RLS the owner-side writers would be subject to the policies we are removing.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'credit_transactions','payment_automation_executions','payment_automation_rules',
    'payment_events','payment_invoices','payment_methods','payment_plan_installments',
    'payment_plans','payment_processors','payment_reminders','payment_transactions',
    'saved_payment_methods'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relname = t) THEN
      RAISE EXCEPTION 'table public.% does not exist - stop and escalate', t;
    END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = t) THEN
      RAISE EXCEPTION 'RLS is disabled on public.% - stop and escalate, this migration would not protect the table', t;
    END IF;
    IF (SELECT c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = t) THEN
      RAISE EXCEPTION 'FORCE RLS is on for public.% - stop and escalate, owner-side writers would be affected', t;
    END IF;
  END LOOP;

  -- SA RC-1: enforce the ORDERING note above instead of trusting a human to read
  -- it. While `authenticated` can still UPDATE `user_subscriptions`, the browser
  -- share-reward upserts the balance successfully and then fails the ledger
  -- insert this file is about to close - crediting money with no ledger row, the
  -- only irreversible data consequence in this change. Apply 20261001 first.
  -- INSERT as well as UPDATE (QA-4): the reward path is an UPSERT, so for a user
  -- with no row yet an INSERT grant alone is enough to create a credited balance.
  IF has_table_privilege('authenticated', 'public.user_subscriptions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.user_subscriptions', 'INSERT') THEN
    RAISE EXCEPTION
      'authenticated still holds UPDATE or INSERT on public.user_subscriptions - apply 20261001_user_subscriptions_write_lockdown.sql FIRST, or the browser share-reward would credit a balance with no credit_transactions ledger row';
  END IF;
END $$;

-- 1. The eight `FOR ALL` policies: convert to SELECT, keeping the USING
-- expression and roles verbatim. Two of them are named "Users can view ...",
-- and on these tables the ALL policy may be the only policy there is — dropping
-- it outright would take owner reads with it.
DO $$
DECLARE
  r record;
  -- Typed locals rather than an untyped `record`, so `unnest(pol_roles)` needs
  -- no plan-time field-type resolution (SA optimisation).
  pol_permissive text;
  pol_cmd text;
  pol_roles name[];
  pol_qual text;
  pol_with_check text;
  newname text;
  rolelist text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('payment_automation_executions', 'Users can view their own automation executions'),
    ('payment_automation_rules',      'Users can manage their own automation rules'),
    ('payment_events',                'Users can view their own payment events'),
    ('payment_plan_installments',     'Users can manage their own installments'),
    ('payment_plans',                 'Users can manage their own payment plans'),
    ('payment_processors',            'Users can manage their own payment processors'),
    ('payment_reminders',             'Users can manage their own payment reminders'),
    ('saved_payment_methods',         'Users can manage their contacts saved payment methods')
  ) AS t(tbl, pol_name)
  LOOP
    newname := r.pol_name || ' (read-only)';

    SELECT p.permissive, p.cmd, p.roles, p.qual, p.with_check
      INTO pol_permissive, pol_cmd, pol_roles, pol_qual, pol_with_check
    FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = r.tbl AND p.policyname = r.pol_name;

    IF NOT FOUND THEN
      -- Re-run of an already-applied file: the twin must be there. If neither
      -- exists the schema has drifted and we must not guess.
      IF EXISTS (SELECT 1 FROM pg_policies p
                  WHERE p.schemaname = 'public' AND p.tablename = r.tbl AND p.policyname = newname) THEN
        RAISE NOTICE 'already converted: "%" on public.%', r.pol_name, r.tbl;
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'policy "%" not found on public.% and no "%" twin exists - live schema has drifted, re-run the pre-check',
        r.pol_name, r.tbl, newname;
    END IF;

    IF pol_cmd <> 'ALL' THEN
      RAISE EXCEPTION 'policy "%" on public.% is cmd %, expected ALL - live schema has drifted', r.pol_name, r.tbl, pol_cmd;
    END IF;
    IF pol_permissive <> 'PERMISSIVE' THEN
      RAISE EXCEPTION 'policy "%" on public.% is %, expected PERMISSIVE - live schema has drifted', r.pol_name, r.tbl, pol_permissive;
    END IF;
    IF pol_qual IS NULL THEN
      RAISE EXCEPTION 'policy "%" on public.% has no USING expression - cannot rebuild its read half safely', r.pol_name, r.tbl;
    END IF;

    SELECT string_agg(quote_ident(x), ', ') INTO rolelist FROM unnest(pol_roles) AS x;

    -- Create the read half first, then drop the writable original. `%I` quotes
    -- every identifier; `qual` goes in raw via `%s` because it is pg_get_expr
    -- output from pg_catalog, which only a table owner can have written - the
    -- trust boundary sits above the caller. `with_check` is dropped on purpose:
    -- a FOR SELECT policy cannot carry one. It is logged below and lives in the
    -- pre-check export, which is what rollback needs (SA RC-5).
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO %s USING (%s)',
                   newname, r.tbl, rolelist, pol_qual);
    EXECUTE format('DROP POLICY %I ON public.%I', r.pol_name, r.tbl);
    RAISE NOTICE 'converted "%" on public.% to SELECT-only as "%" (USING %) (original WITH CHECK: %)',
      r.pol_name, r.tbl, newname, pol_qual, coalesce(pol_with_check, '<none>');
  END LOOP;
END $$;

-- 2. The write-only policies (cmd INSERT / UPDATE / DELETE). Swept by shape
-- rather than by name because the live names of the payment_invoices /
-- payment_methods / payment_transactions triplets were reported collapsed, and a
-- `DROP POLICY IF EXISTS` on a guessed name would silently do nothing. Only
-- PERMISSIVE write-only policies whose roles include public/anon/authenticated
-- are touched; anything mentioning `service_role`, any SELECT policy and any
-- cmd = ALL policy (the service-role ones) are left alone. Re-running drops 0.
--
-- Two limits of the `service_role` exclusion, so nobody mistakes post-condition
-- (b) for an independent check (SA):
--   * (b) applies the SAME exclusion, so a policy like
--     `USING (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'service_role')`
--     with roles {public} survives both. The GRANT revoke in step 3 is the real
--     control in that case - which is exactly why this file does both.
--   * an UNNAMED `cmd = ALL` user policy is skipped here (this step only sweeps
--     INSERT/UPDATE/DELETE) but post-condition (b) includes 'ALL' and aborts on
--     it. That asymmetry is deliberate - do not "simplify" it away.
DO $$
DECLARE r record; dropped int := 0;
BEGIN
  FOR r IN
    SELECT p.tablename, p.policyname, p.cmd
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename IN (
        'credit_transactions','payment_automation_executions','payment_automation_rules',
        'payment_events','payment_invoices','payment_methods','payment_plan_installments',
        'payment_plans','payment_processors','payment_reminders','payment_transactions',
        'saved_payment_methods')
      AND p.permissive = 'PERMISSIVE'
      AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE')
      AND p.roles && ARRAY['public','anon','authenticated']::name[]
      AND coalesce(p.qual, '') NOT LIKE '%service_role%'
      AND coalesce(p.with_check, '') NOT LIKE '%service_role%'
    ORDER BY p.tablename, p.policyname
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    RAISE NOTICE 'dropped write policy "%" (%) on public.%', r.policyname, r.cmd, r.tablename;
    dropped := dropped + 1;
  END LOOP;
  RAISE NOTICE 'write-only policies dropped: %', dropped;
END $$;

-- 3. The grants that made those policies reachable from the browser. SELECT is
-- kept on purpose. REVOKE of a privilege that is not held is a no-op.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON
  public.credit_transactions,
  public.payment_automation_executions,
  public.payment_automation_rules,
  public.payment_events,
  public.payment_invoices,
  public.payment_methods,
  public.payment_plan_installments,
  public.payment_plans,
  public.payment_processors,
  public.payment_reminders,
  public.payment_transactions,
  public.saved_payment_methods
  FROM anon, authenticated;

-- 4. The one write path a table lock-down cannot close (QA-2).
-- `update_overdue_installments()` is SECURITY DEFINER, so it runs as its owner
-- and ignores both RLS and the grants revoked above; it kept the default
-- `EXECUTE TO PUBLIC`, so it is callable from the browser at
-- /rest/v1/rpc/update_overdue_installments; and its UPDATE has no `user_id`
-- predicate. `FROM PUBLIC` is the load-bearing part — the grant is the default
-- PUBLIC one, so naming only the two roles would be a no-op. Wrapped in a
-- guard because REVOKE on a function that does not exist is an error, and this
-- file must stay applicable to an environment that never ran 20260723.
DO $$
BEGIN
  IF to_regprocedure('public.update_overdue_installments()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.update_overdue_installments() FROM PUBLIC, anon, authenticated;
    RAISE NOTICE 'revoked EXECUTE on public.update_overdue_installments() from PUBLIC, anon, authenticated';
  ELSE
    RAISE NOTICE 'public.update_overdue_installments() does not exist here - nothing to revoke';
  END IF;
END $$;

-- 5. Post-conditions, inside the same transaction: if any fails the whole
-- migration rolls back and nothing changed.
DO $$
DECLARE
  t text;
  role_name text;
  priv text;
  leftover text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'credit_transactions','payment_automation_executions','payment_automation_rules',
    'payment_events','payment_invoices','payment_methods','payment_plan_installments',
    'payment_plans','payment_processors','payment_reminders','payment_transactions',
    'saved_payment_methods'
  ] LOOP
    -- (a) reads must survive. PERMISSIVE matters: a RESTRICTIVE-only SELECT
    -- policy would satisfy a naive "a SELECT policy exists" check and still let
    -- no row through.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
        AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
    ) THEN
      RAISE EXCEPTION 'no PERMISSIVE SELECT policy left on public.% - owners would lose read access', t;
    END IF;

    IF NOT has_table_privilege('authenticated', 'public.' || quote_ident(t), 'SELECT') THEN
      RAISE EXCEPTION 'authenticated lost SELECT on public.% - the payments UI would break', t;
    END IF;

    -- (b) no write-capable user policy may remain.
    SELECT string_agg(policyname || ' (' || cmd || ')', ', ') INTO leftover
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = t
      AND permissive = 'PERMISSIVE'
      AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      AND roles && ARRAY['public','anon','authenticated']::name[]
      AND coalesce(qual, '') NOT LIKE '%service_role%'
      AND coalesce(with_check, '') NOT LIKE '%service_role%';
    IF leftover IS NOT NULL THEN
      RAISE EXCEPTION 'write-capable user policies still present on public.%: %', t, leftover;
    END IF;

    -- (c) no write privilege may remain. has_table_privilege also counts
    -- privileges inherited from a grant to PUBLIC, which REVOKE ... FROM anon,
    -- authenticated would not remove. If this fires, re-run the REVOKE above
    -- with `FROM PUBLIC` as well.
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF has_table_privilege(role_name, 'public.' || quote_ident(t), priv) THEN
          RAISE EXCEPTION '% still holds % on public.%', role_name, priv, t;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- (d) QA-2: neither role may retain EXECUTE on the definer helper.
  -- has_function_privilege also counts a privilege inherited from PUBLIC, which
  -- is exactly how this one was held.
  IF to_regprocedure('public.update_overdue_installments()') IS NOT NULL THEN
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(role_name, 'public.update_overdue_installments()', 'EXECUTE') THEN
        RAISE EXCEPTION '% still holds EXECUTE on public.update_overdue_installments() - the platform-wide overdue flip is still callable', role_name;
      END IF;
    END LOOP;
  END IF;
END $$;

COMMIT;
