-- PROD-2 baseline apply, file 3 of 4: after-schema.sql
-- (workplan sections 4.2 and 5; SA conditions A-2, C-2, C-4, OQ-15, R-4, R-10
-- and SA code review item 8).
--
-- WHERE AND WHEN. The new, empty production project only: the rehearsal U5r
-- (which ends in ROLLBACK) and the apply U5. Run by the user, under the D7
-- exception, as the THIRD file of one psql --single-transaction run:
--   before-schema.sql, the rendered schema.sql, after-schema.sql, seed-import.psql
-- See workplan section 12 (U5) for the exact command.
--
-- PSQL ONLY. Never paste this file in the Supabase SQL editor and never run it
-- through execute_sql. It is part of one transaction that spans four files,
-- which only psql gives, and the editor misparses the standalone word "into",
-- which the INSERT statements below need.
--
-- WHAT IT CARRIES: the pieces of staging's schema that a dump of public and
-- operator_private does not.
--   1. The trigger on auth.users that runs our signup bootstrap function (P19).
--      The function itself comes with the dump.
--   2. The five storage bucket rows, configuration only (P20). No object is
--      copied. Values are those the tracked migrations set on staging.
--   3. The bos_cron_run_recording row (OQ-15 class b, an initialisation row).
--      It re-runs the migration's own DEFAULT VALUES insert, so production
--      records its own install time, never staging's.
--   4. Global default ACLs of postgres (SA A-2). A dump limited to schemas never
--      carries them, so any to carry would be re-created here. Per the private
--      record (OQ-2) this file re-creates none, and it asserts that production
--      has none, so the manifest's entry is checked rather than only stated.
--      The parity checker's P15 GLOBAL lines prove parity.
--   5. Materialized views (SA code review item 8). A schema-only dump creates
--      them WITH NO DATA. Staging has none today, so there is nothing to
--      refresh, and this file refuses if one ever arrives in the dump. The
--      REFRESH for it then goes at the end of seed-import.psql, after the seed
--      rows and before its RELEASE, and this check moves there with it, after
--      the REFRESH lines (SA ruling 7). Refreshed here, a view over seeded
--      tables would be built from empty tables.
--   6. PostgREST is told to reload its schema cache. NOTIFY is delivered at
--      commit, so a rehearsal that rolls back sends nothing.
-- Not carried, by ruling: no ALTER ROLE (SA R-10: the API-role settings
-- already match), no storage policy (there are none on staging, P21).
--
-- SEARCH PATH. The rendered dump empties search_path for the rest of the
-- session, so every name below is schema-qualified (SA C-4).
--
-- The rules this file keeps (pinned by scripts/__tests__/schemaParityBaseline.test.ts):
--   - it opens with a SAVEPOINT and releases it at the end, and holds no
--     transaction control and no psql meta-command (SA C-2)
--   - no function is defined
--   - no IF NOT EXISTS and no ON CONFLICT: before-schema.sql has already
--     refused a project where any of this exists, so a conflict here is an
--     error, never a silent no-op
--   - nothing is written to operator_private
--
-- @see docs/workplans/prod-2-schema-baseline-workplan.md sections 4.2, 5 and 19

-- Refuse to run outside a transaction block (SA C-2).
SAVEPOINT baseline_after_schema;

-- The dump resets lock_timeout to 0. An empty project has no traffic, so a
-- wait means something is wrong.
SET LOCAL lock_timeout = '10s';

-- 1. The signup bootstrap trigger (OQ-1: the only object of ours outside our
-- schemas). Text as on staging, schema-qualified.
CREATE TRIGGER create_user_settings_trigger
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.create_user_settings();

-- 2. The five buckets, with the configuration the tracked migrations left on
-- staging (sizes in bytes). The contact-documents MIME list is the creating
-- migration's list plus the three types 20261058 added; P20 compares the
-- types sorted, so their order here does not matter.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars', 'avatars', true, 4194304,
   ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]),
  ('website-images', 'website-images', true, 5242880,
   ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[]),
  ('contact-documents', 'contact-documents', false, 52428800,
   ARRAY['application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'image/jpeg',
         'image/png',
         'image/gif',
         'image/webp',
         'text/plain',
         'text/csv',
         'image/tiff',
         'image/heic',
         'image/heif']::text[]),
  ('business-data-exports', 'business-data-exports', false, 52428800,
   ARRAY['application/zip']::text[]),
  ('business-purge-snapshots', 'business-purge-snapshots', false, 524288000,
   ARRAY['application/json']::text[]);

-- storage.buckets carries platform triggers. One that skipped a row would
-- leave the INSERT above reporting success, so count what landed.
DO $buckets$
BEGIN
  IF (SELECT pg_catalog.count(*)
      FROM storage.buckets AS bkt
      WHERE bkt.id IN ('avatars', 'website-images', 'contact-documents',
                       'business-data-exports', 'business-purge-snapshots')) <> 5 THEN
    RAISE EXCEPTION USING MESSAGE = 'refused, nothing was applied: the five bucket rows did not all land';
  END IF;
END
$buckets$;

-- 3. The initialisation row from migration 20261011 (OQ-15 class b): the
-- migration's own statement, never a copy of staging's value.
INSERT INTO public.bos_cron_run_recording DEFAULT VALUES;

-- 4 and 5. Assertions on what the dump left (SA A-2, SA code review item 8).
DO $after_dump$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl AS def
    WHERE def.defaclrole = (SELECT rol.oid FROM pg_catalog.pg_roles AS rol WHERE rol.rolname = 'postgres')
      AND def.defaclnamespace = 0
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'refused, nothing was applied: postgres has a global default ACL, and this file re-creates none (SA A-2)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS rel
    JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname IN ('public', 'operator_private')
      AND rel.relkind = 'm'
      AND NOT rel.relispopulated
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'refused, nothing was applied: the dump holds a materialized view that is not populated. Add its REFRESH MATERIALIZED VIEW line at the end of seed-import.psql, after the seed rows and before its RELEASE, and move this check there (SA ruling 7)';
  END IF;
END
$after_dump$;

-- 6. PostgREST reloads its schema cache once the transaction commits.
NOTIFY pgrst, 'reload schema';

-- This file's work is done; the run's transaction stays open for seed-import.psql.
RELEASE SAVEPOINT baseline_after_schema;
