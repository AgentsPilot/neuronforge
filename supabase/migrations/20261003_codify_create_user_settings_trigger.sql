-- Codify the signup bootstrap: `create_user_settings()` and its trigger.
--
-- Date: 2026-09-20
-- Related: PR #70 (the auth callback stopped creating profile rows in the browser)
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- Every new account gets its `profiles`, `user_preferences`,
-- `notification_settings` and `security_settings` rows from ONE place: a
-- trigger on `auth.users` that fires inside the signup transaction. Nothing in
-- the application creates them any more — `app/auth/callback/page.tsx` used to
-- carry a browser-side "create the profile if it's missing" fallback, and PR
-- #70 removed it, because the row always existed by the time that page ran and
-- a client component writing `profiles` directly violates Mandatory Rule 1.
--
-- That trigger exists **only in the Supabase project**. It was created through
-- the dashboard and was never written down here. So the situation this file
-- fixes is: a new environment (Preview, staging, a local project) has no
-- profile-creation path at all, and nothing would say so — signup would appear
-- to succeed, and every feature that reads a profile would quietly behave as
-- if the user were half-registered.
--
-- ---------------------------------------------------------------------------
-- THIS IS A NO-OP AGAINST PRODUCTION
--
-- The function body below is the `pg_get_functiondef` output read from
-- production on 2026-09-20, immediately before writing this file. Only trailing
-- whitespace on blank lines differs. `CREATE OR REPLACE` therefore replaces the
-- function with itself, and the trigger is recreated identically.
--
-- ⚠️ IT IS *NOT* WHAT THE REPOSITORY SAID IT WAS.
-- docs/workplans/PROFILES_ROLE_SELF_PROMOTION_FIX_WORKPLAN.md:391-402 presents
-- this function as a verbatim capture and shows every INSERT carrying
-- `ON CONFLICT … DO NOTHING`. The live function has **no ON CONFLICT clauses at
-- all**. Copying the documented version into this file would have added them —
-- a silent behaviour change to the signup path, introduced by the very file
-- whose purpose is to change nothing. The pre-merge check in this header is
-- what caught it; it is not ceremony.
--
-- The absence of ON CONFLICT is worth understanding rather than "fixing" here:
-- each INSERT runs inside the `auth.users` insert, so a conflict aborts the
-- whole signup rather than being skipped. That makes signup fail closed — which
-- is in fact why an `auth.users` row created since this trigger existed can
-- never be missing its `profiles` row, the property PR #70 relies on. Making
-- the function idempotent is a defensible improvement, and it is a PRODUCTION
-- CHANGE: separate migration, separate review.
--
-- It is written faithfully rather than improved, on purpose. Two changes were
-- considered and deliberately NOT made, because this file's job is to make a
-- new environment match production, not to change production:
--
--   * `SET search_path = public, pg_temp` on a SECURITY DEFINER function is
--     ordinary hardening and Supabase's linter asks for it. Every table here is
--     already schema-qualified, so the exposure is small — but it is a real
--     change to a live function and belongs in its own reviewed migration.
--   * Seeding `profiles.full_name` from `NEW.raw_user_meta_data` would recover
--     the OAuth display name at signup. The deleted callback code appeared to
--     do this and never actually did (its branch was unreachable), so adding it
--     here would be a NEW behaviour, not a restoration. Every reader already
--     falls back to auth metadata.
--
-- BEFORE MERGING, confirm the live definition still matches what is written
-- below — if production has drifted since 2026-09-20, this file would overwrite
-- that drift:
--
--     SELECT pg_get_functiondef('public.create_user_settings'::regproc);
--     SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--      WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE DOES NOT GIVE YOU
--
-- It does not make a fresh Supabase project usable. The four tables the
-- function writes to — `profiles`, `user_preferences`, `notification_settings`,
-- `security_settings` — are **not created by any migration in this repository**
-- either (checked 2026-09-20 across all 162 files). They, like this trigger,
-- live only in the dashboard.
--
-- This migration still applies cleanly on an empty project: a plpgsql body is
-- not resolved until it runs, and `auth.users` exists in every Supabase
-- project. It would simply fail at the first signup instead of at migration
-- time. Codifying the base schema is the larger piece of environment-readiness
-- work; this file closes the part that PR #70 made load-bearing.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_user_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    -- Create default profile
    INSERT INTO public.profiles (id) VALUES (NEW.id);

    -- Create default preferences
    INSERT INTO public.user_preferences (user_id) VALUES (NEW.id);

    -- Create default notification settings
    INSERT INTO public.notification_settings (user_id) VALUES (NEW.id);

    -- Create default security settings
    INSERT INTO public.security_settings (user_id) VALUES (NEW.id);

    RETURN NEW;
END;
$function$;

-- Recreated rather than created conditionally: `CREATE TRIGGER IF NOT EXISTS`
-- does not exist in PostgreSQL, and a drop-then-create inside the migration's
-- transaction takes a lock on `auth.users` for its duration — a concurrent
-- signup waits, it does not slip through the gap.
DROP TRIGGER IF EXISTS create_user_settings_trigger ON auth.users;

CREATE TRIGGER create_user_settings_trigger
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.create_user_settings();

COMMENT ON FUNCTION public.create_user_settings() IS
  'Signup bootstrap: creates the profiles, user_preferences, notification_settings and security_settings rows for a new auth.users row. The only path that creates them — the app does not (see PR #70).';
