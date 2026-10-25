-- 20261093_business_os_account_closures. Account deletion lifecycle DL-1a, the closure request storage
-- Requirement docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md XC-1 and XC-1a, XC-2, XC-3, XC-4, XC-21
-- Workplan docs/workplans/BUSINESS_OS_DELETION_DL1A_WORKPLAN.md section 4 with SA Workplan Review 2026-10-25 W-2, W-3, W-6, W-13
-- Creates the table public.business_os_account_closures, one row per deletion request of an account
-- Creates the claim function public.business_os_account_closures_claim_due for the lifecycle job
-- The claim runs with the rights of its caller and is for service_role only. The lease of 90 seconds is a literal
-- in its predicate, so a row claimed longer ago is claimable again and no separate reaper exists
-- That is a ruled deviation from the durable-queue-drain skill steps 2 and 3, SA Workplan Review 2026-10-25 O-4
-- Creates the session cut function public.business_os_account_closure_cut_sessions, which ends the sign in sessions
-- of ONE account at its lock. It runs with its owner rights, owner postgres, and refuses with 42501 unless that
-- account has a locked closure row or a grace row whose lock time has passed (SA W-3). XC-21 rules it a rule 7 exception
-- The session cut is one block plus post-condition 7. If the GoTrue spike of workplan section 3 rules it out, remove
-- exactly that block, post-condition 7, its rollback line and its checker rows. Nothing else depends on it
-- The table has RLS on and no policy. Browser roles hold nothing. service_role holds SELECT, INSERT, UPDATE and DELETE
-- There is no closed status. At stage E the engine deletes the row in its own transaction (SA W-6, XC-1a)
-- Apply BEFORE 20261094_operator_test_account_cleanup_account_closures, in the same sitting. From this apply until the
-- 20261094 build is live, every test account check and delete refuses on G-10, because the live 20261092 function has
-- not reviewed the new link to the login. That fails closed (SA F-A)
-- Pre-check scripts/precheck-account-closures.sql. Checker scripts/check-account-closures-migration.sql
-- Rollback supabase/SQL Scripts/20261093_business_os_account_closures_rollback.sql, run only after the 20261094 rollback
-- The whole file is one transaction. A failed pre-guard or post-condition applies nothing

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $pre_guard$
BEGIN
  IF pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') OR pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures migration refused: anon or authenticated may create objects in schema public. Nothing was applied';
  END IF;
  IF pg_catalog.to_regclass('public.business_os_account_closures') IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures migration refused: table public.business_os_account_closures already exists. Nothing was applied';
  END IF;
  IF pg_catalog.to_regprocedure('public.business_os_account_closures_claim_due(uuid, integer)') IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures migration refused: the claim function already exists. Nothing was applied';
  END IF;
  IF pg_catalog.to_regprocedure('public.business_os_account_closure_cut_sessions(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures migration refused: the session cut function already exists. Nothing was applied';
  END IF;
  IF pg_catalog.to_regclass('auth.sessions') IS NULL OR pg_catalog.to_regclass('auth.refresh_tokens') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures migration refused: auth.sessions or auth.refresh_tokens is missing. Nothing was applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
                  WHERE att.attrelid = pg_catalog.to_regclass('auth.sessions') AND att.attname = 'user_id'
                    AND NOT att.attisdropped AND att.atttypid = 'uuid'::regtype) THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures migration refused: auth.sessions.user_id is not uuid. Nothing was applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS att
                  WHERE att.attrelid = pg_catalog.to_regclass('auth.refresh_tokens') AND att.attname = 'user_id'
                    AND NOT att.attisdropped AND att.atttypid IN ('text'::regtype, 'varchar'::regtype)) THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures migration refused: auth.refresh_tokens.user_id is not text or varchar, so the session cut would compare wrongly. Nothing was applied';
  END IF;
  IF NOT pg_catalog.has_table_privilege('postgres', 'auth.sessions', 'DELETE') OR NOT pg_catalog.has_table_privilege('postgres', 'auth.refresh_tokens', 'DELETE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures migration refused: postgres may not remove rows from auth.sessions or auth.refresh_tokens. Nothing was applied';
  END IF;
END
$pre_guard$;

CREATE TABLE public.business_os_account_closures (
  id                             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                        uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  status                         text        NOT NULL DEFAULT 'requesting',
  requested_at                   timestamptz NOT NULL DEFAULT now(),
  statement_language             text        NOT NULL,
  reason_code                    text        NOT NULL,
  renewal_was_on                 boolean     NOT NULL,
  plan_ends_at                   timestamptz NULL,
  grace_starts_at                timestamptz NULL,
  lock_at                        timestamptz NULL,
  lock_timezone                  text        NULL,
  locked_at                      timestamptz NULL,
  blocked_at                     timestamptz NULL,
  blocked_codes                  text[]      NOT NULL DEFAULT '{}'::text[],
  kept_at                        timestamptz NULL,
  kept_source                    text        NULL,
  requested_email_sent_at        timestamptz NULL,
  grace_email_sent_at            timestamptz NULL,
  reminder_email_sent_at         timestamptz NULL,
  blocked_email_sent_at          timestamptz NULL,
  closed_email_sent_at           timestamptz NULL,
  kept_email_sent_at             timestamptz NULL,
  closed_email_attempts          integer     NOT NULL DEFAULT 0,
  closed_email_first_attempt_at  timestamptz NULL,
  claimed_by                     uuid        NULL,
  claimed_at                     timestamptz NULL,
  attempts                       integer     NOT NULL DEFAULT 0,
  next_check_at                  timestamptz NULL,
  last_error_code                text        NULL,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT business_os_account_closures_status_check
    CHECK (status IN ('requesting', 'pending', 'grace', 'locked', 'kept')),
  CONSTRAINT business_os_account_closures_language_check
    CHECK (statement_language IN ('en', 'he', 'es')),
  CONSTRAINT business_os_account_closures_reason_shape
    CHECK (reason_code ~ '^[a-z][a-z0-9_]{1,39}$'),
  CONSTRAINT business_os_account_closures_kept_source_check
    CHECK (kept_source IS NULL OR kept_source IN ('owner', 'admin', 'stripe')),
  CONSTRAINT business_os_account_closures_kept_shape
    CHECK ((status = 'kept') = (kept_source IS NOT NULL) AND (status = 'kept') = (kept_at IS NOT NULL)),
  CONSTRAINT business_os_account_closures_grace_shape
    CHECK (status NOT IN ('grace', 'locked') OR (grace_starts_at IS NOT NULL AND lock_at IS NOT NULL)),
  CONSTRAINT business_os_account_closures_locked_shape
    CHECK (status <> 'locked' OR locked_at IS NOT NULL),
  CONSTRAINT business_os_account_closures_claim_shape
    CHECK ((claimed_by IS NULL) = (claimed_at IS NULL)),
  CONSTRAINT business_os_account_closures_blocked_codes_shape
    CHECK (cardinality(blocked_codes) <= 20
           AND array_position(blocked_codes, NULL) IS NULL
           AND array_position(blocked_codes, '') IS NULL
           AND cardinality(string_to_array(array_to_string(blocked_codes, ','), ',')) = cardinality(blocked_codes)
           AND array_to_string(blocked_codes, ',') ~ '^(([A-Z]-[0-9]{1,2}[a-z]?|[a-z_]{1,40})(,|$))*$'),
  CONSTRAINT business_os_account_closures_lock_timezone_length
    CHECK (lock_timezone IS NULL OR char_length(lock_timezone) <= 64),
  CONSTRAINT business_os_account_closures_error_code_length
    CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 64),
  CONSTRAINT business_os_account_closures_counts_check
    CHECK (attempts >= 0 AND closed_email_attempts >= 0)
);

CREATE UNIQUE INDEX business_os_account_closures_one_open
  ON public.business_os_account_closures (user_id)
  WHERE status IN ('requesting', 'pending', 'grace', 'locked');

CREATE INDEX business_os_account_closures_claimable
  ON public.business_os_account_closures (next_check_at)
  WHERE status IN ('requesting', 'pending', 'grace');

CREATE INDEX business_os_account_closures_user
  ON public.business_os_account_closures (user_id, created_at DESC);

ALTER TABLE public.business_os_account_closures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_os_account_closures FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_os_account_closures TO service_role;

CREATE FUNCTION public.business_os_account_closures_claim_due(p_runner uuid, p_batch integer)
RETURNS SETOF public.business_os_account_closures
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $claim$
  WITH due AS (
    SELECT c.id FROM public.business_os_account_closures AS c
     WHERE p_runner IS NOT NULL
       AND c.status IN ('requesting', 'pending', 'grace')
       AND (c.status <> 'requesting' OR c.requested_at < now() - interval '15 minutes')
       AND (c.next_check_at IS NULL OR c.next_check_at <= now())
       AND (c.claimed_at IS NULL OR c.claimed_at < now() - interval '90 seconds')
     ORDER BY c.next_check_at NULLS FIRST, c.requested_at
     LIMIT LEAST(GREATEST(coalesce(p_batch, 1), 1), 100)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.business_os_account_closures AS c
     SET claimed_by = p_runner, claimed_at = now(), attempts = c.attempts + 1, updated_at = now()
    FROM due
   WHERE c.id = due.id
  RETURNING c.*;
$claim$;

REVOKE ALL ON FUNCTION public.business_os_account_closures_claim_due(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.business_os_account_closures_claim_due(uuid, integer) TO service_role;

CREATE FUNCTION public.business_os_account_closure_cut_sessions(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $cut$
DECLARE
  v_sessions bigint := 0;
  v_tokens   bigint := 0;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.business_os_account_closures AS c
     WHERE c.user_id = p_user_id
       AND (c.status = 'locked' OR (c.status = 'grace' AND c.lock_at <= now()))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'account closure session cut: the account is not at its lock';
  END IF;

  DELETE FROM auth.sessions AS s WHERE s.user_id = p_user_id;
  GET DIAGNOSTICS v_sessions = ROW_COUNT;

  DELETE FROM auth.refresh_tokens AS t WHERE t.user_id = p_user_id::text;
  GET DIAGNOSTICS v_tokens = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object('sessions', v_sessions, 'refresh_tokens', v_tokens);
END;
$cut$;

ALTER FUNCTION public.business_os_account_closure_cut_sessions(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.business_os_account_closure_cut_sessions(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.business_os_account_closure_cut_sessions(uuid) TO service_role;

DO $post_condition$
DECLARE
  v_table     regclass;
  v_function  regprocedure;
  v_role      text;
  v_privilege text;
  v_count     bigint;
BEGIN
  v_table := pg_catalog.to_regclass('public.business_os_account_closures');
  IF v_table IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures post-condition 1: the table is missing so nothing was applied';
  END IF;
  IF NOT (SELECT cls.relrowsecurity FROM pg_catalog.pg_class AS cls WHERE cls.oid = v_table) THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures post-condition 1: row level security is off so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_policies AS pol
               WHERE pol.schemaname = 'public' AND pol.tablename = 'business_os_account_closures');
  IF v_count <> 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures post-condition 1: the table has a policy so nothing was applied';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['public', 'anon', 'authenticated']
  LOOP
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
    LOOP
      IF pg_catalog.has_table_privilege(v_role, v_table, v_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Account closures post-condition 2: ' || v_role || ' holds table ' || v_privilege || ' so nothing was applied';
      END IF;
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']
    LOOP
      IF pg_catalog.has_any_column_privilege(v_role, v_table, v_privilege) THEN
        RAISE EXCEPTION USING MESSAGE = 'Account closures post-condition 2: ' || v_role || ' holds column ' || v_privilege || ' so nothing was applied';
      END IF;
    END LOOP;
  END LOOP;

  FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
  LOOP
    IF NOT pg_catalog.has_table_privilege('service_role', v_table, v_privilege) THEN
      RAISE EXCEPTION USING MESSAGE = 'Account closures post-condition 3: service_role lacks ' || v_privilege || ' so nothing was applied';
    END IF;
  END LOOP;
  FOREACH v_privilege IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER']
  LOOP
    IF pg_catalog.has_table_privilege('service_role', v_table, v_privilege) THEN
      RAISE EXCEPTION USING MESSAGE = 'Account closures post-condition 3: service_role holds ' || v_privilege || ' so nothing was applied';
    END IF;
  END LOOP;

  v_count := (SELECT count(*) FROM pg_catalog.pg_indexes AS idx
               JOIN pg_catalog.pg_class AS ic ON ic.relname = idx.indexname
               JOIN pg_catalog.pg_namespace AS ns ON ns.oid = ic.relnamespace AND ns.nspname = idx.schemaname
               JOIN pg_catalog.pg_index AS ix ON ix.indexrelid = ic.oid
               WHERE idx.schemaname = 'public'
                 AND idx.indexname = 'business_os_account_closures_one_open'
                 AND ix.indisunique
                 AND idx.indexdef LIKE '%(user_id) WHERE (status = ANY (ARRAY[''requesting''::text, ''pending''::text, ''grace''::text, ''locked''::text]))');
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures post-condition 4: the one-open unique index is missing or has another predicate so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_indexes AS idx
               WHERE idx.schemaname = 'public' AND idx.tablename = 'business_os_account_closures'
                 AND idx.indexname IN ('business_os_account_closures_claimable', 'business_os_account_closures_user'));
  IF v_count <> 2 THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures post-condition 4: the claimable or the per-user index is missing so nothing was applied';
  END IF;

  v_count := (SELECT count(*) FROM pg_catalog.pg_trigger AS trg WHERE trg.tgrelid = v_table AND NOT trg.tgisinternal);
  IF v_count <> 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures post-condition 5: the table has a trigger so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con WHERE con.conrelid = v_table AND con.contype = 'f');
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures post-condition 5: the table does not have exactly one foreign key so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con
               JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
               WHERE con.conrelid = v_table AND con.contype = 'f'
                 AND con.confrelid = pg_catalog.to_regclass('auth.users')
                 AND con.confdeltype = 'c'
                 AND pg_catalog.array_length(con.conkey, 1) = 1
                 AND att.attname = 'user_id');
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures post-condition 5: the foreign key is not user_id to auth.users on delete cascade so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_constraint AS con WHERE con.confrelid = v_table AND con.contype = 'f');
  IF v_count <> 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures post-condition 5: a foreign key points at the table so nothing was applied';
  END IF;

  v_function := pg_catalog.to_regprocedure('public.business_os_account_closures_claim_due(uuid, integer)');
  IF v_function IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures post-condition 6: the claim function is missing so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_proc AS fn
               WHERE fn.oid = v_function
                 AND NOT fn.prosecdef
                 AND fn.provolatile = 'v'
                 AND fn.proacl IS NOT NULL
                 AND fn.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
                 AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(fn.proacl) AS acl WHERE acl.grantee = 0));
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures post-condition 6: the claim function is not invoker, not volatile, lacks its search_path or is open to PUBLIC so nothing was applied';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures post-condition 6: claim EXECUTE is not service_role only so nothing was applied';
  END IF;

  v_function := pg_catalog.to_regprocedure('public.business_os_account_closure_cut_sessions(uuid)');
  IF v_function IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures post-condition 7: the session cut function is missing so nothing was applied';
  END IF;
  v_count := (SELECT count(*) FROM pg_catalog.pg_proc AS fn
               WHERE fn.oid = v_function
                 AND fn.prosecdef
                 AND fn.provolatile = 'v'
                 AND fn.proowner = (SELECT r.oid FROM pg_catalog.pg_roles AS r WHERE r.rolname = 'postgres')
                 AND fn.proacl IS NOT NULL
                 AND fn.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']::text[]
                 AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(fn.proacl) AS acl WHERE acl.grantee = 0));
  IF v_count <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures post-condition 7: the session cut function does not run with its owner rights as postgres, is not volatile, lacks its search_path or is open to PUBLIC so nothing was applied';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION USING MESSAGE = 'Account closures post-condition 7: session cut EXECUTE is not service_role only so nothing was applied';
  END IF;
END
$post_condition$;

NOTIFY pgrst, 'reload schema';

COMMIT;
