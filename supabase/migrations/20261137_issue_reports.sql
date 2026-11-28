-- 20261137_issue_reports. Business OS issue reporting slice 1.1a, the report storage
-- Requirement docs/requirements/BUSINESS_OS_ISSUE_REPORTING_REQUIREMENT.md data model row issue_reports, CR-5, CR-19, SR-2, SR-3
-- Workplan docs/workplans/BUSINESS_OS_ISSUE_REPORTING_SLICE_1_1_WORKPLAN.md section 4 with SA Review Notes 2026-11-27
-- Creates the table public.issue_reports, one row per problem report an account sends us
-- RLS is on with one policy. A signed in user may read their own rows only. There is no write policy
-- authenticated holds SELECT only. service_role holds SELECT, INSERT, UPDATE and DELETE. anon and PUBLIC hold nothing
-- The only foreign key is user_id to auth.users on delete cascade. problem_id is a plain uuid until slice 3.5a
-- No trigger. The repository sets updated_at on each update
-- Apply BEFORE 20261138_operator_test_account_cleanup_issue_reports, in the same sitting. From this apply until the
-- 20261138 build is live, every test account check and delete refuses on G-10, because the live 20261134 function has
-- not reviewed the new link to the login. That fails closed (SA Q2)
-- Pre-check scripts/precheck-issue-reports.sql. Checker scripts/check-issue-reports-migration.sql
-- Rollback supabase/SQL Scripts/20261137_issue_reports_rollback.sql, run only after the 20261138 rollback
-- The whole file is one transaction. A failed pre-guard or post-condition applies nothing

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $pre_guard$
BEGIN
  IF pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') OR pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports migration refused: anon or authenticated may create objects in schema public. Nothing was applied';
  END IF;
  IF pg_catalog.to_regclass('public.issue_reports') IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports migration refused: table public.issue_reports already exists. Nothing was applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
                  WHERE att.attrelid = pg_catalog.to_regclass('auth.users') AND att.attname = 'id'
                    AND NOT att.attisdropped AND att.atttypid = 'uuid'::regtype) THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports migration refused: auth.users.id is missing or not uuid. Nothing was applied';
  END IF;
  IF pg_catalog.to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports migration refused: auth.uid() does not resolve. Nothing was applied';
  END IF;
  IF pg_catalog.to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports migration refused: gen_random_uuid() does not resolve. Nothing was applied';
  END IF;
END
$pre_guard$;

CREATE TABLE public.issue_reports (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL,
  reference        text        NOT NULL,
  message          text        NOT NULL,
  category_hint    text        NULL,
  page             text        NOT NULL,
  area             text        NULL,
  environment      text        NOT NULL,
  status           text        NOT NULL DEFAULT 'submitted',
  closed_reason    text        NULL,
  context          jsonb       NULL,
  screenshot_path  text        NULL,
  problem_id       uuid        NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT issue_reports_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT issue_reports_reference_key
    UNIQUE (reference),
  CONSTRAINT issue_reports_reference_format
    CHECK (reference ~ '^R-[0-9A-HJKMNP-TV-Z]{8}$'),
  CONSTRAINT issue_reports_message_length
    CHECK (char_length(message) BETWEEN 1 AND 5000),
  CONSTRAINT issue_reports_category_hint_check
    CHECK (category_hint IS NULL OR category_hint IN ('bug', 'support', 'feature')),
  CONSTRAINT issue_reports_page_shape
    CHECK (left(page, 1) = '/' AND strpos(page, '?') = 0 AND strpos(page, '#') = 0 AND char_length(page) <= 512),
  CONSTRAINT issue_reports_area_shape
    CHECK (area IS NULL OR area ~ '^[a-z][a-z0-9_-]{0,39}$'),
  CONSTRAINT issue_reports_environment_shape
    CHECK (environment ~ '^[a-z][a-z-]{1,31}$'),
  CONSTRAINT issue_reports_status_check
    CHECK (status IN ('submitted', 'in_review', 'classified', 'actioned', 'resolved', 'closed')),
  CONSTRAINT issue_reports_closed_reason_check
    CHECK (closed_reason IS NULL OR closed_reason IN ('duplicate', 'spam', 'no_response')),
  CONSTRAINT issue_reports_closed_shape
    CHECK ((status = 'closed') = (closed_reason IS NOT NULL)),
  CONSTRAINT issue_reports_context_shape
    CHECK (context IS NULL OR (jsonb_typeof(context) = 'object' AND octet_length(context::text) <= 32768)),
  CONSTRAINT issue_reports_screenshot_path_shape
    CHECK (screenshot_path IS NULL
           OR (char_length(screenshot_path) <= 512
               AND left(screenshot_path, 74) = (user_id::text || '/' || id::text || '/')))
);

CREATE INDEX issue_reports_user_created
  ON public.issue_reports (user_id, created_at DESC);

ALTER TABLE public.issue_reports ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.issue_reports FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.issue_reports TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.issue_reports TO service_role;

CREATE POLICY issue_reports_owner_select ON public.issue_reports
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DO $post_condition$
DECLARE
  v_table     regclass;
  v_role      text;
  v_privilege text;
  v_count     bigint;
BEGIN
  v_table := pg_catalog.to_regclass('public.issue_reports');
  IF v_table IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports post-condition 1: the table is missing so nothing was applied';
  END IF;
  IF NOT (SELECT cls.relrowsecurity FROM pg_catalog.pg_class AS cls WHERE cls.oid = v_table) THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports post-condition 1: row level security is off so nothing was applied';
  END IF;

  v_count := (SELECT count(*) FROM pg_catalog.pg_policy AS pol WHERE pol.polrelid = v_table);
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports post-condition 2: the table does not have exactly one policy so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_policy AS pol
               WHERE pol.polrelid = v_table
                 AND pol.polname = 'issue_reports_owner_select'
                 AND pol.polcmd = 'r'
                 AND pol.polpermissive
                 AND pol.polroles = ARRAY[(SELECT r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname = 'authenticated')]::oid[]
                 AND pol.polwithcheck IS NULL
                 AND position('user_id' in pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)) > 0
                 AND position('auth.uid()' in pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)) > 0);
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports post-condition 2: the policy is not a permissive SELECT for authenticated on user_id and auth.uid() so nothing was applied';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['public', 'anon']
  LOOP
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    LOOP
      IF pg_catalog.has_table_privilege(v_role, v_table, v_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Issue reports post-condition 3: ' || v_role || ' holds table ' || v_privilege || ' so nothing was applied';
      END IF;
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
    LOOP
      IF pg_catalog.has_any_column_privilege(v_role, v_table, v_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Issue reports post-condition 3: ' || v_role || ' holds column ' || v_privilege || ' so nothing was applied';
      END IF;
    END LOOP;
  END LOOP;

  IF NOT pg_catalog.has_table_privilege('authenticated', v_table, 'SELECT') THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports post-condition 4: authenticated lacks SELECT so nothing was applied';
  END IF;
  FOREACH v_privilege IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
  LOOP
    IF pg_catalog.has_table_privilege('authenticated', v_table, v_privilege) THEN
      RAISE EXCEPTION USING MESSAGE = 'Issue reports post-condition 4: authenticated holds table ' || v_privilege || ' so nothing was applied';
    END IF;
  END LOOP;
  FOREACH v_privilege IN ARRAY ARRAY['INSERT', 'UPDATE', 'REFERENCES']
  LOOP
    IF pg_catalog.has_any_column_privilege('authenticated', v_table, v_privilege) THEN
      RAISE EXCEPTION USING MESSAGE = 'Issue reports post-condition 4: authenticated holds column ' || v_privilege || ' so nothing was applied';
    END IF;
  END LOOP;

  FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
  LOOP
    IF NOT pg_catalog.has_table_privilege('service_role', v_table, v_privilege) THEN
      RAISE EXCEPTION USING MESSAGE = 'Issue reports post-condition 5: service_role lacks ' || v_privilege || ' so nothing was applied';
    END IF;
  END LOOP;
  FOREACH v_privilege IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER']
  LOOP
    IF pg_catalog.has_table_privilege('service_role', v_table, v_privilege) THEN
      RAISE EXCEPTION USING MESSAGE = 'Issue reports post-condition 5: service_role holds ' || v_privilege || ' so nothing was applied';
    END IF;
  END LOOP;

  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con WHERE con.conrelid = v_table AND con.contype = 'f');
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports post-condition 6: the table does not have exactly one foreign key so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con
               JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
               WHERE con.conrelid = v_table AND con.contype = 'f'
                 AND con.conname = 'issue_reports_user_id_fkey'
                 AND con.confrelid = pg_catalog.to_regclass('auth.users')
                 AND con.confdeltype = 'c'
                 AND pg_catalog.array_length(con.conkey, 1) = 1
                 AND att.attname = 'user_id');
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports post-condition 6: the foreign key is not user_id to auth.users on delete cascade so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con WHERE con.confrelid = v_table AND con.contype = 'f');
  IF v_count <> 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports post-condition 6: a foreign key points at the table so nothing was applied';
  END IF;

  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con
               JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
               WHERE con.conrelid = v_table AND con.contype = 'u'
                 AND con.conname = 'issue_reports_reference_key'
                 AND pg_catalog.array_length(con.conkey, 1) = 1
                 AND att.attname = 'reference');
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports post-condition 7: the reference is not unique under issue_reports_reference_key so nothing was applied';
  END IF;

  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con WHERE con.conrelid = v_table AND con.contype = 'c');
  IF v_count <> 11 THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports post-condition 8: the table does not have exactly eleven CHECK constraints so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con
               WHERE con.conrelid = v_table AND con.contype = 'c'
                 AND con.conname IN ('issue_reports_reference_format', 'issue_reports_message_length',
                                     'issue_reports_category_hint_check', 'issue_reports_page_shape',
                                     'issue_reports_area_shape', 'issue_reports_environment_shape',
                                     'issue_reports_status_check', 'issue_reports_closed_reason_check',
                                     'issue_reports_closed_shape', 'issue_reports_context_shape',
                                     'issue_reports_screenshot_path_shape'));
  IF v_count <> 11 THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports post-condition 8: a named CHECK constraint is missing so nothing was applied';
  END IF;

  v_count := (SELECT count(*) FROM pg_catalog.pg_indexes AS idx
               WHERE idx.schemaname = 'public' AND idx.tablename = 'issue_reports'
                 AND idx.indexname = 'issue_reports_user_created'
                 AND idx.indexdef LIKE '%(user_id, created_at DESC)');
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports post-condition 9: the per-user index is missing or has another shape so nothing was applied';
  END IF;

  v_count := (SELECT count(*) FROM pg_catalog.pg_trigger AS trg WHERE trg.tgrelid = v_table AND NOT trg.tgisinternal);
  IF v_count <> 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Issue reports post-condition 10: the table has a trigger so nothing was applied';
  END IF;
END
$post_condition$;

NOTIFY pgrst, 'reload schema';

COMMIT;
