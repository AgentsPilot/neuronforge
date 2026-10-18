-- DE-10b.1 pre-check, step 1 of the PROD apply (workplan section 8). Read-only. Run the whole file in the SQL editor
-- Every row must say ok. Any FAIL row stops the apply: paste the output back to TL and apply nothing
-- It proves that 20261077 is the live cleanup function, that 20261080 and 20261081 are not applied yet,
-- and that the auth schema and the grants the anonymise relies on are as reviewed (SQL-W2, W4, W5, G-11, G-20, G-21)
WITH
auth_users_columns AS (
  SELECT needed.column_name
  FROM (VALUES ('email'), ('phone'), ('encrypted_password'), ('raw_user_meta_data'), ('raw_app_meta_data'), ('banned_until'),
    ('confirmation_token'), ('recovery_token'), ('email_change_token_new'), ('email_change_token_current'),
    ('phone_change_token'), ('reauthentication_token'), ('email_change'), ('phone_change')) AS needed(column_name)
),
closure AS (
  SELECT closure_values.table_name, closure_values.key_column, closure_values.action
  FROM (VALUES
    ('identities', 'user_id', 'delete'), ('sessions', 'user_id', 'delete'), ('refresh_tokens', 'user_id', 'delete'),
    ('mfa_amr_claims', 'session_id', 'via_sessions'), ('mfa_factors', 'user_id', 'delete'), ('mfa_challenges', 'factor_id', 'via_factors'),
    ('mfa_recovery_code_sets', 'user_id', 'delete'), ('one_time_tokens', 'user_id', 'delete'), ('oauth_authorizations', 'user_id', 'delete'),
    ('oauth_consents', 'user_id', 'delete'), ('webauthn_credentials', 'user_id', 'delete'), ('webauthn_challenges', 'user_id', 'delete'),
    ('flow_state', 'user_id', 'delete'), ('scim_users', NULL, 'must_be_empty')
  ) AS closure_values(table_name, key_column, action)
),
blanks AS (
  SELECT blank_values.table_name, blank_values.column_name, blank_values.needs_jsonb
  FROM (VALUES
    ('business_os_billing_accounts', 'action_required_invoice_url', false), ('business_os_billing_accounts', 'open_checkout_session_id', false),
    ('business_os_boost_purchases', 'receipt_url', false), ('business_os_credit_lots', 'reason', false), ('business_os_credit_lot_draws', 'reason', false),
    ('user_subscriptions', 'payment_method_last4', false), ('user_subscriptions', 'payment_method_brand', false), ('user_subscriptions', 'last_calculator_inputs', false),
    ('credit_transactions', 'description', false), ('credit_transactions', 'metadata', true),
    ('billing_events', 'payload', true), ('billing_events', 'error_message', false),
    ('token_usage', 'error_message', false), ('token_usage', 'request_payload', false), ('token_usage', 'response_metadata', false), ('token_usage', 'metadata', true),
    ('subscription_invoices', 'stripe_invoice_pdf', false), ('subscription_invoices', 'stripe_hosted_invoice_url', false), ('subscription_invoices', 'metadata', true),
    ('user_rewards', 'metadata', true),
    ('business_os_invites', 'email', false), ('business_os_invites', 'personal_note', false), ('business_os_invites', 'email_problem_detail', false),
    ('business_os_invites', 'redemption_error_message', false), ('business_os_invites', 'redeemed_account_id', false), ('business_os_invites', 'claimed_account_id', false)
  ) AS blank_values(table_name, column_name, needs_jsonb)
),
checks AS (
  SELECT 1 AS ord, 'the live cleanup function is the 6 argument one of 20261077 (stamp b78b4579fc6631f8)' AS check_name,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text)')
        AND position('b78b4579fc6631f8' in p.prosrc) > 0
    ) AS passed, '' AS detail
  UNION ALL
  SELECT 2, 'the 8 argument function of 20261081 is not applied yet',
    pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)') IS NULL, ''
  UNION ALL
  SELECT 3, 'public.business_os_deletion_receipts does not exist yet (20261080 not applied)',
    pg_catalog.to_regclass('public.business_os_deletion_receipts') IS NULL, ''
  UNION ALL
  SELECT 4, 'anon and authenticated may not create objects in schema public',
    NOT pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') AND NOT pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE'), ''
  UNION ALL
  SELECT 5, 'gen_random_uuid is available', pg_catalog.to_regprocedure('pg_catalog.gen_random_uuid()') IS NOT NULL, ''
  UNION ALL
  SELECT 6, 'every auth.users column the closure writes exists (G-20)',
    NOT EXISTS (
      SELECT 1 FROM auth_users_columns AS needed
      WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns AS cols
        WHERE cols.table_schema = 'auth' AND cols.table_name = 'users' AND cols.column_name = needed.column_name)
    ),
    coalesce((SELECT string_agg(needed.column_name, ', ') FROM auth_users_columns AS needed
      WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns AS cols
        WHERE cols.table_schema = 'auth' AND cols.table_name = 'users' AND cols.column_name = needed.column_name)), '')
  UNION ALL
  SELECT 7, 'auth.audit_log_entries exists with its payload column (W-4)',
    EXISTS (SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = 'auth' AND cols.table_name = 'audit_log_entries' AND cols.column_name = 'payload'), ''
  UNION ALL
  SELECT 8, 'every closure table that exists has its key column (G-20)',
    NOT EXISTS (
      SELECT 1 FROM closure
      WHERE closure.key_column IS NOT NULL AND pg_catalog.to_regclass(format('auth.%I', closure.table_name)) IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns AS cols
          WHERE cols.table_schema = 'auth' AND cols.table_name = closure.table_name AND cols.column_name = closure.key_column)
    ),
    coalesce((SELECT string_agg(closure.table_name || '.' || closure.key_column, ', ') FROM closure
      WHERE closure.key_column IS NOT NULL AND pg_catalog.to_regclass(format('auth.%I', closure.table_name)) IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns AS cols
          WHERE cols.table_schema = 'auth' AND cols.table_name = closure.table_name AND cols.column_name = closure.key_column)), '')
  UNION ALL
  SELECT 9, 'which closure tables exist on this project (information only, never FAIL)', true,
    coalesce((SELECT string_agg(closure.table_name, ', ' ORDER BY closure.table_name) FROM closure
      WHERE pg_catalog.to_regclass(format('auth.%I', closure.table_name)) IS NOT NULL), '')
  UNION ALL
  SELECT 10, 'no auth table links to the login or a session without being on the closure list (G-20)',
    NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint AS con
      JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
      JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
      WHERE con.contype = 'f' AND nsp.nspname = 'auth'
        AND con.confrelid IN (SELECT pg_catalog.to_regclass('auth.users') UNION ALL SELECT pg_catalog.to_regclass('auth.sessions'))
        AND rel.relname::text NOT IN (SELECT closure.table_name FROM closure)
    ),
    coalesce((SELECT string_agg(DISTINCT rel.relname::text, ', ') FROM pg_catalog.pg_constraint AS con
      JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
      JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
      WHERE con.contype = 'f' AND nsp.nspname = 'auth'
        AND con.confrelid IN (SELECT pg_catalog.to_regclass('auth.users') UNION ALL SELECT pg_catalog.to_regclass('auth.sessions'))
        AND rel.relname::text NOT IN (SELECT closure.table_name FROM closure)), '')
  UNION ALL
  SELECT 11, 'no auth table has a user_id column without being on the closure list (W-5)',
    NOT EXISTS (SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = 'auth' AND cols.column_name = 'user_id' AND cols.table_name::text NOT IN (SELECT closure.table_name FROM closure)),
    coalesce((SELECT string_agg(cols.table_name::text, ', ') FROM information_schema.columns AS cols
      WHERE cols.table_schema = 'auth' AND cols.column_name = 'user_id' AND cols.table_name::text NOT IN (SELECT closure.table_name FROM closure)), '')
  UNION ALL
  SELECT 12, 'postgres may change auth.users and remove rows of every closure table and the auth log (SQL-W4)',
    pg_catalog.has_table_privilege('postgres', 'auth.users', 'UPDATE')
    AND pg_catalog.has_table_privilege('postgres', 'auth.audit_log_entries', 'DELETE')
    AND NOT EXISTS (SELECT 1 FROM closure
      WHERE closure.action = 'delete' AND pg_catalog.to_regclass(format('auth.%I', closure.table_name)) IS NOT NULL
        AND NOT pg_catalog.has_table_privilege('postgres', format('auth.%I', closure.table_name), 'DELETE')), ''
  UNION ALL
  SELECT 13, 'every column the anonymise blanks exists, jsonb where it must be (G-11)',
    NOT EXISTS (
      SELECT 1 FROM blanks
      WHERE pg_catalog.to_regclass(format('public.%I', blanks.table_name)) IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns AS cols
          WHERE cols.table_schema = 'public' AND cols.table_name = blanks.table_name AND cols.column_name = blanks.column_name
            AND (NOT blanks.needs_jsonb OR cols.data_type = 'jsonb'))
    ),
    coalesce((SELECT string_agg(blanks.table_name || '.' || blanks.column_name, ', ') FROM blanks
      WHERE pg_catalog.to_regclass(format('public.%I', blanks.table_name)) IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns AS cols
          WHERE cols.table_schema = 'public' AND cols.table_name = blanks.table_name AND cols.column_name = blanks.column_name
            AND (NOT blanks.needs_jsonb OR cols.data_type = 'jsonb'))), '')
  UNION ALL
  SELECT 14, 'no update trigger on auth.users or a blanked table except the two reviewed ones (G-21)',
    NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger AS trg
      JOIN pg_catalog.pg_class AS rel ON rel.oid = trg.tgrelid
      JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
      WHERE NOT trg.tgisinternal AND (trg.tgtype::integer & 16) <> 0
        AND ((nsp.nspname = 'auth' AND rel.relname = 'users') OR (nsp.nspname = 'public' AND rel.relname::text IN (SELECT DISTINCT blanks.table_name FROM blanks)))
        AND (rel.relname::text, trg.tgname::text) NOT IN (VALUES ('token_usage', 'update_token_usage_updated_at'), ('user_subscriptions', 'trigger_update_user_subscriptions_updated_at'))
    ),
    coalesce((SELECT string_agg(nsp.nspname || '.' || rel.relname || '.' || trg.tgname, ', ') FROM pg_catalog.pg_trigger AS trg
      JOIN pg_catalog.pg_class AS rel ON rel.oid = trg.tgrelid
      JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
      WHERE NOT trg.tgisinternal AND (trg.tgtype::integer & 16) <> 0
        AND ((nsp.nspname = 'auth' AND rel.relname = 'users') OR (nsp.nspname = 'public' AND rel.relname::text IN (SELECT DISTINCT blanks.table_name FROM blanks)))
        AND (rel.relname::text, trg.tgname::text) NOT IN (VALUES ('token_usage', 'update_token_usage_updated_at'), ('user_subscriptions', 'trigger_update_user_subscriptions_updated_at'))), '')
)
SELECT checks.ord, checks.check_name, CASE WHEN checks.passed THEN 'ok' ELSE 'FAIL' END AS status, checks.detail
FROM checks
ORDER BY checks.ord;
