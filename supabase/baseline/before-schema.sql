-- PROD-2 baseline apply, file 1 of 4: before-schema.sql
-- (workplan sections 4.2 and 5; SA conditions C-1, C-2, A-1, R-6 and R-8).
--
-- WHERE AND WHEN. The new, empty production project only: the rehearsal U5r
-- (which ends in ROLLBACK) and the apply U5. Run by the user, under the D7
-- exception, as the FIRST file of one psql --single-transaction run:
--   before-schema.sql, the rendered schema.sql, after-schema.sql, seed-import.psql
-- See workplan section 12 (U5) for the exact command.
--
-- PSQL ONLY. Never paste this file in the Supabase SQL editor and never run it
-- through execute_sql. It is part of one transaction that spans four files,
-- which only psql gives. (The editor also misparses the standalone word "into",
-- which after-schema.sql needs for its INSERT statements.)
--
-- WHAT IT DOES, in order. Every step fails closed: an error stops psql
-- (ON_ERROR_STOP) and the whole transaction rolls back, so nothing is applied.
--   1. SAVEPOINT. PostgreSQL refuses a savepoint outside a transaction block,
--      so a run without --single-transaction stops here, before anything has
--      run (SA C-2).
--   2. The empty-target guard (SA C-1, R-6). It refuses any project that is not
--      the new, empty production project: one that has sign-ins, objects of
--      ours, our bucket ids, a trigger on auth.users, the two extensions
--      already installed, pg_graphql installed, or an event-trigger set other
--      than the six platform triggers staging has. No exception handler.
--   3. The two extensions in public, at versions pinned to staging's (SA R-8).
--   4. postgres's default privileges in our schemas are emptied, and then the
--      END STATE is asserted: no default-ACL row for postgres in public, in
--      operator_private or globally (SA A-1). That is the built-in model that
--      pg_dump's GRANT and REVOKE lines are written against. The rendered dump
--      then re-creates whatever default privileges postgres has in our schemas
--      on staging, so later migrations grant the same way on both environments,
--      and the parity checker (P15) proves it.
--   5. RELEASE SAVEPOINT.
--
-- The rules this file keeps (pinned by scripts/__tests__/schemaParityBaseline.test.ts):
--   - no transaction control (the run's single transaction is psql's) and no
--     psql meta-command
--   - no function is defined, so the O-1 tripwire of
--     supabase/__tests__/security-definer-surface.guard.test.ts stays green
--   - every relation is schema-qualified
--   - no IF NOT EXISTS and no ON CONFLICT, because on a project that is not
--     empty either would be a silent no-op instead of a refusal
--
-- @see docs/workplans/prod-2-schema-baseline-workplan.md sections 4.2, 5 and 19

-- 1. Refuse to run outside a transaction block (SA C-2).
SAVEPOINT baseline_before_schema;

-- An empty project has no traffic, so a wait means something is wrong.
SET LOCAL lock_timeout = '10s';

-- 2. The empty-target guard (SA C-1, R-6). Every check runs, and the refusal
-- lists every reason at once. The message names no count and no object of ours.
DO $guard$
DECLARE
  refusals text[] := ARRAY[]::text[];
  public_oid oid := (SELECT nsp.oid FROM pg_catalog.pg_namespace AS nsp WHERE nsp.nspname = 'public');
  event_trigger_names text[];
BEGIN
  -- The owner lines of the parity checker (P01, P07) depend on it.
  IF current_user <> 'postgres' THEN
    refusals := refusals || 'not connected as postgres'::text;
  END IF;

  -- Staging always has sign-ins; the new production project has none until
  -- after U6. A user created before the auth.users trigger exists would also
  -- have no settings rows.
  IF EXISTS (SELECT 1 FROM auth.users) THEN
    refusals := refusals || 'auth.users has rows (this is not the new, empty production project)'::text;
  END IF;

  -- Nothing of ours in public. Only extension members are excluded, and that
  -- exclusion is never widened: anything else found here fails closed, and SA rules.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS rel
    WHERE rel.relnamespace = public_oid
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS dep
                      WHERE dep.classid = 'pg_catalog.pg_class'::regclass
                        AND dep.objid = rel.oid AND dep.deptype = 'e')
  ) THEN
    refusals := refusals || 'public holds a relation'::text;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS fn
    WHERE fn.pronamespace = public_oid
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS dep
                      WHERE dep.classid = 'pg_catalog.pg_proc'::regclass
                        AND dep.objid = fn.oid AND dep.deptype = 'e')
  ) THEN
    refusals := refusals || 'public holds a function'::text;
  END IF;

  -- Types: an implicit array type is never an extension member itself, so it
  -- is excluded through its element type.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_type AS typ
    WHERE typ.typnamespace = public_oid
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS dep
                      WHERE dep.classid = 'pg_catalog.pg_type'::regclass
                        AND dep.objid = typ.oid AND dep.deptype = 'e')
      AND NOT EXISTS (SELECT 1
                      FROM pg_catalog.pg_type AS elem
                      JOIN pg_catalog.pg_depend AS dep
                        ON dep.classid = 'pg_catalog.pg_type'::regclass
                       AND dep.objid = elem.oid AND dep.deptype = 'e'
                      WHERE elem.typarray = typ.oid)
  ) THEN
    refusals := refusals || 'public holds a type'::text;
  END IF;

  -- Any other kind of object in public (an operator, a collation, a text search
  -- object ...): the same namespace census the parity checker's P26 uses.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_depend AS dep
    WHERE dep.refclassid = 'pg_catalog.pg_namespace'::regclass
      AND dep.refobjid = public_oid
      AND dep.deptype = 'n'
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend AS ext_dep
                      WHERE ext_dep.classid = dep.classid
                        AND ext_dep.objid = dep.objid AND ext_dep.deptype = 'e')
  ) THEN
    refusals := refusals || 'public holds an object'::text;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace AS nsp WHERE nsp.nspname = 'operator_private') THEN
    refusals := refusals || 'schema operator_private already exists'::text;
  END IF;

  -- Their version and their member ACLs must come from step 3 of this file.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension AS ext WHERE ext.extname IN ('vector', 'btree_gist')) THEN
    refusals := refusals || 'vector or btree_gist is already installed'::text;
  END IF;

  -- D2: off on both environments. U2b turns it off before the apply.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension AS ext WHERE ext.extname = 'pg_graphql') THEN
    refusals := refusals || 'pg_graphql is installed (D2: turn it off first, step U2b)'::text;
  END IF;

  -- SA R-4: a bucket is never deleted by SQL, so clearing one before a re-run
  -- is a dashboard step.
  IF EXISTS (
    SELECT 1
    FROM storage.buckets AS bkt
    WHERE bkt.id IN ('avatars', 'website-images', 'contact-documents',
                     'business-data-exports', 'business-purge-snapshots')
  ) THEN
    refusals := refusals || 'one of our bucket ids already exists (remove it in the dashboard, Storage; never by SQL)'::text;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trg
    WHERE trg.tgrelid = 'auth.users'::regclass
      AND NOT trg.tgisinternal
  ) THEN
    refusals := refusals || 'auth.users already has a trigger'::text;
  END IF;

  -- SA R-6: exactly staging's six platform event triggers, by name. An extra
  -- one (the automatic-RLS option, removed by step U2c, or a new platform
  -- trigger) would fire during the restore and change our DDL, so it refuses
  -- here, before any CREATE TABLE, and SA rules.
  event_trigger_names := coalesce(
    (SELECT pg_catalog.array_agg(evt.evtname::text ORDER BY evt.evtname::text COLLATE "C")
     FROM pg_catalog.pg_event_trigger AS evt),
    ARRAY[]::text[]);
  IF event_trigger_names IS DISTINCT FROM ARRAY[
       'issue_graphql_placeholder', 'issue_pg_cron_access', 'issue_pg_graphql_access',
       'issue_pg_net_access', 'pgrst_ddl_watch', 'pgrst_drop_watch']::text[] THEN
    refusals := refusals || 'the event triggers are not exactly the six staging has (SA R-6, step U2c)'::text;
  END IF;

  IF pg_catalog.cardinality(refusals) > 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'refused, nothing was applied: '
      || pg_catalog.array_to_string(refusals, '; ');
  END IF;
END
$guard$;

-- 3. Extensions (SA R-8). pg_dump --schema writes no CREATE EXTENSION. The
-- versions are pinned to staging's, so a newer default on this project cannot
-- drift P16. A version this project cannot install fails here, closed. Never
-- ALTER EXTENSION ... UPDATE on one environment alone: moving either version
-- is a migration applied to both.
CREATE EXTENSION vector WITH SCHEMA public VERSION '0.8.0';
CREATE EXTENSION btree_gist WITH SCHEMA public VERSION '1.7';

DO $extensions$
BEGIN
  IF (SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_extension AS ext
      JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = ext.extnamespace
      WHERE nsp.nspname = 'public'
        AND ((ext.extname = 'vector' AND ext.extversion = '0.8.0')
          OR (ext.extname = 'btree_gist' AND ext.extversion = '1.7'))) <> 2 THEN
    RAISE EXCEPTION USING MESSAGE = 'refused, nothing was applied: vector 0.8.0 and btree_gist 1.7 are not both installed in public';
  END IF;
END
$extensions$;

-- 4a. Empty postgres's default privileges in our schemas. Read from the
-- catalog at run time, so this file carries no grant list: every grantee of
-- every per-schema row is revoked, object type by object type. A per-schema
-- row only ever ADDS to the built-in default (owner, plus EXECUTE for PUBLIC on
-- functions), so emptying it cannot take that built-in default away, and
-- PostgreSQL deletes the row once it is empty.
--
-- Global rows are deliberately not touched here. Undoing one means granting the
-- built-in default back, not revoking. Step 4b refuses if one exists, and SA rules.
DO $neutralise$
DECLARE
  dacl record;
BEGIN
  FOR dacl IN
    SELECT DISTINCT
           nsp.nspname,
           CASE def.defaclobjtype
             WHEN 'r' THEN 'TABLES'
             WHEN 'S' THEN 'SEQUENCES'
             WHEN 'f' THEN 'FUNCTIONS'
             WHEN 'T' THEN 'TYPES'
           END AS object_kind,
           CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(acl.grantee)::text) END AS grantee_name
    FROM pg_catalog.pg_default_acl AS def
    JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = def.defaclnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(def.defaclacl) AS acl
    WHERE def.defaclrole = (SELECT rol.oid FROM pg_catalog.pg_roles AS rol WHERE rol.rolname = 'postgres')
      AND nsp.nspname IN ('public', 'operator_private')
  LOOP
    IF dacl.object_kind IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'refused, nothing was applied: postgres has a default ACL of an object type this file does not handle';
    END IF;
    EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA %I REVOKE ALL ON %s FROM %s',
                              dacl.nspname, dacl.object_kind, dacl.grantee_name);
  END LOOP;
END
$neutralise$;

-- 4b. The end state (SA A-1): no default-ACL row for postgres in public, in
-- operator_private or globally. Rows of other roles, and postgres's rows in
-- the managed schemas, are not ours and are left alone (I4 compares them).
DO $end_state$
DECLARE
  postgres_oid oid := (SELECT rol.oid FROM pg_catalog.pg_roles AS rol WHERE rol.rolname = 'postgres');
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl AS def
    JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = def.defaclnamespace
    WHERE def.defaclrole = postgres_oid
      AND nsp.nspname IN ('public', 'operator_private')
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'refused, nothing was applied: postgres still has default privileges in public or operator_private after step 4a';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl AS def
    WHERE def.defaclrole = postgres_oid
      AND def.defaclnamespace = 0
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'refused, nothing was applied: postgres has a global default ACL, so the restore would not run under the built-in model (SA A-1). Stop; SA rules';
  END IF;
END
$end_state$;

-- 5. This file's work is done; the run's transaction stays open for schema.sql.
RELEASE SAVEPOINT baseline_before_schema;
