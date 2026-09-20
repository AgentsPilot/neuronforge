-- Close the `profiles.role` self-promotion hole.
--
-- Date: 2026-09-20
-- Workplan: docs/workplans/PROFILES_ROLE_SELF_PROMOTION_FIX_WORKPLAN.md
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- Measured on production 2026-09-20: the `profiles` UPDATE policy is
--
--     USING (auth.uid() = id)
--
-- with **no WITH CHECK and no column restriction**. Every signed-in user can
-- therefore rewrite any column of their own row, including `role`, straight
-- from the browser with the anon key that ships in the bundle:
--
--     await supabase.from('profiles').update({ role: 'admin' }).eq('id', me);
--
-- Nothing authorizes on `profiles.role` today — verified by grep on
-- 2026-09-20: the only readers are `lib/user-context/builders.ts:31` (LLM
-- personalization) and `app/api/admin/onboarding-users/route.ts:56` (display).
-- Admin identity is the `admin_users` allow-list via `AdminAccessService`
-- (docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md), and the one policy that did
-- trust `profiles.role` was dropped from `system_settings_config` by
-- 20260920a_lock_system_settings_and_pricing_rls.sql.
--
-- So this is not an exploitable escalation right now. It is a loaded gun: the
-- column *looks* like an authorization field, the settings UI *offered*
-- "Administrator" as a choice, and the next person to write
-- `WHERE role = 'admin'` would hand the platform to anyone with a console open.
-- That has already happened once, on system_settings_config. This makes the
-- column unable to say 'admin' again.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES *NOT* DO, AND WHY
--
-- The obvious guard — "a non-service-role caller may never change role at all,
-- force NEW.role := OLD.role" — **would break onboarding.** Two client paths
-- legitimately write this column with the anon key:
--
--   * components/onboarding/RoleStep.tsx:84-90        (UPDATE)
--   * components/onboarding/hooks/useOnboarding.ts:317-356 (UPSERT)
--
-- and they write *personas*, not privileges: business_owner, manager,
-- consultant, operations, sales, marketing, finance, other. A blanket freeze
-- would silently discard the user's answer on the onboarding step and, worse,
-- do it invisibly. `components/v2/settings/ProfileTabV2.tsx:218-229` also
-- writes `profiles` directly rather than through /api/user/profile.
--
-- The column is overloaded: it is a persona label *and* it looks like a
-- privilege. This guard splits the two. A non-privileged caller may write any
-- value that is not a privilege claim. A privilege claim is silently dropped —
-- the prior value is kept — so the save the user asked for still succeeds and
-- the UX is untouched.
--
-- Denylist, not allowlist, on purpose: an allowlist of persona values would
-- silently swallow the next persona anyone adds to RoleStep.tsx, turning a
-- product change into an invisible data bug. The durable guarantee is not this
-- list — it is that nothing reads `profiles.role` for authorization. This list
-- is the second lock.
--
-- ---------------------------------------------------------------------------
-- HOW THE PRIVILEGED CALLER IS DETECTED — `current_user`
--
-- PostgREST authenticates the request, then switches the session into a
-- database role: `anon` for no token, `authenticated` for a user token,
-- `service_role` for the secret key. `current_user` is therefore the database's
-- own identity for the caller — the same identity that decides whether RLS is
-- bypassed at all (`service_role` has BYPASSRLS). It is not derived from
-- anything the request body or the client can influence.
--
-- The alternative, `auth.role()` / `current_setting('request.jwt.claims')`, was
-- rejected: it reads a GUC. PostgREST does set that GUC from a signature-
-- verified token, so it is not forgeable over HTTP, but it is still a session
-- variable rather than an identity, and it couples this trigger to the `auth`
-- helper schema. `current_user` is strictly narrower, so it is what is used.
--
-- Roles allowed to write `role` freely:
--   service_role        — every server path (supabaseServer, crons, admin APIs)
--   postgres            — migrations, the Supabase SQL editor, the operator
--   supabase_admin      — Supabase platform maintenance
--   supabase_auth_admin — GoTrue, in case a profile-bootstrap trigger exists
--                         on auth.users that this repo does not contain
--
-- KNOWN AND INTENDED CONSEQUENCE: a SECURITY DEFINER function owned by
-- `postgres` runs with current_user = postgres, so anything called through such
-- a function is allowed to set the role. That is the escape hatch for
-- server-authored RPCs, and it is deliberate — those functions are written by
-- us, not by the client. If one is ever added that passes a client-supplied
-- role through to `profiles`, that function is the thing to review.
--
-- ---------------------------------------------------------------------------
-- COEXISTENCE
--
-- The only `profiles` trigger in this repo is `auto_set_profile_org_id`
-- (20260616_add_org_id_to_profiles.sql) and it fires AFTER INSERT ON
-- organizations — a different table.
--
-- **The PRE-APPLY CHECK below was run on production on 2026-09-20.** It found
-- exactly two triggers, neither of which touches `role`:
--
--   1. `create_user_settings_trigger` — on `auth.users`, calling
--      `public.create_user_settings()` (SECURITY DEFINER). It inserts
--      `public.profiles (id)` and nothing else, plus rows in `user_preferences`,
--      `notification_settings` and `security_settings`. It never reads
--      `raw_user_meta_data` and never writes `role`. That is the exact shape
--      check 4 exists to find, and it came back clean: no signup path carries a
--      client-supplied role in on the exempt caller. The migration is cleared.
--
--   2. `update_profiles_updated_at` — BEFORE UPDATE ON `public.profiles`,
--      calling `public.update_updated_at()`, which sets `NEW.updated_at` and
--      returns NEW.
--
-- ORDERING with (2) is harmless, in either direction. PostgreSQL fires
-- same-event BEFORE row triggers in **alphabetical order by trigger name**, so
-- `profiles_role_privilege_guard` runs first ('p' < 'u'). It would not matter if
-- it were the other way round: the two write disjoint columns (`role` vs
-- `updated_at`), neither reads what the other writes, and both return NEW rather
-- than NULL, so neither can cancel the row or discard the other's edit. Note too
-- that this guard is `UPDATE OF role` while that one is a plain `BEFORE UPDATE`
-- — on a save that does not mention `role`, only the timestamp trigger fires,
-- which is correct, because `role` cannot change when it is absent from SET.
--
-- Re-run the PRE-APPLY CHECK before applying to any other environment: it lists
-- whatever that database actually has, which may include triggers created
-- through the dashboard and never written down here.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- PRE-APPLY CHECK (read-only — run first, keep the output for the rollback)
--
--   -- 1. Existing triggers on profiles (expect: none, or none touching `role`).
--   SELECT tgname, pg_get_triggerdef(oid)
--   FROM pg_trigger
--   WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal;
--
--   -- 1b. Server encoding. EXPECT: UTF8.
--   --
--   -- The guard calls `normalize(..., NFKC)`, which is only defined for UTF8
--   -- databases: on any other server encoding it raises
--   -- `ERROR: Unicode normalization can only be performed if server encoding is UTF8`.
--   -- Because the guard is a BEFORE INSERT trigger on `profiles`, that error
--   -- would not fail safe — it would abort the INSERT, and `profiles` rows are
--   -- created on signup, so **signup would break outright**. The pre-NFKC
--   -- expression (`btrim`/`regexp_replace` alone) could not error at all, so
--   -- this is a failure mode the normalisation introduced (SA R1).
--   --
--   -- Anything other than UTF8 here: STOP. Do not apply. Either drop the
--   -- `normalize()` call (losing only the full-width folding, QA D4) or fix the
--   -- encoding first. Supabase provisions UTF8, so this is a guard against a
--   -- self-hosted or restored-from-elsewhere database, not an expected result.
--   SHOW server_encoding;
--
--   -- 2. The policies as they stand (expect the unguarded UPDATE described above).
--   --    Column names are the `pg_policies` VIEW's: policyname / permissive /
--   --    roles / cmd / qual / with_check. `polname` / `polcmd` / `polqual`
--   --    belong to the catalog TABLE `pg_policy` — a different relation. Mixing
--   --    the two is `ERROR: column "polname" does not exist` (QA D1).
--   SELECT policyname, permissive, roles, cmd, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'profiles';
--
--   -- 3. Rows that already claim a privileged role. Applying this migration
--   --    does not touch them — it is the client's next upsert of such a row
--   --    that clears it (see WHAT IS NOT CHANGED). They are reported here, not
--   --    cleaned; scripts/cleanup-profiles-role-admin.ts is what clears them.
--   SELECT coalesce(role, '(null)') AS role, count(*)
--   FROM public.profiles GROUP BY 1 ORDER BY 2 DESC;
--
--   -- 4. **THE ONE THAT CAN DEFEAT THIS MIGRATION.** Run it. Do not skip it.
--   --
--   -- Query 1 looks at `public.profiles`. The trigger that would walk straight
--   -- through this guard is on **`auth.users`**: a `handle_new_user`-style
--   -- function that copies `raw_user_meta_data->>'role'` into `profiles.role`
--   -- on signup. GoTrue runs as `supabase_auth_admin`, and such functions are
--   -- almost always SECURITY DEFINER owned by `postgres` — BOTH are on this
--   -- guard's exempt list. So a self-served `role: 'admin'` in the signup
--   -- metadata would be written by an exempt caller and the guard would never
--   -- see it. (Exempting them is still correct: GoTrue must be able to create
--   -- the profile row at all. The fix, if such a function exists, is to stop
--   -- that function trusting user metadata — not to un-exempt the caller.)
--   --
--   -- This repo defines NO `profiles` DDL, triggers or policies anywhere, so
--   -- whatever is live was created through the dashboard and CANNOT be read
--   -- from the source tree. The database is the only place to look.
--   --
--   -- EXPECTED: zero rows. Any row => stop, read the function body printed by
--   -- the second query, and check whether it sources `role` from user-supplied
--   -- metadata before applying this migration.
--   SELECT tgname,
--          pg_get_triggerdef(oid) AS trigger_def
--   FROM pg_trigger
--   WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;
--
--   -- Any function anywhere that writes profiles.role or reads role out of
--   -- auth metadata — including the bodies of whatever query 4 returned.
--   SELECT n.nspname AS schema,
--          p.proname  AS function,
--          p.prosecdef AS is_security_definer,
--          pg_get_userbyid(p.proowner) AS owner,
--          pg_get_functiondef(p.oid)   AS body
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
--     AND (p.prosrc ILIKE '%raw_user_meta_data%'
--          OR (p.prosrc ILIKE '%profiles%' AND p.prosrc ILIKE '%role%'));
-- ---------------------------------------------------------------------------


BEGIN;

CREATE OR REPLACE FUNCTION public.guard_profiles_role_privilege()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER          -- must see the *caller's* identity, never the owner's
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Values that read as a claim of platform privilege rather than a persona.
  -- Written in ALREADY-NORMALISED form — lower case, no separators — because
  -- that is what `incoming` is reduced to below. 'super_admin' and 'super-admin'
  -- therefore need no separate entry: both fold onto 'superadmin'.
  --
  -- 'staff' and 'moderator' are deliberately NOT here: both are plausible as
  -- ordinary job labels, which is what this column holds, and clamping them
  -- would swallow a legitimate answer to buy nothing — neither is a privilege
  -- name anything in this codebase would ever check.
  privileged_values CONSTANT text[] := ARRAY[
    'admin', 'administrator',
    'superadmin', 'platformadmin', 'supabaseadmin',
    'superuser', 'sysadmin', 'systemadmin',
    'root', 'owner',
    'servicerole'
  ];

  -- Database roles permitted to set any value. See HOW ... `current_user` above.
  privileged_callers CONSTANT text[] := ARRAY[
    'service_role', 'postgres', 'supabase_admin', 'supabase_auth_admin'
  ];

  -- Assigned in the body, not as a DECLARE default: a default is evaluated on
  -- block entry, which would touch NEW before the caller check has run.
  incoming text;
BEGIN
  IF current_user = ANY (privileged_callers) THEN
    RETURN NEW;
  END IF;

  -- NFKC first, then every non-alphanumeric character REMOVED, then lowered.
  -- That order is load-bearing and is mirrored exactly, in the same order, by
  -- scripts/cleanup-profiles-role-admin.ts and profileRoleOptions.test.ts.
  -- Lowercasing first instead diverges on a dotted capital I: JS lowercases
  -- 'ADMIN' spelled with U+0130 into i + U+0307, whose combining mark the strip
  -- then discards, yielding 'admin' — where this expression yields 'admn'
  -- (QA D5). Two normalisers that disagree is the exact class of bug this
  -- column already has.
  --
  -- `normalize(..., NFKC)` (PostgreSQL 13+; Supabase is 15) folds the full-width
  -- forms, so a role of U+FF41.. 'admin' clamps instead of being stored verbatim
  -- (QA D4).
  --
  -- `btrim` strips ASCII spaces only, so E'\tadmin', E'admin\n' and an
  -- NBSP-padded E' admin' all walked past an equality test and were stored
  -- verbatim — while JavaScript's `.trim()`, which strips tabs, newlines and
  -- NBSP alike, *would* reduce them to 'admin'. That mismatch is the whole bug:
  -- the database would hold a value that any JS reader normalises to exactly
  -- 'admin'. Stripping the whole class instead of trimming a whitelist of
  -- whitespace also folds 'super admin', 'super.admin' and 'Super-Admin' onto
  -- one token, so the list above needs no spelling per separator.
  --
  -- Equality is kept deliberately — NOT `LIKE '%admin%'` or any contains test.
  -- With separators stripped the persona 'business_owner' becomes
  -- 'businessowner', which *contains* 'owner'; a substring test would clamp a
  -- legitimate onboarding answer.
  --
  -- The normalisation is wrapped because it is the only part of this trigger
  -- that CAN raise, and this trigger sits on the signup path (SA R1).
  -- `normalize()` errors outright on a non-UTF8 server. The PRE-APPLY CHECK
  -- proves the encoding at apply time; it cannot prove it forever — a restore
  -- onto a differently-encoded cluster would turn a security guard into an
  -- outage, and "nobody can sign up" is a far worse failure than "a label is
  -- not NFKC-folded".
  --
  -- The fallback is NOT to let the value through. It is the exact expression
  -- that shipped before NFKC was added, so the guard stays fully operative and
  -- loses only the full-width folding (QA D4). Fail-degraded, never fail-open.
  -- The WARNING makes the degradation visible in the Postgres log rather than
  -- silent.
  --
  -- Cost: a plpgsql EXCEPTION block opens a subtransaction. Irrelevant here —
  -- this trigger is `UPDATE OF role`, so it fires on signup, the onboarding
  -- role step and a profile save, not in any hot loop.
  BEGIN
    incoming := lower(regexp_replace(normalize(coalesce(NEW.role, ''), NFKC), '[^a-zA-Z0-9]', '', 'g'));
  EXCEPTION WHEN others THEN
    RAISE WARNING
      'profiles.role privilege guard: normalize() failed (%); falling back to the un-normalised comparison. Check server_encoding.',
      SQLERRM;
    incoming := lower(regexp_replace(coalesce(NEW.role, ''), '[^a-zA-Z0-9]', '', 'g'));
  END;

  IF NOT (incoming = ANY (privileged_values)) THEN
    -- Personas, 'user', 'viewer', NULL, anything else: untouched. This is the
    -- path onboarding and the settings save take, and it must stay free.
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Silent, not an exception: failing here would break a profile save the
    -- user did ask for (name, avatar, timezone) because of a field they did
    -- not. Re-saving a row that is already 'admin' is a no-op, not a demotion.
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE WARNING
        'profiles.role privilege guard: caller % tried to set profile % role to %; kept %',
        current_user, NEW.id, NEW.role, coalesce(OLD.role, '(null)');
    END IF;
    NEW.role := OLD.role;
  ELSE
    -- INSERT: there is no prior value to keep, so the claim is simply dropped.
    -- NULL, not 'user' — the column is a persona label and an absent label is
    -- honest, where a fabricated one is not.
    --
    -- THIS BRANCH ALSO RUNS ON A POSTGREST UPSERT, AND THERE IT IS A WIPE, NOT
    -- A PRESERVE (QA D2). `INSERT ... ON CONFLICT DO UPDATE` fires BEFORE INSERT
    -- against the *proposed* row first; `excluded` is then built from the row as
    -- this trigger left it. So when a client upserts a profile that already
    -- holds a privileged value — which is exactly what
    -- components/v2/settings/ProfileTabV2.tsx does, it re-sends the stored role
    -- on every save — NEW.role becomes NULL here, `excluded.role` is NULL, and
    -- the UPDATE branch then sees a non-privileged incoming value and lets it
    -- through. Net effect: the row's privileged role is cleared, not kept.
    --
    -- That is deliberate and it is the safer of the two. Preserving would mean
    -- a SELECT of the existing row from inside a BEFORE INSERT trigger on every
    -- signup — a read and a race added to the hot path — to conserve the one
    -- value this whole migration exists to eliminate. The user-visible result of
    -- the wipe is that a legacy 'admin' label becomes blank and the settings tab
    -- shows "User"; no error, no failed save, and nothing that grants anything
    -- is lost, because nothing is granted by this column. After the 2026-09-20
    -- cleanup, zero rows can reach this path at all.
    RAISE WARNING
      'profiles.role privilege guard: caller % tried to insert profile % with role %; set NULL',
      current_user, NEW.id, NEW.role;
    NEW.role := NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_profiles_role_privilege() IS
  'Stops a client (anon/authenticated) writing a privilege-sounding value into profiles.role. '
  'Persona values pass through untouched so onboarding keeps working. '
  'See supabase/migrations/20261002_profiles_role_privilege_guard.sql.';

DROP TRIGGER IF EXISTS profiles_role_privilege_guard ON public.profiles;

CREATE TRIGGER profiles_role_privilege_guard
  BEFORE INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profiles_role_privilege();

COMMENT ON COLUMN public.profiles.role IS
  'Persona/display label only — NEVER an authorization signal. Admin identity lives in '
  'admin_users (see docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md). Client writes of a '
  'privileged value are dropped by trigger profiles_role_privilege_guard.';

COMMIT;


-- ---------------------------------------------------------------------------
-- WHAT IS NOT CHANGED
--
--   * Existing rows — BY THIS MIGRATION. Applying it rewrites nothing: the
--     guard blocks *new* claims, and a migration that silently edits user rows
--     is harder to reason about than one that does not.
--
--     Be precise about what that does and does not promise (QA D2). It is a
--     statement about the migration, not a guarantee that a privileged value
--     survives forever. A row holding one keeps it until something writes to
--     it; the next client UPSERT of that row clears it to NULL, because the
--     BEFORE INSERT branch nulls the proposed row before `excluded` is built.
--     See that branch for why the wipe is the deliberate choice.
--
--     Moot in practice: the 2026-09-20 census found three 'admin' rows (two of
--     them genuine `admin_users`), all cleared to 'user' by
--     scripts/cleanup-profiles-role-admin.ts's query. The re-census returned
--     zero rows, so no row can reach either path today.
--
--   * The RLS policies. The trigger sits underneath them and applies to every
--     write path, so the policy edit is not required for this fix.
--
--   * Every server path. service_role is exempt by the first branch, and it
--     bypasses RLS regardless.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- ACCEPTED RESIDUAL RISK (QA D3 / D4) — read this before trusting the column
--
-- Two classes of spelling still survive the normaliser. Both are stored
-- verbatim, neither is exploitable today, and both are accepted rather than
-- chased:
--
--   1. CONFUSABLE HOMOGLYPHS. `normalize(..., NFKC)` folds compatibility
--      variants — that is what closes the full-width class — but it does NOT
--      fold confusables across scripts, because they are genuinely different
--      characters. 'admin' with a Cyrillic U+0430 or a Greek U+0391 normalises
--      to 'dmin' (the strip removes the non-ASCII letter) and is stored as
--      typed. Closing this needs a confusables/skeleton mapping, which is a
--      dependency and a table, not a line of SQL — disproportionate for a
--      display label.
--
--   2. UNLISTED NEIGHBOURS. 'admins', 'adminuser', 'org_admin' are not on the
--      denylist and are stored as typed. This is the denylist's designed
--      failure mode (SA ruling 1) and it cannot be fixed by widening the list
--      into a substring test: 'business_owner' normalises to 'businessowner',
--      which contains 'owner'.
--
-- Why both are acceptable: NOTHING AUTHORIZES ON THIS COLUMN. The durable
-- control is `admin_users` via AdminAccessService, and this guard is the second
-- lock, not the first.
--
-- THE RULE THAT MAKES THAT SAFE, and what the admin-authz slice must carry:
-- any future code that reads `profiles.role` for any privilege-ish decision
-- must compare against THIS normaliser, never its own. A reader that lowercases
-- first, or trims instead of stripping, or skips NFKC, will disagree with this
-- trigger about what 'admin' is — and the disagreement is the vulnerability, as
-- QA D5 showed within this very change. The CI check SA asked for (fail on
-- `profiles.role` compared to a privilege literal anywhere in TS or SQL) is what
-- actually retires both residual classes; it is owned by the admin-authz slice.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- VERIFICATION (run after applying; the whole block rolls back, it writes
-- nothing. Substitute a real profile id for :uid.)
--
--   -- 0. The trigger is installed.
--   SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--   WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal;
--
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SELECT set_config(
--       'request.jwt.claims',
--       json_build_object('sub', :'uid', 'role', 'authenticated')::text,
--       true);
--
--     -- 1. THE HOLE: self-promotion. Expect the row to come back UNCHANGED,
--     --    with a WARNING in the output, and NO error.
--     UPDATE public.profiles SET role = 'admin' WHERE id = :'uid';
--     SELECT role AS after_admin_attempt FROM public.profiles WHERE id = :'uid';
--
--     -- 2. Evasion. Every one of these must leave the row UNCHANGED. The tab,
--     --    newline and NBSP cases are the ones a `btrim`-based guard let
--     --    through: btrim strips ASCII spaces only, but JS `.trim()` strips all
--     --    three — so the stored value would read as exactly 'admin' to any JS
--     --    caller. The separator cases prove 'super_admin' etc. need no entry
--     --    of their own in privileged_values.
--     UPDATE public.profiles SET role = '  ADMIN '            WHERE id = :'uid';
--     UPDATE public.profiles SET role = E'\tadmin'            WHERE id = :'uid';
--     UPDATE public.profiles SET role = E'admin\n'            WHERE id = :'uid';
--     UPDATE public.profiles SET role = E' admin '  WHERE id = :'uid';  -- NBSP
--     UPDATE public.profiles SET role = E'​admin'        WHERE id = :'uid';  -- zero-width space
--     UPDATE public.profiles SET role = E'ａｄｍｉｎ' WHERE id = :'uid';  -- full-width (D4)
--     UPDATE public.profiles SET role = 'Super-Admin'         WHERE id = :'uid';
--     UPDATE public.profiles SET role = 'super admin'         WHERE id = :'uid';
--     UPDATE public.profiles SET role = 'service_role'        WHERE id = :'uid';
--     SELECT role AS after_evasion_attempts FROM public.profiles WHERE id = :'uid';
--
--     -- 2b. The same set, as the normaliser sees it. Every row must be TRUE.
--     SELECT v,
--            lower(regexp_replace(v, '[^a-zA-Z0-9]', '', 'g')) AS normalised,
--            lower(regexp_replace(v, '[^a-zA-Z0-9]', '', 'g')) IN
--              ('admin','administrator','superadmin','platformadmin',
--               'supabaseadmin','superuser','sysadmin','systemadmin',
--               'root','owner','servicerole') AS is_clamped
--     FROM unnest(ARRAY[
--       '  ADMIN ', E'\tadmin', E'admin\n', E' admin ', E'​admin',
--       'Super-Admin', 'super admin', 'service_role', 'ADMINISTRATOR',
--       E'ａｄｍｉｎ'   -- full-width 'admin', folded by NFKC (D4)
--     ]) AS v;
--
--     -- 2c. ...and the personas must all come back FALSE. 'business_owner'
--     --     normalises to 'businessowner', which CONTAINS 'owner' — this is the
--     --     row that proves the check is equality and not a substring test.
--     SELECT v,
--            lower(regexp_replace(v, '[^a-zA-Z0-9]', '', 'g')) AS normalised,
--            lower(regexp_replace(v, '[^a-zA-Z0-9]', '', 'g')) IN
--              ('admin','administrator','superadmin','platformadmin',
--               'supabaseadmin','superuser','sysadmin','systemadmin',
--               'root','owner','servicerole') AS is_clamped
--     FROM unnest(ARRAY[
--       'business_owner', 'manager', 'consultant', 'operations',
--       'sales', 'marketing', 'finance', 'other', 'user', 'viewer',
--       'staff', 'moderator',                   -- excluded from the denylist on purpose
--       E'аdmin', E'ADMİN', 'admins'   -- ACCEPTED RESIDUAL RISK (D3/D5).
--                                               -- These must come back FALSE here
--                                               -- AND from every JS mirror. A mirror
--                                               -- that says TRUE for any of them has
--                                               -- drifted from this normaliser — and
--                                               -- the drift is the vulnerability.
--     ]) AS v;
--
--     -- 3. REGRESSION: onboarding must still work. Expect 'business_owner'.
--     UPDATE public.profiles SET role = 'business_owner' WHERE id = :'uid';
--     SELECT role AS after_persona FROM public.profiles WHERE id = :'uid';
--
--     -- 4. REGRESSION: the profile save must still work. Expect 'viewer'.
--     UPDATE public.profiles SET role = 'viewer' WHERE id = :'uid';
--     SELECT role AS after_demotion FROM public.profiles WHERE id = :'uid';
--
--     -- 5. A save that does not mention role must be untouched by the guard.
--     UPDATE public.profiles SET full_name = full_name WHERE id = :'uid';
--
--     -- 5b. THE UPSERT PATH (QA D2) — the shape PostgREST sends for
--     --     ProfileTabV2's save, and the one branch whose behaviour the docs
--     --     originally described wrongly. Seed a privileged value as the
--     --     operator, then upsert it back as the user, exactly as the tab does.
--     --     EXPECTED: role comes back **(null)** — CLEARED, not preserved,
--     --     because the BEFORE INSERT branch nulls the proposed row before
--     --     `excluded` is built. Anything else means that branch changed.
--     RESET ROLE;
--     UPDATE public.profiles SET role = 'admin' WHERE id = :'uid';
--     SET LOCAL ROLE authenticated;
--     INSERT INTO public.profiles AS p (id, role, updated_at)
--     VALUES (:'uid', 'admin', now())
--     ON CONFLICT (id) DO UPDATE
--       SET role = excluded.role, updated_at = excluded.updated_at;
--     SELECT coalesce(role, '(null)') AS after_upsert
--     FROM public.profiles WHERE id = :'uid';
--   ROLLBACK;
--
--   -- 6. The service role is unaffected (run as postgres, outside the block).
--   --    Expect 'admin', then put it back.
--   BEGIN;
--     UPDATE public.profiles SET role = 'admin' WHERE id = :'uid';
--     SELECT role AS service_role_write FROM public.profiles WHERE id = :'uid';
--   ROLLBACK;
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- OPTIONAL, NOT APPLIED: tighten the policy itself.
--
-- The UPDATE policy has no WITH CHECK, so the predicate is evaluated only
-- against the row as it was, never as it will be. A user can therefore also
-- rewrite their own `id` and orphan the row out of their ownership. That is a
-- different, lesser bug than self-promotion and it is not what this migration
-- was scoped to, so it is left here rather than applied. Apply it only after
-- confirming nothing legitimately re-keys a profile row.
--
--   ALTER POLICY "<the real policy name from the PRE-APPLY CHECK>"
--     ON public.profiles
--     USING (auth.uid() = id)
--     WITH CHECK (auth.uid() = id);
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- ROLLBACK (restores the pre-2026-09-20 state: the column writable by its
-- owner, privilege values included. Insecure by design — this block exists to
-- undo the change, never as a target state.)
--
--   BEGIN;
--     DROP TRIGGER IF EXISTS profiles_role_privilege_guard ON public.profiles;
--     DROP FUNCTION IF EXISTS public.guard_profiles_role_privilege();
--     -- The column comment is cosmetic; restore it only if the PRE-APPLY CHECK
--     -- recorded a previous one:
--     --   COMMENT ON COLUMN public.profiles.role IS '<previous comment or NULL>';
--   COMMIT;
--
-- No policy, grant or row is touched by this migration, so there is nothing
-- else to restore.
-- ---------------------------------------------------------------------------
