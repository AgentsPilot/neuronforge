-- P0-FT-RLS: no browser-side writes to public.user_subscriptions.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- C3 of the S-6 investigation (run by the user on 2026-09-20, results in
-- ALLOCATE_FREE_TIER_S6_FIX_WORKPLAN.md §7.1) found that RLS is enabled on
-- `user_subscriptions`, but two of its policies grant writes to PUBLIC:
--
--   "Users can update their own credits"  cmd ALL,    USING (auth.uid() = user_id), no WITH CHECK
--   "Users can update own subscription"   cmd UPDATE, USING (auth.uid() = user_id), no WITH CHECK
--
-- and both `anon` and `authenticated` hold INSERT / UPDATE / DELETE (plus
-- TRUNCATE / REFERENCES / TRIGGER) on the table. `FOR ALL` covers INSERT,
-- UPDATE and DELETE, and with no WITH CHECK Postgres re-uses USING as the write
-- check, so the row stays writable as long as it keeps the caller's own
-- `user_id`. Any signed-in user can therefore run, from the browser console
-- with the public anon key:
--
--   supabase.from('user_subscriptions')
--     .update({ balance: 999999999, account_frozen: false, storage_quota_mb: 9999999 })
--     .eq('user_id', myId)
--
-- and give themselves unlimited paid capacity, unfreeze a frozen account, or
-- DELETE the row. It leaves no API log and no audit entry. It also makes every
-- server-side balance guarantee advisory: the free-tier grant's `balance =
-- expected` compare-and-set, the expiry cron's freeze and QuotaAllocationService
-- all assume only the service role writes this table.
--
-- WHAT THIS CHANGES
--
--   1. Drops the two write policies, by name.
--   2. Revokes every write privilege on the table from `anon` and
--      `authenticated`.
--
-- Two independent controls are removed on purpose: without the grant the policy
-- is unreachable, and without the policy the grant is unusable. Either one alone
-- would close the hole today, but a future dashboard edit that restores one of
-- them would re-open it.
--
-- WHAT THIS DOES NOT TOUCH
--
--   * SELECT. The three owner read policies ("Users can view own credits",
--     "Users can view own subscription", "Users can view their own credits") and
--     the SELECT grants stay exactly as they are, so every billing screen,
--     the footer token display and the dashboard keep reading. The three are
--     duplicates of each other and should be consolidated one day, but that is
--     cosmetic: dropping and recreating a read policy on a P0 fix risks a read
--     outage for no security gain. It is filed as a separate clean-up.
--   * `anon`'s SELECT grant. It is inert — the owner policies require
--     `auth.uid() = user_id`, and `auth.uid()` is NULL for an unauthenticated
--     caller, so an anon SELECT already returns zero rows. Revoking it would
--     turn any read issued before the session hydrates from "no rows" into a
--     403, a needless regression on a P0. Also filed as the separate clean-up.
--   * "Service role can manage all credits" (ALL, USING auth.jwt() ->> 'role' =
--     'service_role'). The service role bypasses RLS anyway; every server write
--     path keeps working unchanged.
--   * Triggers. `trigger_update_user_subscriptions_updated_at` is the only
--     non-internal trigger (C3, 2026-09-20) and is unaffected. The two functions
--     that write this table from elsewhere — `update_user_storage_used()` (on
--     storage_usage) and `increment_executions_used()` — are both SECURITY
--     DEFINER, so they run as the owner and are unaffected by these grants.
--
-- CODE THAT MUST SHIP FIRST (blast radius, verified 2026-09-20)
--
-- Three paths wrote this table with a caller's own credentials and would break:
--
--   a. `app/api/run-agent/route.ts` — `new CreditService(supabase)` with the
--      user-cookie client; `chargeTokensWithIntensity` UPDATEs balance.
--      **Fixed in this branch**: the service role, scoped to the session user.
--   b. `app/api/stripe/update-subscription/route.ts` — UPDATE of
--      monthly_amount_usd / monthly_credits with the user-cookie client.
--      **Fixed in this branch**: the service role, same as its sibling routes.
--   b2. `app/api/stripe/create-checkout/route.ts` (W-4, found by SA) — the file
--      never names this table: it hands its user-cookie client to
--      StripeService.createCustomCreditSubscription / createBoostPackCheckout,
--      and both reach getOrCreateCustomer, which UPDATEs stripe_customer_id or
--      INSERTs the row. Neither result is checked. **Fixed in this branch**: the
--      service role. Without it a paying user with no row is never credited,
--      because the webhook's handleCheckoutCompleted only UPDATEs.
--   c. The agent-share reward: `app/v2/agents/[id]/page.tsx` and
--      `app/(protected)/agents/[id]/page.tsx` build `RewardService` with the
--      *browser* client, which upserts balance / total_earned.
--      **Deliberately NOT fixed** — that path is the vulnerability (any user can
--      award themselves credits by replaying the same upsert). After this
--      migration the share still succeeds and the reward is simply not credited,
--      until the server-side reward route lands. See the workplan section
--      "P0-FT-RLS" for the decision.
--
-- Apply this file only after (a) and (b) are deployed. The apply guide is in
-- docs/workplans/ALLOCATE_FREE_TIER_S6_FIX_WORKPLAN.md.
--
-- ---------------------------------------------------------------------------
-- PRE-CHECK (run first; read-only; same queries as investigation check C3):
--
--   SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
--   FROM pg_class c WHERE c.oid = 'public.user_subscriptions'::regclass;
--
--   SELECT policyname, permissive, cmd, roles, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'user_subscriptions'
--   ORDER BY policyname;
--
--   SELECT grantee, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND table_name = 'user_subscriptions'
--     AND grantee IN ('anon', 'authenticated')
--   ORDER BY grantee, privilege_type;
--
-- Expect `rls_enabled = true`, `rls_forced = false`, the six policies listed in
-- §7.1 (all `permissive = PERMISSIVE`), and the write grants for both roles.
-- `rls_forced = true` would be a different world: the table owner would then be
-- subject to RLS too, so the SECURITY DEFINER functions that write this table
-- (update_user_storage_used, increment_executions_used) would start writing zero
-- rows in silence once the write policies are gone. Escalate instead of applying. STOP and send the output to the Dev if a policy that is
-- NOT in that list can write (any `cmd` of ALL / INSERT / UPDATE / DELETE whose
-- `roles` include `public`, `authenticated` or `anon`), because this file only
-- drops the two it knows about.
--
-- POST-CHECK (read-only): the same three queries. Expect
--   * `rls_enabled = true` still;
--   * four policies left: the three "Users can view ..." SELECT policies (still
--     `permissive = PERMISSIVE`) and "Service role can manage all credits";
--   * `anon` and `authenticated` left with `SELECT` and nothing else.
-- Then the browser check in the apply guide (an UPDATE from a signed-in session
-- must fail).
--
-- ROLLBACK (restores exactly what was live on 2026-09-20):
--
--   BEGIN;
--   CREATE POLICY "Users can update their own credits" ON public.user_subscriptions
--     FOR ALL TO public USING (auth.uid() = user_id);
--   CREATE POLICY "Users can update own subscription" ON public.user_subscriptions
--     FOR UPDATE TO public USING (auth.uid() = user_id);
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--     ON public.user_subscriptions TO anon, authenticated;
--   COMMIT;
--
-- Rolling back re-opens the hole. Prefer reverting the *code* and leaving this
-- in place; roll back only if owner reads or a server write path are broken.
-- ---------------------------------------------------------------------------

BEGIN;

-- DROP POLICY takes ACCESS EXCLUSIVE on a table that every page load reads and
-- the Stripe webhook writes. Fail fast rather than queue every query behind our
-- lock request: on a lock timeout nothing is changed and the file can simply be
-- re-run (SA RC9-3).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Fail closed if RLS is not actually on: with RLS disabled, dropping policies
-- would look like a fix while the table stayed wide open.
DO $$
BEGIN
  IF NOT (
    SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_subscriptions'::regclass
  ) THEN
    RAISE EXCEPTION
      'RLS is disabled on public.user_subscriptions - stop and escalate, this migration would not protect the table';
  END IF;
END $$;

-- 1. The write policies. IF EXISTS keeps the file re-runnable; the names are the
-- ones read live on 2026-09-20.
DROP POLICY IF EXISTS "Users can update their own credits" ON public.user_subscriptions;
DROP POLICY IF EXISTS "Users can update own subscription" ON public.user_subscriptions;

-- 2. The grants that made those policies reachable from the browser. SELECT is
-- kept on purpose (see the header). REVOKE of a privilege that is not held is a
-- no-op, so this is safe to re-run.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.user_subscriptions FROM anon, authenticated;

-- 3. Post-conditions, inside the same transaction: if any of them fails the
-- whole migration rolls back and nothing changed.
DO $$
DECLARE
  leftover text;
  role_name text;
  priv text;
BEGIN
  SELECT string_agg(policyname, ', ') INTO leftover
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'user_subscriptions'
    AND policyname IN ('Users can update their own credits', 'Users can update own subscription');
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'write policies still present after DROP: %', leftover;
  END IF;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      -- has_table_privilege also counts privileges inherited from a grant to
      -- PUBLIC, which REVOKE ... FROM anon, authenticated would not remove. If
      -- this fires, re-run the REVOKE above with `FROM PUBLIC` as well.
      IF has_table_privilege(role_name, 'public.user_subscriptions', priv) THEN
        RAISE EXCEPTION '% still holds % on public.user_subscriptions', role_name, priv;
      END IF;
    END LOOP;
  END LOOP;

  -- PERMISSIVE matters: a RESTRICTIVE-only SELECT policy would satisfy a naive
  -- "a SELECT policy exists" check and still let no row through.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_subscriptions'
      AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
  ) THEN
    RAISE EXCEPTION 'no PERMISSIVE SELECT policy left on public.user_subscriptions - owners would lose read access';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.user_subscriptions', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated lost SELECT on public.user_subscriptions - billing screens would break';
  END IF;
END $$;

COMMIT;
