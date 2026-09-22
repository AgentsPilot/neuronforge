-- Business OS LLM Layer 2, workplan Step 0 (task T0.6): close client write access
-- to `ai_model_pricing` and `system_settings_config`.
--
-- Date: 2026-09-20
-- Workplan: docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_WORKPLAN.md §4.4
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- Step 0 put an `admin_users`-backed gate on the admin API routes that write
-- these two tables. That closes the HTTP door only. The live read the operator
-- ran on 2026-09-20 (§4.4, queries R-1/R-2/R-3) found the database door open:
--
--   * `ai_model_pricing` — **RLS is DISABLED**, and both `anon` and
--     `authenticated` hold SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
--     TRIGGER. Anyone with the public anon key (it ships in the browser bundle)
--     can rewrite or TRUNCATE the table that every credit charge is computed
--     from, without signing in.
--
--   * `system_settings_config` — RLS is enabled and SELECT is open to
--     public + authenticated (kept: the rows are labels and model names, and
--     `lib/design-system-v2/theme-provider.tsx:61-65` reads `v2_custom_tokens`
--     in the browser with the anon key, and `OrchestrationService` /
--     `MemoryCompressor` default to the same anon client for their config
--     reads). Its two write policies are both broken:
--       - "Only admins can modify settings" trusts `profiles.role = 'admin'`.
--         `profiles` is user-writable — its UPDATE policy is
--         `USING (auth.uid() = id)` with no WITH CHECK and no column
--         restriction — so any signed-in user can set their own role to
--         'admin' and then write any system setting. This is the exact trap
--         docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md exists to prevent.
--       - "Only admins can modify system settings config" trusts
--         `auth.users.role = 'admin'`. That column is the Postgres/GoTrue role
--         and is always 'authenticated', so the policy is inert — it grants
--         nothing and protects nothing.
--
-- After Layer 2 these tables hold `bos_llm_area_*` — the rows that decide which
-- model runs, and whether an AI feature is on at all — so the database lock has
-- to land before the seed.
--
-- WHAT THIS DOES
--   1. `public.is_platform_admin()` — one SECURITY DEFINER predicate reading the
--      `admin_users` allow-list (never `profiles.role`).
--   2. `ai_model_pricing`: ENABLE RLS; admin-only SELECT and write policies.
--   3. Both tables: REVOKE INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER from
--      `PUBLIC`, `anon` and `authenticated`.
--   4. `system_settings_config`: drop the two broken write policies, replace
--      with one `admin_users`-backed write policy. SELECT is left exactly as it
--      is.
--
-- WHAT THIS DOES NOT TOUCH
--   * The service role. `service_role` has BYPASSRLS, and the REVOKEs name only
--     `anon` and `authenticated`, so every server path is unaffected:
--     `lib/ai/pricing.ts`, the three `/api/admin/system-config*` routes,
--     `systemConfigRepository` (supabaseServer), and every other
--     `system_settings_config` consumer — all verified service-role on
--     2026-09-20 by grep. **No app code writes either table with the browser
--     (anon/authenticated) client**: the only browser touch of either table is
--     the theme-provider SELECT above, and the browser `CurrencyService` paths
--     reach `exchange_rates`, not `system_settings_config`
--     (`SystemConfigService.set` is called only from `updateRatesFromAPI`,
--     which has no browser caller). The three anon-client consumers found
--     (theme provider, OrchestrationService, MemoryCompressor) are SELECT-only.
--   * `system_settings_config` SELECT. Reads stay open on purpose.
--   * The `profiles` self-promotion policy itself. That is a platform-wide
--     issue with its own blast radius and is recorded as a Step 0 follow-up
--     (workplan §4.9), not widened into this migration.
--
-- WHY NOT `FORCE ROW LEVEL SECURITY`
--   FORCE makes policies apply to the table OWNER as well. It buys nothing here
--   — `service_role` bypasses RLS by role attribute, not by ownership, so our
--   paths are identical with or without it — while it would make the Supabase
--   dashboard's table editor and owner-connection psql sessions appear empty.
--   The opt-in statements are left commented at the bottom if the operator
--   later wants owner-level enforcement too.
--
-- PRE-APPLY CHECK (SA R-3/R-4 — do this in the same session, before applying):
--   Re-run the R-2 policy query from workplan §4.4 and confirm `system_settings_config`
--   still has at least one policy with `cmd = 'SELECT'` whose name is NEITHER
--   "Only admins can modify settings" NOR "Only admins can modify system settings
--   config". Those two are dropped below; if the table's read openness came from
--   them, dropping them would silently kill the browser theme provider's
--   `v2_custom_tokens` read and the anon-client config reads.
--   The 2026-09-20 read already satisfies this — two standalone SELECT policies,
--   "Allow authenticated users to read settings" and "Anyone can read system
--   settings config", both `qual: true` — and the rows are pasted verbatim in
--   workplan §4.4. Re-confirm anyway, because the drop is irreversible in place.
--   While there, paste the R-3 grant rows for BOTH tables into §4.4 (the first
--   read recorded them for ai_model_pricing only) — the ROLLBACK block below
--   cannot restore `system_settings_config` without them.
--
--   Runnable as-is (QA D-Q6) — both queries, read-only:
--
--     SELECT tablename, policyname, cmd, roles, qual, with_check
--     FROM pg_policies
--     WHERE schemaname = 'public'
--       AND tablename IN ('system_settings_config', 'ai_model_pricing')
--     ORDER BY tablename, policyname;
--
--     SELECT table_name, grantee, privilege_type
--     FROM information_schema.role_table_grants
--     WHERE table_schema = 'public'
--       AND table_name IN ('system_settings_config', 'ai_model_pricing')
--       AND grantee IN ('anon', 'authenticated', 'PUBLIC')
--     ORDER BY table_name, grantee, privilege_type;
--
-- APPLY MANUALLY in the Supabase SQL editor (README option 2), AFTER the Step 0
-- routes are deployed. Re-runnable: every statement is idempotent.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The admin predicate.
--
-- SECURITY DEFINER is required: `admin_users` is itself RLS-locked to the
-- service role (20260701_create_admin_users.sql), so a policy evaluated in an
-- `authenticated` session cannot read it directly.
--
-- `search_path` is pinned with `pg_catalog` FIRST: inside a definer-rights
-- function a `public.lower(text)` would otherwise shadow the built-in this body
-- calls. Not exploitable on this database (Postgres 15 no longer grants CREATE on
-- `public` to PUBLIC, and Supabase does not grant it to anon/authenticated), but
-- this is the most privileged object the migration creates, so it is pinned
-- anyway (SA R-1).
--
-- It mirrors AdminAccessService.isAdmin steps 1 and 2 — bound `user_id`, or an
-- active row whose email matches the caller's JWT email (lowercased, as stored).
-- It deliberately does NOT mirror step 3, the ADMIN_EMAILS env fallback: the
-- database has no access to the env allow-list, and an admin who exists only
-- there is seeded into `admin_users` on their first API call anyway.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users au
    WHERE au.is_active = true
      AND (
        au.user_id = auth.uid()
        -- Both sides lower-cased, as AdminAccessService does in JS: the stored
        -- value is normalised on write, but a hand-inserted mixed-case row would
        -- otherwise never match this policy (QA D-Q7).
        OR lower(au.email) = lower(nullif(auth.jwt() ->> 'email', ''))
      )
  );
$$;

COMMENT ON FUNCTION public.is_platform_admin() IS
  'True when the current session belongs to an active row in admin_users (the authoritative admin allow-list). SECURITY DEFINER because admin_users is service-role only. NEVER use profiles.role for admin authz — it is user-writable.';

-- An anonymous session can never be an admin, and the function leaks nothing
-- about other users, but keep EXECUTE to the roles that can actually use it.
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. ai_model_pricing — turn RLS on and give it admin-only policies.
--
-- Reads today are service-role only (`lib/ai/pricing.ts`, the admin pricing
-- route, `agent-generation-config`, two scripts — all verified 2026-09-20), so
-- the table stays closed to ordinary clients. The admin SELECT policy exists so
-- that an admin screen reading it directly with the user's session keeps
-- working, instead of silently returning zero rows.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ai_model_pricing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_model_pricing_admin_select" ON public.ai_model_pricing;
CREATE POLICY "ai_model_pricing_admin_select" ON public.ai_model_pricing
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- FOR ALL covers INSERT/UPDATE/DELETE. Its SELECT overlap carries the same
-- admin predicate as the policy above, so it widens nothing.
DROP POLICY IF EXISTS "ai_model_pricing_admin_write" ON public.ai_model_pricing;
CREATE POLICY "ai_model_pricing_admin_write" ON public.ai_model_pricing
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

COMMENT ON TABLE public.ai_model_pricing IS
  'Per-token model pricing; every credit charge is computed from it. Written only by the service role through /api/admin/system-config/pricing (admin-gated). RLS: admin_users-backed read + write for authenticated sessions; anon has no privileges beyond SELECT, which RLS then denies.';

-- ---------------------------------------------------------------------------
-- 3. Take the client roles' write privileges away on BOTH tables.
--
-- Grants are checked BEFORE RLS, so this is the primary lock; the policies above
-- are the second one, and they are what governs if a privilege is ever regranted
-- (for example by a generated "grant all on new tables" migration).
--
-- `PUBLIC` is named alongside the two roles (SA R-2): a privilege held via PUBLIC
-- rather than via `anon`/`authenticated` would survive a revoke that names only
-- those roles, and grants are checked before RLS. The verification block at the
-- end queries PUBLIC, so the migration must also be able to clear it. Harmless
-- no-op where nothing is granted that way.
--
-- SELECT is deliberately NOT revoked: `system_settings_config` is read in the
-- browser by the theme provider, and on `ai_model_pricing` the SELECT grant is
-- what lets the admin SELECT policy above be reachable at all.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.ai_model_pricing
  FROM PUBLIC, anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.system_settings_config
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. system_settings_config — drop the two broken write policies, add one that
--    is actually backed by admin_users. SELECT policies are untouched.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Only admins can modify settings" ON public.system_settings_config;
DROP POLICY IF EXISTS "Only admins can modify system settings config" ON public.system_settings_config;

DROP POLICY IF EXISTS "system_settings_config_admin_write" ON public.system_settings_config;
CREATE POLICY "system_settings_config_admin_write" ON public.system_settings_config
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

COMMENT ON TABLE public.system_settings_config IS
  'Platform settings (labels, model names, feature switches, and from Layer 2 the bos_llm_area_* rows). Reads are intentionally open — the browser theme provider reads v2_custom_tokens. Writes are service-role only in practice; the RLS write policy is admin_users-backed. Do NOT reintroduce a profiles.role-based policy: profiles.role is user-writable.';

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFICATION (read-only; run after applying)
--
-- Expect: ai_model_pricing rowsecurity = true; four policies (two per table,
-- plus whatever SELECT policy system_settings_config already had); neither of
-- the two dropped policy names present; and NO INSERT/UPDATE/DELETE/TRUNCATE/
-- REFERENCES/TRIGGER row for anon or authenticated.
--
--   SELECT c.relname, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public'
--     AND c.relname IN ('system_settings_config', 'ai_model_pricing');
--
--   SELECT tablename, policyname, cmd, roles, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('system_settings_config', 'ai_model_pricing')
--   ORDER BY tablename, policyname;
--
--   SELECT table_name, grantee, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public'
--     AND table_name IN ('system_settings_config', 'ai_model_pricing')
--     AND grantee IN ('anon', 'authenticated', 'PUBLIC')
--   ORDER BY table_name, grantee, privilege_type;
--
-- Then, in the app: /admin/system-config still loads, a price edit and a sync
-- still work (service role), and the V2 theme still picks up v2_custom_tokens.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- OPTIONAL (not applied): owner-level enforcement. Only turn these on if you
-- accept that the Supabase table editor and owner psql sessions stop seeing
-- rows. `service_role` is unaffected either way.
--
--   ALTER TABLE public.ai_model_pricing FORCE ROW LEVEL SECURITY;
--   ALTER TABLE public.system_settings_config FORCE ROW LEVEL SECURITY;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK (restores the pre-2026-09-20 state described in workplan §4.4).
-- The two recreated policies follow the raw `pg_policies` rows now pasted in
-- §4.4 — same roles, same commands, same predicates, including that the second
-- one was `{public}` with no WITH CHECK. Both are insecure by design; this block
-- exists only to undo the change, never as a target state.
--
--   BEGIN;
--
--   DROP POLICY IF EXISTS "system_settings_config_admin_write" ON public.system_settings_config;
--   DROP POLICY IF EXISTS "ai_model_pricing_admin_write" ON public.ai_model_pricing;
--   DROP POLICY IF EXISTS "ai_model_pricing_admin_select" ON public.ai_model_pricing;
--
--   ALTER TABLE public.ai_model_pricing DISABLE ROW LEVEL SECURITY;
--
--   -- Re-grant ONLY what the live read recorded, per table (QA D-Q4). A rollback
--   -- that grants more than existed would leave a table more open than it
--   -- started — on the very table that will hold the bos_llm_area_* rows.
--   --
--   -- ai_model_pricing: §4.4 R-3 recorded this exact write set for both roles.
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--     ON public.ai_model_pricing TO anon, authenticated;
--   --
--   -- system_settings_config: NO GRANT HERE ON PURPOSE. §4.4 R-3 recorded grants
--   -- for ai_model_pricing only, so what anon/authenticated held on this table is
--   -- not known. Paste the grants captured by the PRE-APPLY CHECK above and
--   -- re-grant exactly those, nothing more. If that read came back empty, there is
--   -- nothing to restore and this table is already back to its prior state (the
--   -- REVOKE would have been a no-op).
--   --
--   -- A PUBLIC grant is not re-granted on either table: none was recorded, and
--   -- PUBLIC write on these tables would be strictly worse than the start state
--   -- (SA R-2/R-4).
--
--   CREATE POLICY "Only admins can modify settings" ON public.system_settings_config
--     FOR ALL
--     TO authenticated
--     USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
--     WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
--
--   CREATE POLICY "Only admins can modify system settings config" ON public.system_settings_config
--     FOR ALL
--     USING (EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid() AND u.role::text = 'admin'));
--
--   -- The two SELECT policies are NOT recreated here: this migration never drops
--   -- them ("Allow authenticated users to read settings", "Anyone can read system
--   -- settings config" both survive untouched), so there is nothing to restore.
--
--   DROP FUNCTION IF EXISTS public.is_platform_admin();
--
--   COMMIT;
-- ---------------------------------------------------------------------------
