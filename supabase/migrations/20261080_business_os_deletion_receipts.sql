-- 20261080_business_os_deletion_receipts. Data export DE-10b.1, the deletion receipt
-- Requirement docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md section 5 and SA Review 2 section E
-- Workplan docs/workplans/BUSINESS_OS_DATA_EXPORT_DE10B1_WORKPLAN.md section 4
-- Creates public.business_os_deletion_receipts. One row per committed account deletion, written only by the
-- cleanup function of 20261081 inside its own transaction, so a receipt exists if and only if the deletion committed
-- No user_id column, no owner_user_id column and no foreign key, so no cascade, purge, audit erasure or archiving reaches it
-- RLS on with no policy. Browser roles hold nothing. service_role holds SELECT and INSERT only
-- The email is never stored. email_fingerprint is a keyed HMAC computed by the app, the key never reaches the database
-- Apply before 20261081_operator_account_cleanup_anonymise, which refuses until this table exists
-- Pre-check scripts/precheck-de10b-deletion-receipts.sql. Checker scripts/check-de10b-deletion-receipts-migration.sql
-- Rollback supabase/SQL Scripts/20261080_business_os_deletion_receipts_rollback.sql, which refuses once any receipt exists
-- The whole file is one transaction. A failed pre-guard or post-condition applies nothing

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $pre_guard$
BEGIN
  IF pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') OR pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Deletion receipts migration refused: anon or authenticated may create objects in schema public. Nothing was applied';
  END IF;
  IF pg_catalog.to_regclass('public.business_os_deletion_receipts') IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Deletion receipts migration refused: table public.business_os_deletion_receipts already exists. Nothing was applied';
  END IF;
END
$pre_guard$;

CREATE TABLE public.business_os_deletion_receipts (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  status                      text        NOT NULL,
  mode                        text        NOT NULL,
  subject_user_id             uuid        NOT NULL,
  placeholder_ref             text        NULL,
  email_fingerprint           text        NOT NULL,
  fingerprint_key_version     smallint    NOT NULL,
  origin                      text        NOT NULL,
  executor_kind               text        NOT NULL,
  executor_admin_id           uuid        NULL,
  executor_admin_email        text        NULL,
  reason_category             text        NULL,
  reason_note                 text        NULL,
  statement_language          text        NULL,
  statement_text              text        NULL,
  owner_last_export_ready_at  timestamptz NULL,
  owner_export_downloaded_at  timestamptz NULL,
  admin_export_existed        boolean     NULL,
  rows_removed                bigint      NOT NULL DEFAULT 0,
  rows_blanked                bigint      NOT NULL DEFAULT 0,
  files_removed               bigint      NOT NULL DEFAULT 0,
  tables_removed              integer     NOT NULL DEFAULT 0,
  requested_at                timestamptz NOT NULL,
  completed_at                timestamptz NOT NULL,
  retain_until                timestamptz NOT NULL,
  correlation_id              text        NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT business_os_deletion_receipts_status_check
    CHECK (status = 'completed'),
  CONSTRAINT business_os_deletion_receipts_mode_check
    CHECK (mode IN ('full_delete', 'anonymised', 'pseudonymised_billing_kept')),
  CONSTRAINT business_os_deletion_receipts_ref_check
    CHECK (placeholder_ref IS NULL OR placeholder_ref ~ '^[0-9a-f]{12}$'),
  CONSTRAINT business_os_deletion_receipts_ref_shape
    CHECK ((mode = 'full_delete') = (placeholder_ref IS NULL)),
  CONSTRAINT business_os_deletion_receipts_fingerprint_check
    CHECK (email_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT business_os_deletion_receipts_key_version_check
    CHECK (fingerprint_key_version >= 1),
  CONSTRAINT business_os_deletion_receipts_origin_check
    CHECK (origin IN ('owner', 'admin')),
  CONSTRAINT business_os_deletion_receipts_executor_check
    CHECK (executor_kind IN ('self_service', 'admin')),
  CONSTRAINT business_os_deletion_receipts_origin_matches_executor
    CHECK ((origin = 'owner') = (executor_kind = 'self_service')),
  CONSTRAINT business_os_deletion_receipts_admin_shape
    CHECK ((executor_kind = 'admin') = (executor_admin_id IS NOT NULL)),
  CONSTRAINT business_os_deletion_receipts_admin_email_length
    CHECK (executor_admin_email IS NULL OR char_length(executor_admin_email) BETWEEN 3 AND 320),
  CONSTRAINT business_os_deletion_receipts_reason_check
    CHECK (reason_category IS NULL OR reason_category IN ('customer_asked', 'test_account', 'other')),
  CONSTRAINT business_os_deletion_receipts_admin_reason
    CHECK (origin <> 'admin' OR reason_category IS NOT NULL),
  CONSTRAINT business_os_deletion_receipts_note_length
    CHECK (reason_note IS NULL OR char_length(reason_note) BETWEEN 5 AND 500),
  CONSTRAINT business_os_deletion_receipts_other_needs_note
    CHECK (reason_category IS DISTINCT FROM 'other' OR reason_note IS NOT NULL),
  CONSTRAINT business_os_deletion_receipts_language_check
    CHECK (statement_language IS NULL OR statement_language IN ('en', 'he', 'es')),
  CONSTRAINT business_os_deletion_receipts_statement_length
    CHECK (statement_text IS NULL OR char_length(statement_text) <= 500),
  CONSTRAINT business_os_deletion_receipts_statement_shape
    CHECK ((statement_language IS NULL) = (statement_text IS NULL)),
  CONSTRAINT business_os_deletion_receipts_counts_check
    CHECK (rows_removed >= 0 AND rows_blanked >= 0 AND files_removed >= 0 AND tables_removed >= 0),
  CONSTRAINT business_os_deletion_receipts_retention_floor
    CHECK (retain_until >= completed_at + interval '1 year'),
  CONSTRAINT business_os_deletion_receipts_correlation_length
    CHECK (correlation_id IS NULL OR char_length(correlation_id) <= 200)
);

CREATE INDEX business_os_deletion_receipts_subject
  ON public.business_os_deletion_receipts (subject_user_id);

CREATE INDEX business_os_deletion_receipts_fingerprint
  ON public.business_os_deletion_receipts (email_fingerprint, fingerprint_key_version);

ALTER TABLE public.business_os_deletion_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_os_deletion_receipts FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT ON TABLE public.business_os_deletion_receipts TO service_role;

DO $post_condition$
DECLARE
  v_table     regclass;
  v_role      text;
  v_privilege text;
  v_count     bigint;
BEGIN
  v_table := pg_catalog.to_regclass('public.business_os_deletion_receipts');
  IF v_table IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Deletion receipts post-condition 1: the table is missing so nothing was applied';
  END IF;
  IF NOT (SELECT cls.relrowsecurity FROM pg_catalog.pg_class AS cls WHERE cls.oid = v_table) THEN
    RAISE EXCEPTION USING MESSAGE = 'Deletion receipts post-condition 1: row level security is off so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_policies AS pol
               WHERE pol.schemaname = 'public' AND pol.tablename = 'business_os_deletion_receipts');
  IF v_count <> 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Deletion receipts post-condition 1: the table has a policy so nothing was applied';
  END IF;

  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con WHERE con.conrelid = v_table AND con.contype = 'f');
  IF v_count <> 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Deletion receipts post-condition 2: the table has a foreign key so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con WHERE con.confrelid = v_table AND con.contype = 'f');
  IF v_count <> 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Deletion receipts post-condition 2: a foreign key points at the table so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_attribute AS att
               WHERE att.attrelid = v_table AND att.attnum > 0 AND NOT att.attisdropped
                 AND att.attname IN ('user_id', 'owner_user_id'));
  IF v_count <> 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Deletion receipts post-condition 2: the table has a user_id or owner_user_id column so nothing was applied';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['public', 'anon', 'authenticated']
  LOOP
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    LOOP
      IF pg_catalog.has_table_privilege(v_role, v_table, v_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Deletion receipts post-condition 3: ' || v_role || ' holds table ' || v_privilege || ' so nothing was applied';
      END IF;
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
    LOOP
      IF pg_catalog.has_any_column_privilege(v_role, v_table, v_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Deletion receipts post-condition 3: ' || v_role || ' holds column ' || v_privilege || ' so nothing was applied';
      END IF;
    END LOOP;
  END LOOP;

  FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT']
  LOOP
    IF NOT pg_catalog.has_table_privilege('service_role', v_table, v_privilege) THEN
      RAISE EXCEPTION USING MESSAGE = 'Deletion receipts post-condition 4: service_role lacks ' || v_privilege || ' so nothing was applied';
    END IF;
  END LOOP;
  FOREACH v_privilege IN ARRAY ARRAY['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
  LOOP
    IF pg_catalog.has_table_privilege('service_role', v_table, v_privilege) THEN
      RAISE EXCEPTION USING MESSAGE = 'Deletion receipts post-condition 4: service_role holds ' || v_privilege || ' so nothing was applied';
    END IF;
  END LOOP;
  IF NOT pg_catalog.has_table_privilege('postgres', v_table, 'INSERT') THEN
    RAISE EXCEPTION USING MESSAGE = 'Deletion receipts post-condition 4: postgres, the owner of the cleanup function, cannot add a receipt so nothing was applied';
  END IF;

  v_count := (SELECT count(*) FROM pg_catalog.pg_trigger AS trg WHERE trg.tgrelid = v_table AND NOT trg.tgisinternal);
  IF v_count <> 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Deletion receipts post-condition 5: the table has a trigger so nothing was applied';
  END IF;

  v_count := (SELECT count(*) FROM pg_catalog.pg_indexes AS idx
               WHERE idx.schemaname = 'public' AND idx.tablename = 'business_os_deletion_receipts'
                 AND idx.indexname IN ('business_os_deletion_receipts_subject', 'business_os_deletion_receipts_fingerprint'));
  IF v_count <> 2 THEN
    RAISE EXCEPTION USING MESSAGE = 'Deletion receipts post-condition 6: an index is missing so nothing was applied';
  END IF;
END
$post_condition$;

NOTIFY pgrst, 'reload schema';

COMMIT;
