-- Rollback of supabase/migrations/20261096_operator_test_account_cleanup_export_requests.sql. GENERATED, never edit by hand.
-- Drops this function first, so no two overloads stay live (SA W-3)
-- Then restores the function exactly as supabase/migrations/20261094_operator_test_account_cleanup_account_closures.sql created it, with its grants. Keeps the schema, the secret table and the stored hash
-- Then redeploy an app build that pins the version stamp of 20261094_operator_test_account_cleanup_account_closures, or the Danger Zone check and delete refuse
-- The restored 20261094 function does not remove export history rows
-- While the tables of 20261095 exist, G-10 of the restored function refuses every check and delete on their links to the login
-- A full restore is this file, then the 20261095 rollback, then the PR revert
-- Closed accounts and receipts already made stay as they are. Nothing can restore them
-- The receipt table of 20261080 stays. Its own rollback refuses once any receipt exists
-- To remove the whole feature instead, also run supabase/SQL Scripts/20261041_operator_test_account_cleanup_rollback.sql afterwards
-- The whole file is one transaction

BEGIN;

DROP FUNCTION IF EXISTS public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.operator_test_account_cleanup(p_mode text, p_email text, p_tag text, p_confirm text, p_actor uuid, p_secret text, p_subject uuid DEFAULT NULL, p_receipt jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $operator_cleanup$
DECLARE
  v_result jsonb;
  v_report jsonb := '{}'::jsonb;
  v_receipt_id uuid := pg_catalog.gen_random_uuid();
  v_receipt_mode text;
  v_receipt_ref text;
  v_subject_id uuid;
  v_removed_rows bigint := 0;
  v_removed_tables integer := 0;
  v_blanked_rows bigint := 0;
BEGIN
  IF p_secret IS NULL OR pg_catalog.length(p_secret) < 32 OR NOT EXISTS (
    SELECT 1 FROM operator_private.secrets AS stored
    WHERE stored.name = 'test_account_cleanup'
      AND stored.secret_sha256 = pg_catalog.sha256(pg_catalog.convert_to(p_secret, 'UTF8'))
  ) THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('check', 'delete', 'anonymise_check', 'anonymise') THEN
    RAISE EXCEPTION 'unknown mode' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'delete' AND p_actor IS NULL THEN
    RAISE EXCEPTION 'a delete needs the admin id' USING ERRCODE = '22023';
  END IF;
  IF p_mode IN ('delete', 'anonymise') AND (p_receipt IS NULL OR pg_catalog.jsonb_typeof(p_receipt) IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'a delete needs the receipt' USING ERRCODE = '22023';
  END IF;
  IF p_mode IN ('anonymise_check', 'anonymise') AND p_subject IS NULL THEN
    RAISE EXCEPTION 'an anonymise needs the account id' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'anonymise' AND p_actor IS NULL AND (p_receipt ->> 'origin') IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'an anonymise needs the admin id unless the owner asked' USING ERRCODE = '22023';
  END IF;
  IF p_mode IN ('delete', 'anonymise') THEN
    IF (p_receipt ->> 'origin') IS NULL OR (p_receipt ->> 'origin') NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'the receipt has no known origin' USING ERRCODE = '22023';
    END IF;
    IF ((p_receipt ->> 'origin') = 'owner') IS DISTINCT FROM ((p_receipt ->> 'executor_kind') = 'self_service') THEN
      RAISE EXCEPTION 'the receipt origin and executor disagree' USING ERRCODE = '22023';
    END IF;
    IF (p_receipt ->> 'origin') = 'owner' AND p_actor IS NOT NULL THEN
      RAISE EXCEPTION 'an owner deletion has no admin id' USING ERRCODE = '22023';
    END IF;
    IF (p_receipt ->> 'origin') = 'admin' AND p_actor IS NULL THEN
      RAISE EXCEPTION 'an admin deletion needs the admin id' USING ERRCODE = '22023';
    END IF;
    IF p_mode = 'delete' AND (p_receipt ->> 'origin') <> 'admin' THEN
      RAISE EXCEPTION 'a full delete is for admins only' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_mode IN ('check', 'anonymise_check') THEN
    PERFORM pg_catalog.set_config('transaction_read_only', 'on', true);
  END IF;
  PERFORM pg_catalog.set_config('cleanup.target_email', coalesce(p_email, ''), true);
  PERFORM pg_catalog.set_config('cleanup.test_tag', CASE WHEN p_mode IN ('check', 'delete') THEN coalesce(p_tag, '') ELSE '' END, true);
  PERFORM pg_catalog.set_config('cleanup.confirm_email', CASE WHEN p_mode IN ('delete', 'anonymise') THEN coalesce(p_confirm, '') ELSE '' END, true);
  PERFORM pg_catalog.set_config('cleanup.actor_id', CASE WHEN p_mode IN ('delete', 'anonymise') THEN coalesce(p_actor::text, '') ELSE '' END, true);
  PERFORM pg_catalog.set_config('cleanup.source', CASE WHEN (p_receipt ->> 'origin') = 'owner' THEN 'self_service' ELSE 'admin_page' END, true);
  PERFORM pg_catalog.set_config('cleanup.subject_id', CASE WHEN p_mode IN ('anonymise_check', 'anonymise') THEN p_subject::text ELSE '' END, true);
  PERFORM pg_catalog.set_config('cleanup.mode', p_mode, true);
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);

  IF p_mode = 'check' THEN
    v_result := (
WITH
params AS (
  SELECT
    NULLIF(lower(btrim(coalesce(current_setting('cleanup.target_email', true), ''))), '') AS target_email,
    NULLIF(lower(btrim(coalesce(current_setting('cleanup.test_tag', true), ''))), '') AS test_tag
),
matches AS (
  SELECT users.id AS user_id
  FROM auth.users AS users
  JOIN params ON lower(users.email) = params.target_email
),
target AS (
  SELECT CASE WHEN (SELECT count(*) FROM matches) = 1 THEN (SELECT matches.user_id FROM matches LIMIT 1) END AS user_id
),
target_orgs AS (
  SELECT orgs.id AS org_id
  FROM public.organizations AS orgs
  JOIN target ON orgs.owner_user_id = target.user_id
),
plan AS (
  SELECT plan_values.ord, plan_values.step, plan_values.table_name, plan_values.key_column, plan_values.parent_table
  FROM (VALUES
    (1, 'A'::text, 'payment_reminders'::text, 'user_id'::text, NULL::text),
    (2, 'A', 'scheduling_meetings', 'user_id', NULL),
    (3, 'A', 'payment_plan_installments', 'user_id', NULL),
    (4, 'A', 'agent_logs', 'user_id', NULL),
    (5, 'A', 'insight_automations', 'user_id', NULL),
    (6, 'A', 'payment_plan_subscriptions', 'user_id', NULL),
    (7, 'A', 'payment_refunds', 'user_id', NULL),
    (8, 'A', 'agent_scheduler_state', 'agent_id', 'agents'),
    (9, 'A', 'abandoned_bookings', 'user_id', NULL),
    (10, 'A', 'agent_memories', 'user_id', NULL),
    (11, 'A', 'agent_memory', 'user_id', NULL),
    (12, 'A', 'agent_prompt_threads', 'user_id', NULL),
    (13, 'A', 'agent_prompt_workflow_generation_sessions', 'user_id', NULL),
    (14, 'A', 'archived_records', 'user_id', NULL),
    (15, 'A', 'audit_trail', 'user_id', NULL),
    (16, 'A', 'business_chat_action_log', 'user_id', NULL),
    (17, 'A', 'business_chat_conversation', 'user_id', NULL),
    (18, 'A', 'business_chat_plan_cache', 'user_id', NULL),
    (19, 'A', 'business_chat_saved_plans', 'user_id', NULL),
    (20, 'A', 'business_chat_verified_questions', 'user_id', NULL),
    (21, 'A', 'business_events', 'user_id', NULL),
    (22, 'A', 'business_health_summaries', 'user_id', NULL),
    (23, 'A', 'business_os_data_exports', 'user_id', NULL),
    (24, 'A', 'business_subscribers', 'user_id', NULL),
    (25, 'A', 'channel_metrics_daily', 'user_id', NULL),
    (26, 'A', 'command_sessions', 'user_id', NULL),
    (27, 'A', 'contact_documents', 'user_id', NULL),
    (28, 'A', 'crm_tasks', 'user_id', NULL),
    (29, 'A', 'daily_briefing_sends', 'user_id', NULL),
    (30, 'A', 'data_decision_requests', 'user_id', NULL),
    (31, 'A', 'derived_metrics', 'user_id', NULL),
    (32, 'A', 'email_sends', 'user_id', NULL),
    (33, 'A', 'email_sequence_enrollments', 'user_id', NULL),
    (34, 'A', 'email_sequence_steps', 'user_id', NULL),
    (35, 'A', 'external_calendar_events', 'user_id', NULL),
    (36, 'A', 'insight_actions', 'user_id', NULL),
    (37, 'A', 'insight_hypotheses', 'user_id', NULL),
    (38, 'A', 'insight_measurements', 'user_id', NULL),
    (39, 'A', 'kernel_action_log', 'user_id', NULL),
    (40, 'A', 'lead_responses', 'user_id', NULL),
    (41, 'A', 'onboarding_conversations', 'user_id', NULL),
    (42, 'A', 'onboarding_prompt_ideas', 'user_id', NULL),
    (43, 'A', 'owner_insight_history', 'user_id', NULL),
    (44, 'A', 'payment_automation_executions', 'user_id', NULL),
    (45, 'A', 'payment_events', 'user_id', NULL),
    (46, 'A', 'payment_methods', 'user_id', NULL),
    (47, 'A', 'proposals', 'user_id', NULL),
    (48, 'A', 'run_memories', 'user_id', NULL),
    (49, 'A', 'saved_payment_methods', 'user_id', NULL),
    (50, 'A', 'scheduling_availability_exceptions', 'user_id', NULL),
    (51, 'A', 'smart_link_clicks', 'smart_link_id', 'smart_links'),
    (52, 'A', 'user_media', 'user_id', NULL),
    (53, 'A', 'user_memory', 'user_id', NULL),
    (54, 'A', 'website_blocks', 'page_id', 'website_pages'),
    (55, 'A', 'website_content', 'user_id', NULL),
    (56, 'A', 'website_page_views', 'user_id', NULL),
    (57, 'A', 'scheduling_bookings', 'user_id', NULL),
    (58, 'A', 'agent_executions', 'user_id', NULL),
    (59, 'A', 'agents', 'user_id', NULL),
    (60, 'A', 'crm_contacts', 'user_id', NULL),
    (61, 'A', 'daily_briefings', 'user_id', NULL),
    (62, 'A', 'email_campaigns', 'user_id', NULL),
    (63, 'A', 'email_sequences', 'user_id', NULL),
    (64, 'A', 'insights', 'user_id', NULL),
    (65, 'A', 'kernel_executions', 'user_id', NULL),
    (66, 'A', 'payment_automation_rules', 'user_id', NULL),
    (67, 'A', 'payment_invoices', 'user_id', NULL),
    (68, 'A', 'payment_plans', 'user_id', NULL),
    (69, 'A', 'payment_transactions', 'user_id', NULL),
    (70, 'A', 'scheduling_services', 'user_id', NULL),
    (71, 'A', 'smart_links', 'user_id', NULL),
    (72, 'A', 'website_pages', 'user_id', NULL),
    (73, 'A', 'user_capability_blocks', 'user_capability_id', 'user_capabilities'),
    (74, 'A', 'business_addresses', 'user_id', NULL),
    (75, 'A', 'business_intake_forms', 'user_id', NULL),
    (76, 'A', 'channel_connections', 'user_id', NULL),
    (77, 'A', 'crm_pipeline_stages', 'user_id', NULL),
    (78, 'A', 'marketing_consent_settings', 'user_id', NULL),
    (79, 'A', 'payment_processors', 'user_id', NULL),
    (80, 'A', 'plugin_connections', 'user_id', NULL),
    (81, 'A', 'stripe_connect_accounts', 'user_id', NULL),
    (82, 'A', 'user_capabilities', 'user_id', NULL),
    (83, 'A', 'user_intake_settings', 'user_id', NULL),
    (84, 'A', 'crm_activities', 'user_id', NULL),
    (85, 'B', 'billing_events', 'user_id', NULL),
    (86, 'B', 'boost_pack_purchases', 'user_id', NULL),
    (87, 'B', 'user_rewards', 'user_id', NULL),
    (88, 'B', 'credit_transactions', 'user_id', NULL),
    (89, 'B', 'token_usage', 'user_id', NULL),
    (90, 'B', 'storage_usage', 'user_id', NULL),
    (91, 'B', 'user_subscriptions', 'user_id', NULL),
    (92, 'B', 'subscriptions', 'user_id', NULL),
    (93, 'B', 'subscription_invoices', 'user_id', NULL),
    (94, 'B', 'business_os_boost_purchases', 'user_id', NULL),
    (95, 'B', 'business_os_credit_lot_draws', 'user_id', NULL),
    (96, 'B', 'business_os_credit_lots', 'user_id', NULL),
    (97, 'B', 'business_os_credit_charges', 'user_id', NULL),
    (98, 'B', 'business_os_credit_totals', 'user_id', NULL),
    (99, 'B', 'business_os_billing_events', 'user_id', NULL),
    (100, 'B', 'business_os_billing_accounts', 'user_id', NULL),
    (101, 'B', 'business_os_boost_cap_overrides', 'user_id', NULL),
    (102, 'B', 'business_os_account_plans', 'user_id', NULL),
    (103, 'B', 'business_os_entitlement_overrides', 'user_id', NULL),
    (104, 'B', 'business_os_entitlement_shadow_events', 'user_id', NULL),
    (105, 'B', 'processed_webhook_events', 'user_id', NULL),
    (106, 'B', 'marketing_consent_state', 'user_id', NULL),
    (107, 'B', 'email_unsubscribes', 'user_id', NULL),
    (108, 'B', 'user_preferences', 'user_id', NULL),
    (109, 'B', 'notification_settings', 'user_id', NULL),
    (110, 'B', 'security_settings', 'user_id', NULL),
    (111, 'B', 'api_keys', 'user_id', NULL),
    (112, 'B', 'audit_logs', 'user_id', NULL),
    (113, 'B', 'auth_handoff_codes', 'user_id', NULL),
    (114, 'B', 'business_os_account_closures', 'user_id', NULL),
    (115, 'B', 'agent_configurations', 'user_id', NULL),
    (116, 'B', 'agent_execution_logs', 'user_id', NULL),
    (117, 'B', 'agent_intensity_metrics', 'user_id', NULL),
    (118, 'B', 'agent_stats', 'user_id', NULL),
    (119, 'B', 'agent_templates', 'user_id', NULL),
    (120, 'B', 'agentkit_analytics', 'user_id', NULL),
    (121, 'B', 'calibration_history', 'user_id', NULL),
    (122, 'B', 'calibration_sessions', 'user_id', NULL),
    (123, 'B', 'error_patterns', 'user_id', NULL),
    (124, 'B', 'execution_anomalies', 'user_id', NULL),
    (125, 'B', 'execution_baselines', 'user_id', NULL),
    (126, 'B', 'execution_insight_runs', 'user_id', NULL),
    (127, 'B', 'execution_insights', 'user_id', NULL),
    (128, 'B', 'pilot_step_routing_history', 'user_id', NULL),
    (129, 'B', 'plugin_performance', 'user_id', NULL),
    (130, 'B', 'shadow_failure_snapshots', 'user_id', NULL),
    (131, 'B', 'shared_agents', 'user_id', NULL),
    (132, 'B', 'workflow_executions', 'user_id', NULL),
    (133, 'B', 'advisor_reports', 'user_id', NULL),
    (134, 'B', 'automation_slas', 'user_id', NULL),
    (135, 'B', 'group_metrics_rollup', 'user_id', NULL),
    (136, 'B', 'metric_baselines', 'user_id', NULL),
    (137, 'B', 'organization_members', 'user_id', NULL),
    (138, 'C', 'business_profiles', 'user_id', NULL),
    (139, 'C', 'profiles', 'id', NULL),
    (140, 'C', 'organizations', 'owner_user_id', NULL),
    (141, 'C', 'business_os_account_lineage', 'account_id', NULL),
    (142, 'C', 'business_os_invites', 'issuer_account_id', NULL)
  ) AS plan_values(ord, step, table_name, key_column, parent_table)
),
plan_state AS (
  SELECT
    plan.*,
    to_regclass(format('public.%I', plan.table_name)) IS NOT NULL AS present,
    EXISTS (
      SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = 'public' AND cols.table_name = plan.table_name AND cols.column_name = plan.key_column
    ) AS key_ok,
    (plan.parent_table IS NULL OR EXISTS (
      SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = 'public' AND cols.table_name = plan.parent_table AND cols.column_name = 'user_id'
    )) AS parent_ok
  FROM plan
),
fk_catalog AS (
  SELECT
    nsp.nspname::text AS fk_schema,
    rel.relname::text AS fk_table,
    att.attname::text AS fk_column,
    cardinality(con.conkey) AS key_width
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND con.confrelid = 'auth.users'::regclass AND nsp.nspname <> 'auth'
),
fk_review AS (
  SELECT reviewed.fk_schema, reviewed.fk_table, reviewed.fk_column, reviewed.kind, reviewed.owner_column
  FROM (VALUES
    ('public'::text, 'abandoned_bookings'::text, 'user_id'::text, 'tenancy'::text, NULL::text),
    ('public', 'admin_users', 'user_id', 'tenancy', NULL),
    ('public', 'advisor_reports', 'user_id', 'tenancy', NULL),
    ('public', 'agent_configurations', 'user_id', 'tenancy', NULL),
    ('public', 'agent_execution_logs', 'user_id', 'tenancy', NULL),
    ('public', 'agent_executions', 'user_id', 'tenancy', NULL),
    ('public', 'agent_intensity_metrics', 'user_id', 'tenancy', NULL),
    ('public', 'agent_logs', 'user_id', 'tenancy', NULL),
    ('public', 'agent_memories', 'user_id', 'tenancy', NULL),
    ('public', 'agent_memory', 'user_id', 'tenancy', NULL),
    ('public', 'agent_prompt_threads', 'user_id', 'tenancy', NULL),
    ('public', 'agent_prompt_workflow_generation_sessions', 'user_id', 'tenancy', NULL),
    ('public', 'agent_stats', 'user_id', 'tenancy', NULL),
    ('public', 'agent_templates', 'user_id', 'tenancy', NULL),
    ('public', 'agentkit_analytics', 'user_id', 'tenancy', NULL),
    ('public', 'agents', 'user_id', 'tenancy', NULL),
    ('public', 'api_keys', 'user_id', 'tenancy', NULL),
    ('public', 'archived_records', 'user_id', 'tenancy', NULL),
    ('public', 'audit_logs', 'user_id', 'tenancy', NULL),
    ('public', 'audit_trail', 'user_id', 'tenancy', NULL),
    ('public', 'auth_handoff_codes', 'user_id', 'tenancy', NULL),
    ('public', 'automation_slas', 'user_id', 'tenancy', NULL),
    ('public', 'billing_events', 'user_id', 'tenancy', NULL),
    ('public', 'boost_pack_purchases', 'user_id', 'tenancy', NULL),
    ('public', 'business_addresses', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_action_log', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_conversation', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_plan_cache', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_saved_plans', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_verified_questions', 'user_id', 'tenancy', NULL),
    ('public', 'business_events', 'user_id', 'tenancy', NULL),
    ('public', 'business_health_summaries', 'user_id', 'tenancy', NULL),
    ('public', 'business_intake_forms', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_account_closures', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_account_lineage', 'account_id', 'tenancy', NULL),
    ('public', 'business_os_account_plans', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_billing_accounts', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_billing_events', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_boost_cap_overrides', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_boost_purchases', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_credit_charges', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_credit_lot_draws', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_credit_lots', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_credit_totals', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_data_exports', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_entitlement_overrides', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_entitlement_shadow_events', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_invites', 'issuer_account_id', 'tenancy', NULL),
    ('public', 'business_profiles', 'user_id', 'tenancy', NULL),
    ('public', 'business_subscribers', 'user_id', 'tenancy', NULL),
    ('public', 'calibration_history', 'user_id', 'tenancy', NULL),
    ('public', 'calibration_sessions', 'user_id', 'tenancy', NULL),
    ('public', 'channel_connections', 'user_id', 'tenancy', NULL),
    ('public', 'channel_metrics_daily', 'user_id', 'tenancy', NULL),
    ('public', 'command_sessions', 'user_id', 'tenancy', NULL),
    ('public', 'contact_documents', 'user_id', 'tenancy', NULL),
    ('public', 'credit_transactions', 'user_id', 'tenancy', NULL),
    ('public', 'crm_activities', 'user_id', 'tenancy', NULL),
    ('public', 'crm_contacts', 'user_id', 'tenancy', NULL),
    ('public', 'crm_pipeline_stages', 'user_id', 'tenancy', NULL),
    ('public', 'crm_tasks', 'user_id', 'tenancy', NULL),
    ('public', 'daily_briefing_sends', 'user_id', 'tenancy', NULL),
    ('public', 'daily_briefings', 'user_id', 'tenancy', NULL),
    ('public', 'data_decision_requests', 'user_id', 'tenancy', NULL),
    ('public', 'derived_metrics', 'user_id', 'tenancy', NULL),
    ('public', 'email_campaigns', 'user_id', 'tenancy', NULL),
    ('public', 'email_sends', 'user_id', 'tenancy', NULL),
    ('public', 'email_sequence_enrollments', 'user_id', 'tenancy', NULL),
    ('public', 'email_sequence_steps', 'user_id', 'tenancy', NULL),
    ('public', 'email_sequences', 'user_id', 'tenancy', NULL),
    ('public', 'email_unsubscribes', 'user_id', 'tenancy', NULL),
    ('public', 'error_patterns', 'user_id', 'tenancy', NULL),
    ('public', 'execution_anomalies', 'user_id', 'tenancy', NULL),
    ('public', 'execution_baselines', 'user_id', 'tenancy', NULL),
    ('public', 'execution_insight_runs', 'user_id', 'tenancy', NULL),
    ('public', 'execution_insights', 'user_id', 'tenancy', NULL),
    ('public', 'external_calendar_events', 'user_id', 'tenancy', NULL),
    ('public', 'group_metrics_rollup', 'user_id', 'tenancy', NULL),
    ('public', 'insight_actions', 'user_id', 'tenancy', NULL),
    ('public', 'insight_automations', 'user_id', 'tenancy', NULL),
    ('public', 'insight_hypotheses', 'user_id', 'tenancy', NULL),
    ('public', 'insight_measurements', 'user_id', 'tenancy', NULL),
    ('public', 'insights', 'user_id', 'tenancy', NULL),
    ('public', 'kernel_action_log', 'user_id', 'tenancy', NULL),
    ('public', 'kernel_executions', 'user_id', 'tenancy', NULL),
    ('public', 'lead_responses', 'user_id', 'tenancy', NULL),
    ('public', 'marketing_consent_events', 'user_id', 'tenancy', NULL),
    ('public', 'marketing_consent_settings', 'user_id', 'tenancy', NULL),
    ('public', 'marketing_consent_state', 'user_id', 'tenancy', NULL),
    ('public', 'metric_baselines', 'user_id', 'tenancy', NULL),
    ('public', 'notification_settings', 'user_id', 'tenancy', NULL),
    ('public', 'onboarding_conversations', 'user_id', 'tenancy', NULL),
    ('public', 'onboarding_prompt_ideas', 'user_id', 'tenancy', NULL),
    ('public', 'organization_members', 'user_id', 'tenancy', NULL),
    ('public', 'organizations', 'owner_user_id', 'tenancy', NULL),
    ('public', 'owner_insight_history', 'user_id', 'tenancy', NULL),
    ('public', 'payment_automation_executions', 'user_id', 'tenancy', NULL),
    ('public', 'payment_automation_rules', 'user_id', 'tenancy', NULL),
    ('public', 'payment_events', 'user_id', 'tenancy', NULL),
    ('public', 'payment_invoices', 'user_id', 'tenancy', NULL),
    ('public', 'payment_methods', 'user_id', 'tenancy', NULL),
    ('public', 'payment_plan_installments', 'user_id', 'tenancy', NULL),
    ('public', 'payment_plan_subscriptions', 'user_id', 'tenancy', NULL),
    ('public', 'payment_plans', 'user_id', 'tenancy', NULL),
    ('public', 'payment_processors', 'user_id', 'tenancy', NULL),
    ('public', 'payment_refunds', 'user_id', 'tenancy', NULL),
    ('public', 'payment_reminders', 'user_id', 'tenancy', NULL),
    ('public', 'payment_transactions', 'user_id', 'tenancy', NULL),
    ('public', 'pilot_step_routing_history', 'user_id', 'tenancy', NULL),
    ('public', 'plugin_connections', 'user_id', 'tenancy', NULL),
    ('public', 'plugin_performance', 'user_id', 'tenancy', NULL),
    ('public', 'processed_webhook_events', 'user_id', 'tenancy', NULL),
    ('public', 'profiles', 'id', 'tenancy', NULL),
    ('public', 'proposals', 'user_id', 'tenancy', NULL),
    ('public', 'run_memories', 'user_id', 'tenancy', NULL),
    ('public', 'saved_payment_methods', 'user_id', 'tenancy', NULL),
    ('public', 'scheduling_availability_exceptions', 'user_id', 'tenancy', NULL),
    ('public', 'scheduling_bookings', 'user_id', 'tenancy', NULL),
    ('public', 'scheduling_meetings', 'user_id', 'tenancy', NULL),
    ('public', 'scheduling_services', 'user_id', 'tenancy', NULL),
    ('public', 'security_settings', 'user_id', 'tenancy', NULL),
    ('public', 'shadow_failure_snapshots', 'user_id', 'tenancy', NULL),
    ('public', 'shared_agents', 'user_id', 'tenancy', NULL),
    ('public', 'smart_links', 'user_id', 'tenancy', NULL),
    ('public', 'storage_usage', 'user_id', 'tenancy', NULL),
    ('public', 'stripe_connect_accounts', 'user_id', 'tenancy', NULL),
    ('public', 'subscription_invoices', 'user_id', 'tenancy', NULL),
    ('public', 'subscriptions', 'user_id', 'tenancy', NULL),
    ('public', 'token_usage', 'user_id', 'tenancy', NULL),
    ('public', 'user_capabilities', 'user_id', 'tenancy', NULL),
    ('public', 'user_intake_settings', 'user_id', 'tenancy', NULL),
    ('public', 'user_media', 'user_id', 'tenancy', NULL),
    ('public', 'user_memory', 'user_id', 'tenancy', NULL),
    ('public', 'user_preferences', 'user_id', 'tenancy', NULL),
    ('public', 'user_rewards', 'user_id', 'tenancy', NULL),
    ('public', 'user_subscriptions', 'user_id', 'tenancy', NULL),
    ('public', 'website_content', 'user_id', 'tenancy', NULL),
    ('public', 'website_page_views', 'user_id', 'tenancy', NULL),
    ('public', 'website_pages', 'user_id', 'tenancy', NULL),
    ('public', 'workflow_executions', 'user_id', 'tenancy', NULL),
    ('public', 'admin_users', 'granted_by', 'actor', 'user_id'),
    ('public', 'ais_scoring_weights', 'updated_by', 'actor', NULL),
    ('public', 'ais_system_config', 'updated_by', 'actor', NULL),
    ('public', 'exchange_rate_history', 'changed_by', 'actor', NULL),
    ('public', 'exchange_rates', 'updated_by', 'actor', NULL),
    ('public', 'marketing_consent_events', 'recorded_by', 'actor', 'user_id'),
    ('public', 'shared_agent_imports', 'imported_by_user_id', 'actor', NULL),
    ('public', 'sla_events', 'acknowledged_by', 'actor', NULL),
    ('public', 'system_settings_config', 'updated_by', 'actor', NULL),
    ('storage', 'buckets', 'owner', 'actor', NULL),
    ('storage', 'objects', 'owner', 'actor', NULL)
  ) AS reviewed(fk_schema, fk_table, fk_column, kind, owner_column)
),
fk_rows AS (
  SELECT
    fk_catalog.fk_schema, fk_catalog.fk_table, fk_catalog.fk_column, fk_catalog.key_width, fk_review.kind,
    CASE
      WHEN target.user_id IS NULL OR fk_review.kind = 'tenancy' OR fk_catalog.key_width <> 1 THEN 0
      ELSE (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM %I.%I WHERE %I = %L AND %s', fk_catalog.fk_schema, fk_catalog.fk_table, fk_catalog.fk_column, target.user_id, CASE WHEN fk_review.owner_column IS NULL THEN 'true' ELSE format('%I IS DISTINCT FROM %L', fk_review.owner_column, target.user_id) END), false, true, '')))[1]::text::bigint
    END AS found
  FROM fk_catalog
  CROSS JOIN target
  LEFT JOIN fk_review USING (fk_schema, fk_table, fk_column)
),
inbound_catalog AS (
  SELECT
    con.conname::text AS fk_name,
    child_nsp.nspname::text AS child_schema,
    child_rel.relname::text AS child_table,
    child_att.attname::text AS child_column,
    parent_rel.relname::text AS parent_table,
    parent_att.attname::text AS parent_column,
    cardinality(con.conkey) AS key_width
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS child_rel ON child_rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS child_nsp ON child_nsp.oid = child_rel.relnamespace
  JOIN pg_catalog.pg_attribute AS child_att ON child_att.attrelid = con.conrelid AND child_att.attnum = con.conkey[1]
  JOIN pg_catalog.pg_class AS parent_rel ON parent_rel.oid = con.confrelid
  JOIN pg_catalog.pg_namespace AS parent_nsp ON parent_nsp.oid = parent_rel.relnamespace
  JOIN pg_catalog.pg_attribute AS parent_att ON parent_att.attrelid = con.confrelid AND parent_att.attnum = con.confkey[1]
  WHERE con.contype = 'f' AND parent_nsp.nspname = 'public' AND parent_rel.relname IN (SELECT plan.table_name FROM plan)
),
inbound_review AS (
  SELECT reviewed.child_table, reviewed.fk_name, reviewed.owner_column
  FROM (VALUES
    ('abandoned_bookings'::text, 'abandoned_bookings_booking_id_fkey'::text, 'user_id'::text),
    ('abandoned_bookings', 'abandoned_bookings_business_fk', 'user_id'),
    ('abandoned_bookings', 'abandoned_bookings_service_id_fkey', 'user_id'),
    ('advisor_reports', 'advisor_reports_org_id_fkey', 'user_id'),
    ('agent_configurations', 'agent_configurations_agent_id_fkey', 'user_id'),
    ('agent_executions', 'agent_executions_agent_id_fkey', 'user_id'),
    ('agent_group_memberships', 'agent_group_memberships_agent_id_fkey', NULL),
    ('agent_intensity_metrics', 'agent_intensity_metrics_agent_id_fkey', 'user_id'),
    ('agent_logs', 'agent_logs_agent_id_fkey', 'user_id'),
    ('agent_memory', 'agent_memory_agent_id_fkey', 'user_id'),
    ('agent_prompt_workflow_generation_sessions', 'agent_prompt_workflow_generation_sessions_agent_id_fkey', 'user_id'),
    ('agent_scheduler_state', 'agent_scheduler_state_agent_id_fkey', NULL),
    ('agent_scheduler_state', 'agent_scheduler_state_last_execution_id_fkey', NULL),
    ('agent_stats', 'agent_stats_agent_id_fkey', 'user_id'),
    ('agentkit_analytics', 'agentkit_analytics_agent_id_fkey', 'user_id'),
    ('agents', 'agents_org_id_fkey', 'user_id'),
    ('agents', 'fk_agents_last_calibration', 'user_id'),
    ('automation_slas', 'automation_slas_agent_id_fkey', 'user_id'),
    ('automation_slas', 'automation_slas_org_id_fkey', 'user_id'),
    ('billing_events', 'billing_events_subscription_id_fkey', 'user_id'),
    ('billing_events', 'billing_events_transaction_id_fkey', 'user_id'),
    ('boost_pack_purchases', 'boost_pack_purchases_transaction_id_fkey', 'user_id'),
    ('business_addresses', 'business_addresses_business_fk', 'user_id'),
    ('business_chat_action_log', 'business_chat_action_log_business_fk', 'user_id'),
    ('business_chat_conversation', 'business_chat_conversation_business_fk', 'user_id'),
    ('business_chat_plan_cache', 'business_chat_plan_cache_business_fk', 'user_id'),
    ('business_chat_saved_plans', 'business_chat_saved_plans_business_fk', 'user_id'),
    ('business_chat_verified_questions', 'business_chat_verified_questions_business_fk', 'user_id'),
    ('business_events', 'business_events_business_fk', 'user_id'),
    ('business_events', 'business_events_contact_id_fkey', 'user_id'),
    ('business_health_summaries', 'business_health_summaries_business_fk', 'user_id'),
    ('business_intake_forms', 'business_intake_forms_business_fk', 'user_id'),
    ('business_os_boost_purchases', 'business_os_boost_purchases_lot_id_fkey', 'user_id'),
    ('business_os_boost_reversal_events', 'business_os_boost_reversal_events_purchase_id_fkey', NULL),
    ('business_os_credit_charges', 'business_os_credit_charges_adjusts_action_id_fkey', 'user_id'),
    ('business_os_credit_lot_draws', 'business_os_credit_lot_draws_lot_id_fkey', 'user_id'),
    ('business_os_entitlement_overrides', 'business_os_entitlement_overrides_user_id_fkey', 'user_id'),
    ('business_profiles', 'business_profiles_address_id_fkey', 'user_id'),
    ('business_profiles', 'business_profiles_invoice_address_id_fkey', 'user_id'),
    ('business_subscribers', 'business_subscribers_business_fk', 'user_id'),
    ('business_subscribers', 'business_subscribers_promoted_contact_id_fkey', 'user_id'),
    ('calibration_history', 'calibration_history_agent_id_fkey', 'user_id'),
    ('calibration_history', 'calibration_history_session_id_fkey', 'user_id'),
    ('calibration_sessions', 'calibration_sessions_agent_id_fkey', 'user_id'),
    ('calibration_sessions', 'calibration_sessions_execution_id_fkey', 'user_id'),
    ('calibration_sessions', 'calibration_sessions_user_id_fkey', 'user_id'),
    ('channel_connections', 'channel_connections_business_fk', 'user_id'),
    ('channel_metrics_daily', 'channel_metrics_daily_business_fk', 'user_id'),
    ('contact_documents', 'contact_documents_business_fk', 'user_id'),
    ('contact_documents', 'contact_documents_contact_id_fkey', 'user_id'),
    ('credit_transactions', 'credit_transactions_token_usage_id_fkey', 'user_id'),
    ('crm_activities', 'crm_activities_business_fk', 'user_id'),
    ('crm_activities', 'crm_activities_contact_id_fkey', 'user_id'),
    ('crm_contacts', 'crm_contacts_business_fk', 'user_id'),
    ('crm_pipeline_stages', 'crm_pipeline_stages_business_fk', 'user_id'),
    ('crm_tasks', 'crm_tasks_business_fk', 'user_id'),
    ('crm_tasks', 'crm_tasks_contact_id_fkey', 'user_id'),
    ('daily_briefing_sends', 'daily_briefing_sends_business_fk', 'user_id'),
    ('daily_briefings', 'daily_briefings_business_fk', 'user_id'),
    ('data_decision_requests', 'fk_data_decision_requests_agent', 'user_id'),
    ('data_decision_requests', 'fk_data_decision_requests_execution', 'user_id'),
    ('derived_metrics', 'derived_metrics_business_fk', 'user_id'),
    ('email_campaigns', 'email_campaigns_business_fk', 'user_id'),
    ('email_sends', 'email_sends_booking_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_business_fk', 'user_id'),
    ('email_sends', 'email_sends_campaign_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_contact_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_meeting_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_sequence_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_sequence_step_id_fkey', 'user_id'),
    ('email_sequence_enrollments', 'email_sequence_enrollments_business_fk', 'user_id'),
    ('email_sequence_enrollments', 'email_sequence_enrollments_contact_id_fkey', 'user_id'),
    ('email_sequence_enrollments', 'email_sequence_enrollments_sequence_id_fkey', 'user_id'),
    ('email_sequence_steps', 'email_sequence_steps_business_fk', 'user_id'),
    ('email_sequence_steps', 'email_sequence_steps_sequence_id_fkey', 'user_id'),
    ('email_sequences', 'email_sequences_business_fk', 'user_id'),
    ('email_unsubscribes', 'email_unsubscribes_contact_id_fkey', 'user_id'),
    ('error_patterns', 'error_patterns_agent_id_fkey', 'user_id'),
    ('execution_anomalies', 'execution_anomalies_agent_id_fkey', 'user_id'),
    ('execution_anomalies', 'execution_anomalies_execution_id_fkey', 'user_id'),
    ('execution_baselines', 'execution_baselines_agent_id_fkey', 'user_id'),
    ('execution_insight_runs', 'execution_insight_runs_agent_id_fkey', 'user_id'),
    ('execution_insight_runs', 'execution_insight_runs_execution_id_fkey', 'user_id'),
    ('execution_insight_runs', 'execution_insight_runs_insight_id_fkey', 'user_id'),
    ('execution_insights', 'execution_insights_agent_id_fkey', 'user_id'),
    ('execution_insights', 'execution_insights_org_id_fkey', 'user_id'),
    ('execution_metrics', 'execution_metrics_agent_id_fkey', NULL),
    ('execution_metrics', 'execution_metrics_execution_id_fkey', NULL),
    ('execution_routing_decisions', 'execution_routing_decisions_execution_id_fkey', NULL),
    ('external_calendar_events', 'external_calendar_events_business_fk', 'user_id'),
    ('group_metrics_rollup', 'group_metrics_rollup_org_id_fkey', 'user_id'),
    ('insight_actions', 'insight_actions_booking_id_fkey', 'user_id'),
    ('insight_actions', 'insight_actions_business_fk', 'user_id'),
    ('insight_actions', 'insight_actions_contact_id_fkey', 'user_id'),
    ('insight_actions', 'insight_actions_insight_id_fkey', 'user_id'),
    ('insight_actions', 'insight_actions_invoice_id_fkey', 'user_id'),
    ('insight_automations', 'insight_automations_business_fk', 'user_id'),
    ('insight_automations', 'insight_automations_created_from_insight_id_fkey', 'user_id'),
    ('insight_automations', 'insight_automations_last_run_execution_id_fkey', 'user_id'),
    ('insight_hypotheses', 'insight_hypotheses_business_fk', 'user_id'),
    ('insight_measurements', 'insight_measurements_business_fk', 'user_id'),
    ('insight_measurements', 'insight_measurements_insight_id_fkey', 'user_id'),
    ('insights', 'insights_business_fk', 'user_id'),
    ('insights', 'insights_correlation_parent_id_fkey', 'user_id'),
    ('kernel_action_log', 'kernel_action_log_execution_id_fkey', 'user_id'),
    ('kernel_action_log', 'kernel_action_log_insight_id_fkey', 'user_id'),
    ('kernel_executions', 'kernel_executions_insight_id_fkey', 'user_id'),
    ('lead_responses', 'lead_responses_business_fk', 'user_id'),
    ('lead_responses', 'lead_responses_contact_id_fkey', 'user_id'),
    ('marketing_consent_events', 'marketing_consent_events_contact_id_fkey', 'user_id'),
    ('marketing_consent_settings', 'marketing_consent_settings_business_fk', 'user_id'),
    ('marketing_consent_state', 'marketing_consent_state_contact_id_fkey', 'user_id'),
    ('metric_baselines', 'metric_baselines_org_id_fkey', 'user_id'),
    ('onboarding_prompt_ideas', 'onboarding_prompt_ideas_agent_created_id_fkey', 'user_id'),
    ('organization_members', 'organization_members_org_id_fkey', 'user_id'),
    ('owner_insight_history', 'owner_insight_history_business_fk', 'user_id'),
    ('owner_insight_history', 'owner_insight_history_insight_id_fkey', 'user_id'),
    ('payment_automation_executions', 'payment_automation_executions_business_fk', 'user_id'),
    ('payment_automation_executions', 'payment_automation_executions_rule_id_fkey', 'user_id'),
    ('payment_automation_executions', 'payment_automation_executions_trigger_event_id_fkey', 'user_id'),
    ('payment_automation_rules', 'payment_automation_rules_business_fk', 'user_id'),
    ('payment_events', 'payment_events_business_fk', 'user_id'),
    ('payment_events', 'payment_events_contact_id_fkey', 'user_id'),
    ('payment_invoices', 'payment_invoices_booking_id_fkey', 'user_id'),
    ('payment_invoices', 'payment_invoices_business_fk', 'user_id'),
    ('payment_invoices', 'payment_invoices_contact_id_fkey', 'user_id'),
    ('payment_invoices', 'payment_invoices_service_id_fkey', 'user_id'),
    ('payment_methods', 'payment_methods_business_fk', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_booking_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_business_fk', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_contact_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_invoice_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_meeting_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_payment_plan_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_proposal_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_subscription_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_transaction_id_fkey', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_booking_id_fkey', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_business_fk', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_contact_id_fkey', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_payment_plan_id_fkey', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_service_id_fkey', 'user_id'),
    ('payment_plans', 'payment_plans_business_fk', 'user_id'),
    ('payment_plans', 'payment_plans_service_id_fkey', 'user_id'),
    ('payment_processors', 'payment_processors_business_fk', 'user_id'),
    ('payment_refunds', 'payment_refunds_business_fk', 'user_id'),
    ('payment_refunds', 'payment_refunds_invoice_id_fkey', 'user_id'),
    ('payment_refunds', 'payment_refunds_transaction_id_fkey', 'user_id'),
    ('payment_reminders', 'payment_reminders_business_fk', 'user_id'),
    ('payment_reminders', 'payment_reminders_contact_id_fkey', 'user_id'),
    ('payment_reminders', 'payment_reminders_installment_id_fkey', 'user_id'),
    ('payment_reminders', 'payment_reminders_invoice_id_fkey', 'user_id'),
    ('payment_transactions', 'payment_transactions_booking_id_fkey', 'user_id'),
    ('payment_transactions', 'payment_transactions_business_fk', 'user_id'),
    ('payment_transactions', 'payment_transactions_contact_id_fkey', 'user_id'),
    ('payment_transactions', 'payment_transactions_invoice_id_fkey', 'user_id'),
    ('payment_transactions', 'payment_transactions_service_id_fkey', 'user_id'),
    ('plugin_performance', 'plugin_performance_agent_id_fkey', 'user_id'),
    ('profiles', 'profiles_org_id_fkey', 'id'),
    ('proposals', 'proposals_booking_id_fkey', 'user_id'),
    ('proposals', 'proposals_business_fk', 'user_id'),
    ('proposals', 'proposals_contact_id_fkey', 'user_id'),
    ('proposals', 'proposals_created_invoice_id_fkey', 'user_id'),
    ('proposals', 'proposals_created_plan_id_fkey', 'user_id'),
    ('proposals', 'proposals_document_id_fkey', 'user_id'),
    ('proposals', 'proposals_package_booking_id_fkey', 'user_id'),
    ('proposals', 'proposals_service_id_fkey', 'user_id'),
    ('proposals', 'proposals_supersedes_id_fkey', 'user_id'),
    ('run_memories', 'run_memories_agent_id_fkey', 'user_id'),
    ('saved_payment_methods', 'saved_payment_methods_business_fk', 'user_id'),
    ('saved_payment_methods', 'saved_payment_methods_contact_id_fkey', 'user_id'),
    ('scheduling_availability_exceptions', 'scheduling_availability_exceptions_business_fk', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_business_fk', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_contact_id_fkey', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_invoice_id_fkey', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_parent_booking_id_fkey', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_payment_plan_id_fkey', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_service_id_fkey', 'user_id'),
    ('scheduling_meetings', 'scheduling_meetings_booking_id_fkey', 'user_id'),
    ('scheduling_meetings', 'scheduling_meetings_business_fk', 'user_id'),
    ('scheduling_services', 'scheduling_services_business_fk', 'user_id'),
    ('shadow_failure_snapshots', 'shadow_failure_snapshots_agent_id_fkey', 'user_id'),
    ('shared_agent_imports', 'shared_agent_imports_created_agent_id_fkey', 'imported_by_user_id'),
    ('shared_agent_imports', 'shared_agent_imports_shared_agent_id_fkey', 'imported_by_user_id'),
    ('shared_agents', 'fk_shared_agents_original_agent', 'user_id'),
    ('sla_events', 'sla_events_sla_id_fkey', NULL),
    ('smart_link_clicks', 'smart_link_clicks_smart_link_id_fkey', NULL),
    ('smart_links', 'smart_links_business_fk', 'user_id'),
    ('stripe_connect_accounts', 'stripe_connect_accounts_business_fk', 'user_id'),
    ('user_capabilities', 'user_capabilities_business_fk', 'user_id'),
    ('user_capability_blocks', 'user_capability_blocks_user_capability_id_fkey', NULL),
    ('user_intake_settings', 'user_intake_settings_business_fk', 'user_id'),
    ('user_media', 'user_media_business_fk', 'user_id'),
    ('user_memory', 'user_memory_source_agent_id_fkey', 'user_id'),
    ('user_rewards', 'user_rewards_transaction_id_fkey', 'user_id'),
    ('website_blocks', 'website_blocks_page_id_fkey', NULL),
    ('website_content', 'website_content_business_fk', 'user_id'),
    ('website_page_views', 'website_page_views_business_fk', 'user_id'),
    ('website_page_views', 'website_page_views_page_id_fkey', 'user_id'),
    ('website_pages', 'website_pages_business_fk', 'user_id'),
    ('workflow_groups', 'workflow_groups_org_id_fkey', NULL)
  ) AS reviewed(child_table, fk_name, owner_column)
),
inbound_joined AS (
  SELECT
    inbound_catalog.*,
    inbound_review.child_table IS NOT NULL AND inbound_catalog.child_schema = 'public' AS reviewed,
    inbound_review.owner_column,
    (inbound_review.owner_column IS NULL OR EXISTS (
      SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = inbound_catalog.child_schema AND cols.table_name = inbound_catalog.child_table AND cols.column_name = inbound_review.owner_column
    )) AS owner_ok,
    CASE WHEN plan.parent_table IS NULL
      THEN format('%I = %L', plan.key_column, target.user_id)
      ELSE format('%I IN (SELECT id FROM public.%I WHERE user_id = %L)', plan.key_column, plan.parent_table, target.user_id)
    END AS parent_predicate,
    plan.ord AS parent_ord,
    plan.parent_table IS NULL AND inbound_catalog.parent_column = plan.key_column
      AND inbound_catalog.child_column = inbound_review.owner_column AS owner_is_target,
    target.user_id
  FROM inbound_catalog
  JOIN plan ON plan.table_name = inbound_catalog.parent_table
  CROSS JOIN target
  LEFT JOIN inbound_review USING (child_table, fk_name)
),
inbound_parents AS (
  SELECT
    needed.parent_ord,
    (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM (SELECT 1 FROM public.%I WHERE %s LIMIT 1) AS one_row', needed.parent_table, needed.parent_predicate), false, true, '')))[1]::text::bigint AS found
  FROM (
    SELECT DISTINCT inbound_joined.parent_ord, inbound_joined.parent_table, inbound_joined.parent_predicate
    FROM inbound_joined
    WHERE inbound_joined.user_id IS NOT NULL AND inbound_joined.reviewed AND inbound_joined.owner_column IS NOT NULL
      AND inbound_joined.owner_ok AND inbound_joined.key_width = 1 AND NOT inbound_joined.owner_is_target
  ) AS needed
),
inbound_rows AS (
  SELECT
    inbound_joined.*,
    CASE
      WHEN inbound_joined.user_id IS NULL OR NOT inbound_joined.reviewed OR inbound_joined.owner_column IS NULL
        OR NOT inbound_joined.owner_ok OR inbound_joined.key_width <> 1 THEN 0
      WHEN inbound_joined.owner_is_target OR inbound_parents.found = 0 THEN 0
      ELSE (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM %I.%I AS child_rows WHERE child_rows.%I IN (SELECT %I FROM public.%I WHERE %s) AND child_rows.%I IS DISTINCT FROM %L', inbound_joined.child_schema, inbound_joined.child_table, inbound_joined.child_column, inbound_joined.parent_column, inbound_joined.parent_table, inbound_joined.parent_predicate, inbound_joined.owner_column, inbound_joined.user_id), false, true, '')))[1]::text::bigint
    END AS found
  FROM inbound_joined
  LEFT JOIN inbound_parents USING (parent_ord)
),
guard_rows AS (
  SELECT 'G-1'::text AS guard, 'exactly one login has this email'::text AS item, counted.found::bigint AS found, (counted.target_email IS NULL OR counted.found <> 1) AS blocked, 'Edit the email line at the top. It must match exactly one login.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM matches)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-2'::text AS guard, 'the email contains the test tag'::text AS item, counted.found::bigint AS found, (counted.test_tag IS NULL OR counted.found <> 1) AS blocked, 'Only an email containing the test tag can be removed. Set the tag line (never empty) or pick a test account.'::text AS clears
  FROM (SELECT (CASE WHEN params.test_tag IS NULL OR params.target_email IS NULL THEN 0 ELSE sign(strpos(params.target_email, params.test_tag)) END) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-4'::text AS guard, 'not a platform admin'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Admins are never removed here. Remove the admin row by hand first if this really is a test account.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.admin_users AS admins WHERE admins.user_id = target.user_id OR lower(admins.email) = params.target_email)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-5'::text AS guard, 'nothing ever ran in Stripe live mode'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Real money. This account is not a test account and must not be removed.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.business_os_billing_accounts AS billing WHERE billing.user_id = target.user_id AND billing.livemode)
      + (SELECT count(*) FROM public.business_os_boost_purchases AS boosts WHERE boosts.user_id = target.user_id AND boosts.livemode)
      + (SELECT count(*) FROM public.business_os_billing_events AS money WHERE money.user_id = target.user_id AND money.livemode)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-6'::text AS guard, 'no live plan subscription, test or live mode'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Cancel the subscription in the Stripe dashboard, in its mode, then wait for the webhook.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.business_os_billing_accounts AS billing WHERE billing.user_id = target.user_id
        AND (billing.subscription_status IN ('active', 'trialing', 'past_due', 'unpaid', 'paused') OR (billing.stripe_subscription_id IS NOT NULL AND billing.ended_at IS NULL)))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-7'::text AS guard, 'legacy subscription with a Stripe id'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Legacy rows carry no Stripe mode, so they are treated as real money. Engineering must review this account.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.user_subscriptions AS legacy WHERE legacy.user_id = target.user_id AND legacy.stripe_subscription_id IS NOT NULL)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-7'::text AS guard, 'legacy credit payment with a Stripe id'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Legacy rows carry no Stripe mode, so they are treated as real money. Engineering must review this account.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.credit_transactions AS legacy WHERE legacy.user_id = target.user_id AND legacy.stripe_payment_intent_id IS NOT NULL)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-7'::text AS guard, 'legacy billing event from Stripe'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Legacy rows carry no Stripe mode, so they are treated as real money. Engineering must review this account.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.billing_events AS legacy WHERE legacy.user_id = target.user_id AND legacy.stripe_event_id IS NOT NULL)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-8'::text AS guard, 'no Stripe account connected for client payments'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Disconnect Stripe from the business first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.stripe_connect_accounts AS connect WHERE connect.user_id = target.user_id)
      + (SELECT count(*) FROM public.plugin_connections AS plugins WHERE plugins.user_id = target.user_id AND plugins.plugin_key = 'stripe')) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-9'::text AS guard, 'money in flight: recurring payment plan(s) still running'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Finish or cancel these in the app first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.payment_plan_subscriptions AS money WHERE money.user_id = target.user_id AND money.status IN ('pending', 'active', 'past_due', 'paused'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-9'::text AS guard, 'money in flight: payment(s) still pending'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Finish or cancel these in the app first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.payment_transactions AS money WHERE money.user_id = target.user_id AND money.status IN ('pending'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-9'::text AS guard, 'money in flight: refund(s) still in flight'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Finish or cancel these in the app first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.payment_refunds AS money WHERE money.user_id = target.user_id AND money.status IN ('pending'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-9'::text AS guard, 'money in flight: unpaid invoice(s) owed to this business'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Finish or cancel these in the app first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.payment_invoices AS money WHERE money.user_id = target.user_id AND money.status IN ('sent', 'overdue'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-10'::text AS guard, fk_rows.fk_schema || '.' || fk_rows.fk_table || '.' || fk_rows.fk_column AS item, fk_rows.found::bigint AS found, true AS blocked,
    CASE WHEN fk_rows.kind IS NULL OR fk_rows.key_width <> 1
      THEN 'A link to the login nobody has reviewed. Engineering must classify it in the generator first.'
      ELSE 'Rows of other accounts or of the platform name this login. Clear them by hand first.' END AS clears
  FROM fk_rows
  WHERE fk_rows.kind IS NULL OR fk_rows.key_width <> 1 OR (fk_rows.kind = 'actor' AND fk_rows.found > 0)
  UNION ALL
  SELECT 'G-10'::text AS guard, 'links to the login, reviewed'::text AS item, count(*)::bigint AS found, false AS blocked, ''::text AS clears FROM fk_catalog
  UNION ALL
  SELECT 'G-11'::text AS guard, plan_state.table_name || '.' || plan_state.key_column AS item, NULL::bigint AS found, true AS blocked,
    'A column this script relies on is missing. Regenerate the script after the schema change.'::text AS clears
  FROM plan_state
  WHERE plan_state.present AND NOT (plan_state.key_ok AND plan_state.parent_ok)
  UNION ALL
  SELECT 'G-12'::text AS guard, 'no stored files under the account folder'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Empty the listed folders in the Supabase Storage dashboard, then run the check again.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM storage.objects AS objects WHERE objects.bucket_id IN ('contact-documents', 'website-images', 'business-purge-snapshots', 'business-data-exports') AND starts_with(objects.name, target.user_id::text || '/'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: advisor_reports'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.advisor_reports AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: agents'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.agents AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: automation_slas'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.automation_slas AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: execution_insights'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.execution_insights AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: group_metrics_rollup'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.group_metrics_rollup AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: metric_baselines'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.metric_baselines AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: organization_members'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.organization_members AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: profiles'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.profiles AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-14'::text AS guard, 'no consent ledger rows'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'The consent ledger is append-only and cannot be removed. This account cannot be cleaned by this script.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.marketing_consent_events AS consent WHERE consent.user_id = target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-15'::text AS guard, 'nobody else hangs below it in the invitation circle'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'It invited an account that still exists. Remove that account first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.business_os_account_lineage AS lineage WHERE (lineage.parent_account_id = target.user_id OR lineage.root_account_id = target.user_id) AND lineage.account_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-16'::text AS guard, 'no other account imported its shared agents'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account imported an agent it shared. Engineering must review this account.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.shared_agent_imports AS imports JOIN public.shared_agents AS shared ON shared.id = imports.shared_agent_id WHERE shared.user_id = target.user_id AND imports.imported_by_user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-17'::text AS guard, rel.relname || '.' || trg.tgname AS item, 1::bigint AS found, true AS blocked,
    'A trigger on a table this script empties has not been reviewed. Engineering must review it in the generator first.'::text AS clears
  FROM pg_catalog.pg_trigger AS trg
  JOIN pg_catalog.pg_class AS rel ON rel.oid = trg.tgrelid
  JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public' AND NOT trg.tgisinternal AND (trg.tgtype::integer & 8) <> 0
    AND (
      rel.relname IN (SELECT plan.table_name FROM plan)
      OR rel.oid IN (SELECT fk_con.conrelid FROM pg_catalog.pg_constraint AS fk_con WHERE fk_con.contype = 'f' AND fk_con.confrelid = 'auth.users'::regclass)
      OR rel.relname IN (SELECT inbound_catalog.child_table FROM inbound_catalog WHERE inbound_catalog.child_schema = 'public')
    )
    AND (rel.relname::text, trg.tgname::text) NOT IN (VALUES ('payment_refunds', 'recompute_transaction_refund_state_trigger'), ('storage_usage', 'trigger_update_storage_on_delete'), ('storage_usage', 'trigger_update_storage_used'), ('marketing_consent_events', 'trg_mce_guard'))
  UNION ALL
  SELECT 'G-18'::text AS guard, inbound_rows.child_schema || '.' || inbound_rows.child_table || '.' || inbound_rows.child_column || ' to ' || inbound_rows.parent_table AS item,
    inbound_rows.found::bigint AS found, true AS blocked,
    CASE
      WHEN NOT inbound_rows.reviewed OR inbound_rows.key_width <> 1
        THEN 'A link pointing at a table this script empties has not been reviewed. Engineering must classify it in the generator first.'
      WHEN NOT inbound_rows.owner_ok
        THEN 'The owner column of this link is missing. Regenerate the script after the schema change.'
      ELSE 'Rows of another account point at rows this script removes, and would be deleted or emptied with them. Engineering must review this account.'
    END AS clears
  FROM inbound_rows
  WHERE NOT inbound_rows.reviewed OR inbound_rows.key_width <> 1 OR NOT inbound_rows.owner_ok OR inbound_rows.found > 0
  UNION ALL
  SELECT 'G-18'::text AS guard, 'links pointing at removed tables, reviewed'::text AS item, count(*)::bigint AS found, false AS blocked, ''::text AS clears FROM inbound_catalog
  UNION ALL
  SELECT 'G-19'::text AS guard, child_plan.table_name || '.' || att.attname || ' to ' || parent_plan.table_name AS item, 1::bigint AS found, true AS blocked,
    'Removing a row of the second table empties a NOT NULL column of the first (ON DELETE SET NULL or SET DEFAULT), which the database refuses, and the plan removes the second table first. Engineering must order the first table before it in the generator.'::text AS clears
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS child_rel ON child_rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS child_nsp ON child_nsp.oid = child_rel.relnamespace
  JOIN pg_catalog.pg_class AS parent_rel ON parent_rel.oid = con.confrelid
  JOIN pg_catalog.pg_namespace AS parent_nsp ON parent_nsp.oid = parent_rel.relnamespace
  JOIN plan AS parent_plan ON parent_plan.table_name = parent_rel.relname::text
  JOIN plan AS child_plan ON child_plan.table_name = child_rel.relname::text
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
  WHERE con.contype = 'f' AND con.confdeltype IN ('n', 'd') AND con.conrelid <> con.confrelid
    AND parent_nsp.nspname = 'public' AND child_nsp.nspname = 'public'
    AND att.attnotnull AND (con.confdeltype = 'n' OR NOT att.atthasdef)
    AND child_plan.ord > parent_plan.ord
),
removal AS (
  SELECT
    plan_state.ord, plan_state.step, plan_state.table_name, plan_state.present,
    CASE
      WHEN NOT plan_state.present OR NOT (plan_state.key_ok AND plan_state.parent_ok) OR target.user_id IS NULL THEN NULL
      WHEN plan_state.parent_table IS NULL
        THEN (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM public.%I WHERE %I = %L', plan_state.table_name, plan_state.key_column, target.user_id), false, true, '')))[1]::text::bigint
      ELSE (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM public.%I WHERE %I IN (SELECT id FROM public.%I WHERE user_id = %L)', plan_state.table_name, plan_state.key_column, plan_state.parent_table, target.user_id), false, true, '')))[1]::text::bigint
    END AS found
  FROM plan_state
  CROSS JOIN target
),
report AS (
  SELECT 0 AS section_order, 'VERDICT'::text AS section, 0 AS sort_order,
    CASE WHEN (SELECT count(*) FROM guard_rows WHERE guard_rows.blocked) = 0 THEN 'OK' ELSE 'BLOCKED' END AS status,
    'login ' || coalesce((SELECT target.user_id::text FROM target), 'not found') AS item,
    (SELECT count(*) FROM guard_rows WHERE guard_rows.blocked)::bigint AS found,
    CASE WHEN (SELECT count(*) FROM guard_rows WHERE guard_rows.blocked) = 0
      THEN 'Nothing blocks. Rows to remove: ' || coalesce((SELECT sum(removal.found) FROM removal)::text, '0') || '. Run the delete file next.'
      ELSE 'Fix every BLOCKED row below, then run this check again. Do not run the delete file.' END AS detail
  UNION ALL
  SELECT 1, 'guard', substring(guard_rows.guard FROM 3)::integer, CASE WHEN guard_rows.blocked THEN 'BLOCKED' ELSE 'ok' END,
    guard_rows.guard || ' ' || guard_rows.item, guard_rows.found, CASE WHEN guard_rows.blocked THEN guard_rows.clears ELSE '' END
  FROM guard_rows
  UNION ALL
  SELECT 2, 'remove', removal.ord,
    CASE WHEN NOT removal.present THEN 'absent' WHEN removal.found IS NULL THEN 'unknown' ELSE 'remove' END,
    removal.step || ' ' || removal.table_name, removal.found, ''
  FROM removal
  WHERE removal.found IS DISTINCT FROM 0 AND (SELECT target.user_id FROM target) IS NOT NULL
  UNION ALL
  SELECT 2, 'remove', 100000, 'remove', 'C the login (auth.users)', (SELECT count(*) FROM matches), 'Deleted last. Its cascades clear the rest.'
  WHERE (SELECT target.user_id FROM target) IS NOT NULL
  UNION ALL
  SELECT 3, 'storage', 0, 'empty this folder', objects.bucket_id || '/' || objects.name, NULL, 'Delete it in the Supabase Storage dashboard.'
  FROM storage.objects AS objects
  CROSS JOIN target
  WHERE objects.bucket_id IN ('contact-documents', 'website-images', 'business-purge-snapshots', 'business-data-exports') AND starts_with(objects.name, target.user_id::text || '/')
  UNION ALL
  SELECT 4, 'trigger', 0, 'info', 'auth.users.' || trg.tgname, NULL,
    CASE WHEN (trg.tgtype::integer & 8) <> 0 THEN 'Fires when the login is deleted. Events: ' ELSE 'Does not fire on this delete. Events: ' END
      || concat_ws(' OR ', CASE WHEN (trg.tgtype::integer & 4) <> 0 THEN 'INSERT' END, CASE WHEN (trg.tgtype::integer & 8) <> 0 THEN 'DELETE' END,
        CASE WHEN (trg.tgtype::integer & 16) <> 0 THEN 'UPDATE' END, CASE WHEN (trg.tgtype::integer & 32) <> 0 THEN 'TRUNCATE' END) || '.'
  FROM pg_catalog.pg_trigger AS trg
  WHERE trg.tgrelid = 'auth.users'::regclass AND NOT trg.tgisinternal
  UNION ALL
  SELECT 5, 'kept', 0, 'kept', 'business_os_invites redeemed or claimed by it',
    (SELECT count(*) FROM public.business_os_invites AS invites CROSS JOIN target WHERE invites.redeemed_account_id = target.user_id OR invites.claimed_account_id = target.user_id),
    'BQ-3: the invitation that brought it in stays as the record of what the inviter did. It holds only the pseudonymous id.'
)
SELECT jsonb_agg(jsonb_build_object('section', report.section, 'status', report.status, 'item', report.item, 'found', report.found, 'detail', report.detail)
  ORDER BY report.section_order, report.sort_order, report.item)
FROM report
    );
  ELSIF p_mode = 'anonymise_check' THEN
    v_result := (
WITH
params AS (
  SELECT
    NULLIF(lower(btrim(coalesce(current_setting('cleanup.target_email', true), ''))), '') AS target_email,
    NULLIF(lower(btrim(coalesce(current_setting('cleanup.test_tag', true), ''))), '') AS test_tag,
    NULLIF(current_setting('cleanup.subject_id', true), '')::uuid AS subject_id
),
matches AS (
  SELECT users.id AS user_id
  FROM auth.users AS users
  JOIN params ON lower(users.email) = params.target_email
),
target AS (
  SELECT CASE WHEN (SELECT count(*) FROM matches) = 1 THEN (SELECT matches.user_id FROM matches LIMIT 1) END AS user_id
),
target_orgs AS (
  SELECT orgs.id AS org_id
  FROM public.organizations AS orgs
  JOIN target ON orgs.owner_user_id = target.user_id
),
plan AS (
  SELECT plan_values.ord, plan_values.step, plan_values.table_name, plan_values.key_column, plan_values.parent_table
  FROM (VALUES
    (1, 'A'::text, 'payment_reminders'::text, 'user_id'::text, NULL::text),
    (2, 'A', 'scheduling_meetings', 'user_id', NULL),
    (3, 'A', 'payment_plan_installments', 'user_id', NULL),
    (4, 'A', 'agent_logs', 'user_id', NULL),
    (5, 'A', 'insight_automations', 'user_id', NULL),
    (6, 'A', 'payment_plan_subscriptions', 'user_id', NULL),
    (7, 'A', 'payment_refunds', 'user_id', NULL),
    (8, 'A', 'agent_scheduler_state', 'agent_id', 'agents'),
    (9, 'A', 'abandoned_bookings', 'user_id', NULL),
    (10, 'A', 'agent_memories', 'user_id', NULL),
    (11, 'A', 'agent_memory', 'user_id', NULL),
    (12, 'A', 'agent_prompt_threads', 'user_id', NULL),
    (13, 'A', 'agent_prompt_workflow_generation_sessions', 'user_id', NULL),
    (14, 'A', 'archived_records', 'user_id', NULL),
    (15, 'A', 'audit_trail', 'user_id', NULL),
    (16, 'A', 'business_chat_action_log', 'user_id', NULL),
    (17, 'A', 'business_chat_conversation', 'user_id', NULL),
    (18, 'A', 'business_chat_plan_cache', 'user_id', NULL),
    (19, 'A', 'business_chat_saved_plans', 'user_id', NULL),
    (20, 'A', 'business_chat_verified_questions', 'user_id', NULL),
    (21, 'A', 'business_events', 'user_id', NULL),
    (22, 'A', 'business_health_summaries', 'user_id', NULL),
    (23, 'A', 'business_os_data_exports', 'user_id', NULL),
    (24, 'A', 'business_subscribers', 'user_id', NULL),
    (25, 'A', 'channel_metrics_daily', 'user_id', NULL),
    (26, 'A', 'command_sessions', 'user_id', NULL),
    (27, 'A', 'contact_documents', 'user_id', NULL),
    (28, 'A', 'crm_tasks', 'user_id', NULL),
    (29, 'A', 'daily_briefing_sends', 'user_id', NULL),
    (30, 'A', 'data_decision_requests', 'user_id', NULL),
    (31, 'A', 'derived_metrics', 'user_id', NULL),
    (32, 'A', 'email_sends', 'user_id', NULL),
    (33, 'A', 'email_sequence_enrollments', 'user_id', NULL),
    (34, 'A', 'email_sequence_steps', 'user_id', NULL),
    (35, 'A', 'external_calendar_events', 'user_id', NULL),
    (36, 'A', 'insight_actions', 'user_id', NULL),
    (37, 'A', 'insight_hypotheses', 'user_id', NULL),
    (38, 'A', 'insight_measurements', 'user_id', NULL),
    (39, 'A', 'kernel_action_log', 'user_id', NULL),
    (40, 'A', 'lead_responses', 'user_id', NULL),
    (41, 'A', 'onboarding_conversations', 'user_id', NULL),
    (42, 'A', 'onboarding_prompt_ideas', 'user_id', NULL),
    (43, 'A', 'owner_insight_history', 'user_id', NULL),
    (44, 'A', 'payment_automation_executions', 'user_id', NULL),
    (45, 'A', 'payment_events', 'user_id', NULL),
    (46, 'A', 'payment_methods', 'user_id', NULL),
    (47, 'A', 'proposals', 'user_id', NULL),
    (48, 'A', 'run_memories', 'user_id', NULL),
    (49, 'A', 'saved_payment_methods', 'user_id', NULL),
    (50, 'A', 'scheduling_availability_exceptions', 'user_id', NULL),
    (51, 'A', 'smart_link_clicks', 'smart_link_id', 'smart_links'),
    (52, 'A', 'user_media', 'user_id', NULL),
    (53, 'A', 'user_memory', 'user_id', NULL),
    (54, 'A', 'website_blocks', 'page_id', 'website_pages'),
    (55, 'A', 'website_content', 'user_id', NULL),
    (56, 'A', 'website_page_views', 'user_id', NULL),
    (57, 'A', 'scheduling_bookings', 'user_id', NULL),
    (58, 'A', 'agent_executions', 'user_id', NULL),
    (59, 'A', 'agents', 'user_id', NULL),
    (60, 'A', 'crm_contacts', 'user_id', NULL),
    (61, 'A', 'daily_briefings', 'user_id', NULL),
    (62, 'A', 'email_campaigns', 'user_id', NULL),
    (63, 'A', 'email_sequences', 'user_id', NULL),
    (64, 'A', 'insights', 'user_id', NULL),
    (65, 'A', 'kernel_executions', 'user_id', NULL),
    (66, 'A', 'payment_automation_rules', 'user_id', NULL),
    (67, 'A', 'payment_invoices', 'user_id', NULL),
    (68, 'A', 'payment_plans', 'user_id', NULL),
    (69, 'A', 'payment_transactions', 'user_id', NULL),
    (70, 'A', 'scheduling_services', 'user_id', NULL),
    (71, 'A', 'smart_links', 'user_id', NULL),
    (72, 'A', 'website_pages', 'user_id', NULL),
    (73, 'A', 'user_capability_blocks', 'user_capability_id', 'user_capabilities'),
    (74, 'A', 'business_addresses', 'user_id', NULL),
    (75, 'A', 'business_intake_forms', 'user_id', NULL),
    (76, 'A', 'channel_connections', 'user_id', NULL),
    (77, 'A', 'crm_pipeline_stages', 'user_id', NULL),
    (78, 'A', 'marketing_consent_settings', 'user_id', NULL),
    (79, 'A', 'payment_processors', 'user_id', NULL),
    (80, 'A', 'plugin_connections', 'user_id', NULL),
    (81, 'A', 'stripe_connect_accounts', 'user_id', NULL),
    (82, 'A', 'user_capabilities', 'user_id', NULL),
    (83, 'A', 'user_intake_settings', 'user_id', NULL),
    (84, 'A', 'crm_activities', 'user_id', NULL),
    (85, 'B', 'storage_usage', 'user_id', NULL),
    (86, 'B', 'subscriptions', 'user_id', NULL),
    (87, 'B', 'business_os_boost_cap_overrides', 'user_id', NULL),
    (88, 'B', 'business_os_account_plans', 'user_id', NULL),
    (89, 'B', 'business_os_entitlement_overrides', 'user_id', NULL),
    (90, 'B', 'business_os_entitlement_shadow_events', 'user_id', NULL),
    (91, 'B', 'email_unsubscribes', 'user_id', NULL),
    (92, 'B', 'user_preferences', 'user_id', NULL),
    (93, 'B', 'notification_settings', 'user_id', NULL),
    (94, 'B', 'security_settings', 'user_id', NULL),
    (95, 'B', 'api_keys', 'user_id', NULL),
    (96, 'B', 'audit_logs', 'user_id', NULL),
    (97, 'B', 'auth_handoff_codes', 'user_id', NULL),
    (98, 'B', 'business_os_account_closures', 'user_id', NULL),
    (99, 'B', 'agent_configurations', 'user_id', NULL),
    (100, 'B', 'agent_execution_logs', 'user_id', NULL),
    (101, 'B', 'agent_intensity_metrics', 'user_id', NULL),
    (102, 'B', 'agent_stats', 'user_id', NULL),
    (103, 'B', 'agent_templates', 'user_id', NULL),
    (104, 'B', 'agentkit_analytics', 'user_id', NULL),
    (105, 'B', 'calibration_history', 'user_id', NULL),
    (106, 'B', 'calibration_sessions', 'user_id', NULL),
    (107, 'B', 'error_patterns', 'user_id', NULL),
    (108, 'B', 'execution_anomalies', 'user_id', NULL),
    (109, 'B', 'execution_baselines', 'user_id', NULL),
    (110, 'B', 'execution_insight_runs', 'user_id', NULL),
    (111, 'B', 'execution_insights', 'user_id', NULL),
    (112, 'B', 'pilot_step_routing_history', 'user_id', NULL),
    (113, 'B', 'plugin_performance', 'user_id', NULL),
    (114, 'B', 'shadow_failure_snapshots', 'user_id', NULL),
    (115, 'B', 'shared_agents', 'user_id', NULL),
    (116, 'B', 'workflow_executions', 'user_id', NULL),
    (117, 'B', 'advisor_reports', 'user_id', NULL),
    (118, 'B', 'automation_slas', 'user_id', NULL),
    (119, 'B', 'group_metrics_rollup', 'user_id', NULL),
    (120, 'B', 'metric_baselines', 'user_id', NULL),
    (121, 'B', 'organization_members', 'user_id', NULL),
    (122, 'C', 'business_profiles', 'user_id', NULL),
    (123, 'C', 'profiles', 'id', NULL),
    (124, 'C', 'organizations', 'owner_user_id', NULL),
    (125, 'C', 'business_os_invites', 'issuer_account_id', NULL)
  ) AS plan_values(ord, step, table_name, key_column, parent_table)
),
plan_state AS (
  SELECT
    plan.*,
    to_regclass(format('public.%I', plan.table_name)) IS NOT NULL AS present,
    EXISTS (
      SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = 'public' AND cols.table_name = plan.table_name AND cols.column_name = plan.key_column
    ) AS key_ok,
    (plan.parent_table IS NULL OR EXISTS (
      SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = 'public' AND cols.table_name = plan.parent_table AND cols.column_name = 'user_id'
    )) AS parent_ok
  FROM plan
),
fk_catalog AS (
  SELECT
    nsp.nspname::text AS fk_schema,
    rel.relname::text AS fk_table,
    att.attname::text AS fk_column,
    cardinality(con.conkey) AS key_width
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND con.confrelid = 'auth.users'::regclass AND nsp.nspname <> 'auth'
),
fk_review AS (
  SELECT reviewed.fk_schema, reviewed.fk_table, reviewed.fk_column, reviewed.kind, reviewed.owner_column
  FROM (VALUES
    ('public'::text, 'abandoned_bookings'::text, 'user_id'::text, 'tenancy'::text, NULL::text),
    ('public', 'admin_users', 'user_id', 'tenancy', NULL),
    ('public', 'advisor_reports', 'user_id', 'tenancy', NULL),
    ('public', 'agent_configurations', 'user_id', 'tenancy', NULL),
    ('public', 'agent_execution_logs', 'user_id', 'tenancy', NULL),
    ('public', 'agent_executions', 'user_id', 'tenancy', NULL),
    ('public', 'agent_intensity_metrics', 'user_id', 'tenancy', NULL),
    ('public', 'agent_logs', 'user_id', 'tenancy', NULL),
    ('public', 'agent_memories', 'user_id', 'tenancy', NULL),
    ('public', 'agent_memory', 'user_id', 'tenancy', NULL),
    ('public', 'agent_prompt_threads', 'user_id', 'tenancy', NULL),
    ('public', 'agent_prompt_workflow_generation_sessions', 'user_id', 'tenancy', NULL),
    ('public', 'agent_stats', 'user_id', 'tenancy', NULL),
    ('public', 'agent_templates', 'user_id', 'tenancy', NULL),
    ('public', 'agentkit_analytics', 'user_id', 'tenancy', NULL),
    ('public', 'agents', 'user_id', 'tenancy', NULL),
    ('public', 'api_keys', 'user_id', 'tenancy', NULL),
    ('public', 'archived_records', 'user_id', 'tenancy', NULL),
    ('public', 'audit_logs', 'user_id', 'tenancy', NULL),
    ('public', 'audit_trail', 'user_id', 'tenancy', NULL),
    ('public', 'auth_handoff_codes', 'user_id', 'tenancy', NULL),
    ('public', 'automation_slas', 'user_id', 'tenancy', NULL),
    ('public', 'billing_events', 'user_id', 'tenancy', NULL),
    ('public', 'boost_pack_purchases', 'user_id', 'tenancy', NULL),
    ('public', 'business_addresses', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_action_log', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_conversation', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_plan_cache', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_saved_plans', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_verified_questions', 'user_id', 'tenancy', NULL),
    ('public', 'business_events', 'user_id', 'tenancy', NULL),
    ('public', 'business_health_summaries', 'user_id', 'tenancy', NULL),
    ('public', 'business_intake_forms', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_account_closures', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_account_lineage', 'account_id', 'tenancy', NULL),
    ('public', 'business_os_account_plans', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_billing_accounts', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_billing_events', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_boost_cap_overrides', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_boost_purchases', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_credit_charges', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_credit_lot_draws', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_credit_lots', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_credit_totals', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_data_exports', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_entitlement_overrides', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_entitlement_shadow_events', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_invites', 'issuer_account_id', 'tenancy', NULL),
    ('public', 'business_profiles', 'user_id', 'tenancy', NULL),
    ('public', 'business_subscribers', 'user_id', 'tenancy', NULL),
    ('public', 'calibration_history', 'user_id', 'tenancy', NULL),
    ('public', 'calibration_sessions', 'user_id', 'tenancy', NULL),
    ('public', 'channel_connections', 'user_id', 'tenancy', NULL),
    ('public', 'channel_metrics_daily', 'user_id', 'tenancy', NULL),
    ('public', 'command_sessions', 'user_id', 'tenancy', NULL),
    ('public', 'contact_documents', 'user_id', 'tenancy', NULL),
    ('public', 'credit_transactions', 'user_id', 'tenancy', NULL),
    ('public', 'crm_activities', 'user_id', 'tenancy', NULL),
    ('public', 'crm_contacts', 'user_id', 'tenancy', NULL),
    ('public', 'crm_pipeline_stages', 'user_id', 'tenancy', NULL),
    ('public', 'crm_tasks', 'user_id', 'tenancy', NULL),
    ('public', 'daily_briefing_sends', 'user_id', 'tenancy', NULL),
    ('public', 'daily_briefings', 'user_id', 'tenancy', NULL),
    ('public', 'data_decision_requests', 'user_id', 'tenancy', NULL),
    ('public', 'derived_metrics', 'user_id', 'tenancy', NULL),
    ('public', 'email_campaigns', 'user_id', 'tenancy', NULL),
    ('public', 'email_sends', 'user_id', 'tenancy', NULL),
    ('public', 'email_sequence_enrollments', 'user_id', 'tenancy', NULL),
    ('public', 'email_sequence_steps', 'user_id', 'tenancy', NULL),
    ('public', 'email_sequences', 'user_id', 'tenancy', NULL),
    ('public', 'email_unsubscribes', 'user_id', 'tenancy', NULL),
    ('public', 'error_patterns', 'user_id', 'tenancy', NULL),
    ('public', 'execution_anomalies', 'user_id', 'tenancy', NULL),
    ('public', 'execution_baselines', 'user_id', 'tenancy', NULL),
    ('public', 'execution_insight_runs', 'user_id', 'tenancy', NULL),
    ('public', 'execution_insights', 'user_id', 'tenancy', NULL),
    ('public', 'external_calendar_events', 'user_id', 'tenancy', NULL),
    ('public', 'group_metrics_rollup', 'user_id', 'tenancy', NULL),
    ('public', 'insight_actions', 'user_id', 'tenancy', NULL),
    ('public', 'insight_automations', 'user_id', 'tenancy', NULL),
    ('public', 'insight_hypotheses', 'user_id', 'tenancy', NULL),
    ('public', 'insight_measurements', 'user_id', 'tenancy', NULL),
    ('public', 'insights', 'user_id', 'tenancy', NULL),
    ('public', 'kernel_action_log', 'user_id', 'tenancy', NULL),
    ('public', 'kernel_executions', 'user_id', 'tenancy', NULL),
    ('public', 'lead_responses', 'user_id', 'tenancy', NULL),
    ('public', 'marketing_consent_events', 'user_id', 'tenancy', NULL),
    ('public', 'marketing_consent_settings', 'user_id', 'tenancy', NULL),
    ('public', 'marketing_consent_state', 'user_id', 'tenancy', NULL),
    ('public', 'metric_baselines', 'user_id', 'tenancy', NULL),
    ('public', 'notification_settings', 'user_id', 'tenancy', NULL),
    ('public', 'onboarding_conversations', 'user_id', 'tenancy', NULL),
    ('public', 'onboarding_prompt_ideas', 'user_id', 'tenancy', NULL),
    ('public', 'organization_members', 'user_id', 'tenancy', NULL),
    ('public', 'organizations', 'owner_user_id', 'tenancy', NULL),
    ('public', 'owner_insight_history', 'user_id', 'tenancy', NULL),
    ('public', 'payment_automation_executions', 'user_id', 'tenancy', NULL),
    ('public', 'payment_automation_rules', 'user_id', 'tenancy', NULL),
    ('public', 'payment_events', 'user_id', 'tenancy', NULL),
    ('public', 'payment_invoices', 'user_id', 'tenancy', NULL),
    ('public', 'payment_methods', 'user_id', 'tenancy', NULL),
    ('public', 'payment_plan_installments', 'user_id', 'tenancy', NULL),
    ('public', 'payment_plan_subscriptions', 'user_id', 'tenancy', NULL),
    ('public', 'payment_plans', 'user_id', 'tenancy', NULL),
    ('public', 'payment_processors', 'user_id', 'tenancy', NULL),
    ('public', 'payment_refunds', 'user_id', 'tenancy', NULL),
    ('public', 'payment_reminders', 'user_id', 'tenancy', NULL),
    ('public', 'payment_transactions', 'user_id', 'tenancy', NULL),
    ('public', 'pilot_step_routing_history', 'user_id', 'tenancy', NULL),
    ('public', 'plugin_connections', 'user_id', 'tenancy', NULL),
    ('public', 'plugin_performance', 'user_id', 'tenancy', NULL),
    ('public', 'processed_webhook_events', 'user_id', 'tenancy', NULL),
    ('public', 'profiles', 'id', 'tenancy', NULL),
    ('public', 'proposals', 'user_id', 'tenancy', NULL),
    ('public', 'run_memories', 'user_id', 'tenancy', NULL),
    ('public', 'saved_payment_methods', 'user_id', 'tenancy', NULL),
    ('public', 'scheduling_availability_exceptions', 'user_id', 'tenancy', NULL),
    ('public', 'scheduling_bookings', 'user_id', 'tenancy', NULL),
    ('public', 'scheduling_meetings', 'user_id', 'tenancy', NULL),
    ('public', 'scheduling_services', 'user_id', 'tenancy', NULL),
    ('public', 'security_settings', 'user_id', 'tenancy', NULL),
    ('public', 'shadow_failure_snapshots', 'user_id', 'tenancy', NULL),
    ('public', 'shared_agents', 'user_id', 'tenancy', NULL),
    ('public', 'smart_links', 'user_id', 'tenancy', NULL),
    ('public', 'storage_usage', 'user_id', 'tenancy', NULL),
    ('public', 'stripe_connect_accounts', 'user_id', 'tenancy', NULL),
    ('public', 'subscription_invoices', 'user_id', 'tenancy', NULL),
    ('public', 'subscriptions', 'user_id', 'tenancy', NULL),
    ('public', 'token_usage', 'user_id', 'tenancy', NULL),
    ('public', 'user_capabilities', 'user_id', 'tenancy', NULL),
    ('public', 'user_intake_settings', 'user_id', 'tenancy', NULL),
    ('public', 'user_media', 'user_id', 'tenancy', NULL),
    ('public', 'user_memory', 'user_id', 'tenancy', NULL),
    ('public', 'user_preferences', 'user_id', 'tenancy', NULL),
    ('public', 'user_rewards', 'user_id', 'tenancy', NULL),
    ('public', 'user_subscriptions', 'user_id', 'tenancy', NULL),
    ('public', 'website_content', 'user_id', 'tenancy', NULL),
    ('public', 'website_page_views', 'user_id', 'tenancy', NULL),
    ('public', 'website_pages', 'user_id', 'tenancy', NULL),
    ('public', 'workflow_executions', 'user_id', 'tenancy', NULL),
    ('public', 'admin_users', 'granted_by', 'actor', 'user_id'),
    ('public', 'ais_scoring_weights', 'updated_by', 'actor', NULL),
    ('public', 'ais_system_config', 'updated_by', 'actor', NULL),
    ('public', 'exchange_rate_history', 'changed_by', 'actor', NULL),
    ('public', 'exchange_rates', 'updated_by', 'actor', NULL),
    ('public', 'marketing_consent_events', 'recorded_by', 'actor', 'user_id'),
    ('public', 'shared_agent_imports', 'imported_by_user_id', 'actor', NULL),
    ('public', 'sla_events', 'acknowledged_by', 'actor', NULL),
    ('public', 'system_settings_config', 'updated_by', 'actor', NULL),
    ('storage', 'buckets', 'owner', 'actor', NULL),
    ('storage', 'objects', 'owner', 'actor', NULL)
  ) AS reviewed(fk_schema, fk_table, fk_column, kind, owner_column)
),
fk_rows AS (
  SELECT
    fk_catalog.fk_schema, fk_catalog.fk_table, fk_catalog.fk_column, fk_catalog.key_width, fk_review.kind,
    CASE
      WHEN target.user_id IS NULL OR fk_review.kind = 'tenancy' OR fk_catalog.key_width <> 1 THEN 0
      ELSE (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM %I.%I WHERE %I = %L AND %s', fk_catalog.fk_schema, fk_catalog.fk_table, fk_catalog.fk_column, target.user_id, CASE WHEN fk_review.owner_column IS NULL THEN 'true' ELSE format('%I IS DISTINCT FROM %L', fk_review.owner_column, target.user_id) END), false, true, '')))[1]::text::bigint
    END AS found
  FROM fk_catalog
  CROSS JOIN target
  LEFT JOIN fk_review USING (fk_schema, fk_table, fk_column)
),
inbound_catalog AS (
  SELECT
    con.conname::text AS fk_name,
    child_nsp.nspname::text AS child_schema,
    child_rel.relname::text AS child_table,
    child_att.attname::text AS child_column,
    parent_rel.relname::text AS parent_table,
    parent_att.attname::text AS parent_column,
    cardinality(con.conkey) AS key_width
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS child_rel ON child_rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS child_nsp ON child_nsp.oid = child_rel.relnamespace
  JOIN pg_catalog.pg_attribute AS child_att ON child_att.attrelid = con.conrelid AND child_att.attnum = con.conkey[1]
  JOIN pg_catalog.pg_class AS parent_rel ON parent_rel.oid = con.confrelid
  JOIN pg_catalog.pg_namespace AS parent_nsp ON parent_nsp.oid = parent_rel.relnamespace
  JOIN pg_catalog.pg_attribute AS parent_att ON parent_att.attrelid = con.confrelid AND parent_att.attnum = con.confkey[1]
  WHERE con.contype = 'f' AND parent_nsp.nspname = 'public' AND parent_rel.relname IN (SELECT plan.table_name FROM plan)
),
inbound_review AS (
  SELECT reviewed.child_table, reviewed.fk_name, reviewed.owner_column
  FROM (VALUES
    ('abandoned_bookings'::text, 'abandoned_bookings_booking_id_fkey'::text, 'user_id'::text),
    ('abandoned_bookings', 'abandoned_bookings_business_fk', 'user_id'),
    ('abandoned_bookings', 'abandoned_bookings_service_id_fkey', 'user_id'),
    ('advisor_reports', 'advisor_reports_org_id_fkey', 'user_id'),
    ('agent_configurations', 'agent_configurations_agent_id_fkey', 'user_id'),
    ('agent_executions', 'agent_executions_agent_id_fkey', 'user_id'),
    ('agent_group_memberships', 'agent_group_memberships_agent_id_fkey', NULL),
    ('agent_intensity_metrics', 'agent_intensity_metrics_agent_id_fkey', 'user_id'),
    ('agent_logs', 'agent_logs_agent_id_fkey', 'user_id'),
    ('agent_memory', 'agent_memory_agent_id_fkey', 'user_id'),
    ('agent_prompt_workflow_generation_sessions', 'agent_prompt_workflow_generation_sessions_agent_id_fkey', 'user_id'),
    ('agent_scheduler_state', 'agent_scheduler_state_agent_id_fkey', NULL),
    ('agent_scheduler_state', 'agent_scheduler_state_last_execution_id_fkey', NULL),
    ('agent_stats', 'agent_stats_agent_id_fkey', 'user_id'),
    ('agentkit_analytics', 'agentkit_analytics_agent_id_fkey', 'user_id'),
    ('agents', 'agents_org_id_fkey', 'user_id'),
    ('agents', 'fk_agents_last_calibration', 'user_id'),
    ('automation_slas', 'automation_slas_agent_id_fkey', 'user_id'),
    ('automation_slas', 'automation_slas_org_id_fkey', 'user_id'),
    ('billing_events', 'billing_events_subscription_id_fkey', 'user_id'),
    ('billing_events', 'billing_events_transaction_id_fkey', 'user_id'),
    ('boost_pack_purchases', 'boost_pack_purchases_transaction_id_fkey', 'user_id'),
    ('business_addresses', 'business_addresses_business_fk', 'user_id'),
    ('business_chat_action_log', 'business_chat_action_log_business_fk', 'user_id'),
    ('business_chat_conversation', 'business_chat_conversation_business_fk', 'user_id'),
    ('business_chat_plan_cache', 'business_chat_plan_cache_business_fk', 'user_id'),
    ('business_chat_saved_plans', 'business_chat_saved_plans_business_fk', 'user_id'),
    ('business_chat_verified_questions', 'business_chat_verified_questions_business_fk', 'user_id'),
    ('business_events', 'business_events_business_fk', 'user_id'),
    ('business_events', 'business_events_contact_id_fkey', 'user_id'),
    ('business_health_summaries', 'business_health_summaries_business_fk', 'user_id'),
    ('business_intake_forms', 'business_intake_forms_business_fk', 'user_id'),
    ('business_os_boost_purchases', 'business_os_boost_purchases_lot_id_fkey', 'user_id'),
    ('business_os_boost_reversal_events', 'business_os_boost_reversal_events_purchase_id_fkey', NULL),
    ('business_os_credit_charges', 'business_os_credit_charges_adjusts_action_id_fkey', 'user_id'),
    ('business_os_credit_lot_draws', 'business_os_credit_lot_draws_lot_id_fkey', 'user_id'),
    ('business_os_entitlement_overrides', 'business_os_entitlement_overrides_user_id_fkey', 'user_id'),
    ('business_profiles', 'business_profiles_address_id_fkey', 'user_id'),
    ('business_profiles', 'business_profiles_invoice_address_id_fkey', 'user_id'),
    ('business_subscribers', 'business_subscribers_business_fk', 'user_id'),
    ('business_subscribers', 'business_subscribers_promoted_contact_id_fkey', 'user_id'),
    ('calibration_history', 'calibration_history_agent_id_fkey', 'user_id'),
    ('calibration_history', 'calibration_history_session_id_fkey', 'user_id'),
    ('calibration_sessions', 'calibration_sessions_agent_id_fkey', 'user_id'),
    ('calibration_sessions', 'calibration_sessions_execution_id_fkey', 'user_id'),
    ('calibration_sessions', 'calibration_sessions_user_id_fkey', 'user_id'),
    ('channel_connections', 'channel_connections_business_fk', 'user_id'),
    ('channel_metrics_daily', 'channel_metrics_daily_business_fk', 'user_id'),
    ('contact_documents', 'contact_documents_business_fk', 'user_id'),
    ('contact_documents', 'contact_documents_contact_id_fkey', 'user_id'),
    ('credit_transactions', 'credit_transactions_token_usage_id_fkey', 'user_id'),
    ('crm_activities', 'crm_activities_business_fk', 'user_id'),
    ('crm_activities', 'crm_activities_contact_id_fkey', 'user_id'),
    ('crm_contacts', 'crm_contacts_business_fk', 'user_id'),
    ('crm_pipeline_stages', 'crm_pipeline_stages_business_fk', 'user_id'),
    ('crm_tasks', 'crm_tasks_business_fk', 'user_id'),
    ('crm_tasks', 'crm_tasks_contact_id_fkey', 'user_id'),
    ('daily_briefing_sends', 'daily_briefing_sends_business_fk', 'user_id'),
    ('daily_briefings', 'daily_briefings_business_fk', 'user_id'),
    ('data_decision_requests', 'fk_data_decision_requests_agent', 'user_id'),
    ('data_decision_requests', 'fk_data_decision_requests_execution', 'user_id'),
    ('derived_metrics', 'derived_metrics_business_fk', 'user_id'),
    ('email_campaigns', 'email_campaigns_business_fk', 'user_id'),
    ('email_sends', 'email_sends_booking_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_business_fk', 'user_id'),
    ('email_sends', 'email_sends_campaign_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_contact_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_meeting_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_sequence_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_sequence_step_id_fkey', 'user_id'),
    ('email_sequence_enrollments', 'email_sequence_enrollments_business_fk', 'user_id'),
    ('email_sequence_enrollments', 'email_sequence_enrollments_contact_id_fkey', 'user_id'),
    ('email_sequence_enrollments', 'email_sequence_enrollments_sequence_id_fkey', 'user_id'),
    ('email_sequence_steps', 'email_sequence_steps_business_fk', 'user_id'),
    ('email_sequence_steps', 'email_sequence_steps_sequence_id_fkey', 'user_id'),
    ('email_sequences', 'email_sequences_business_fk', 'user_id'),
    ('email_unsubscribes', 'email_unsubscribes_contact_id_fkey', 'user_id'),
    ('error_patterns', 'error_patterns_agent_id_fkey', 'user_id'),
    ('execution_anomalies', 'execution_anomalies_agent_id_fkey', 'user_id'),
    ('execution_anomalies', 'execution_anomalies_execution_id_fkey', 'user_id'),
    ('execution_baselines', 'execution_baselines_agent_id_fkey', 'user_id'),
    ('execution_insight_runs', 'execution_insight_runs_agent_id_fkey', 'user_id'),
    ('execution_insight_runs', 'execution_insight_runs_execution_id_fkey', 'user_id'),
    ('execution_insight_runs', 'execution_insight_runs_insight_id_fkey', 'user_id'),
    ('execution_insights', 'execution_insights_agent_id_fkey', 'user_id'),
    ('execution_insights', 'execution_insights_org_id_fkey', 'user_id'),
    ('execution_metrics', 'execution_metrics_agent_id_fkey', NULL),
    ('execution_metrics', 'execution_metrics_execution_id_fkey', NULL),
    ('execution_routing_decisions', 'execution_routing_decisions_execution_id_fkey', NULL),
    ('external_calendar_events', 'external_calendar_events_business_fk', 'user_id'),
    ('group_metrics_rollup', 'group_metrics_rollup_org_id_fkey', 'user_id'),
    ('insight_actions', 'insight_actions_booking_id_fkey', 'user_id'),
    ('insight_actions', 'insight_actions_business_fk', 'user_id'),
    ('insight_actions', 'insight_actions_contact_id_fkey', 'user_id'),
    ('insight_actions', 'insight_actions_insight_id_fkey', 'user_id'),
    ('insight_actions', 'insight_actions_invoice_id_fkey', 'user_id'),
    ('insight_automations', 'insight_automations_business_fk', 'user_id'),
    ('insight_automations', 'insight_automations_created_from_insight_id_fkey', 'user_id'),
    ('insight_automations', 'insight_automations_last_run_execution_id_fkey', 'user_id'),
    ('insight_hypotheses', 'insight_hypotheses_business_fk', 'user_id'),
    ('insight_measurements', 'insight_measurements_business_fk', 'user_id'),
    ('insight_measurements', 'insight_measurements_insight_id_fkey', 'user_id'),
    ('insights', 'insights_business_fk', 'user_id'),
    ('insights', 'insights_correlation_parent_id_fkey', 'user_id'),
    ('kernel_action_log', 'kernel_action_log_execution_id_fkey', 'user_id'),
    ('kernel_action_log', 'kernel_action_log_insight_id_fkey', 'user_id'),
    ('kernel_executions', 'kernel_executions_insight_id_fkey', 'user_id'),
    ('lead_responses', 'lead_responses_business_fk', 'user_id'),
    ('lead_responses', 'lead_responses_contact_id_fkey', 'user_id'),
    ('marketing_consent_events', 'marketing_consent_events_contact_id_fkey', 'user_id'),
    ('marketing_consent_settings', 'marketing_consent_settings_business_fk', 'user_id'),
    ('marketing_consent_state', 'marketing_consent_state_contact_id_fkey', 'user_id'),
    ('metric_baselines', 'metric_baselines_org_id_fkey', 'user_id'),
    ('onboarding_prompt_ideas', 'onboarding_prompt_ideas_agent_created_id_fkey', 'user_id'),
    ('organization_members', 'organization_members_org_id_fkey', 'user_id'),
    ('owner_insight_history', 'owner_insight_history_business_fk', 'user_id'),
    ('owner_insight_history', 'owner_insight_history_insight_id_fkey', 'user_id'),
    ('payment_automation_executions', 'payment_automation_executions_business_fk', 'user_id'),
    ('payment_automation_executions', 'payment_automation_executions_rule_id_fkey', 'user_id'),
    ('payment_automation_executions', 'payment_automation_executions_trigger_event_id_fkey', 'user_id'),
    ('payment_automation_rules', 'payment_automation_rules_business_fk', 'user_id'),
    ('payment_events', 'payment_events_business_fk', 'user_id'),
    ('payment_events', 'payment_events_contact_id_fkey', 'user_id'),
    ('payment_invoices', 'payment_invoices_booking_id_fkey', 'user_id'),
    ('payment_invoices', 'payment_invoices_business_fk', 'user_id'),
    ('payment_invoices', 'payment_invoices_contact_id_fkey', 'user_id'),
    ('payment_invoices', 'payment_invoices_service_id_fkey', 'user_id'),
    ('payment_methods', 'payment_methods_business_fk', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_booking_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_business_fk', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_contact_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_invoice_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_meeting_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_payment_plan_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_proposal_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_subscription_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_transaction_id_fkey', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_booking_id_fkey', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_business_fk', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_contact_id_fkey', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_payment_plan_id_fkey', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_service_id_fkey', 'user_id'),
    ('payment_plans', 'payment_plans_business_fk', 'user_id'),
    ('payment_plans', 'payment_plans_service_id_fkey', 'user_id'),
    ('payment_processors', 'payment_processors_business_fk', 'user_id'),
    ('payment_refunds', 'payment_refunds_business_fk', 'user_id'),
    ('payment_refunds', 'payment_refunds_invoice_id_fkey', 'user_id'),
    ('payment_refunds', 'payment_refunds_transaction_id_fkey', 'user_id'),
    ('payment_reminders', 'payment_reminders_business_fk', 'user_id'),
    ('payment_reminders', 'payment_reminders_contact_id_fkey', 'user_id'),
    ('payment_reminders', 'payment_reminders_installment_id_fkey', 'user_id'),
    ('payment_reminders', 'payment_reminders_invoice_id_fkey', 'user_id'),
    ('payment_transactions', 'payment_transactions_booking_id_fkey', 'user_id'),
    ('payment_transactions', 'payment_transactions_business_fk', 'user_id'),
    ('payment_transactions', 'payment_transactions_contact_id_fkey', 'user_id'),
    ('payment_transactions', 'payment_transactions_invoice_id_fkey', 'user_id'),
    ('payment_transactions', 'payment_transactions_service_id_fkey', 'user_id'),
    ('plugin_performance', 'plugin_performance_agent_id_fkey', 'user_id'),
    ('profiles', 'profiles_org_id_fkey', 'id'),
    ('proposals', 'proposals_booking_id_fkey', 'user_id'),
    ('proposals', 'proposals_business_fk', 'user_id'),
    ('proposals', 'proposals_contact_id_fkey', 'user_id'),
    ('proposals', 'proposals_created_invoice_id_fkey', 'user_id'),
    ('proposals', 'proposals_created_plan_id_fkey', 'user_id'),
    ('proposals', 'proposals_document_id_fkey', 'user_id'),
    ('proposals', 'proposals_package_booking_id_fkey', 'user_id'),
    ('proposals', 'proposals_service_id_fkey', 'user_id'),
    ('proposals', 'proposals_supersedes_id_fkey', 'user_id'),
    ('run_memories', 'run_memories_agent_id_fkey', 'user_id'),
    ('saved_payment_methods', 'saved_payment_methods_business_fk', 'user_id'),
    ('saved_payment_methods', 'saved_payment_methods_contact_id_fkey', 'user_id'),
    ('scheduling_availability_exceptions', 'scheduling_availability_exceptions_business_fk', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_business_fk', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_contact_id_fkey', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_invoice_id_fkey', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_parent_booking_id_fkey', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_payment_plan_id_fkey', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_service_id_fkey', 'user_id'),
    ('scheduling_meetings', 'scheduling_meetings_booking_id_fkey', 'user_id'),
    ('scheduling_meetings', 'scheduling_meetings_business_fk', 'user_id'),
    ('scheduling_services', 'scheduling_services_business_fk', 'user_id'),
    ('shadow_failure_snapshots', 'shadow_failure_snapshots_agent_id_fkey', 'user_id'),
    ('shared_agent_imports', 'shared_agent_imports_created_agent_id_fkey', 'imported_by_user_id'),
    ('shared_agent_imports', 'shared_agent_imports_shared_agent_id_fkey', 'imported_by_user_id'),
    ('shared_agents', 'fk_shared_agents_original_agent', 'user_id'),
    ('sla_events', 'sla_events_sla_id_fkey', NULL),
    ('smart_link_clicks', 'smart_link_clicks_smart_link_id_fkey', NULL),
    ('smart_links', 'smart_links_business_fk', 'user_id'),
    ('stripe_connect_accounts', 'stripe_connect_accounts_business_fk', 'user_id'),
    ('user_capabilities', 'user_capabilities_business_fk', 'user_id'),
    ('user_capability_blocks', 'user_capability_blocks_user_capability_id_fkey', NULL),
    ('user_intake_settings', 'user_intake_settings_business_fk', 'user_id'),
    ('user_media', 'user_media_business_fk', 'user_id'),
    ('user_memory', 'user_memory_source_agent_id_fkey', 'user_id'),
    ('user_rewards', 'user_rewards_transaction_id_fkey', 'user_id'),
    ('website_blocks', 'website_blocks_page_id_fkey', NULL),
    ('website_content', 'website_content_business_fk', 'user_id'),
    ('website_page_views', 'website_page_views_business_fk', 'user_id'),
    ('website_page_views', 'website_page_views_page_id_fkey', 'user_id'),
    ('website_pages', 'website_pages_business_fk', 'user_id'),
    ('workflow_groups', 'workflow_groups_org_id_fkey', NULL)
  ) AS reviewed(child_table, fk_name, owner_column)
),
inbound_joined AS (
  SELECT
    inbound_catalog.*,
    inbound_review.child_table IS NOT NULL AND inbound_catalog.child_schema = 'public' AS reviewed,
    inbound_review.owner_column,
    (inbound_review.owner_column IS NULL OR EXISTS (
      SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = inbound_catalog.child_schema AND cols.table_name = inbound_catalog.child_table AND cols.column_name = inbound_review.owner_column
    )) AS owner_ok,
    CASE WHEN plan.parent_table IS NULL
      THEN format('%I = %L', plan.key_column, target.user_id)
      ELSE format('%I IN (SELECT id FROM public.%I WHERE user_id = %L)', plan.key_column, plan.parent_table, target.user_id)
    END AS parent_predicate,
    plan.ord AS parent_ord,
    plan.parent_table IS NULL AND inbound_catalog.parent_column = plan.key_column
      AND inbound_catalog.child_column = inbound_review.owner_column AS owner_is_target,
    target.user_id
  FROM inbound_catalog
  JOIN plan ON plan.table_name = inbound_catalog.parent_table
  CROSS JOIN target
  LEFT JOIN inbound_review USING (child_table, fk_name)
),
inbound_parents AS (
  SELECT
    needed.parent_ord,
    (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM (SELECT 1 FROM public.%I WHERE %s LIMIT 1) AS one_row', needed.parent_table, needed.parent_predicate), false, true, '')))[1]::text::bigint AS found
  FROM (
    SELECT DISTINCT inbound_joined.parent_ord, inbound_joined.parent_table, inbound_joined.parent_predicate
    FROM inbound_joined
    WHERE inbound_joined.user_id IS NOT NULL AND inbound_joined.reviewed AND inbound_joined.owner_column IS NOT NULL
      AND inbound_joined.owner_ok AND inbound_joined.key_width = 1 AND NOT inbound_joined.owner_is_target
  ) AS needed
),
inbound_rows AS (
  SELECT
    inbound_joined.*,
    CASE
      WHEN inbound_joined.user_id IS NULL OR NOT inbound_joined.reviewed OR inbound_joined.owner_column IS NULL
        OR NOT inbound_joined.owner_ok OR inbound_joined.key_width <> 1 THEN 0
      WHEN inbound_joined.owner_is_target OR inbound_parents.found = 0 THEN 0
      ELSE (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM %I.%I AS child_rows WHERE child_rows.%I IN (SELECT %I FROM public.%I WHERE %s) AND child_rows.%I IS DISTINCT FROM %L', inbound_joined.child_schema, inbound_joined.child_table, inbound_joined.child_column, inbound_joined.parent_column, inbound_joined.parent_table, inbound_joined.parent_predicate, inbound_joined.owner_column, inbound_joined.user_id), false, true, '')))[1]::text::bigint
    END AS found
  FROM inbound_joined
  LEFT JOIN inbound_parents USING (parent_ord)
),
guard_rows AS (
  SELECT 'G-1'::text AS guard, 'exactly one login has this email'::text AS item, counted.found::bigint AS found, (counted.target_email IS NULL OR counted.found <> 1) AS blocked, 'Edit the email line at the top. It must match exactly one login.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM matches)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-2a'::text AS guard, 'the account id and the email name the same login'::text AS item, counted.found::bigint AS found, (counted.found <> 1) AS blocked, 'The account picked and the email do not resolve to the same login. Reload the page and pick the account again.'::text AS clears, (false) AS info
  FROM (SELECT (CASE WHEN target.user_id IS NOT NULL AND target.user_id = params.subject_id THEN 1 ELSE 0 END) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-4'::text AS guard, 'not a platform admin'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Admins are never removed here. Remove the admin row by hand first if this really is a test account.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.admin_users AS admins WHERE admins.user_id = target.user_id OR lower(admins.email) = params.target_email)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-5'::text AS guard, 'nothing ever ran in Stripe live mode'::text AS item, counted.found::bigint AS found, (false) AS blocked, 'Reported only: real money with us. Our billing rows are kept, with their personal details removed.'::text AS clears, (counted.found > 0) AS info
  FROM (SELECT ((SELECT count(*) FROM public.business_os_billing_accounts AS billing WHERE billing.user_id = target.user_id AND billing.livemode)
      + (SELECT count(*) FROM public.business_os_boost_purchases AS boosts WHERE boosts.user_id = target.user_id AND boosts.livemode)
      + (SELECT count(*) FROM public.business_os_billing_events AS money WHERE money.user_id = target.user_id AND money.livemode)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-6'::text AS guard, 'no live plan subscription, test or live mode'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Cancel the subscription in the Stripe dashboard, in its mode, then wait for the webhook.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.business_os_billing_accounts AS billing WHERE billing.user_id = target.user_id
        AND (billing.subscription_status IN ('active', 'trialing', 'past_due', 'unpaid', 'paused') OR (billing.stripe_subscription_id IS NOT NULL AND billing.ended_at IS NULL)))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-7'::text AS guard, 'legacy subscription with a Stripe id'::text AS item, counted.found::bigint AS found, (false) AS blocked, 'Reported only: legacy money with us. The billing rows are kept, with their personal details removed.'::text AS clears, (counted.found > 0) AS info
  FROM (SELECT ((SELECT count(*) FROM public.user_subscriptions AS legacy WHERE legacy.user_id = target.user_id AND legacy.stripe_subscription_id IS NOT NULL)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-7'::text AS guard, 'legacy credit payment with a Stripe id'::text AS item, counted.found::bigint AS found, (false) AS blocked, 'Reported only: legacy money with us. The billing rows are kept, with their personal details removed.'::text AS clears, (counted.found > 0) AS info
  FROM (SELECT ((SELECT count(*) FROM public.credit_transactions AS legacy WHERE legacy.user_id = target.user_id AND legacy.stripe_payment_intent_id IS NOT NULL)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-7'::text AS guard, 'legacy billing event from Stripe'::text AS item, counted.found::bigint AS found, (false) AS blocked, 'Reported only: legacy money with us. The billing rows are kept, with their personal details removed.'::text AS clears, (counted.found > 0) AS info
  FROM (SELECT ((SELECT count(*) FROM public.billing_events AS legacy WHERE legacy.user_id = target.user_id AND legacy.stripe_event_id IS NOT NULL)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-8'::text AS guard, 'no Stripe account connected for client payments'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Disconnect Stripe from the business first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.stripe_connect_accounts AS connect WHERE connect.user_id = target.user_id)
      + (SELECT count(*) FROM public.plugin_connections AS plugins WHERE plugins.user_id = target.user_id AND plugins.plugin_key = 'stripe')) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-9'::text AS guard, 'money in flight: recurring payment plan(s) still running'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Finish or cancel these in the app first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.payment_plan_subscriptions AS money WHERE money.user_id = target.user_id AND money.status IN ('pending', 'active', 'past_due', 'paused'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-9'::text AS guard, 'money in flight: payment(s) still pending'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Finish or cancel these in the app first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.payment_transactions AS money WHERE money.user_id = target.user_id AND money.status IN ('pending'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-9'::text AS guard, 'money in flight: refund(s) still in flight'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Finish or cancel these in the app first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.payment_refunds AS money WHERE money.user_id = target.user_id AND money.status IN ('pending'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-9'::text AS guard, 'money in flight: unpaid invoice(s) owed to this business'::text AS item, counted.found::bigint AS found, (false) AS blocked, 'Reported only: these invoices are the business own data and are deleted with the account.'::text AS clears, (counted.found > 0) AS info
  FROM (SELECT ((SELECT count(*) FROM public.payment_invoices AS money WHERE money.user_id = target.user_id AND money.status IN ('sent', 'overdue'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-10'::text AS guard, fk_rows.fk_schema || '.' || fk_rows.fk_table || '.' || fk_rows.fk_column AS item, fk_rows.found::bigint AS found, true AS blocked,
    CASE WHEN fk_rows.kind IS NULL OR fk_rows.key_width <> 1
      THEN 'A link to the login nobody has reviewed. Engineering must classify it in the generator first.'
      ELSE 'Rows of other accounts or of the platform name this login. Clear them by hand first.' END AS clears, false AS info
  FROM fk_rows
  WHERE fk_rows.kind IS NULL OR fk_rows.key_width <> 1 OR (fk_rows.kind = 'actor' AND fk_rows.found > 0)
  UNION ALL
  SELECT 'G-10'::text AS guard, 'links to the login, reviewed'::text AS item, count(*)::bigint AS found, false AS blocked, ''::text AS clears, false AS info FROM fk_catalog
  UNION ALL
  SELECT 'G-11'::text AS guard, plan_state.table_name || '.' || plan_state.key_column AS item, NULL::bigint AS found, true AS blocked,
    'A column this script relies on is missing. Regenerate the script after the schema change.'::text AS clears, false AS info
  FROM plan_state
  WHERE plan_state.present AND NOT (plan_state.key_ok AND plan_state.parent_ok)
  UNION ALL
  SELECT 'G-12'::text AS guard, 'no stored files under the account folder'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Empty the listed folders in the Supabase Storage dashboard, then run the check again.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM storage.objects AS objects WHERE objects.bucket_id IN ('contact-documents', 'website-images', 'business-purge-snapshots', 'business-data-exports') AND starts_with(objects.name, target.user_id::text || '/'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: advisor_reports'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.advisor_reports AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: agents'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.agents AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: automation_slas'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.automation_slas AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: execution_insights'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.execution_insights AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: group_metrics_rollup'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.group_metrics_rollup AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: metric_baselines'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.metric_baselines AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: organization_members'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.organization_members AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: profiles'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.profiles AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-14'::text AS guard, 'no consent ledger rows'::text AS item, counted.found::bigint AS found, (false) AS blocked, 'Reported only: the consent records of the business clients are kept under the closed account (NBQ-3).'::text AS clears, (counted.found > 0) AS info
  FROM (SELECT ((SELECT count(*) FROM public.marketing_consent_events AS consent WHERE consent.user_id = target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-15'::text AS guard, 'nobody else hangs below it in the invitation circle'::text AS item, counted.found::bigint AS found, (false) AS blocked, 'Reported only: the invitation link stays as a nameless link (NBQ-4).'::text AS clears, (counted.found > 0) AS info
  FROM (SELECT ((SELECT count(*) FROM public.business_os_account_lineage AS lineage WHERE (lineage.parent_account_id = target.user_id OR lineage.root_account_id = target.user_id) AND lineage.account_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-16'::text AS guard, 'no other account imported its shared agents'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account imported an agent it shared. Engineering must review this account.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.shared_agent_imports AS imports JOIN public.shared_agents AS shared ON shared.id = imports.shared_agent_id WHERE shared.user_id = target.user_id AND imports.imported_by_user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-17'::text AS guard, rel.relname || '.' || trg.tgname AS item, 1::bigint AS found, true AS blocked,
    'A trigger on a table this script empties has not been reviewed. Engineering must review it in the generator first.'::text AS clears, false AS info
  FROM pg_catalog.pg_trigger AS trg
  JOIN pg_catalog.pg_class AS rel ON rel.oid = trg.tgrelid
  JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public' AND NOT trg.tgisinternal AND (trg.tgtype::integer & 8) <> 0
    AND (
      rel.relname IN (SELECT plan.table_name FROM plan)
      OR rel.oid IN (SELECT fk_con.conrelid FROM pg_catalog.pg_constraint AS fk_con WHERE fk_con.contype = 'f' AND fk_con.confrelid = 'auth.users'::regclass)
      OR rel.relname IN (SELECT inbound_catalog.child_table FROM inbound_catalog WHERE inbound_catalog.child_schema = 'public')
    )
    AND (rel.relname::text, trg.tgname::text) NOT IN (VALUES ('payment_refunds', 'recompute_transaction_refund_state_trigger'), ('storage_usage', 'trigger_update_storage_on_delete'), ('storage_usage', 'trigger_update_storage_used'), ('marketing_consent_events', 'trg_mce_guard'))
  UNION ALL
  SELECT 'G-18'::text AS guard, inbound_rows.child_schema || '.' || inbound_rows.child_table || '.' || inbound_rows.child_column || ' to ' || inbound_rows.parent_table AS item,
    inbound_rows.found::bigint AS found, true AS blocked,
    CASE
      WHEN NOT inbound_rows.reviewed OR inbound_rows.key_width <> 1
        THEN 'A link pointing at a table this script empties has not been reviewed. Engineering must classify it in the generator first.'
      WHEN NOT inbound_rows.owner_ok
        THEN 'The owner column of this link is missing. Regenerate the script after the schema change.'
      ELSE 'Rows of another account point at rows this script removes, and would be deleted or emptied with them. Engineering must review this account.'
    END AS clears, false AS info
  FROM inbound_rows
  WHERE NOT inbound_rows.reviewed OR inbound_rows.key_width <> 1 OR NOT inbound_rows.owner_ok OR inbound_rows.found > 0
  UNION ALL
  SELECT 'G-18'::text AS guard, 'links pointing at removed tables, reviewed'::text AS item, count(*)::bigint AS found, false AS blocked, ''::text AS clears, false AS info FROM inbound_catalog
  UNION ALL
  SELECT 'G-19'::text AS guard, child_plan.table_name || '.' || att.attname || ' to ' || parent_plan.table_name AS item, 1::bigint AS found, true AS blocked,
    'Removing a row of the second table empties a NOT NULL column of the first (ON DELETE SET NULL or SET DEFAULT), which the database refuses, and the plan removes the second table first. Engineering must order the first table before it in the generator.'::text AS clears, false AS info
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS child_rel ON child_rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS child_nsp ON child_nsp.oid = child_rel.relnamespace
  JOIN pg_catalog.pg_class AS parent_rel ON parent_rel.oid = con.confrelid
  JOIN pg_catalog.pg_namespace AS parent_nsp ON parent_nsp.oid = parent_rel.relnamespace
  JOIN plan AS parent_plan ON parent_plan.table_name = parent_rel.relname::text
  JOIN plan AS child_plan ON child_plan.table_name = child_rel.relname::text
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
  WHERE con.contype = 'f' AND con.confdeltype IN ('n', 'd') AND con.conrelid <> con.confrelid
    AND parent_nsp.nspname = 'public' AND child_nsp.nspname = 'public'
    AND att.attnotnull AND (con.confdeltype = 'n' OR NOT att.atthasdef)
    AND child_plan.ord > parent_plan.ord
  UNION ALL
  SELECT 'G-11'::text AS guard, blank_state.table_name || '.' || blank_state.column_name AS item, NULL::bigint AS found, true AS blocked,
    'A column the anonymise blanks, or the column it finds the rows by, is missing or is not jsonb where it must be. Regenerate after the schema change.'::text AS clears, false AS info
  FROM (VALUES
    ('business_os_billing_accounts'::text, 'action_required_invoice_url'::text, false, '{user_id}'::text[]),
    ('business_os_billing_accounts', 'open_checkout_session_id', false, '{user_id}'),
    ('business_os_boost_purchases', 'receipt_url', false, '{user_id}'),
    ('business_os_credit_lots', 'reason', false, '{user_id}'),
    ('business_os_credit_lot_draws', 'reason', false, '{user_id}'),
    ('user_subscriptions', 'payment_method_last4', false, '{user_id}'),
    ('user_subscriptions', 'payment_method_brand', false, '{user_id}'),
    ('user_subscriptions', 'last_calculator_inputs', false, '{user_id}'),
    ('credit_transactions', 'description', false, '{user_id}'),
    ('credit_transactions', 'metadata', true, '{user_id}'),
    ('billing_events', 'payload', true, '{user_id}'),
    ('billing_events', 'error_message', false, '{user_id}'),
    ('token_usage', 'error_message', false, '{user_id}'),
    ('token_usage', 'request_payload', false, '{user_id}'),
    ('token_usage', 'response_metadata', false, '{user_id}'),
    ('token_usage', 'metadata', true, '{user_id}'),
    ('subscription_invoices', 'stripe_invoice_pdf', false, '{user_id}'),
    ('subscription_invoices', 'stripe_hosted_invoice_url', false, '{user_id}'),
    ('subscription_invoices', 'metadata', true, '{user_id}'),
    ('user_rewards', 'metadata', true, '{user_id}'),
    ('business_os_invites', 'email', false, '{redeemed_account_id,claimed_account_id}'),
    ('business_os_invites', 'personal_note', false, '{redeemed_account_id,claimed_account_id}'),
    ('business_os_invites', 'email_problem_detail', false, '{redeemed_account_id,claimed_account_id}'),
    ('business_os_invites', 'redemption_error_message', false, '{redeemed_account_id,claimed_account_id}')
  ) AS blank_state(table_name, column_name, needs_jsonb, key_columns)
  WHERE to_regclass(format('public.%I', blank_state.table_name)) IS NOT NULL
    AND (
      NOT EXISTS (
        SELECT 1 FROM information_schema.columns AS cols
        WHERE cols.table_schema = 'public' AND cols.table_name = blank_state.table_name AND cols.column_name = blank_state.column_name
          AND (NOT blank_state.needs_jsonb OR cols.data_type = 'jsonb')
      )
      OR (SELECT count(*) FROM information_schema.columns AS cols
          WHERE cols.table_schema = 'public' AND cols.table_name = blank_state.table_name AND cols.column_name::text = ANY (blank_state.key_columns))
        <> cardinality(blank_state.key_columns)
    )
  UNION ALL
  SELECT 'G-20'::text AS guard, 'auth.' || needed.table_name || ' is missing' AS item, NULL::bigint AS found, true AS blocked,
    'A table of the auth schema the closure relies on is missing. Supabase changed the auth schema. Engineering must review the generator first.'::text AS clears, false AS info
  FROM (VALUES ('users'::text), ('sessions'), ('mfa_factors'), ('audit_log_entries')) AS needed(table_name)
  WHERE to_regclass(format('auth.%I', needed.table_name)) IS NULL
  UNION ALL
  SELECT 'G-20'::text AS guard, 'auth.' || needed.table_name || '.' || needed.column_name AS item, NULL::bigint AS found, true AS blocked,
    'A column the closure writes or reads is missing. Supabase changed the auth schema. Engineering must review the generator first.'::text AS clears, false AS info
  FROM (VALUES
    ('users'::text, 'email'::text),
    ('users', 'phone'),
    ('users', 'encrypted_password'),
    ('users', 'raw_user_meta_data'),
    ('users', 'raw_app_meta_data'),
    ('users', 'banned_until'),
    ('users', 'confirmation_token'),
    ('users', 'recovery_token'),
    ('users', 'email_change_token_new'),
    ('users', 'email_change_token_current'),
    ('users', 'phone_change_token'),
    ('users', 'reauthentication_token'),
    ('users', 'email_change'),
    ('users', 'phone_change'),
    ('audit_log_entries', 'payload'),
    ('identities'::text, 'user_id'::text),
    ('sessions', 'user_id'),
    ('refresh_tokens', 'user_id'),
    ('mfa_amr_claims', 'session_id'),
    ('mfa_factors', 'user_id'),
    ('mfa_challenges', 'factor_id'),
    ('mfa_recovery_code_sets', 'user_id'),
    ('one_time_tokens', 'user_id'),
    ('oauth_authorizations', 'user_id'),
    ('oauth_consents', 'user_id'),
    ('webauthn_credentials', 'user_id'),
    ('webauthn_challenges', 'user_id'),
    ('flow_state', 'user_id')
  ) AS needed(table_name, column_name)
  WHERE to_regclass(format('auth.%I', needed.table_name)) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = 'auth' AND cols.table_name = needed.table_name AND cols.column_name = needed.column_name
    )
  UNION ALL
  SELECT 'G-20'::text AS guard, 'auth.' || rel.relname || '.' || att.attname || ' links to the login' AS item, 1::bigint AS found, true AS blocked,
    'A table of the auth schema that links to the login or to its sessions has not been reviewed. Engineering must add it to the closure in the generator first.'::text AS clears, false AS info
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND nsp.nspname = 'auth'
    AND con.confrelid IN (SELECT to_regclass('auth.users') UNION ALL SELECT to_regclass('auth.sessions'))
    AND rel.relname::text NOT IN ('identities', 'sessions', 'refresh_tokens', 'mfa_amr_claims', 'mfa_factors', 'mfa_challenges', 'mfa_recovery_code_sets', 'one_time_tokens', 'oauth_authorizations', 'oauth_consents', 'webauthn_credentials', 'webauthn_challenges', 'flow_state', 'scim_users')
  UNION ALL
  SELECT 'G-20'::text AS guard, 'auth.' || cols.table_name || ' has a user_id column' AS item, 1::bigint AS found, true AS blocked,
    'A table of the auth schema names a login without a link (W-5). Engineering must add it to the closure in the generator first.'::text AS clears, false AS info
  FROM information_schema.columns AS cols
  WHERE cols.table_schema = 'auth' AND cols.column_name = 'user_id' AND cols.table_name::text NOT IN ('identities', 'sessions', 'refresh_tokens', 'mfa_amr_claims', 'mfa_factors', 'mfa_challenges', 'mfa_recovery_code_sets', 'one_time_tokens', 'oauth_authorizations', 'oauth_consents', 'webauthn_credentials', 'webauthn_challenges', 'flow_state', 'scim_users')
  UNION ALL
  SELECT 'G-20'::text AS guard, 'auth.' || rel.relname || '.' || att.attname || ' names the login' AS item,
    (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM auth.%I WHERE %I = %L', rel.relname, att.attname, target.user_id), false, true, '')))[1]::text::bigint AS found, true AS blocked,
    'A row of the auth schema that must not exist names the login. Engineering must review this account.'::text AS clears, false AS info
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  CROSS JOIN target
  WHERE con.contype = 'f' AND nsp.nspname = 'auth' AND con.confrelid = 'auth.users'::regclass
    AND rel.relname::text IN ('scim_users') AND target.user_id IS NOT NULL
    AND (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM auth.%I WHERE %I = %L', rel.relname, att.attname, target.user_id), false, true, '')))[1]::text::bigint > 0
  UNION ALL
  SELECT 'G-20'::text AS guard, 'privilege ' || needed.privilege_name || ' on auth.' || needed.table_name AS item, NULL::bigint AS found, true AS blocked,
    'The function owner may not write this auth table. Engineering must review the grants first.'::text AS clears, false AS info
  FROM (VALUES
    ('users'::text, 'UPDATE'::text),
    ('audit_log_entries', 'DELETE'),
    ('identities', 'DELETE'),
    ('sessions', 'DELETE'),
    ('refresh_tokens', 'DELETE'),
    ('mfa_factors', 'DELETE'),
    ('mfa_recovery_code_sets', 'DELETE'),
    ('one_time_tokens', 'DELETE'),
    ('oauth_authorizations', 'DELETE'),
    ('oauth_consents', 'DELETE'),
    ('webauthn_credentials', 'DELETE'),
    ('webauthn_challenges', 'DELETE'),
    ('flow_state', 'DELETE')
  ) AS needed(table_name, privilege_name)
  WHERE to_regclass(format('auth.%I', needed.table_name)) IS NOT NULL
    AND NOT pg_catalog.has_table_privilege(format('auth.%I', needed.table_name), needed.privilege_name)
  UNION ALL
  SELECT 'G-20'::text AS guard, 'auth closure reviewed'::text AS item, 0::bigint AS found, false AS blocked, ''::text AS clears, false AS info
  UNION ALL
  SELECT 'G-21'::text AS guard, nsp.nspname || '.' || rel.relname || '.' || trg.tgname AS item, 1::bigint AS found, true AS blocked,
    'An update trigger on the login or on a table the anonymise blanks has not been reviewed. Engineering must review it in the generator first.'::text AS clears, false AS info
  FROM pg_catalog.pg_trigger AS trg
  JOIN pg_catalog.pg_class AS rel ON rel.oid = trg.tgrelid
  JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  WHERE NOT trg.tgisinternal AND (trg.tgtype::integer & 16) <> 0
    AND ((nsp.nspname = 'auth' AND rel.relname = 'users') OR (nsp.nspname = 'public' AND rel.relname::text IN ('business_os_billing_accounts', 'business_os_boost_purchases', 'business_os_credit_lots', 'business_os_credit_lot_draws', 'user_subscriptions', 'credit_transactions', 'billing_events', 'token_usage', 'subscription_invoices', 'user_rewards', 'business_os_invites')))
    AND (nsp.nspname::text, rel.relname::text, trg.tgname::text) NOT IN (VALUES ('public', 'token_usage', 'update_token_usage_updated_at'), ('public', 'user_subscriptions', 'trigger_update_user_subscriptions_updated_at'))
  UNION ALL
  SELECT 'G-22'::text AS guard, child_rel.relname || '.' || con.conname || ' to ' || parent_rel.relname AS item, 1::bigint AS found, true AS blocked,
    'A kept table links to a table the anonymise empties, so deleting it would change or refuse kept rows. Engineering must review the link in the generator first.'::text AS clears, false AS info
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS child_rel ON child_rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS child_nsp ON child_nsp.oid = child_rel.relnamespace
  JOIN pg_catalog.pg_class AS parent_rel ON parent_rel.oid = con.confrelid
  JOIN pg_catalog.pg_namespace AS parent_nsp ON parent_nsp.oid = parent_rel.relnamespace
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND child_nsp.nspname = 'public' AND parent_nsp.nspname = 'public' AND con.conrelid <> con.confrelid
    AND child_rel.relname::text IN ('business_os_billing_accounts', 'business_os_billing_events', 'business_os_boost_purchases', 'business_os_boost_reversal_events', 'business_os_credit_charges', 'business_os_credit_lots', 'business_os_credit_lot_draws', 'business_os_credit_totals', 'credit_transactions', 'user_subscriptions', 'billing_events', 'processed_webhook_events', 'marketing_consent_events', 'marketing_consent_state', 'business_os_account_lineage', 'token_usage', 'boost_pack_purchases', 'user_rewards', 'subscription_invoices')
    AND parent_rel.relname::text IN (SELECT plan.table_name FROM plan)
    AND (
      (child_rel.relname::text, con.conname::text) NOT IN (VALUES ('marketing_consent_events', 'marketing_consent_events_contact_id_fkey'), ('marketing_consent_state', 'marketing_consent_state_contact_id_fkey'))
      OR con.confdeltype <> 'n' OR att.attnotnull OR cardinality(con.conkey) <> 1
    )
),
removal AS (
  SELECT
    plan_state.ord, plan_state.step, plan_state.table_name, plan_state.present,
    CASE
      WHEN NOT plan_state.present OR NOT (plan_state.key_ok AND plan_state.parent_ok) OR target.user_id IS NULL THEN NULL
      WHEN plan_state.parent_table IS NULL
        THEN (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM public.%I WHERE %I = %L', plan_state.table_name, plan_state.key_column, target.user_id), false, true, '')))[1]::text::bigint
      ELSE (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM public.%I WHERE %I IN (SELECT id FROM public.%I WHERE user_id = %L)', plan_state.table_name, plan_state.key_column, plan_state.parent_table, target.user_id), false, true, '')))[1]::text::bigint
    END AS found
  FROM plan_state
  CROSS JOIN target
),
report AS (
  SELECT 0 AS section_order, 'VERDICT'::text AS section, 0 AS sort_order,
    CASE WHEN (SELECT count(*) FROM guard_rows WHERE guard_rows.blocked) = 0 THEN 'OK' ELSE 'BLOCKED' END AS status,
    'login ' || coalesce((SELECT target.user_id::text FROM target), 'not found') AS item,
    (SELECT count(*) FROM guard_rows WHERE guard_rows.blocked)::bigint AS found,
    CASE WHEN (SELECT count(*) FROM guard_rows WHERE guard_rows.blocked) = 0
      THEN 'Nothing blocks. Rows to remove: ' || coalesce((SELECT sum(removal.found) FROM removal)::text, '0') || '. Run the delete file next.'
      ELSE 'Fix every BLOCKED row below, then run this check again. Do not run the delete file.' END AS detail
  UNION ALL
  SELECT 1, 'guard', substring(guard_rows.guard FROM '[0-9]+')::integer, CASE WHEN guard_rows.blocked THEN 'BLOCKED' WHEN guard_rows.info AND guard_rows.found > 0 THEN 'info' ELSE 'ok' END,
    guard_rows.guard || ' ' || guard_rows.item, guard_rows.found, CASE WHEN guard_rows.blocked OR (guard_rows.info AND guard_rows.found > 0) THEN guard_rows.clears ELSE '' END
  FROM guard_rows
  UNION ALL
  SELECT 2, 'remove', removal.ord,
    CASE WHEN NOT removal.present THEN 'absent' WHEN removal.found IS NULL THEN 'unknown' ELSE 'remove' END,
    removal.step || ' ' || removal.table_name, removal.found, ''
  FROM removal
  WHERE removal.found IS DISTINCT FROM 0 AND (SELECT target.user_id FROM target) IS NOT NULL
  UNION ALL
  SELECT 3, 'storage', 0, 'empty this folder', objects.bucket_id || '/' || objects.name, NULL, 'The delete removes it first.'
  FROM storage.objects AS objects
  CROSS JOIN target
  WHERE objects.bucket_id IN ('contact-documents', 'website-images', 'business-purge-snapshots', 'business-data-exports') AND starts_with(objects.name, target.user_id::text || '/')
  UNION ALL
  SELECT 5, 'kept', kept_values.ord, 'kept', kept_values.table_name,
    CASE WHEN target.user_id IS NULL THEN NULL
      ELSE (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM public.%I WHERE %I = %L', kept_values.table_name, kept_values.key_column, target.user_id), false, true, '')))[1]::text::bigint END,
    'Kept under the same account id. Personal columns are blanked.'
  FROM (VALUES
    (1, 'business_os_billing_accounts'::text, 'user_id'::text),
    (2, 'business_os_billing_events', 'user_id'),
    (3, 'business_os_boost_purchases', 'user_id'),
    (4, 'business_os_credit_charges', 'user_id'),
    (5, 'business_os_credit_lots', 'user_id'),
    (6, 'business_os_credit_lot_draws', 'user_id'),
    (7, 'business_os_credit_totals', 'user_id'),
    (8, 'credit_transactions', 'user_id'),
    (9, 'user_subscriptions', 'user_id'),
    (10, 'billing_events', 'user_id'),
    (11, 'processed_webhook_events', 'user_id'),
    (12, 'marketing_consent_events', 'user_id'),
    (13, 'marketing_consent_state', 'user_id'),
    (14, 'business_os_account_lineage', 'account_id'),
    (15, 'token_usage', 'user_id'),
    (16, 'boost_pack_purchases', 'user_id'),
    (17, 'user_rewards', 'user_id'),
    (18, 'subscription_invoices', 'user_id')
  ) AS kept_values(ord, table_name, key_column)
  CROSS JOIN target
  WHERE EXISTS (
    SELECT 1 FROM information_schema.columns AS cols
    WHERE cols.table_schema = 'public' AND cols.table_name = kept_values.table_name AND cols.column_name = kept_values.key_column
  )
  UNION ALL
  SELECT 5, 'kept', 1000, 'kept', 'business_os_invites redeemed or claimed by it',
    (SELECT count(*) FROM public.business_os_invites AS invites CROSS JOIN target WHERE invites.redeemed_account_id = target.user_id OR invites.claimed_account_id = target.user_id),
    'Kept for the inviter. The invitee email becomes the closed placeholder and the notes are emptied.'
  UNION ALL
  SELECT 5, 'kept', 1001, 'kept', 'the login (auth.users)', (SELECT count(*) FROM matches),
    'Closed and anonymised in place: placeholder email, no password, phone, identities or sessions, banned. The email can sign up again.'
  WHERE (SELECT target.user_id FROM target) IS NOT NULL
)
SELECT jsonb_agg(jsonb_build_object('section', report.section, 'status', report.status, 'item', report.item, 'found', report.found, 'detail', report.detail)
  ORDER BY report.section_order, report.sort_order, report.item)
FROM report
    );
  ELSIF p_mode = 'delete' THEN
    v_subject_id := (
      SELECT CASE WHEN count(*) = 1 THEN min(users.id::text)::uuid END
      FROM auth.users AS users
      WHERE lower(users.email) = NULLIF(lower(btrim(coalesce(p_email, ''))), '')
    );
DECLARE
  v_email text := NULLIF(lower(btrim(coalesce(current_setting('cleanup.target_email', true), ''))), '');
  v_confirm text := NULLIF(lower(btrim(coalesce(current_setting('cleanup.confirm_email', true), ''))), '');
  v_blockers text;
  v_survivors text;
  v_user_id uuid;
  v_rows bigint;
  v_total bigint := 0;
  v_tables integer := 0;
  v_counts jsonb := '{}'::jsonb;
  v_step record;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'No email on the first edit line. Nothing was removed.';
  END IF;
  IF v_confirm IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'G-3 the confirmation line does not equal the email. Nothing was removed.';
  END IF;

  v_blockers := (
    WITH
params AS (
  SELECT
    NULLIF(lower(btrim(coalesce(current_setting('cleanup.target_email', true), ''))), '') AS target_email,
    NULLIF(lower(btrim(coalesce(current_setting('cleanup.test_tag', true), ''))), '') AS test_tag
),
matches AS (
  SELECT users.id AS user_id
  FROM auth.users AS users
  JOIN params ON lower(users.email) = params.target_email
),
target AS (
  SELECT CASE WHEN (SELECT count(*) FROM matches) = 1 THEN (SELECT matches.user_id FROM matches LIMIT 1) END AS user_id
),
target_orgs AS (
  SELECT orgs.id AS org_id
  FROM public.organizations AS orgs
  JOIN target ON orgs.owner_user_id = target.user_id
),
plan AS (
  SELECT plan_values.ord, plan_values.step, plan_values.table_name, plan_values.key_column, plan_values.parent_table
  FROM (VALUES
    (1, 'A'::text, 'payment_reminders'::text, 'user_id'::text, NULL::text),
    (2, 'A', 'scheduling_meetings', 'user_id', NULL),
    (3, 'A', 'payment_plan_installments', 'user_id', NULL),
    (4, 'A', 'agent_logs', 'user_id', NULL),
    (5, 'A', 'insight_automations', 'user_id', NULL),
    (6, 'A', 'payment_plan_subscriptions', 'user_id', NULL),
    (7, 'A', 'payment_refunds', 'user_id', NULL),
    (8, 'A', 'agent_scheduler_state', 'agent_id', 'agents'),
    (9, 'A', 'abandoned_bookings', 'user_id', NULL),
    (10, 'A', 'agent_memories', 'user_id', NULL),
    (11, 'A', 'agent_memory', 'user_id', NULL),
    (12, 'A', 'agent_prompt_threads', 'user_id', NULL),
    (13, 'A', 'agent_prompt_workflow_generation_sessions', 'user_id', NULL),
    (14, 'A', 'archived_records', 'user_id', NULL),
    (15, 'A', 'audit_trail', 'user_id', NULL),
    (16, 'A', 'business_chat_action_log', 'user_id', NULL),
    (17, 'A', 'business_chat_conversation', 'user_id', NULL),
    (18, 'A', 'business_chat_plan_cache', 'user_id', NULL),
    (19, 'A', 'business_chat_saved_plans', 'user_id', NULL),
    (20, 'A', 'business_chat_verified_questions', 'user_id', NULL),
    (21, 'A', 'business_events', 'user_id', NULL),
    (22, 'A', 'business_health_summaries', 'user_id', NULL),
    (23, 'A', 'business_os_data_exports', 'user_id', NULL),
    (24, 'A', 'business_subscribers', 'user_id', NULL),
    (25, 'A', 'channel_metrics_daily', 'user_id', NULL),
    (26, 'A', 'command_sessions', 'user_id', NULL),
    (27, 'A', 'contact_documents', 'user_id', NULL),
    (28, 'A', 'crm_tasks', 'user_id', NULL),
    (29, 'A', 'daily_briefing_sends', 'user_id', NULL),
    (30, 'A', 'data_decision_requests', 'user_id', NULL),
    (31, 'A', 'derived_metrics', 'user_id', NULL),
    (32, 'A', 'email_sends', 'user_id', NULL),
    (33, 'A', 'email_sequence_enrollments', 'user_id', NULL),
    (34, 'A', 'email_sequence_steps', 'user_id', NULL),
    (35, 'A', 'external_calendar_events', 'user_id', NULL),
    (36, 'A', 'insight_actions', 'user_id', NULL),
    (37, 'A', 'insight_hypotheses', 'user_id', NULL),
    (38, 'A', 'insight_measurements', 'user_id', NULL),
    (39, 'A', 'kernel_action_log', 'user_id', NULL),
    (40, 'A', 'lead_responses', 'user_id', NULL),
    (41, 'A', 'onboarding_conversations', 'user_id', NULL),
    (42, 'A', 'onboarding_prompt_ideas', 'user_id', NULL),
    (43, 'A', 'owner_insight_history', 'user_id', NULL),
    (44, 'A', 'payment_automation_executions', 'user_id', NULL),
    (45, 'A', 'payment_events', 'user_id', NULL),
    (46, 'A', 'payment_methods', 'user_id', NULL),
    (47, 'A', 'proposals', 'user_id', NULL),
    (48, 'A', 'run_memories', 'user_id', NULL),
    (49, 'A', 'saved_payment_methods', 'user_id', NULL),
    (50, 'A', 'scheduling_availability_exceptions', 'user_id', NULL),
    (51, 'A', 'smart_link_clicks', 'smart_link_id', 'smart_links'),
    (52, 'A', 'user_media', 'user_id', NULL),
    (53, 'A', 'user_memory', 'user_id', NULL),
    (54, 'A', 'website_blocks', 'page_id', 'website_pages'),
    (55, 'A', 'website_content', 'user_id', NULL),
    (56, 'A', 'website_page_views', 'user_id', NULL),
    (57, 'A', 'scheduling_bookings', 'user_id', NULL),
    (58, 'A', 'agent_executions', 'user_id', NULL),
    (59, 'A', 'agents', 'user_id', NULL),
    (60, 'A', 'crm_contacts', 'user_id', NULL),
    (61, 'A', 'daily_briefings', 'user_id', NULL),
    (62, 'A', 'email_campaigns', 'user_id', NULL),
    (63, 'A', 'email_sequences', 'user_id', NULL),
    (64, 'A', 'insights', 'user_id', NULL),
    (65, 'A', 'kernel_executions', 'user_id', NULL),
    (66, 'A', 'payment_automation_rules', 'user_id', NULL),
    (67, 'A', 'payment_invoices', 'user_id', NULL),
    (68, 'A', 'payment_plans', 'user_id', NULL),
    (69, 'A', 'payment_transactions', 'user_id', NULL),
    (70, 'A', 'scheduling_services', 'user_id', NULL),
    (71, 'A', 'smart_links', 'user_id', NULL),
    (72, 'A', 'website_pages', 'user_id', NULL),
    (73, 'A', 'user_capability_blocks', 'user_capability_id', 'user_capabilities'),
    (74, 'A', 'business_addresses', 'user_id', NULL),
    (75, 'A', 'business_intake_forms', 'user_id', NULL),
    (76, 'A', 'channel_connections', 'user_id', NULL),
    (77, 'A', 'crm_pipeline_stages', 'user_id', NULL),
    (78, 'A', 'marketing_consent_settings', 'user_id', NULL),
    (79, 'A', 'payment_processors', 'user_id', NULL),
    (80, 'A', 'plugin_connections', 'user_id', NULL),
    (81, 'A', 'stripe_connect_accounts', 'user_id', NULL),
    (82, 'A', 'user_capabilities', 'user_id', NULL),
    (83, 'A', 'user_intake_settings', 'user_id', NULL),
    (84, 'A', 'crm_activities', 'user_id', NULL),
    (85, 'B', 'billing_events', 'user_id', NULL),
    (86, 'B', 'boost_pack_purchases', 'user_id', NULL),
    (87, 'B', 'user_rewards', 'user_id', NULL),
    (88, 'B', 'credit_transactions', 'user_id', NULL),
    (89, 'B', 'token_usage', 'user_id', NULL),
    (90, 'B', 'storage_usage', 'user_id', NULL),
    (91, 'B', 'user_subscriptions', 'user_id', NULL),
    (92, 'B', 'subscriptions', 'user_id', NULL),
    (93, 'B', 'subscription_invoices', 'user_id', NULL),
    (94, 'B', 'business_os_boost_purchases', 'user_id', NULL),
    (95, 'B', 'business_os_credit_lot_draws', 'user_id', NULL),
    (96, 'B', 'business_os_credit_lots', 'user_id', NULL),
    (97, 'B', 'business_os_credit_charges', 'user_id', NULL),
    (98, 'B', 'business_os_credit_totals', 'user_id', NULL),
    (99, 'B', 'business_os_billing_events', 'user_id', NULL),
    (100, 'B', 'business_os_billing_accounts', 'user_id', NULL),
    (101, 'B', 'business_os_boost_cap_overrides', 'user_id', NULL),
    (102, 'B', 'business_os_account_plans', 'user_id', NULL),
    (103, 'B', 'business_os_entitlement_overrides', 'user_id', NULL),
    (104, 'B', 'business_os_entitlement_shadow_events', 'user_id', NULL),
    (105, 'B', 'processed_webhook_events', 'user_id', NULL),
    (106, 'B', 'marketing_consent_state', 'user_id', NULL),
    (107, 'B', 'email_unsubscribes', 'user_id', NULL),
    (108, 'B', 'user_preferences', 'user_id', NULL),
    (109, 'B', 'notification_settings', 'user_id', NULL),
    (110, 'B', 'security_settings', 'user_id', NULL),
    (111, 'B', 'api_keys', 'user_id', NULL),
    (112, 'B', 'audit_logs', 'user_id', NULL),
    (113, 'B', 'auth_handoff_codes', 'user_id', NULL),
    (114, 'B', 'business_os_account_closures', 'user_id', NULL),
    (115, 'B', 'agent_configurations', 'user_id', NULL),
    (116, 'B', 'agent_execution_logs', 'user_id', NULL),
    (117, 'B', 'agent_intensity_metrics', 'user_id', NULL),
    (118, 'B', 'agent_stats', 'user_id', NULL),
    (119, 'B', 'agent_templates', 'user_id', NULL),
    (120, 'B', 'agentkit_analytics', 'user_id', NULL),
    (121, 'B', 'calibration_history', 'user_id', NULL),
    (122, 'B', 'calibration_sessions', 'user_id', NULL),
    (123, 'B', 'error_patterns', 'user_id', NULL),
    (124, 'B', 'execution_anomalies', 'user_id', NULL),
    (125, 'B', 'execution_baselines', 'user_id', NULL),
    (126, 'B', 'execution_insight_runs', 'user_id', NULL),
    (127, 'B', 'execution_insights', 'user_id', NULL),
    (128, 'B', 'pilot_step_routing_history', 'user_id', NULL),
    (129, 'B', 'plugin_performance', 'user_id', NULL),
    (130, 'B', 'shadow_failure_snapshots', 'user_id', NULL),
    (131, 'B', 'shared_agents', 'user_id', NULL),
    (132, 'B', 'workflow_executions', 'user_id', NULL),
    (133, 'B', 'advisor_reports', 'user_id', NULL),
    (134, 'B', 'automation_slas', 'user_id', NULL),
    (135, 'B', 'group_metrics_rollup', 'user_id', NULL),
    (136, 'B', 'metric_baselines', 'user_id', NULL),
    (137, 'B', 'organization_members', 'user_id', NULL),
    (138, 'C', 'business_profiles', 'user_id', NULL),
    (139, 'C', 'profiles', 'id', NULL),
    (140, 'C', 'organizations', 'owner_user_id', NULL),
    (141, 'C', 'business_os_account_lineage', 'account_id', NULL),
    (142, 'C', 'business_os_invites', 'issuer_account_id', NULL)
  ) AS plan_values(ord, step, table_name, key_column, parent_table)
),
plan_state AS (
  SELECT
    plan.*,
    to_regclass(format('public.%I', plan.table_name)) IS NOT NULL AS present,
    EXISTS (
      SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = 'public' AND cols.table_name = plan.table_name AND cols.column_name = plan.key_column
    ) AS key_ok,
    (plan.parent_table IS NULL OR EXISTS (
      SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = 'public' AND cols.table_name = plan.parent_table AND cols.column_name = 'user_id'
    )) AS parent_ok
  FROM plan
),
fk_catalog AS (
  SELECT
    nsp.nspname::text AS fk_schema,
    rel.relname::text AS fk_table,
    att.attname::text AS fk_column,
    cardinality(con.conkey) AS key_width
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND con.confrelid = 'auth.users'::regclass AND nsp.nspname <> 'auth'
),
fk_review AS (
  SELECT reviewed.fk_schema, reviewed.fk_table, reviewed.fk_column, reviewed.kind, reviewed.owner_column
  FROM (VALUES
    ('public'::text, 'abandoned_bookings'::text, 'user_id'::text, 'tenancy'::text, NULL::text),
    ('public', 'admin_users', 'user_id', 'tenancy', NULL),
    ('public', 'advisor_reports', 'user_id', 'tenancy', NULL),
    ('public', 'agent_configurations', 'user_id', 'tenancy', NULL),
    ('public', 'agent_execution_logs', 'user_id', 'tenancy', NULL),
    ('public', 'agent_executions', 'user_id', 'tenancy', NULL),
    ('public', 'agent_intensity_metrics', 'user_id', 'tenancy', NULL),
    ('public', 'agent_logs', 'user_id', 'tenancy', NULL),
    ('public', 'agent_memories', 'user_id', 'tenancy', NULL),
    ('public', 'agent_memory', 'user_id', 'tenancy', NULL),
    ('public', 'agent_prompt_threads', 'user_id', 'tenancy', NULL),
    ('public', 'agent_prompt_workflow_generation_sessions', 'user_id', 'tenancy', NULL),
    ('public', 'agent_stats', 'user_id', 'tenancy', NULL),
    ('public', 'agent_templates', 'user_id', 'tenancy', NULL),
    ('public', 'agentkit_analytics', 'user_id', 'tenancy', NULL),
    ('public', 'agents', 'user_id', 'tenancy', NULL),
    ('public', 'api_keys', 'user_id', 'tenancy', NULL),
    ('public', 'archived_records', 'user_id', 'tenancy', NULL),
    ('public', 'audit_logs', 'user_id', 'tenancy', NULL),
    ('public', 'audit_trail', 'user_id', 'tenancy', NULL),
    ('public', 'auth_handoff_codes', 'user_id', 'tenancy', NULL),
    ('public', 'automation_slas', 'user_id', 'tenancy', NULL),
    ('public', 'billing_events', 'user_id', 'tenancy', NULL),
    ('public', 'boost_pack_purchases', 'user_id', 'tenancy', NULL),
    ('public', 'business_addresses', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_action_log', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_conversation', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_plan_cache', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_saved_plans', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_verified_questions', 'user_id', 'tenancy', NULL),
    ('public', 'business_events', 'user_id', 'tenancy', NULL),
    ('public', 'business_health_summaries', 'user_id', 'tenancy', NULL),
    ('public', 'business_intake_forms', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_account_closures', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_account_lineage', 'account_id', 'tenancy', NULL),
    ('public', 'business_os_account_plans', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_billing_accounts', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_billing_events', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_boost_cap_overrides', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_boost_purchases', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_credit_charges', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_credit_lot_draws', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_credit_lots', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_credit_totals', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_data_exports', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_entitlement_overrides', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_entitlement_shadow_events', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_invites', 'issuer_account_id', 'tenancy', NULL),
    ('public', 'business_profiles', 'user_id', 'tenancy', NULL),
    ('public', 'business_subscribers', 'user_id', 'tenancy', NULL),
    ('public', 'calibration_history', 'user_id', 'tenancy', NULL),
    ('public', 'calibration_sessions', 'user_id', 'tenancy', NULL),
    ('public', 'channel_connections', 'user_id', 'tenancy', NULL),
    ('public', 'channel_metrics_daily', 'user_id', 'tenancy', NULL),
    ('public', 'command_sessions', 'user_id', 'tenancy', NULL),
    ('public', 'contact_documents', 'user_id', 'tenancy', NULL),
    ('public', 'credit_transactions', 'user_id', 'tenancy', NULL),
    ('public', 'crm_activities', 'user_id', 'tenancy', NULL),
    ('public', 'crm_contacts', 'user_id', 'tenancy', NULL),
    ('public', 'crm_pipeline_stages', 'user_id', 'tenancy', NULL),
    ('public', 'crm_tasks', 'user_id', 'tenancy', NULL),
    ('public', 'daily_briefing_sends', 'user_id', 'tenancy', NULL),
    ('public', 'daily_briefings', 'user_id', 'tenancy', NULL),
    ('public', 'data_decision_requests', 'user_id', 'tenancy', NULL),
    ('public', 'derived_metrics', 'user_id', 'tenancy', NULL),
    ('public', 'email_campaigns', 'user_id', 'tenancy', NULL),
    ('public', 'email_sends', 'user_id', 'tenancy', NULL),
    ('public', 'email_sequence_enrollments', 'user_id', 'tenancy', NULL),
    ('public', 'email_sequence_steps', 'user_id', 'tenancy', NULL),
    ('public', 'email_sequences', 'user_id', 'tenancy', NULL),
    ('public', 'email_unsubscribes', 'user_id', 'tenancy', NULL),
    ('public', 'error_patterns', 'user_id', 'tenancy', NULL),
    ('public', 'execution_anomalies', 'user_id', 'tenancy', NULL),
    ('public', 'execution_baselines', 'user_id', 'tenancy', NULL),
    ('public', 'execution_insight_runs', 'user_id', 'tenancy', NULL),
    ('public', 'execution_insights', 'user_id', 'tenancy', NULL),
    ('public', 'external_calendar_events', 'user_id', 'tenancy', NULL),
    ('public', 'group_metrics_rollup', 'user_id', 'tenancy', NULL),
    ('public', 'insight_actions', 'user_id', 'tenancy', NULL),
    ('public', 'insight_automations', 'user_id', 'tenancy', NULL),
    ('public', 'insight_hypotheses', 'user_id', 'tenancy', NULL),
    ('public', 'insight_measurements', 'user_id', 'tenancy', NULL),
    ('public', 'insights', 'user_id', 'tenancy', NULL),
    ('public', 'kernel_action_log', 'user_id', 'tenancy', NULL),
    ('public', 'kernel_executions', 'user_id', 'tenancy', NULL),
    ('public', 'lead_responses', 'user_id', 'tenancy', NULL),
    ('public', 'marketing_consent_events', 'user_id', 'tenancy', NULL),
    ('public', 'marketing_consent_settings', 'user_id', 'tenancy', NULL),
    ('public', 'marketing_consent_state', 'user_id', 'tenancy', NULL),
    ('public', 'metric_baselines', 'user_id', 'tenancy', NULL),
    ('public', 'notification_settings', 'user_id', 'tenancy', NULL),
    ('public', 'onboarding_conversations', 'user_id', 'tenancy', NULL),
    ('public', 'onboarding_prompt_ideas', 'user_id', 'tenancy', NULL),
    ('public', 'organization_members', 'user_id', 'tenancy', NULL),
    ('public', 'organizations', 'owner_user_id', 'tenancy', NULL),
    ('public', 'owner_insight_history', 'user_id', 'tenancy', NULL),
    ('public', 'payment_automation_executions', 'user_id', 'tenancy', NULL),
    ('public', 'payment_automation_rules', 'user_id', 'tenancy', NULL),
    ('public', 'payment_events', 'user_id', 'tenancy', NULL),
    ('public', 'payment_invoices', 'user_id', 'tenancy', NULL),
    ('public', 'payment_methods', 'user_id', 'tenancy', NULL),
    ('public', 'payment_plan_installments', 'user_id', 'tenancy', NULL),
    ('public', 'payment_plan_subscriptions', 'user_id', 'tenancy', NULL),
    ('public', 'payment_plans', 'user_id', 'tenancy', NULL),
    ('public', 'payment_processors', 'user_id', 'tenancy', NULL),
    ('public', 'payment_refunds', 'user_id', 'tenancy', NULL),
    ('public', 'payment_reminders', 'user_id', 'tenancy', NULL),
    ('public', 'payment_transactions', 'user_id', 'tenancy', NULL),
    ('public', 'pilot_step_routing_history', 'user_id', 'tenancy', NULL),
    ('public', 'plugin_connections', 'user_id', 'tenancy', NULL),
    ('public', 'plugin_performance', 'user_id', 'tenancy', NULL),
    ('public', 'processed_webhook_events', 'user_id', 'tenancy', NULL),
    ('public', 'profiles', 'id', 'tenancy', NULL),
    ('public', 'proposals', 'user_id', 'tenancy', NULL),
    ('public', 'run_memories', 'user_id', 'tenancy', NULL),
    ('public', 'saved_payment_methods', 'user_id', 'tenancy', NULL),
    ('public', 'scheduling_availability_exceptions', 'user_id', 'tenancy', NULL),
    ('public', 'scheduling_bookings', 'user_id', 'tenancy', NULL),
    ('public', 'scheduling_meetings', 'user_id', 'tenancy', NULL),
    ('public', 'scheduling_services', 'user_id', 'tenancy', NULL),
    ('public', 'security_settings', 'user_id', 'tenancy', NULL),
    ('public', 'shadow_failure_snapshots', 'user_id', 'tenancy', NULL),
    ('public', 'shared_agents', 'user_id', 'tenancy', NULL),
    ('public', 'smart_links', 'user_id', 'tenancy', NULL),
    ('public', 'storage_usage', 'user_id', 'tenancy', NULL),
    ('public', 'stripe_connect_accounts', 'user_id', 'tenancy', NULL),
    ('public', 'subscription_invoices', 'user_id', 'tenancy', NULL),
    ('public', 'subscriptions', 'user_id', 'tenancy', NULL),
    ('public', 'token_usage', 'user_id', 'tenancy', NULL),
    ('public', 'user_capabilities', 'user_id', 'tenancy', NULL),
    ('public', 'user_intake_settings', 'user_id', 'tenancy', NULL),
    ('public', 'user_media', 'user_id', 'tenancy', NULL),
    ('public', 'user_memory', 'user_id', 'tenancy', NULL),
    ('public', 'user_preferences', 'user_id', 'tenancy', NULL),
    ('public', 'user_rewards', 'user_id', 'tenancy', NULL),
    ('public', 'user_subscriptions', 'user_id', 'tenancy', NULL),
    ('public', 'website_content', 'user_id', 'tenancy', NULL),
    ('public', 'website_page_views', 'user_id', 'tenancy', NULL),
    ('public', 'website_pages', 'user_id', 'tenancy', NULL),
    ('public', 'workflow_executions', 'user_id', 'tenancy', NULL),
    ('public', 'admin_users', 'granted_by', 'actor', 'user_id'),
    ('public', 'ais_scoring_weights', 'updated_by', 'actor', NULL),
    ('public', 'ais_system_config', 'updated_by', 'actor', NULL),
    ('public', 'exchange_rate_history', 'changed_by', 'actor', NULL),
    ('public', 'exchange_rates', 'updated_by', 'actor', NULL),
    ('public', 'marketing_consent_events', 'recorded_by', 'actor', 'user_id'),
    ('public', 'shared_agent_imports', 'imported_by_user_id', 'actor', NULL),
    ('public', 'sla_events', 'acknowledged_by', 'actor', NULL),
    ('public', 'system_settings_config', 'updated_by', 'actor', NULL),
    ('storage', 'buckets', 'owner', 'actor', NULL),
    ('storage', 'objects', 'owner', 'actor', NULL)
  ) AS reviewed(fk_schema, fk_table, fk_column, kind, owner_column)
),
fk_rows AS (
  SELECT
    fk_catalog.fk_schema, fk_catalog.fk_table, fk_catalog.fk_column, fk_catalog.key_width, fk_review.kind,
    CASE
      WHEN target.user_id IS NULL OR fk_review.kind = 'tenancy' OR fk_catalog.key_width <> 1 THEN 0
      ELSE (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM %I.%I WHERE %I = %L AND %s', fk_catalog.fk_schema, fk_catalog.fk_table, fk_catalog.fk_column, target.user_id, CASE WHEN fk_review.owner_column IS NULL THEN 'true' ELSE format('%I IS DISTINCT FROM %L', fk_review.owner_column, target.user_id) END), false, true, '')))[1]::text::bigint
    END AS found
  FROM fk_catalog
  CROSS JOIN target
  LEFT JOIN fk_review USING (fk_schema, fk_table, fk_column)
),
inbound_catalog AS (
  SELECT
    con.conname::text AS fk_name,
    child_nsp.nspname::text AS child_schema,
    child_rel.relname::text AS child_table,
    child_att.attname::text AS child_column,
    parent_rel.relname::text AS parent_table,
    parent_att.attname::text AS parent_column,
    cardinality(con.conkey) AS key_width
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS child_rel ON child_rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS child_nsp ON child_nsp.oid = child_rel.relnamespace
  JOIN pg_catalog.pg_attribute AS child_att ON child_att.attrelid = con.conrelid AND child_att.attnum = con.conkey[1]
  JOIN pg_catalog.pg_class AS parent_rel ON parent_rel.oid = con.confrelid
  JOIN pg_catalog.pg_namespace AS parent_nsp ON parent_nsp.oid = parent_rel.relnamespace
  JOIN pg_catalog.pg_attribute AS parent_att ON parent_att.attrelid = con.confrelid AND parent_att.attnum = con.confkey[1]
  WHERE con.contype = 'f' AND parent_nsp.nspname = 'public' AND parent_rel.relname IN (SELECT plan.table_name FROM plan)
),
inbound_review AS (
  SELECT reviewed.child_table, reviewed.fk_name, reviewed.owner_column
  FROM (VALUES
    ('abandoned_bookings'::text, 'abandoned_bookings_booking_id_fkey'::text, 'user_id'::text),
    ('abandoned_bookings', 'abandoned_bookings_business_fk', 'user_id'),
    ('abandoned_bookings', 'abandoned_bookings_service_id_fkey', 'user_id'),
    ('advisor_reports', 'advisor_reports_org_id_fkey', 'user_id'),
    ('agent_configurations', 'agent_configurations_agent_id_fkey', 'user_id'),
    ('agent_executions', 'agent_executions_agent_id_fkey', 'user_id'),
    ('agent_group_memberships', 'agent_group_memberships_agent_id_fkey', NULL),
    ('agent_intensity_metrics', 'agent_intensity_metrics_agent_id_fkey', 'user_id'),
    ('agent_logs', 'agent_logs_agent_id_fkey', 'user_id'),
    ('agent_memory', 'agent_memory_agent_id_fkey', 'user_id'),
    ('agent_prompt_workflow_generation_sessions', 'agent_prompt_workflow_generation_sessions_agent_id_fkey', 'user_id'),
    ('agent_scheduler_state', 'agent_scheduler_state_agent_id_fkey', NULL),
    ('agent_scheduler_state', 'agent_scheduler_state_last_execution_id_fkey', NULL),
    ('agent_stats', 'agent_stats_agent_id_fkey', 'user_id'),
    ('agentkit_analytics', 'agentkit_analytics_agent_id_fkey', 'user_id'),
    ('agents', 'agents_org_id_fkey', 'user_id'),
    ('agents', 'fk_agents_last_calibration', 'user_id'),
    ('automation_slas', 'automation_slas_agent_id_fkey', 'user_id'),
    ('automation_slas', 'automation_slas_org_id_fkey', 'user_id'),
    ('billing_events', 'billing_events_subscription_id_fkey', 'user_id'),
    ('billing_events', 'billing_events_transaction_id_fkey', 'user_id'),
    ('boost_pack_purchases', 'boost_pack_purchases_transaction_id_fkey', 'user_id'),
    ('business_addresses', 'business_addresses_business_fk', 'user_id'),
    ('business_chat_action_log', 'business_chat_action_log_business_fk', 'user_id'),
    ('business_chat_conversation', 'business_chat_conversation_business_fk', 'user_id'),
    ('business_chat_plan_cache', 'business_chat_plan_cache_business_fk', 'user_id'),
    ('business_chat_saved_plans', 'business_chat_saved_plans_business_fk', 'user_id'),
    ('business_chat_verified_questions', 'business_chat_verified_questions_business_fk', 'user_id'),
    ('business_events', 'business_events_business_fk', 'user_id'),
    ('business_events', 'business_events_contact_id_fkey', 'user_id'),
    ('business_health_summaries', 'business_health_summaries_business_fk', 'user_id'),
    ('business_intake_forms', 'business_intake_forms_business_fk', 'user_id'),
    ('business_os_boost_purchases', 'business_os_boost_purchases_lot_id_fkey', 'user_id'),
    ('business_os_boost_reversal_events', 'business_os_boost_reversal_events_purchase_id_fkey', NULL),
    ('business_os_credit_charges', 'business_os_credit_charges_adjusts_action_id_fkey', 'user_id'),
    ('business_os_credit_lot_draws', 'business_os_credit_lot_draws_lot_id_fkey', 'user_id'),
    ('business_os_entitlement_overrides', 'business_os_entitlement_overrides_user_id_fkey', 'user_id'),
    ('business_profiles', 'business_profiles_address_id_fkey', 'user_id'),
    ('business_profiles', 'business_profiles_invoice_address_id_fkey', 'user_id'),
    ('business_subscribers', 'business_subscribers_business_fk', 'user_id'),
    ('business_subscribers', 'business_subscribers_promoted_contact_id_fkey', 'user_id'),
    ('calibration_history', 'calibration_history_agent_id_fkey', 'user_id'),
    ('calibration_history', 'calibration_history_session_id_fkey', 'user_id'),
    ('calibration_sessions', 'calibration_sessions_agent_id_fkey', 'user_id'),
    ('calibration_sessions', 'calibration_sessions_execution_id_fkey', 'user_id'),
    ('calibration_sessions', 'calibration_sessions_user_id_fkey', 'user_id'),
    ('channel_connections', 'channel_connections_business_fk', 'user_id'),
    ('channel_metrics_daily', 'channel_metrics_daily_business_fk', 'user_id'),
    ('contact_documents', 'contact_documents_business_fk', 'user_id'),
    ('contact_documents', 'contact_documents_contact_id_fkey', 'user_id'),
    ('credit_transactions', 'credit_transactions_token_usage_id_fkey', 'user_id'),
    ('crm_activities', 'crm_activities_business_fk', 'user_id'),
    ('crm_activities', 'crm_activities_contact_id_fkey', 'user_id'),
    ('crm_contacts', 'crm_contacts_business_fk', 'user_id'),
    ('crm_pipeline_stages', 'crm_pipeline_stages_business_fk', 'user_id'),
    ('crm_tasks', 'crm_tasks_business_fk', 'user_id'),
    ('crm_tasks', 'crm_tasks_contact_id_fkey', 'user_id'),
    ('daily_briefing_sends', 'daily_briefing_sends_business_fk', 'user_id'),
    ('daily_briefings', 'daily_briefings_business_fk', 'user_id'),
    ('data_decision_requests', 'fk_data_decision_requests_agent', 'user_id'),
    ('data_decision_requests', 'fk_data_decision_requests_execution', 'user_id'),
    ('derived_metrics', 'derived_metrics_business_fk', 'user_id'),
    ('email_campaigns', 'email_campaigns_business_fk', 'user_id'),
    ('email_sends', 'email_sends_booking_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_business_fk', 'user_id'),
    ('email_sends', 'email_sends_campaign_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_contact_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_meeting_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_sequence_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_sequence_step_id_fkey', 'user_id'),
    ('email_sequence_enrollments', 'email_sequence_enrollments_business_fk', 'user_id'),
    ('email_sequence_enrollments', 'email_sequence_enrollments_contact_id_fkey', 'user_id'),
    ('email_sequence_enrollments', 'email_sequence_enrollments_sequence_id_fkey', 'user_id'),
    ('email_sequence_steps', 'email_sequence_steps_business_fk', 'user_id'),
    ('email_sequence_steps', 'email_sequence_steps_sequence_id_fkey', 'user_id'),
    ('email_sequences', 'email_sequences_business_fk', 'user_id'),
    ('email_unsubscribes', 'email_unsubscribes_contact_id_fkey', 'user_id'),
    ('error_patterns', 'error_patterns_agent_id_fkey', 'user_id'),
    ('execution_anomalies', 'execution_anomalies_agent_id_fkey', 'user_id'),
    ('execution_anomalies', 'execution_anomalies_execution_id_fkey', 'user_id'),
    ('execution_baselines', 'execution_baselines_agent_id_fkey', 'user_id'),
    ('execution_insight_runs', 'execution_insight_runs_agent_id_fkey', 'user_id'),
    ('execution_insight_runs', 'execution_insight_runs_execution_id_fkey', 'user_id'),
    ('execution_insight_runs', 'execution_insight_runs_insight_id_fkey', 'user_id'),
    ('execution_insights', 'execution_insights_agent_id_fkey', 'user_id'),
    ('execution_insights', 'execution_insights_org_id_fkey', 'user_id'),
    ('execution_metrics', 'execution_metrics_agent_id_fkey', NULL),
    ('execution_metrics', 'execution_metrics_execution_id_fkey', NULL),
    ('execution_routing_decisions', 'execution_routing_decisions_execution_id_fkey', NULL),
    ('external_calendar_events', 'external_calendar_events_business_fk', 'user_id'),
    ('group_metrics_rollup', 'group_metrics_rollup_org_id_fkey', 'user_id'),
    ('insight_actions', 'insight_actions_booking_id_fkey', 'user_id'),
    ('insight_actions', 'insight_actions_business_fk', 'user_id'),
    ('insight_actions', 'insight_actions_contact_id_fkey', 'user_id'),
    ('insight_actions', 'insight_actions_insight_id_fkey', 'user_id'),
    ('insight_actions', 'insight_actions_invoice_id_fkey', 'user_id'),
    ('insight_automations', 'insight_automations_business_fk', 'user_id'),
    ('insight_automations', 'insight_automations_created_from_insight_id_fkey', 'user_id'),
    ('insight_automations', 'insight_automations_last_run_execution_id_fkey', 'user_id'),
    ('insight_hypotheses', 'insight_hypotheses_business_fk', 'user_id'),
    ('insight_measurements', 'insight_measurements_business_fk', 'user_id'),
    ('insight_measurements', 'insight_measurements_insight_id_fkey', 'user_id'),
    ('insights', 'insights_business_fk', 'user_id'),
    ('insights', 'insights_correlation_parent_id_fkey', 'user_id'),
    ('kernel_action_log', 'kernel_action_log_execution_id_fkey', 'user_id'),
    ('kernel_action_log', 'kernel_action_log_insight_id_fkey', 'user_id'),
    ('kernel_executions', 'kernel_executions_insight_id_fkey', 'user_id'),
    ('lead_responses', 'lead_responses_business_fk', 'user_id'),
    ('lead_responses', 'lead_responses_contact_id_fkey', 'user_id'),
    ('marketing_consent_events', 'marketing_consent_events_contact_id_fkey', 'user_id'),
    ('marketing_consent_settings', 'marketing_consent_settings_business_fk', 'user_id'),
    ('marketing_consent_state', 'marketing_consent_state_contact_id_fkey', 'user_id'),
    ('metric_baselines', 'metric_baselines_org_id_fkey', 'user_id'),
    ('onboarding_prompt_ideas', 'onboarding_prompt_ideas_agent_created_id_fkey', 'user_id'),
    ('organization_members', 'organization_members_org_id_fkey', 'user_id'),
    ('owner_insight_history', 'owner_insight_history_business_fk', 'user_id'),
    ('owner_insight_history', 'owner_insight_history_insight_id_fkey', 'user_id'),
    ('payment_automation_executions', 'payment_automation_executions_business_fk', 'user_id'),
    ('payment_automation_executions', 'payment_automation_executions_rule_id_fkey', 'user_id'),
    ('payment_automation_executions', 'payment_automation_executions_trigger_event_id_fkey', 'user_id'),
    ('payment_automation_rules', 'payment_automation_rules_business_fk', 'user_id'),
    ('payment_events', 'payment_events_business_fk', 'user_id'),
    ('payment_events', 'payment_events_contact_id_fkey', 'user_id'),
    ('payment_invoices', 'payment_invoices_booking_id_fkey', 'user_id'),
    ('payment_invoices', 'payment_invoices_business_fk', 'user_id'),
    ('payment_invoices', 'payment_invoices_contact_id_fkey', 'user_id'),
    ('payment_invoices', 'payment_invoices_service_id_fkey', 'user_id'),
    ('payment_methods', 'payment_methods_business_fk', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_booking_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_business_fk', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_contact_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_invoice_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_meeting_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_payment_plan_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_proposal_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_subscription_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_transaction_id_fkey', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_booking_id_fkey', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_business_fk', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_contact_id_fkey', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_payment_plan_id_fkey', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_service_id_fkey', 'user_id'),
    ('payment_plans', 'payment_plans_business_fk', 'user_id'),
    ('payment_plans', 'payment_plans_service_id_fkey', 'user_id'),
    ('payment_processors', 'payment_processors_business_fk', 'user_id'),
    ('payment_refunds', 'payment_refunds_business_fk', 'user_id'),
    ('payment_refunds', 'payment_refunds_invoice_id_fkey', 'user_id'),
    ('payment_refunds', 'payment_refunds_transaction_id_fkey', 'user_id'),
    ('payment_reminders', 'payment_reminders_business_fk', 'user_id'),
    ('payment_reminders', 'payment_reminders_contact_id_fkey', 'user_id'),
    ('payment_reminders', 'payment_reminders_installment_id_fkey', 'user_id'),
    ('payment_reminders', 'payment_reminders_invoice_id_fkey', 'user_id'),
    ('payment_transactions', 'payment_transactions_booking_id_fkey', 'user_id'),
    ('payment_transactions', 'payment_transactions_business_fk', 'user_id'),
    ('payment_transactions', 'payment_transactions_contact_id_fkey', 'user_id'),
    ('payment_transactions', 'payment_transactions_invoice_id_fkey', 'user_id'),
    ('payment_transactions', 'payment_transactions_service_id_fkey', 'user_id'),
    ('plugin_performance', 'plugin_performance_agent_id_fkey', 'user_id'),
    ('profiles', 'profiles_org_id_fkey', 'id'),
    ('proposals', 'proposals_booking_id_fkey', 'user_id'),
    ('proposals', 'proposals_business_fk', 'user_id'),
    ('proposals', 'proposals_contact_id_fkey', 'user_id'),
    ('proposals', 'proposals_created_invoice_id_fkey', 'user_id'),
    ('proposals', 'proposals_created_plan_id_fkey', 'user_id'),
    ('proposals', 'proposals_document_id_fkey', 'user_id'),
    ('proposals', 'proposals_package_booking_id_fkey', 'user_id'),
    ('proposals', 'proposals_service_id_fkey', 'user_id'),
    ('proposals', 'proposals_supersedes_id_fkey', 'user_id'),
    ('run_memories', 'run_memories_agent_id_fkey', 'user_id'),
    ('saved_payment_methods', 'saved_payment_methods_business_fk', 'user_id'),
    ('saved_payment_methods', 'saved_payment_methods_contact_id_fkey', 'user_id'),
    ('scheduling_availability_exceptions', 'scheduling_availability_exceptions_business_fk', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_business_fk', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_contact_id_fkey', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_invoice_id_fkey', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_parent_booking_id_fkey', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_payment_plan_id_fkey', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_service_id_fkey', 'user_id'),
    ('scheduling_meetings', 'scheduling_meetings_booking_id_fkey', 'user_id'),
    ('scheduling_meetings', 'scheduling_meetings_business_fk', 'user_id'),
    ('scheduling_services', 'scheduling_services_business_fk', 'user_id'),
    ('shadow_failure_snapshots', 'shadow_failure_snapshots_agent_id_fkey', 'user_id'),
    ('shared_agent_imports', 'shared_agent_imports_created_agent_id_fkey', 'imported_by_user_id'),
    ('shared_agent_imports', 'shared_agent_imports_shared_agent_id_fkey', 'imported_by_user_id'),
    ('shared_agents', 'fk_shared_agents_original_agent', 'user_id'),
    ('sla_events', 'sla_events_sla_id_fkey', NULL),
    ('smart_link_clicks', 'smart_link_clicks_smart_link_id_fkey', NULL),
    ('smart_links', 'smart_links_business_fk', 'user_id'),
    ('stripe_connect_accounts', 'stripe_connect_accounts_business_fk', 'user_id'),
    ('user_capabilities', 'user_capabilities_business_fk', 'user_id'),
    ('user_capability_blocks', 'user_capability_blocks_user_capability_id_fkey', NULL),
    ('user_intake_settings', 'user_intake_settings_business_fk', 'user_id'),
    ('user_media', 'user_media_business_fk', 'user_id'),
    ('user_memory', 'user_memory_source_agent_id_fkey', 'user_id'),
    ('user_rewards', 'user_rewards_transaction_id_fkey', 'user_id'),
    ('website_blocks', 'website_blocks_page_id_fkey', NULL),
    ('website_content', 'website_content_business_fk', 'user_id'),
    ('website_page_views', 'website_page_views_business_fk', 'user_id'),
    ('website_page_views', 'website_page_views_page_id_fkey', 'user_id'),
    ('website_pages', 'website_pages_business_fk', 'user_id'),
    ('workflow_groups', 'workflow_groups_org_id_fkey', NULL)
  ) AS reviewed(child_table, fk_name, owner_column)
),
inbound_joined AS (
  SELECT
    inbound_catalog.*,
    inbound_review.child_table IS NOT NULL AND inbound_catalog.child_schema = 'public' AS reviewed,
    inbound_review.owner_column,
    (inbound_review.owner_column IS NULL OR EXISTS (
      SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = inbound_catalog.child_schema AND cols.table_name = inbound_catalog.child_table AND cols.column_name = inbound_review.owner_column
    )) AS owner_ok,
    CASE WHEN plan.parent_table IS NULL
      THEN format('%I = %L', plan.key_column, target.user_id)
      ELSE format('%I IN (SELECT id FROM public.%I WHERE user_id = %L)', plan.key_column, plan.parent_table, target.user_id)
    END AS parent_predicate,
    plan.ord AS parent_ord,
    plan.parent_table IS NULL AND inbound_catalog.parent_column = plan.key_column
      AND inbound_catalog.child_column = inbound_review.owner_column AS owner_is_target,
    target.user_id
  FROM inbound_catalog
  JOIN plan ON plan.table_name = inbound_catalog.parent_table
  CROSS JOIN target
  LEFT JOIN inbound_review USING (child_table, fk_name)
),
inbound_parents AS (
  SELECT
    needed.parent_ord,
    (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM (SELECT 1 FROM public.%I WHERE %s LIMIT 1) AS one_row', needed.parent_table, needed.parent_predicate), false, true, '')))[1]::text::bigint AS found
  FROM (
    SELECT DISTINCT inbound_joined.parent_ord, inbound_joined.parent_table, inbound_joined.parent_predicate
    FROM inbound_joined
    WHERE inbound_joined.user_id IS NOT NULL AND inbound_joined.reviewed AND inbound_joined.owner_column IS NOT NULL
      AND inbound_joined.owner_ok AND inbound_joined.key_width = 1 AND NOT inbound_joined.owner_is_target
  ) AS needed
),
inbound_rows AS (
  SELECT
    inbound_joined.*,
    CASE
      WHEN inbound_joined.user_id IS NULL OR NOT inbound_joined.reviewed OR inbound_joined.owner_column IS NULL
        OR NOT inbound_joined.owner_ok OR inbound_joined.key_width <> 1 THEN 0
      WHEN inbound_joined.owner_is_target OR inbound_parents.found = 0 THEN 0
      ELSE (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM %I.%I AS child_rows WHERE child_rows.%I IN (SELECT %I FROM public.%I WHERE %s) AND child_rows.%I IS DISTINCT FROM %L', inbound_joined.child_schema, inbound_joined.child_table, inbound_joined.child_column, inbound_joined.parent_column, inbound_joined.parent_table, inbound_joined.parent_predicate, inbound_joined.owner_column, inbound_joined.user_id), false, true, '')))[1]::text::bigint
    END AS found
  FROM inbound_joined
  LEFT JOIN inbound_parents USING (parent_ord)
),
guard_rows AS (
  SELECT 'G-1'::text AS guard, 'exactly one login has this email'::text AS item, counted.found::bigint AS found, (counted.target_email IS NULL OR counted.found <> 1) AS blocked, 'Edit the email line at the top. It must match exactly one login.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM matches)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-2'::text AS guard, 'the email contains the test tag'::text AS item, counted.found::bigint AS found, (counted.test_tag IS NULL OR counted.found <> 1) AS blocked, 'Only an email containing the test tag can be removed. Set the tag line (never empty) or pick a test account.'::text AS clears
  FROM (SELECT (CASE WHEN params.test_tag IS NULL OR params.target_email IS NULL THEN 0 ELSE sign(strpos(params.target_email, params.test_tag)) END) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-4'::text AS guard, 'not a platform admin'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Admins are never removed here. Remove the admin row by hand first if this really is a test account.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.admin_users AS admins WHERE admins.user_id = target.user_id OR lower(admins.email) = params.target_email)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-5'::text AS guard, 'nothing ever ran in Stripe live mode'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Real money. This account is not a test account and must not be removed.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.business_os_billing_accounts AS billing WHERE billing.user_id = target.user_id AND billing.livemode)
      + (SELECT count(*) FROM public.business_os_boost_purchases AS boosts WHERE boosts.user_id = target.user_id AND boosts.livemode)
      + (SELECT count(*) FROM public.business_os_billing_events AS money WHERE money.user_id = target.user_id AND money.livemode)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-6'::text AS guard, 'no live plan subscription, test or live mode'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Cancel the subscription in the Stripe dashboard, in its mode, then wait for the webhook.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.business_os_billing_accounts AS billing WHERE billing.user_id = target.user_id
        AND (billing.subscription_status IN ('active', 'trialing', 'past_due', 'unpaid', 'paused') OR (billing.stripe_subscription_id IS NOT NULL AND billing.ended_at IS NULL)))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-7'::text AS guard, 'legacy subscription with a Stripe id'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Legacy rows carry no Stripe mode, so they are treated as real money. Engineering must review this account.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.user_subscriptions AS legacy WHERE legacy.user_id = target.user_id AND legacy.stripe_subscription_id IS NOT NULL)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-7'::text AS guard, 'legacy credit payment with a Stripe id'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Legacy rows carry no Stripe mode, so they are treated as real money. Engineering must review this account.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.credit_transactions AS legacy WHERE legacy.user_id = target.user_id AND legacy.stripe_payment_intent_id IS NOT NULL)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-7'::text AS guard, 'legacy billing event from Stripe'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Legacy rows carry no Stripe mode, so they are treated as real money. Engineering must review this account.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.billing_events AS legacy WHERE legacy.user_id = target.user_id AND legacy.stripe_event_id IS NOT NULL)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-8'::text AS guard, 'no Stripe account connected for client payments'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Disconnect Stripe from the business first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.stripe_connect_accounts AS connect WHERE connect.user_id = target.user_id)
      + (SELECT count(*) FROM public.plugin_connections AS plugins WHERE plugins.user_id = target.user_id AND plugins.plugin_key = 'stripe')) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-9'::text AS guard, 'money in flight: recurring payment plan(s) still running'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Finish or cancel these in the app first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.payment_plan_subscriptions AS money WHERE money.user_id = target.user_id AND money.status IN ('pending', 'active', 'past_due', 'paused'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-9'::text AS guard, 'money in flight: payment(s) still pending'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Finish or cancel these in the app first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.payment_transactions AS money WHERE money.user_id = target.user_id AND money.status IN ('pending'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-9'::text AS guard, 'money in flight: refund(s) still in flight'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Finish or cancel these in the app first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.payment_refunds AS money WHERE money.user_id = target.user_id AND money.status IN ('pending'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-9'::text AS guard, 'money in flight: unpaid invoice(s) owed to this business'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Finish or cancel these in the app first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.payment_invoices AS money WHERE money.user_id = target.user_id AND money.status IN ('sent', 'overdue'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-10'::text AS guard, fk_rows.fk_schema || '.' || fk_rows.fk_table || '.' || fk_rows.fk_column AS item, fk_rows.found::bigint AS found, true AS blocked,
    CASE WHEN fk_rows.kind IS NULL OR fk_rows.key_width <> 1
      THEN 'A link to the login nobody has reviewed. Engineering must classify it in the generator first.'
      ELSE 'Rows of other accounts or of the platform name this login. Clear them by hand first.' END AS clears
  FROM fk_rows
  WHERE fk_rows.kind IS NULL OR fk_rows.key_width <> 1 OR (fk_rows.kind = 'actor' AND fk_rows.found > 0)
  UNION ALL
  SELECT 'G-10'::text AS guard, 'links to the login, reviewed'::text AS item, count(*)::bigint AS found, false AS blocked, ''::text AS clears FROM fk_catalog
  UNION ALL
  SELECT 'G-11'::text AS guard, plan_state.table_name || '.' || plan_state.key_column AS item, NULL::bigint AS found, true AS blocked,
    'A column this script relies on is missing. Regenerate the script after the schema change.'::text AS clears
  FROM plan_state
  WHERE plan_state.present AND NOT (plan_state.key_ok AND plan_state.parent_ok)
  UNION ALL
  SELECT 'G-12'::text AS guard, 'no stored files under the account folder'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Empty the listed folders in the Supabase Storage dashboard, then run the check again.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM storage.objects AS objects WHERE objects.bucket_id IN ('contact-documents', 'website-images', 'business-purge-snapshots', 'business-data-exports') AND starts_with(objects.name, target.user_id::text || '/'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: advisor_reports'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.advisor_reports AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: agents'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.agents AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: automation_slas'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.automation_slas AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: execution_insights'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.execution_insights AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: group_metrics_rollup'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.group_metrics_rollup AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: metric_baselines'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.metric_baselines AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: organization_members'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.organization_members AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: profiles'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.profiles AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-14'::text AS guard, 'no consent ledger rows'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'The consent ledger is append-only and cannot be removed. This account cannot be cleaned by this script.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.marketing_consent_events AS consent WHERE consent.user_id = target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-15'::text AS guard, 'nobody else hangs below it in the invitation circle'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'It invited an account that still exists. Remove that account first.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.business_os_account_lineage AS lineage WHERE (lineage.parent_account_id = target.user_id OR lineage.root_account_id = target.user_id) AND lineage.account_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-16'::text AS guard, 'no other account imported its shared agents'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account imported an agent it shared. Engineering must review this account.'::text AS clears
  FROM (SELECT ((SELECT count(*) FROM public.shared_agent_imports AS imports JOIN public.shared_agents AS shared ON shared.id = imports.shared_agent_id WHERE shared.user_id = target.user_id AND imports.imported_by_user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-17'::text AS guard, rel.relname || '.' || trg.tgname AS item, 1::bigint AS found, true AS blocked,
    'A trigger on a table this script empties has not been reviewed. Engineering must review it in the generator first.'::text AS clears
  FROM pg_catalog.pg_trigger AS trg
  JOIN pg_catalog.pg_class AS rel ON rel.oid = trg.tgrelid
  JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public' AND NOT trg.tgisinternal AND (trg.tgtype::integer & 8) <> 0
    AND (
      rel.relname IN (SELECT plan.table_name FROM plan)
      OR rel.oid IN (SELECT fk_con.conrelid FROM pg_catalog.pg_constraint AS fk_con WHERE fk_con.contype = 'f' AND fk_con.confrelid = 'auth.users'::regclass)
      OR rel.relname IN (SELECT inbound_catalog.child_table FROM inbound_catalog WHERE inbound_catalog.child_schema = 'public')
    )
    AND (rel.relname::text, trg.tgname::text) NOT IN (VALUES ('payment_refunds', 'recompute_transaction_refund_state_trigger'), ('storage_usage', 'trigger_update_storage_on_delete'), ('storage_usage', 'trigger_update_storage_used'), ('marketing_consent_events', 'trg_mce_guard'))
  UNION ALL
  SELECT 'G-18'::text AS guard, inbound_rows.child_schema || '.' || inbound_rows.child_table || '.' || inbound_rows.child_column || ' to ' || inbound_rows.parent_table AS item,
    inbound_rows.found::bigint AS found, true AS blocked,
    CASE
      WHEN NOT inbound_rows.reviewed OR inbound_rows.key_width <> 1
        THEN 'A link pointing at a table this script empties has not been reviewed. Engineering must classify it in the generator first.'
      WHEN NOT inbound_rows.owner_ok
        THEN 'The owner column of this link is missing. Regenerate the script after the schema change.'
      ELSE 'Rows of another account point at rows this script removes, and would be deleted or emptied with them. Engineering must review this account.'
    END AS clears
  FROM inbound_rows
  WHERE NOT inbound_rows.reviewed OR inbound_rows.key_width <> 1 OR NOT inbound_rows.owner_ok OR inbound_rows.found > 0
  UNION ALL
  SELECT 'G-18'::text AS guard, 'links pointing at removed tables, reviewed'::text AS item, count(*)::bigint AS found, false AS blocked, ''::text AS clears FROM inbound_catalog
  UNION ALL
  SELECT 'G-19'::text AS guard, child_plan.table_name || '.' || att.attname || ' to ' || parent_plan.table_name AS item, 1::bigint AS found, true AS blocked,
    'Removing a row of the second table empties a NOT NULL column of the first (ON DELETE SET NULL or SET DEFAULT), which the database refuses, and the plan removes the second table first. Engineering must order the first table before it in the generator.'::text AS clears
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS child_rel ON child_rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS child_nsp ON child_nsp.oid = child_rel.relnamespace
  JOIN pg_catalog.pg_class AS parent_rel ON parent_rel.oid = con.confrelid
  JOIN pg_catalog.pg_namespace AS parent_nsp ON parent_nsp.oid = parent_rel.relnamespace
  JOIN plan AS parent_plan ON parent_plan.table_name = parent_rel.relname::text
  JOIN plan AS child_plan ON child_plan.table_name = child_rel.relname::text
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
  WHERE con.contype = 'f' AND con.confdeltype IN ('n', 'd') AND con.conrelid <> con.confrelid
    AND parent_nsp.nspname = 'public' AND child_nsp.nspname = 'public'
    AND att.attnotnull AND (con.confdeltype = 'n' OR NOT att.atthasdef)
    AND child_plan.ord > parent_plan.ord
)
    SELECT string_agg(guard_rows.guard || ' ' || guard_rows.item, ', ' ORDER BY guard_rows.guard, guard_rows.item)
    FROM guard_rows
    WHERE guard_rows.blocked
  );
  IF v_blockers IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCKED, nothing was removed: %', v_blockers;
  END IF;

  v_user_id := (SELECT users.id FROM auth.users AS users WHERE lower(users.email) = v_email);

  FOR v_step IN
    SELECT plan_values.table_name, plan_values.key_column, plan_values.parent_table
    FROM (VALUES
      (1, 'A'::text, 'payment_reminders'::text, 'user_id'::text, NULL::text),
      (2, 'A', 'scheduling_meetings', 'user_id', NULL),
      (3, 'A', 'payment_plan_installments', 'user_id', NULL),
      (4, 'A', 'agent_logs', 'user_id', NULL),
      (5, 'A', 'insight_automations', 'user_id', NULL),
      (6, 'A', 'payment_plan_subscriptions', 'user_id', NULL),
      (7, 'A', 'payment_refunds', 'user_id', NULL),
      (8, 'A', 'agent_scheduler_state', 'agent_id', 'agents'),
      (9, 'A', 'abandoned_bookings', 'user_id', NULL),
      (10, 'A', 'agent_memories', 'user_id', NULL),
      (11, 'A', 'agent_memory', 'user_id', NULL),
      (12, 'A', 'agent_prompt_threads', 'user_id', NULL),
      (13, 'A', 'agent_prompt_workflow_generation_sessions', 'user_id', NULL),
      (14, 'A', 'archived_records', 'user_id', NULL),
      (15, 'A', 'audit_trail', 'user_id', NULL),
      (16, 'A', 'business_chat_action_log', 'user_id', NULL),
      (17, 'A', 'business_chat_conversation', 'user_id', NULL),
      (18, 'A', 'business_chat_plan_cache', 'user_id', NULL),
      (19, 'A', 'business_chat_saved_plans', 'user_id', NULL),
      (20, 'A', 'business_chat_verified_questions', 'user_id', NULL),
      (21, 'A', 'business_events', 'user_id', NULL),
      (22, 'A', 'business_health_summaries', 'user_id', NULL),
      (23, 'A', 'business_os_data_exports', 'user_id', NULL),
      (24, 'A', 'business_subscribers', 'user_id', NULL),
      (25, 'A', 'channel_metrics_daily', 'user_id', NULL),
      (26, 'A', 'command_sessions', 'user_id', NULL),
      (27, 'A', 'contact_documents', 'user_id', NULL),
      (28, 'A', 'crm_tasks', 'user_id', NULL),
      (29, 'A', 'daily_briefing_sends', 'user_id', NULL),
      (30, 'A', 'data_decision_requests', 'user_id', NULL),
      (31, 'A', 'derived_metrics', 'user_id', NULL),
      (32, 'A', 'email_sends', 'user_id', NULL),
      (33, 'A', 'email_sequence_enrollments', 'user_id', NULL),
      (34, 'A', 'email_sequence_steps', 'user_id', NULL),
      (35, 'A', 'external_calendar_events', 'user_id', NULL),
      (36, 'A', 'insight_actions', 'user_id', NULL),
      (37, 'A', 'insight_hypotheses', 'user_id', NULL),
      (38, 'A', 'insight_measurements', 'user_id', NULL),
      (39, 'A', 'kernel_action_log', 'user_id', NULL),
      (40, 'A', 'lead_responses', 'user_id', NULL),
      (41, 'A', 'onboarding_conversations', 'user_id', NULL),
      (42, 'A', 'onboarding_prompt_ideas', 'user_id', NULL),
      (43, 'A', 'owner_insight_history', 'user_id', NULL),
      (44, 'A', 'payment_automation_executions', 'user_id', NULL),
      (45, 'A', 'payment_events', 'user_id', NULL),
      (46, 'A', 'payment_methods', 'user_id', NULL),
      (47, 'A', 'proposals', 'user_id', NULL),
      (48, 'A', 'run_memories', 'user_id', NULL),
      (49, 'A', 'saved_payment_methods', 'user_id', NULL),
      (50, 'A', 'scheduling_availability_exceptions', 'user_id', NULL),
      (51, 'A', 'smart_link_clicks', 'smart_link_id', 'smart_links'),
      (52, 'A', 'user_media', 'user_id', NULL),
      (53, 'A', 'user_memory', 'user_id', NULL),
      (54, 'A', 'website_blocks', 'page_id', 'website_pages'),
      (55, 'A', 'website_content', 'user_id', NULL),
      (56, 'A', 'website_page_views', 'user_id', NULL),
      (57, 'A', 'scheduling_bookings', 'user_id', NULL),
      (58, 'A', 'agent_executions', 'user_id', NULL),
      (59, 'A', 'agents', 'user_id', NULL),
      (60, 'A', 'crm_contacts', 'user_id', NULL),
      (61, 'A', 'daily_briefings', 'user_id', NULL),
      (62, 'A', 'email_campaigns', 'user_id', NULL),
      (63, 'A', 'email_sequences', 'user_id', NULL),
      (64, 'A', 'insights', 'user_id', NULL),
      (65, 'A', 'kernel_executions', 'user_id', NULL),
      (66, 'A', 'payment_automation_rules', 'user_id', NULL),
      (67, 'A', 'payment_invoices', 'user_id', NULL),
      (68, 'A', 'payment_plans', 'user_id', NULL),
      (69, 'A', 'payment_transactions', 'user_id', NULL),
      (70, 'A', 'scheduling_services', 'user_id', NULL),
      (71, 'A', 'smart_links', 'user_id', NULL),
      (72, 'A', 'website_pages', 'user_id', NULL),
      (73, 'A', 'user_capability_blocks', 'user_capability_id', 'user_capabilities'),
      (74, 'A', 'business_addresses', 'user_id', NULL),
      (75, 'A', 'business_intake_forms', 'user_id', NULL),
      (76, 'A', 'channel_connections', 'user_id', NULL),
      (77, 'A', 'crm_pipeline_stages', 'user_id', NULL),
      (78, 'A', 'marketing_consent_settings', 'user_id', NULL),
      (79, 'A', 'payment_processors', 'user_id', NULL),
      (80, 'A', 'plugin_connections', 'user_id', NULL),
      (81, 'A', 'stripe_connect_accounts', 'user_id', NULL),
      (82, 'A', 'user_capabilities', 'user_id', NULL),
      (83, 'A', 'user_intake_settings', 'user_id', NULL),
      (84, 'A', 'crm_activities', 'user_id', NULL),
      (85, 'B', 'billing_events', 'user_id', NULL),
      (86, 'B', 'boost_pack_purchases', 'user_id', NULL),
      (87, 'B', 'user_rewards', 'user_id', NULL),
      (88, 'B', 'credit_transactions', 'user_id', NULL),
      (89, 'B', 'token_usage', 'user_id', NULL),
      (90, 'B', 'storage_usage', 'user_id', NULL),
      (91, 'B', 'user_subscriptions', 'user_id', NULL),
      (92, 'B', 'subscriptions', 'user_id', NULL),
      (93, 'B', 'subscription_invoices', 'user_id', NULL),
      (94, 'B', 'business_os_boost_purchases', 'user_id', NULL),
      (95, 'B', 'business_os_credit_lot_draws', 'user_id', NULL),
      (96, 'B', 'business_os_credit_lots', 'user_id', NULL),
      (97, 'B', 'business_os_credit_charges', 'user_id', NULL),
      (98, 'B', 'business_os_credit_totals', 'user_id', NULL),
      (99, 'B', 'business_os_billing_events', 'user_id', NULL),
      (100, 'B', 'business_os_billing_accounts', 'user_id', NULL),
      (101, 'B', 'business_os_boost_cap_overrides', 'user_id', NULL),
      (102, 'B', 'business_os_account_plans', 'user_id', NULL),
      (103, 'B', 'business_os_entitlement_overrides', 'user_id', NULL),
      (104, 'B', 'business_os_entitlement_shadow_events', 'user_id', NULL),
      (105, 'B', 'processed_webhook_events', 'user_id', NULL),
      (106, 'B', 'marketing_consent_state', 'user_id', NULL),
      (107, 'B', 'email_unsubscribes', 'user_id', NULL),
      (108, 'B', 'user_preferences', 'user_id', NULL),
      (109, 'B', 'notification_settings', 'user_id', NULL),
      (110, 'B', 'security_settings', 'user_id', NULL),
      (111, 'B', 'api_keys', 'user_id', NULL),
      (112, 'B', 'audit_logs', 'user_id', NULL),
      (113, 'B', 'auth_handoff_codes', 'user_id', NULL),
      (114, 'B', 'business_os_account_closures', 'user_id', NULL),
      (115, 'B', 'agent_configurations', 'user_id', NULL),
      (116, 'B', 'agent_execution_logs', 'user_id', NULL),
      (117, 'B', 'agent_intensity_metrics', 'user_id', NULL),
      (118, 'B', 'agent_stats', 'user_id', NULL),
      (119, 'B', 'agent_templates', 'user_id', NULL),
      (120, 'B', 'agentkit_analytics', 'user_id', NULL),
      (121, 'B', 'calibration_history', 'user_id', NULL),
      (122, 'B', 'calibration_sessions', 'user_id', NULL),
      (123, 'B', 'error_patterns', 'user_id', NULL),
      (124, 'B', 'execution_anomalies', 'user_id', NULL),
      (125, 'B', 'execution_baselines', 'user_id', NULL),
      (126, 'B', 'execution_insight_runs', 'user_id', NULL),
      (127, 'B', 'execution_insights', 'user_id', NULL),
      (128, 'B', 'pilot_step_routing_history', 'user_id', NULL),
      (129, 'B', 'plugin_performance', 'user_id', NULL),
      (130, 'B', 'shadow_failure_snapshots', 'user_id', NULL),
      (131, 'B', 'shared_agents', 'user_id', NULL),
      (132, 'B', 'workflow_executions', 'user_id', NULL),
      (133, 'B', 'advisor_reports', 'user_id', NULL),
      (134, 'B', 'automation_slas', 'user_id', NULL),
      (135, 'B', 'group_metrics_rollup', 'user_id', NULL),
      (136, 'B', 'metric_baselines', 'user_id', NULL),
      (137, 'B', 'organization_members', 'user_id', NULL),
      (138, 'C', 'business_profiles', 'user_id', NULL),
      (139, 'C', 'profiles', 'id', NULL),
      (140, 'C', 'organizations', 'owner_user_id', NULL),
      (141, 'C', 'business_os_account_lineage', 'account_id', NULL),
      (142, 'C', 'business_os_invites', 'issuer_account_id', NULL)
    ) AS plan_values(ord, step, table_name, key_column, parent_table)
    ORDER BY plan_values.ord
  LOOP
    IF to_regclass(format('public.%I', v_step.table_name)) IS NULL THEN
      CONTINUE;
    END IF;
    IF v_step.parent_table IS NULL THEN
      EXECUTE format('DELETE FROM public.%I WHERE %I = %L', v_step.table_name, v_step.key_column, v_user_id);
    ELSE
      EXECUTE format('DELETE FROM public.%I WHERE %I IN (SELECT id FROM public.%I WHERE user_id = %L)', v_step.table_name, v_step.key_column, v_step.parent_table, v_user_id);
    END IF;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      v_counts := v_counts || jsonb_build_object(v_step.table_name, v_rows);
      v_total := v_total + v_rows;
      v_tables := v_tables + 1;
    END IF;
  END LOOP;

  DELETE FROM auth.users WHERE id = v_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'The login was not removed. Everything was rolled back.';
  END IF;

  v_survivors := (
    WITH plan_keys AS (
      SELECT plan_values.table_name, plan_values.key_column
      FROM (VALUES
        (1, 'A'::text, 'payment_reminders'::text, 'user_id'::text, NULL::text),
        (2, 'A', 'scheduling_meetings', 'user_id', NULL),
        (3, 'A', 'payment_plan_installments', 'user_id', NULL),
        (4, 'A', 'agent_logs', 'user_id', NULL),
        (5, 'A', 'insight_automations', 'user_id', NULL),
        (6, 'A', 'payment_plan_subscriptions', 'user_id', NULL),
        (7, 'A', 'payment_refunds', 'user_id', NULL),
        (8, 'A', 'agent_scheduler_state', 'agent_id', 'agents'),
        (9, 'A', 'abandoned_bookings', 'user_id', NULL),
        (10, 'A', 'agent_memories', 'user_id', NULL),
        (11, 'A', 'agent_memory', 'user_id', NULL),
        (12, 'A', 'agent_prompt_threads', 'user_id', NULL),
        (13, 'A', 'agent_prompt_workflow_generation_sessions', 'user_id', NULL),
        (14, 'A', 'archived_records', 'user_id', NULL),
        (15, 'A', 'audit_trail', 'user_id', NULL),
        (16, 'A', 'business_chat_action_log', 'user_id', NULL),
        (17, 'A', 'business_chat_conversation', 'user_id', NULL),
        (18, 'A', 'business_chat_plan_cache', 'user_id', NULL),
        (19, 'A', 'business_chat_saved_plans', 'user_id', NULL),
        (20, 'A', 'business_chat_verified_questions', 'user_id', NULL),
        (21, 'A', 'business_events', 'user_id', NULL),
        (22, 'A', 'business_health_summaries', 'user_id', NULL),
        (23, 'A', 'business_os_data_exports', 'user_id', NULL),
        (24, 'A', 'business_subscribers', 'user_id', NULL),
        (25, 'A', 'channel_metrics_daily', 'user_id', NULL),
        (26, 'A', 'command_sessions', 'user_id', NULL),
        (27, 'A', 'contact_documents', 'user_id', NULL),
        (28, 'A', 'crm_tasks', 'user_id', NULL),
        (29, 'A', 'daily_briefing_sends', 'user_id', NULL),
        (30, 'A', 'data_decision_requests', 'user_id', NULL),
        (31, 'A', 'derived_metrics', 'user_id', NULL),
        (32, 'A', 'email_sends', 'user_id', NULL),
        (33, 'A', 'email_sequence_enrollments', 'user_id', NULL),
        (34, 'A', 'email_sequence_steps', 'user_id', NULL),
        (35, 'A', 'external_calendar_events', 'user_id', NULL),
        (36, 'A', 'insight_actions', 'user_id', NULL),
        (37, 'A', 'insight_hypotheses', 'user_id', NULL),
        (38, 'A', 'insight_measurements', 'user_id', NULL),
        (39, 'A', 'kernel_action_log', 'user_id', NULL),
        (40, 'A', 'lead_responses', 'user_id', NULL),
        (41, 'A', 'onboarding_conversations', 'user_id', NULL),
        (42, 'A', 'onboarding_prompt_ideas', 'user_id', NULL),
        (43, 'A', 'owner_insight_history', 'user_id', NULL),
        (44, 'A', 'payment_automation_executions', 'user_id', NULL),
        (45, 'A', 'payment_events', 'user_id', NULL),
        (46, 'A', 'payment_methods', 'user_id', NULL),
        (47, 'A', 'proposals', 'user_id', NULL),
        (48, 'A', 'run_memories', 'user_id', NULL),
        (49, 'A', 'saved_payment_methods', 'user_id', NULL),
        (50, 'A', 'scheduling_availability_exceptions', 'user_id', NULL),
        (51, 'A', 'smart_link_clicks', 'smart_link_id', 'smart_links'),
        (52, 'A', 'user_media', 'user_id', NULL),
        (53, 'A', 'user_memory', 'user_id', NULL),
        (54, 'A', 'website_blocks', 'page_id', 'website_pages'),
        (55, 'A', 'website_content', 'user_id', NULL),
        (56, 'A', 'website_page_views', 'user_id', NULL),
        (57, 'A', 'scheduling_bookings', 'user_id', NULL),
        (58, 'A', 'agent_executions', 'user_id', NULL),
        (59, 'A', 'agents', 'user_id', NULL),
        (60, 'A', 'crm_contacts', 'user_id', NULL),
        (61, 'A', 'daily_briefings', 'user_id', NULL),
        (62, 'A', 'email_campaigns', 'user_id', NULL),
        (63, 'A', 'email_sequences', 'user_id', NULL),
        (64, 'A', 'insights', 'user_id', NULL),
        (65, 'A', 'kernel_executions', 'user_id', NULL),
        (66, 'A', 'payment_automation_rules', 'user_id', NULL),
        (67, 'A', 'payment_invoices', 'user_id', NULL),
        (68, 'A', 'payment_plans', 'user_id', NULL),
        (69, 'A', 'payment_transactions', 'user_id', NULL),
        (70, 'A', 'scheduling_services', 'user_id', NULL),
        (71, 'A', 'smart_links', 'user_id', NULL),
        (72, 'A', 'website_pages', 'user_id', NULL),
        (73, 'A', 'user_capability_blocks', 'user_capability_id', 'user_capabilities'),
        (74, 'A', 'business_addresses', 'user_id', NULL),
        (75, 'A', 'business_intake_forms', 'user_id', NULL),
        (76, 'A', 'channel_connections', 'user_id', NULL),
        (77, 'A', 'crm_pipeline_stages', 'user_id', NULL),
        (78, 'A', 'marketing_consent_settings', 'user_id', NULL),
        (79, 'A', 'payment_processors', 'user_id', NULL),
        (80, 'A', 'plugin_connections', 'user_id', NULL),
        (81, 'A', 'stripe_connect_accounts', 'user_id', NULL),
        (82, 'A', 'user_capabilities', 'user_id', NULL),
        (83, 'A', 'user_intake_settings', 'user_id', NULL),
        (84, 'A', 'crm_activities', 'user_id', NULL),
        (85, 'B', 'billing_events', 'user_id', NULL),
        (86, 'B', 'boost_pack_purchases', 'user_id', NULL),
        (87, 'B', 'user_rewards', 'user_id', NULL),
        (88, 'B', 'credit_transactions', 'user_id', NULL),
        (89, 'B', 'token_usage', 'user_id', NULL),
        (90, 'B', 'storage_usage', 'user_id', NULL),
        (91, 'B', 'user_subscriptions', 'user_id', NULL),
        (92, 'B', 'subscriptions', 'user_id', NULL),
        (93, 'B', 'subscription_invoices', 'user_id', NULL),
        (94, 'B', 'business_os_boost_purchases', 'user_id', NULL),
        (95, 'B', 'business_os_credit_lot_draws', 'user_id', NULL),
        (96, 'B', 'business_os_credit_lots', 'user_id', NULL),
        (97, 'B', 'business_os_credit_charges', 'user_id', NULL),
        (98, 'B', 'business_os_credit_totals', 'user_id', NULL),
        (99, 'B', 'business_os_billing_events', 'user_id', NULL),
        (100, 'B', 'business_os_billing_accounts', 'user_id', NULL),
        (101, 'B', 'business_os_boost_cap_overrides', 'user_id', NULL),
        (102, 'B', 'business_os_account_plans', 'user_id', NULL),
        (103, 'B', 'business_os_entitlement_overrides', 'user_id', NULL),
        (104, 'B', 'business_os_entitlement_shadow_events', 'user_id', NULL),
        (105, 'B', 'processed_webhook_events', 'user_id', NULL),
        (106, 'B', 'marketing_consent_state', 'user_id', NULL),
        (107, 'B', 'email_unsubscribes', 'user_id', NULL),
        (108, 'B', 'user_preferences', 'user_id', NULL),
        (109, 'B', 'notification_settings', 'user_id', NULL),
        (110, 'B', 'security_settings', 'user_id', NULL),
        (111, 'B', 'api_keys', 'user_id', NULL),
        (112, 'B', 'audit_logs', 'user_id', NULL),
        (113, 'B', 'auth_handoff_codes', 'user_id', NULL),
        (114, 'B', 'business_os_account_closures', 'user_id', NULL),
        (115, 'B', 'agent_configurations', 'user_id', NULL),
        (116, 'B', 'agent_execution_logs', 'user_id', NULL),
        (117, 'B', 'agent_intensity_metrics', 'user_id', NULL),
        (118, 'B', 'agent_stats', 'user_id', NULL),
        (119, 'B', 'agent_templates', 'user_id', NULL),
        (120, 'B', 'agentkit_analytics', 'user_id', NULL),
        (121, 'B', 'calibration_history', 'user_id', NULL),
        (122, 'B', 'calibration_sessions', 'user_id', NULL),
        (123, 'B', 'error_patterns', 'user_id', NULL),
        (124, 'B', 'execution_anomalies', 'user_id', NULL),
        (125, 'B', 'execution_baselines', 'user_id', NULL),
        (126, 'B', 'execution_insight_runs', 'user_id', NULL),
        (127, 'B', 'execution_insights', 'user_id', NULL),
        (128, 'B', 'pilot_step_routing_history', 'user_id', NULL),
        (129, 'B', 'plugin_performance', 'user_id', NULL),
        (130, 'B', 'shadow_failure_snapshots', 'user_id', NULL),
        (131, 'B', 'shared_agents', 'user_id', NULL),
        (132, 'B', 'workflow_executions', 'user_id', NULL),
        (133, 'B', 'advisor_reports', 'user_id', NULL),
        (134, 'B', 'automation_slas', 'user_id', NULL),
        (135, 'B', 'group_metrics_rollup', 'user_id', NULL),
        (136, 'B', 'metric_baselines', 'user_id', NULL),
        (137, 'B', 'organization_members', 'user_id', NULL),
        (138, 'C', 'business_profiles', 'user_id', NULL),
        (139, 'C', 'profiles', 'id', NULL),
        (140, 'C', 'organizations', 'owner_user_id', NULL),
        (141, 'C', 'business_os_account_lineage', 'account_id', NULL),
        (142, 'C', 'business_os_invites', 'issuer_account_id', NULL)
      ) AS plan_values(ord, step, table_name, key_column, parent_table)
      WHERE plan_values.parent_table IS NULL
    )
    SELECT string_agg(left_over.item || ' ' || left_over.found, ', ' ORDER BY left_over.item)
    FROM (
      SELECT 'auth.users'::text AS item, (SELECT count(*) FROM auth.users AS users WHERE users.id = v_user_id)::bigint AS found
      UNION ALL
      SELECT plan_keys.table_name,
        (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM public.%I WHERE %I = %L', plan_keys.table_name, plan_keys.key_column, v_user_id), false, true, '')))[1]::text::bigint
      FROM plan_keys
      WHERE to_regclass(format('public.%I', plan_keys.table_name)) IS NOT NULL
      UNION ALL
      SELECT nsp.nspname || '.' || rel.relname || '.' || att.attname,
        (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM %I.%I WHERE %I = %L', nsp.nspname, rel.relname, att.attname, v_user_id), false, true, '')))[1]::text::bigint
      FROM pg_catalog.pg_constraint AS con
      JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
      JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
      JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
      WHERE con.contype = 'f' AND con.confrelid = 'auth.users'::regclass AND nsp.nspname <> 'auth'
        AND NOT (nsp.nspname = 'public' AND (rel.relname::text, att.attname::text) IN (SELECT plan_keys.table_name, plan_keys.key_column FROM plan_keys))
    ) AS left_over
    WHERE left_over.found > 0
  );
  IF v_survivors IS NOT NULL THEN
    RAISE EXCEPTION 'Rows still name the login after the delete, so everything was rolled back: %', v_survivors;
  END IF;

  INSERT INTO public.audit_trail (action, entity_type, entity_id, resource_name, user_id, actor_id, details, severity, compliance_flags, created_at)
  VALUES (
    'BUSINESS_TEST_ACCOUNT_REMOVED', 'user', v_user_id::text, NULL,
    NULLIF(current_setting('cleanup.actor_id', true), '')::uuid, NULLIF(current_setting('cleanup.actor_id', true), '')::uuid,
    jsonb_build_object('source', coalesce(NULLIF(current_setting('cleanup.source', true), ''), 'operator_sql'), 'script', 'scripts/test-account-cleanup-delete.sql', 'tables', v_tables, 'rows', v_total, 'counts', v_counts),
    'warning', ARRAY['SOC2']::text[], now()
  );

  RAISE NOTICE 'CLEAN. Removed % rows from % tables and the login %', v_total, v_tables, v_user_id;
END;
    v_result := (
WITH
recent AS (
  SELECT audit.entity_id, audit.created_at, audit.details
  FROM public.audit_trail AS audit
  WHERE audit.action = 'BUSINESS_TEST_ACCOUNT_REMOVED' AND audit.created_at >= now() - interval '15 minutes'
  ORDER BY audit.created_at DESC
  LIMIT 1
),
per_table AS (
  SELECT counted.key AS table_name, counted.value::bigint AS rows_removed
  FROM recent
  CROSS JOIN LATERAL jsonb_each_text(coalesce(recent.details -> 'counts', '{}'::jsonb)) AS counted
),
summary AS (
  SELECT
    CASE
      WHEN recent.entity_id IS NULL THEN 'NO RECENT REMOVAL'
      WHEN recent.created_at = now() THEN 'CLEAN'
      ELSE 'REMOVED EARLIER'
    END AS result,
    (SELECT coalesce(sum(per_table.rows_removed), 0) FROM per_table)::bigint AS rows_removed,
    (SELECT count(*) FROM per_table)::bigint AS tables_removed,
    recent.entity_id AS removed_login,
    recent.created_at AS removed_at,
    coalesce(recent.created_at = now(), false) AS same_run
  FROM (SELECT 1 AS anchor) AS anchor_row
  LEFT JOIN recent ON true
)
SELECT jsonb_agg(jsonb_build_object('line', report.line, 'rows_removed', report.rows_removed, 'result', report.result,
    'tables_removed', report.tables_removed, 'removed_login', report.removed_login, 'removed_at', report.removed_at, 'same_run', report.same_run)
  ORDER BY report.sort_order, report.line)
FROM (
  SELECT 0 AS sort_order, per_table.table_name AS line, per_table.rows_removed,
    NULL::text AS result, NULL::bigint AS tables_removed, NULL::text AS removed_login, NULL::timestamptz AS removed_at, NULL::boolean AS same_run
  FROM per_table
  UNION ALL
  SELECT 1, 'TOTAL', summary.rows_removed, summary.result, summary.tables_removed, summary.removed_login, summary.removed_at, summary.same_run
  FROM summary
) AS report
    );
    v_receipt_mode := 'full_delete';
    v_removed_rows := (
      SELECT (audit.details ->> 'rows')::bigint FROM public.audit_trail AS audit
      WHERE audit.action = 'BUSINESS_TEST_ACCOUNT_REMOVED' AND audit.entity_id = v_subject_id::text AND audit.created_at = now()
      LIMIT 1
    );
    v_removed_tables := (
      SELECT (audit.details ->> 'tables')::integer FROM public.audit_trail AS audit
      WHERE audit.action = 'BUSINESS_TEST_ACCOUNT_REMOVED' AND audit.entity_id = v_subject_id::text AND audit.created_at = now()
      LIMIT 1
    );
    IF v_subject_id IS NULL OR v_removed_rows IS NULL OR v_removed_tables IS NULL THEN
      RAISE EXCEPTION 'The removal left no audit row to take the receipt totals from, so everything was rolled back.';
    END IF;
    v_report := pg_catalog.jsonb_build_object('receipt_id', v_receipt_id, 'receipt_mode', v_receipt_mode);
  ELSE
DECLARE
  v_email text := NULLIF(lower(btrim(coalesce(current_setting('cleanup.target_email', true), ''))), '');
  v_confirm text := NULLIF(lower(btrim(coalesce(current_setting('cleanup.confirm_email', true), ''))), '');
  v_subject uuid := NULLIF(current_setting('cleanup.subject_id', true), '')::uuid;
  v_guard jsonb;
  v_blockers text;
  v_survivors text;
  v_user_id uuid;
  v_rows bigint;
  v_total bigint := 0;
  v_tables integer := 0;
  v_blanked_total bigint := 0;
  v_counts jsonb := '{}'::jsonb;
  v_blanked jsonb := '{}'::jsonb;
  v_closed jsonb := '{}'::jsonb;
  v_placeholder text;
  v_session_ids uuid[];
  v_factor_ids uuid[];
  v_step record;
  v_blank record;
  v_auth record;
BEGIN
  IF v_email IS NULL OR v_subject IS NULL THEN
    RAISE EXCEPTION 'No email or no account id. Nothing was removed.';
  END IF;
  IF v_confirm IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'G-3 the confirmation does not equal the email. Nothing was removed.';
  END IF;

  v_guard := (
    WITH
params AS (
  SELECT
    NULLIF(lower(btrim(coalesce(current_setting('cleanup.target_email', true), ''))), '') AS target_email,
    NULLIF(lower(btrim(coalesce(current_setting('cleanup.test_tag', true), ''))), '') AS test_tag,
    NULLIF(current_setting('cleanup.subject_id', true), '')::uuid AS subject_id
),
matches AS (
  SELECT users.id AS user_id
  FROM auth.users AS users
  JOIN params ON lower(users.email) = params.target_email
),
target AS (
  SELECT CASE WHEN (SELECT count(*) FROM matches) = 1 THEN (SELECT matches.user_id FROM matches LIMIT 1) END AS user_id
),
target_orgs AS (
  SELECT orgs.id AS org_id
  FROM public.organizations AS orgs
  JOIN target ON orgs.owner_user_id = target.user_id
),
plan AS (
  SELECT plan_values.ord, plan_values.step, plan_values.table_name, plan_values.key_column, plan_values.parent_table
  FROM (VALUES
    (1, 'A'::text, 'payment_reminders'::text, 'user_id'::text, NULL::text),
    (2, 'A', 'scheduling_meetings', 'user_id', NULL),
    (3, 'A', 'payment_plan_installments', 'user_id', NULL),
    (4, 'A', 'agent_logs', 'user_id', NULL),
    (5, 'A', 'insight_automations', 'user_id', NULL),
    (6, 'A', 'payment_plan_subscriptions', 'user_id', NULL),
    (7, 'A', 'payment_refunds', 'user_id', NULL),
    (8, 'A', 'agent_scheduler_state', 'agent_id', 'agents'),
    (9, 'A', 'abandoned_bookings', 'user_id', NULL),
    (10, 'A', 'agent_memories', 'user_id', NULL),
    (11, 'A', 'agent_memory', 'user_id', NULL),
    (12, 'A', 'agent_prompt_threads', 'user_id', NULL),
    (13, 'A', 'agent_prompt_workflow_generation_sessions', 'user_id', NULL),
    (14, 'A', 'archived_records', 'user_id', NULL),
    (15, 'A', 'audit_trail', 'user_id', NULL),
    (16, 'A', 'business_chat_action_log', 'user_id', NULL),
    (17, 'A', 'business_chat_conversation', 'user_id', NULL),
    (18, 'A', 'business_chat_plan_cache', 'user_id', NULL),
    (19, 'A', 'business_chat_saved_plans', 'user_id', NULL),
    (20, 'A', 'business_chat_verified_questions', 'user_id', NULL),
    (21, 'A', 'business_events', 'user_id', NULL),
    (22, 'A', 'business_health_summaries', 'user_id', NULL),
    (23, 'A', 'business_os_data_exports', 'user_id', NULL),
    (24, 'A', 'business_subscribers', 'user_id', NULL),
    (25, 'A', 'channel_metrics_daily', 'user_id', NULL),
    (26, 'A', 'command_sessions', 'user_id', NULL),
    (27, 'A', 'contact_documents', 'user_id', NULL),
    (28, 'A', 'crm_tasks', 'user_id', NULL),
    (29, 'A', 'daily_briefing_sends', 'user_id', NULL),
    (30, 'A', 'data_decision_requests', 'user_id', NULL),
    (31, 'A', 'derived_metrics', 'user_id', NULL),
    (32, 'A', 'email_sends', 'user_id', NULL),
    (33, 'A', 'email_sequence_enrollments', 'user_id', NULL),
    (34, 'A', 'email_sequence_steps', 'user_id', NULL),
    (35, 'A', 'external_calendar_events', 'user_id', NULL),
    (36, 'A', 'insight_actions', 'user_id', NULL),
    (37, 'A', 'insight_hypotheses', 'user_id', NULL),
    (38, 'A', 'insight_measurements', 'user_id', NULL),
    (39, 'A', 'kernel_action_log', 'user_id', NULL),
    (40, 'A', 'lead_responses', 'user_id', NULL),
    (41, 'A', 'onboarding_conversations', 'user_id', NULL),
    (42, 'A', 'onboarding_prompt_ideas', 'user_id', NULL),
    (43, 'A', 'owner_insight_history', 'user_id', NULL),
    (44, 'A', 'payment_automation_executions', 'user_id', NULL),
    (45, 'A', 'payment_events', 'user_id', NULL),
    (46, 'A', 'payment_methods', 'user_id', NULL),
    (47, 'A', 'proposals', 'user_id', NULL),
    (48, 'A', 'run_memories', 'user_id', NULL),
    (49, 'A', 'saved_payment_methods', 'user_id', NULL),
    (50, 'A', 'scheduling_availability_exceptions', 'user_id', NULL),
    (51, 'A', 'smart_link_clicks', 'smart_link_id', 'smart_links'),
    (52, 'A', 'user_media', 'user_id', NULL),
    (53, 'A', 'user_memory', 'user_id', NULL),
    (54, 'A', 'website_blocks', 'page_id', 'website_pages'),
    (55, 'A', 'website_content', 'user_id', NULL),
    (56, 'A', 'website_page_views', 'user_id', NULL),
    (57, 'A', 'scheduling_bookings', 'user_id', NULL),
    (58, 'A', 'agent_executions', 'user_id', NULL),
    (59, 'A', 'agents', 'user_id', NULL),
    (60, 'A', 'crm_contacts', 'user_id', NULL),
    (61, 'A', 'daily_briefings', 'user_id', NULL),
    (62, 'A', 'email_campaigns', 'user_id', NULL),
    (63, 'A', 'email_sequences', 'user_id', NULL),
    (64, 'A', 'insights', 'user_id', NULL),
    (65, 'A', 'kernel_executions', 'user_id', NULL),
    (66, 'A', 'payment_automation_rules', 'user_id', NULL),
    (67, 'A', 'payment_invoices', 'user_id', NULL),
    (68, 'A', 'payment_plans', 'user_id', NULL),
    (69, 'A', 'payment_transactions', 'user_id', NULL),
    (70, 'A', 'scheduling_services', 'user_id', NULL),
    (71, 'A', 'smart_links', 'user_id', NULL),
    (72, 'A', 'website_pages', 'user_id', NULL),
    (73, 'A', 'user_capability_blocks', 'user_capability_id', 'user_capabilities'),
    (74, 'A', 'business_addresses', 'user_id', NULL),
    (75, 'A', 'business_intake_forms', 'user_id', NULL),
    (76, 'A', 'channel_connections', 'user_id', NULL),
    (77, 'A', 'crm_pipeline_stages', 'user_id', NULL),
    (78, 'A', 'marketing_consent_settings', 'user_id', NULL),
    (79, 'A', 'payment_processors', 'user_id', NULL),
    (80, 'A', 'plugin_connections', 'user_id', NULL),
    (81, 'A', 'stripe_connect_accounts', 'user_id', NULL),
    (82, 'A', 'user_capabilities', 'user_id', NULL),
    (83, 'A', 'user_intake_settings', 'user_id', NULL),
    (84, 'A', 'crm_activities', 'user_id', NULL),
    (85, 'B', 'storage_usage', 'user_id', NULL),
    (86, 'B', 'subscriptions', 'user_id', NULL),
    (87, 'B', 'business_os_boost_cap_overrides', 'user_id', NULL),
    (88, 'B', 'business_os_account_plans', 'user_id', NULL),
    (89, 'B', 'business_os_entitlement_overrides', 'user_id', NULL),
    (90, 'B', 'business_os_entitlement_shadow_events', 'user_id', NULL),
    (91, 'B', 'email_unsubscribes', 'user_id', NULL),
    (92, 'B', 'user_preferences', 'user_id', NULL),
    (93, 'B', 'notification_settings', 'user_id', NULL),
    (94, 'B', 'security_settings', 'user_id', NULL),
    (95, 'B', 'api_keys', 'user_id', NULL),
    (96, 'B', 'audit_logs', 'user_id', NULL),
    (97, 'B', 'auth_handoff_codes', 'user_id', NULL),
    (98, 'B', 'business_os_account_closures', 'user_id', NULL),
    (99, 'B', 'agent_configurations', 'user_id', NULL),
    (100, 'B', 'agent_execution_logs', 'user_id', NULL),
    (101, 'B', 'agent_intensity_metrics', 'user_id', NULL),
    (102, 'B', 'agent_stats', 'user_id', NULL),
    (103, 'B', 'agent_templates', 'user_id', NULL),
    (104, 'B', 'agentkit_analytics', 'user_id', NULL),
    (105, 'B', 'calibration_history', 'user_id', NULL),
    (106, 'B', 'calibration_sessions', 'user_id', NULL),
    (107, 'B', 'error_patterns', 'user_id', NULL),
    (108, 'B', 'execution_anomalies', 'user_id', NULL),
    (109, 'B', 'execution_baselines', 'user_id', NULL),
    (110, 'B', 'execution_insight_runs', 'user_id', NULL),
    (111, 'B', 'execution_insights', 'user_id', NULL),
    (112, 'B', 'pilot_step_routing_history', 'user_id', NULL),
    (113, 'B', 'plugin_performance', 'user_id', NULL),
    (114, 'B', 'shadow_failure_snapshots', 'user_id', NULL),
    (115, 'B', 'shared_agents', 'user_id', NULL),
    (116, 'B', 'workflow_executions', 'user_id', NULL),
    (117, 'B', 'advisor_reports', 'user_id', NULL),
    (118, 'B', 'automation_slas', 'user_id', NULL),
    (119, 'B', 'group_metrics_rollup', 'user_id', NULL),
    (120, 'B', 'metric_baselines', 'user_id', NULL),
    (121, 'B', 'organization_members', 'user_id', NULL),
    (122, 'C', 'business_profiles', 'user_id', NULL),
    (123, 'C', 'profiles', 'id', NULL),
    (124, 'C', 'organizations', 'owner_user_id', NULL),
    (125, 'C', 'business_os_invites', 'issuer_account_id', NULL)
  ) AS plan_values(ord, step, table_name, key_column, parent_table)
),
plan_state AS (
  SELECT
    plan.*,
    to_regclass(format('public.%I', plan.table_name)) IS NOT NULL AS present,
    EXISTS (
      SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = 'public' AND cols.table_name = plan.table_name AND cols.column_name = plan.key_column
    ) AS key_ok,
    (plan.parent_table IS NULL OR EXISTS (
      SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = 'public' AND cols.table_name = plan.parent_table AND cols.column_name = 'user_id'
    )) AS parent_ok
  FROM plan
),
fk_catalog AS (
  SELECT
    nsp.nspname::text AS fk_schema,
    rel.relname::text AS fk_table,
    att.attname::text AS fk_column,
    cardinality(con.conkey) AS key_width
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND con.confrelid = 'auth.users'::regclass AND nsp.nspname <> 'auth'
),
fk_review AS (
  SELECT reviewed.fk_schema, reviewed.fk_table, reviewed.fk_column, reviewed.kind, reviewed.owner_column
  FROM (VALUES
    ('public'::text, 'abandoned_bookings'::text, 'user_id'::text, 'tenancy'::text, NULL::text),
    ('public', 'admin_users', 'user_id', 'tenancy', NULL),
    ('public', 'advisor_reports', 'user_id', 'tenancy', NULL),
    ('public', 'agent_configurations', 'user_id', 'tenancy', NULL),
    ('public', 'agent_execution_logs', 'user_id', 'tenancy', NULL),
    ('public', 'agent_executions', 'user_id', 'tenancy', NULL),
    ('public', 'agent_intensity_metrics', 'user_id', 'tenancy', NULL),
    ('public', 'agent_logs', 'user_id', 'tenancy', NULL),
    ('public', 'agent_memories', 'user_id', 'tenancy', NULL),
    ('public', 'agent_memory', 'user_id', 'tenancy', NULL),
    ('public', 'agent_prompt_threads', 'user_id', 'tenancy', NULL),
    ('public', 'agent_prompt_workflow_generation_sessions', 'user_id', 'tenancy', NULL),
    ('public', 'agent_stats', 'user_id', 'tenancy', NULL),
    ('public', 'agent_templates', 'user_id', 'tenancy', NULL),
    ('public', 'agentkit_analytics', 'user_id', 'tenancy', NULL),
    ('public', 'agents', 'user_id', 'tenancy', NULL),
    ('public', 'api_keys', 'user_id', 'tenancy', NULL),
    ('public', 'archived_records', 'user_id', 'tenancy', NULL),
    ('public', 'audit_logs', 'user_id', 'tenancy', NULL),
    ('public', 'audit_trail', 'user_id', 'tenancy', NULL),
    ('public', 'auth_handoff_codes', 'user_id', 'tenancy', NULL),
    ('public', 'automation_slas', 'user_id', 'tenancy', NULL),
    ('public', 'billing_events', 'user_id', 'tenancy', NULL),
    ('public', 'boost_pack_purchases', 'user_id', 'tenancy', NULL),
    ('public', 'business_addresses', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_action_log', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_conversation', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_plan_cache', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_saved_plans', 'user_id', 'tenancy', NULL),
    ('public', 'business_chat_verified_questions', 'user_id', 'tenancy', NULL),
    ('public', 'business_events', 'user_id', 'tenancy', NULL),
    ('public', 'business_health_summaries', 'user_id', 'tenancy', NULL),
    ('public', 'business_intake_forms', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_account_closures', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_account_lineage', 'account_id', 'tenancy', NULL),
    ('public', 'business_os_account_plans', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_billing_accounts', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_billing_events', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_boost_cap_overrides', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_boost_purchases', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_credit_charges', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_credit_lot_draws', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_credit_lots', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_credit_totals', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_data_exports', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_entitlement_overrides', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_entitlement_shadow_events', 'user_id', 'tenancy', NULL),
    ('public', 'business_os_invites', 'issuer_account_id', 'tenancy', NULL),
    ('public', 'business_profiles', 'user_id', 'tenancy', NULL),
    ('public', 'business_subscribers', 'user_id', 'tenancy', NULL),
    ('public', 'calibration_history', 'user_id', 'tenancy', NULL),
    ('public', 'calibration_sessions', 'user_id', 'tenancy', NULL),
    ('public', 'channel_connections', 'user_id', 'tenancy', NULL),
    ('public', 'channel_metrics_daily', 'user_id', 'tenancy', NULL),
    ('public', 'command_sessions', 'user_id', 'tenancy', NULL),
    ('public', 'contact_documents', 'user_id', 'tenancy', NULL),
    ('public', 'credit_transactions', 'user_id', 'tenancy', NULL),
    ('public', 'crm_activities', 'user_id', 'tenancy', NULL),
    ('public', 'crm_contacts', 'user_id', 'tenancy', NULL),
    ('public', 'crm_pipeline_stages', 'user_id', 'tenancy', NULL),
    ('public', 'crm_tasks', 'user_id', 'tenancy', NULL),
    ('public', 'daily_briefing_sends', 'user_id', 'tenancy', NULL),
    ('public', 'daily_briefings', 'user_id', 'tenancy', NULL),
    ('public', 'data_decision_requests', 'user_id', 'tenancy', NULL),
    ('public', 'derived_metrics', 'user_id', 'tenancy', NULL),
    ('public', 'email_campaigns', 'user_id', 'tenancy', NULL),
    ('public', 'email_sends', 'user_id', 'tenancy', NULL),
    ('public', 'email_sequence_enrollments', 'user_id', 'tenancy', NULL),
    ('public', 'email_sequence_steps', 'user_id', 'tenancy', NULL),
    ('public', 'email_sequences', 'user_id', 'tenancy', NULL),
    ('public', 'email_unsubscribes', 'user_id', 'tenancy', NULL),
    ('public', 'error_patterns', 'user_id', 'tenancy', NULL),
    ('public', 'execution_anomalies', 'user_id', 'tenancy', NULL),
    ('public', 'execution_baselines', 'user_id', 'tenancy', NULL),
    ('public', 'execution_insight_runs', 'user_id', 'tenancy', NULL),
    ('public', 'execution_insights', 'user_id', 'tenancy', NULL),
    ('public', 'external_calendar_events', 'user_id', 'tenancy', NULL),
    ('public', 'group_metrics_rollup', 'user_id', 'tenancy', NULL),
    ('public', 'insight_actions', 'user_id', 'tenancy', NULL),
    ('public', 'insight_automations', 'user_id', 'tenancy', NULL),
    ('public', 'insight_hypotheses', 'user_id', 'tenancy', NULL),
    ('public', 'insight_measurements', 'user_id', 'tenancy', NULL),
    ('public', 'insights', 'user_id', 'tenancy', NULL),
    ('public', 'kernel_action_log', 'user_id', 'tenancy', NULL),
    ('public', 'kernel_executions', 'user_id', 'tenancy', NULL),
    ('public', 'lead_responses', 'user_id', 'tenancy', NULL),
    ('public', 'marketing_consent_events', 'user_id', 'tenancy', NULL),
    ('public', 'marketing_consent_settings', 'user_id', 'tenancy', NULL),
    ('public', 'marketing_consent_state', 'user_id', 'tenancy', NULL),
    ('public', 'metric_baselines', 'user_id', 'tenancy', NULL),
    ('public', 'notification_settings', 'user_id', 'tenancy', NULL),
    ('public', 'onboarding_conversations', 'user_id', 'tenancy', NULL),
    ('public', 'onboarding_prompt_ideas', 'user_id', 'tenancy', NULL),
    ('public', 'organization_members', 'user_id', 'tenancy', NULL),
    ('public', 'organizations', 'owner_user_id', 'tenancy', NULL),
    ('public', 'owner_insight_history', 'user_id', 'tenancy', NULL),
    ('public', 'payment_automation_executions', 'user_id', 'tenancy', NULL),
    ('public', 'payment_automation_rules', 'user_id', 'tenancy', NULL),
    ('public', 'payment_events', 'user_id', 'tenancy', NULL),
    ('public', 'payment_invoices', 'user_id', 'tenancy', NULL),
    ('public', 'payment_methods', 'user_id', 'tenancy', NULL),
    ('public', 'payment_plan_installments', 'user_id', 'tenancy', NULL),
    ('public', 'payment_plan_subscriptions', 'user_id', 'tenancy', NULL),
    ('public', 'payment_plans', 'user_id', 'tenancy', NULL),
    ('public', 'payment_processors', 'user_id', 'tenancy', NULL),
    ('public', 'payment_refunds', 'user_id', 'tenancy', NULL),
    ('public', 'payment_reminders', 'user_id', 'tenancy', NULL),
    ('public', 'payment_transactions', 'user_id', 'tenancy', NULL),
    ('public', 'pilot_step_routing_history', 'user_id', 'tenancy', NULL),
    ('public', 'plugin_connections', 'user_id', 'tenancy', NULL),
    ('public', 'plugin_performance', 'user_id', 'tenancy', NULL),
    ('public', 'processed_webhook_events', 'user_id', 'tenancy', NULL),
    ('public', 'profiles', 'id', 'tenancy', NULL),
    ('public', 'proposals', 'user_id', 'tenancy', NULL),
    ('public', 'run_memories', 'user_id', 'tenancy', NULL),
    ('public', 'saved_payment_methods', 'user_id', 'tenancy', NULL),
    ('public', 'scheduling_availability_exceptions', 'user_id', 'tenancy', NULL),
    ('public', 'scheduling_bookings', 'user_id', 'tenancy', NULL),
    ('public', 'scheduling_meetings', 'user_id', 'tenancy', NULL),
    ('public', 'scheduling_services', 'user_id', 'tenancy', NULL),
    ('public', 'security_settings', 'user_id', 'tenancy', NULL),
    ('public', 'shadow_failure_snapshots', 'user_id', 'tenancy', NULL),
    ('public', 'shared_agents', 'user_id', 'tenancy', NULL),
    ('public', 'smart_links', 'user_id', 'tenancy', NULL),
    ('public', 'storage_usage', 'user_id', 'tenancy', NULL),
    ('public', 'stripe_connect_accounts', 'user_id', 'tenancy', NULL),
    ('public', 'subscription_invoices', 'user_id', 'tenancy', NULL),
    ('public', 'subscriptions', 'user_id', 'tenancy', NULL),
    ('public', 'token_usage', 'user_id', 'tenancy', NULL),
    ('public', 'user_capabilities', 'user_id', 'tenancy', NULL),
    ('public', 'user_intake_settings', 'user_id', 'tenancy', NULL),
    ('public', 'user_media', 'user_id', 'tenancy', NULL),
    ('public', 'user_memory', 'user_id', 'tenancy', NULL),
    ('public', 'user_preferences', 'user_id', 'tenancy', NULL),
    ('public', 'user_rewards', 'user_id', 'tenancy', NULL),
    ('public', 'user_subscriptions', 'user_id', 'tenancy', NULL),
    ('public', 'website_content', 'user_id', 'tenancy', NULL),
    ('public', 'website_page_views', 'user_id', 'tenancy', NULL),
    ('public', 'website_pages', 'user_id', 'tenancy', NULL),
    ('public', 'workflow_executions', 'user_id', 'tenancy', NULL),
    ('public', 'admin_users', 'granted_by', 'actor', 'user_id'),
    ('public', 'ais_scoring_weights', 'updated_by', 'actor', NULL),
    ('public', 'ais_system_config', 'updated_by', 'actor', NULL),
    ('public', 'exchange_rate_history', 'changed_by', 'actor', NULL),
    ('public', 'exchange_rates', 'updated_by', 'actor', NULL),
    ('public', 'marketing_consent_events', 'recorded_by', 'actor', 'user_id'),
    ('public', 'shared_agent_imports', 'imported_by_user_id', 'actor', NULL),
    ('public', 'sla_events', 'acknowledged_by', 'actor', NULL),
    ('public', 'system_settings_config', 'updated_by', 'actor', NULL),
    ('storage', 'buckets', 'owner', 'actor', NULL),
    ('storage', 'objects', 'owner', 'actor', NULL)
  ) AS reviewed(fk_schema, fk_table, fk_column, kind, owner_column)
),
fk_rows AS (
  SELECT
    fk_catalog.fk_schema, fk_catalog.fk_table, fk_catalog.fk_column, fk_catalog.key_width, fk_review.kind,
    CASE
      WHEN target.user_id IS NULL OR fk_review.kind = 'tenancy' OR fk_catalog.key_width <> 1 THEN 0
      ELSE (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM %I.%I WHERE %I = %L AND %s', fk_catalog.fk_schema, fk_catalog.fk_table, fk_catalog.fk_column, target.user_id, CASE WHEN fk_review.owner_column IS NULL THEN 'true' ELSE format('%I IS DISTINCT FROM %L', fk_review.owner_column, target.user_id) END), false, true, '')))[1]::text::bigint
    END AS found
  FROM fk_catalog
  CROSS JOIN target
  LEFT JOIN fk_review USING (fk_schema, fk_table, fk_column)
),
inbound_catalog AS (
  SELECT
    con.conname::text AS fk_name,
    child_nsp.nspname::text AS child_schema,
    child_rel.relname::text AS child_table,
    child_att.attname::text AS child_column,
    parent_rel.relname::text AS parent_table,
    parent_att.attname::text AS parent_column,
    cardinality(con.conkey) AS key_width
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS child_rel ON child_rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS child_nsp ON child_nsp.oid = child_rel.relnamespace
  JOIN pg_catalog.pg_attribute AS child_att ON child_att.attrelid = con.conrelid AND child_att.attnum = con.conkey[1]
  JOIN pg_catalog.pg_class AS parent_rel ON parent_rel.oid = con.confrelid
  JOIN pg_catalog.pg_namespace AS parent_nsp ON parent_nsp.oid = parent_rel.relnamespace
  JOIN pg_catalog.pg_attribute AS parent_att ON parent_att.attrelid = con.confrelid AND parent_att.attnum = con.confkey[1]
  WHERE con.contype = 'f' AND parent_nsp.nspname = 'public' AND parent_rel.relname IN (SELECT plan.table_name FROM plan)
),
inbound_review AS (
  SELECT reviewed.child_table, reviewed.fk_name, reviewed.owner_column
  FROM (VALUES
    ('abandoned_bookings'::text, 'abandoned_bookings_booking_id_fkey'::text, 'user_id'::text),
    ('abandoned_bookings', 'abandoned_bookings_business_fk', 'user_id'),
    ('abandoned_bookings', 'abandoned_bookings_service_id_fkey', 'user_id'),
    ('advisor_reports', 'advisor_reports_org_id_fkey', 'user_id'),
    ('agent_configurations', 'agent_configurations_agent_id_fkey', 'user_id'),
    ('agent_executions', 'agent_executions_agent_id_fkey', 'user_id'),
    ('agent_group_memberships', 'agent_group_memberships_agent_id_fkey', NULL),
    ('agent_intensity_metrics', 'agent_intensity_metrics_agent_id_fkey', 'user_id'),
    ('agent_logs', 'agent_logs_agent_id_fkey', 'user_id'),
    ('agent_memory', 'agent_memory_agent_id_fkey', 'user_id'),
    ('agent_prompt_workflow_generation_sessions', 'agent_prompt_workflow_generation_sessions_agent_id_fkey', 'user_id'),
    ('agent_scheduler_state', 'agent_scheduler_state_agent_id_fkey', NULL),
    ('agent_scheduler_state', 'agent_scheduler_state_last_execution_id_fkey', NULL),
    ('agent_stats', 'agent_stats_agent_id_fkey', 'user_id'),
    ('agentkit_analytics', 'agentkit_analytics_agent_id_fkey', 'user_id'),
    ('agents', 'agents_org_id_fkey', 'user_id'),
    ('agents', 'fk_agents_last_calibration', 'user_id'),
    ('automation_slas', 'automation_slas_agent_id_fkey', 'user_id'),
    ('automation_slas', 'automation_slas_org_id_fkey', 'user_id'),
    ('billing_events', 'billing_events_subscription_id_fkey', 'user_id'),
    ('billing_events', 'billing_events_transaction_id_fkey', 'user_id'),
    ('boost_pack_purchases', 'boost_pack_purchases_transaction_id_fkey', 'user_id'),
    ('business_addresses', 'business_addresses_business_fk', 'user_id'),
    ('business_chat_action_log', 'business_chat_action_log_business_fk', 'user_id'),
    ('business_chat_conversation', 'business_chat_conversation_business_fk', 'user_id'),
    ('business_chat_plan_cache', 'business_chat_plan_cache_business_fk', 'user_id'),
    ('business_chat_saved_plans', 'business_chat_saved_plans_business_fk', 'user_id'),
    ('business_chat_verified_questions', 'business_chat_verified_questions_business_fk', 'user_id'),
    ('business_events', 'business_events_business_fk', 'user_id'),
    ('business_events', 'business_events_contact_id_fkey', 'user_id'),
    ('business_health_summaries', 'business_health_summaries_business_fk', 'user_id'),
    ('business_intake_forms', 'business_intake_forms_business_fk', 'user_id'),
    ('business_os_boost_purchases', 'business_os_boost_purchases_lot_id_fkey', 'user_id'),
    ('business_os_boost_reversal_events', 'business_os_boost_reversal_events_purchase_id_fkey', NULL),
    ('business_os_credit_charges', 'business_os_credit_charges_adjusts_action_id_fkey', 'user_id'),
    ('business_os_credit_lot_draws', 'business_os_credit_lot_draws_lot_id_fkey', 'user_id'),
    ('business_os_entitlement_overrides', 'business_os_entitlement_overrides_user_id_fkey', 'user_id'),
    ('business_profiles', 'business_profiles_address_id_fkey', 'user_id'),
    ('business_profiles', 'business_profiles_invoice_address_id_fkey', 'user_id'),
    ('business_subscribers', 'business_subscribers_business_fk', 'user_id'),
    ('business_subscribers', 'business_subscribers_promoted_contact_id_fkey', 'user_id'),
    ('calibration_history', 'calibration_history_agent_id_fkey', 'user_id'),
    ('calibration_history', 'calibration_history_session_id_fkey', 'user_id'),
    ('calibration_sessions', 'calibration_sessions_agent_id_fkey', 'user_id'),
    ('calibration_sessions', 'calibration_sessions_execution_id_fkey', 'user_id'),
    ('calibration_sessions', 'calibration_sessions_user_id_fkey', 'user_id'),
    ('channel_connections', 'channel_connections_business_fk', 'user_id'),
    ('channel_metrics_daily', 'channel_metrics_daily_business_fk', 'user_id'),
    ('contact_documents', 'contact_documents_business_fk', 'user_id'),
    ('contact_documents', 'contact_documents_contact_id_fkey', 'user_id'),
    ('credit_transactions', 'credit_transactions_token_usage_id_fkey', 'user_id'),
    ('crm_activities', 'crm_activities_business_fk', 'user_id'),
    ('crm_activities', 'crm_activities_contact_id_fkey', 'user_id'),
    ('crm_contacts', 'crm_contacts_business_fk', 'user_id'),
    ('crm_pipeline_stages', 'crm_pipeline_stages_business_fk', 'user_id'),
    ('crm_tasks', 'crm_tasks_business_fk', 'user_id'),
    ('crm_tasks', 'crm_tasks_contact_id_fkey', 'user_id'),
    ('daily_briefing_sends', 'daily_briefing_sends_business_fk', 'user_id'),
    ('daily_briefings', 'daily_briefings_business_fk', 'user_id'),
    ('data_decision_requests', 'fk_data_decision_requests_agent', 'user_id'),
    ('data_decision_requests', 'fk_data_decision_requests_execution', 'user_id'),
    ('derived_metrics', 'derived_metrics_business_fk', 'user_id'),
    ('email_campaigns', 'email_campaigns_business_fk', 'user_id'),
    ('email_sends', 'email_sends_booking_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_business_fk', 'user_id'),
    ('email_sends', 'email_sends_campaign_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_contact_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_meeting_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_sequence_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_sequence_step_id_fkey', 'user_id'),
    ('email_sequence_enrollments', 'email_sequence_enrollments_business_fk', 'user_id'),
    ('email_sequence_enrollments', 'email_sequence_enrollments_contact_id_fkey', 'user_id'),
    ('email_sequence_enrollments', 'email_sequence_enrollments_sequence_id_fkey', 'user_id'),
    ('email_sequence_steps', 'email_sequence_steps_business_fk', 'user_id'),
    ('email_sequence_steps', 'email_sequence_steps_sequence_id_fkey', 'user_id'),
    ('email_sequences', 'email_sequences_business_fk', 'user_id'),
    ('email_unsubscribes', 'email_unsubscribes_contact_id_fkey', 'user_id'),
    ('error_patterns', 'error_patterns_agent_id_fkey', 'user_id'),
    ('execution_anomalies', 'execution_anomalies_agent_id_fkey', 'user_id'),
    ('execution_anomalies', 'execution_anomalies_execution_id_fkey', 'user_id'),
    ('execution_baselines', 'execution_baselines_agent_id_fkey', 'user_id'),
    ('execution_insight_runs', 'execution_insight_runs_agent_id_fkey', 'user_id'),
    ('execution_insight_runs', 'execution_insight_runs_execution_id_fkey', 'user_id'),
    ('execution_insight_runs', 'execution_insight_runs_insight_id_fkey', 'user_id'),
    ('execution_insights', 'execution_insights_agent_id_fkey', 'user_id'),
    ('execution_insights', 'execution_insights_org_id_fkey', 'user_id'),
    ('execution_metrics', 'execution_metrics_agent_id_fkey', NULL),
    ('execution_metrics', 'execution_metrics_execution_id_fkey', NULL),
    ('execution_routing_decisions', 'execution_routing_decisions_execution_id_fkey', NULL),
    ('external_calendar_events', 'external_calendar_events_business_fk', 'user_id'),
    ('group_metrics_rollup', 'group_metrics_rollup_org_id_fkey', 'user_id'),
    ('insight_actions', 'insight_actions_booking_id_fkey', 'user_id'),
    ('insight_actions', 'insight_actions_business_fk', 'user_id'),
    ('insight_actions', 'insight_actions_contact_id_fkey', 'user_id'),
    ('insight_actions', 'insight_actions_insight_id_fkey', 'user_id'),
    ('insight_actions', 'insight_actions_invoice_id_fkey', 'user_id'),
    ('insight_automations', 'insight_automations_business_fk', 'user_id'),
    ('insight_automations', 'insight_automations_created_from_insight_id_fkey', 'user_id'),
    ('insight_automations', 'insight_automations_last_run_execution_id_fkey', 'user_id'),
    ('insight_hypotheses', 'insight_hypotheses_business_fk', 'user_id'),
    ('insight_measurements', 'insight_measurements_business_fk', 'user_id'),
    ('insight_measurements', 'insight_measurements_insight_id_fkey', 'user_id'),
    ('insights', 'insights_business_fk', 'user_id'),
    ('insights', 'insights_correlation_parent_id_fkey', 'user_id'),
    ('kernel_action_log', 'kernel_action_log_execution_id_fkey', 'user_id'),
    ('kernel_action_log', 'kernel_action_log_insight_id_fkey', 'user_id'),
    ('kernel_executions', 'kernel_executions_insight_id_fkey', 'user_id'),
    ('lead_responses', 'lead_responses_business_fk', 'user_id'),
    ('lead_responses', 'lead_responses_contact_id_fkey', 'user_id'),
    ('marketing_consent_events', 'marketing_consent_events_contact_id_fkey', 'user_id'),
    ('marketing_consent_settings', 'marketing_consent_settings_business_fk', 'user_id'),
    ('marketing_consent_state', 'marketing_consent_state_contact_id_fkey', 'user_id'),
    ('metric_baselines', 'metric_baselines_org_id_fkey', 'user_id'),
    ('onboarding_prompt_ideas', 'onboarding_prompt_ideas_agent_created_id_fkey', 'user_id'),
    ('organization_members', 'organization_members_org_id_fkey', 'user_id'),
    ('owner_insight_history', 'owner_insight_history_business_fk', 'user_id'),
    ('owner_insight_history', 'owner_insight_history_insight_id_fkey', 'user_id'),
    ('payment_automation_executions', 'payment_automation_executions_business_fk', 'user_id'),
    ('payment_automation_executions', 'payment_automation_executions_rule_id_fkey', 'user_id'),
    ('payment_automation_executions', 'payment_automation_executions_trigger_event_id_fkey', 'user_id'),
    ('payment_automation_rules', 'payment_automation_rules_business_fk', 'user_id'),
    ('payment_events', 'payment_events_business_fk', 'user_id'),
    ('payment_events', 'payment_events_contact_id_fkey', 'user_id'),
    ('payment_invoices', 'payment_invoices_booking_id_fkey', 'user_id'),
    ('payment_invoices', 'payment_invoices_business_fk', 'user_id'),
    ('payment_invoices', 'payment_invoices_contact_id_fkey', 'user_id'),
    ('payment_invoices', 'payment_invoices_service_id_fkey', 'user_id'),
    ('payment_methods', 'payment_methods_business_fk', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_booking_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_business_fk', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_contact_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_invoice_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_meeting_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_payment_plan_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_proposal_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_subscription_id_fkey', 'user_id'),
    ('payment_plan_installments', 'payment_plan_installments_transaction_id_fkey', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_booking_id_fkey', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_business_fk', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_contact_id_fkey', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_payment_plan_id_fkey', 'user_id'),
    ('payment_plan_subscriptions', 'payment_plan_subscriptions_service_id_fkey', 'user_id'),
    ('payment_plans', 'payment_plans_business_fk', 'user_id'),
    ('payment_plans', 'payment_plans_service_id_fkey', 'user_id'),
    ('payment_processors', 'payment_processors_business_fk', 'user_id'),
    ('payment_refunds', 'payment_refunds_business_fk', 'user_id'),
    ('payment_refunds', 'payment_refunds_invoice_id_fkey', 'user_id'),
    ('payment_refunds', 'payment_refunds_transaction_id_fkey', 'user_id'),
    ('payment_reminders', 'payment_reminders_business_fk', 'user_id'),
    ('payment_reminders', 'payment_reminders_contact_id_fkey', 'user_id'),
    ('payment_reminders', 'payment_reminders_installment_id_fkey', 'user_id'),
    ('payment_reminders', 'payment_reminders_invoice_id_fkey', 'user_id'),
    ('payment_transactions', 'payment_transactions_booking_id_fkey', 'user_id'),
    ('payment_transactions', 'payment_transactions_business_fk', 'user_id'),
    ('payment_transactions', 'payment_transactions_contact_id_fkey', 'user_id'),
    ('payment_transactions', 'payment_transactions_invoice_id_fkey', 'user_id'),
    ('payment_transactions', 'payment_transactions_service_id_fkey', 'user_id'),
    ('plugin_performance', 'plugin_performance_agent_id_fkey', 'user_id'),
    ('profiles', 'profiles_org_id_fkey', 'id'),
    ('proposals', 'proposals_booking_id_fkey', 'user_id'),
    ('proposals', 'proposals_business_fk', 'user_id'),
    ('proposals', 'proposals_contact_id_fkey', 'user_id'),
    ('proposals', 'proposals_created_invoice_id_fkey', 'user_id'),
    ('proposals', 'proposals_created_plan_id_fkey', 'user_id'),
    ('proposals', 'proposals_document_id_fkey', 'user_id'),
    ('proposals', 'proposals_package_booking_id_fkey', 'user_id'),
    ('proposals', 'proposals_service_id_fkey', 'user_id'),
    ('proposals', 'proposals_supersedes_id_fkey', 'user_id'),
    ('run_memories', 'run_memories_agent_id_fkey', 'user_id'),
    ('saved_payment_methods', 'saved_payment_methods_business_fk', 'user_id'),
    ('saved_payment_methods', 'saved_payment_methods_contact_id_fkey', 'user_id'),
    ('scheduling_availability_exceptions', 'scheduling_availability_exceptions_business_fk', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_business_fk', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_contact_id_fkey', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_invoice_id_fkey', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_parent_booking_id_fkey', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_payment_plan_id_fkey', 'user_id'),
    ('scheduling_bookings', 'scheduling_bookings_service_id_fkey', 'user_id'),
    ('scheduling_meetings', 'scheduling_meetings_booking_id_fkey', 'user_id'),
    ('scheduling_meetings', 'scheduling_meetings_business_fk', 'user_id'),
    ('scheduling_services', 'scheduling_services_business_fk', 'user_id'),
    ('shadow_failure_snapshots', 'shadow_failure_snapshots_agent_id_fkey', 'user_id'),
    ('shared_agent_imports', 'shared_agent_imports_created_agent_id_fkey', 'imported_by_user_id'),
    ('shared_agent_imports', 'shared_agent_imports_shared_agent_id_fkey', 'imported_by_user_id'),
    ('shared_agents', 'fk_shared_agents_original_agent', 'user_id'),
    ('sla_events', 'sla_events_sla_id_fkey', NULL),
    ('smart_link_clicks', 'smart_link_clicks_smart_link_id_fkey', NULL),
    ('smart_links', 'smart_links_business_fk', 'user_id'),
    ('stripe_connect_accounts', 'stripe_connect_accounts_business_fk', 'user_id'),
    ('user_capabilities', 'user_capabilities_business_fk', 'user_id'),
    ('user_capability_blocks', 'user_capability_blocks_user_capability_id_fkey', NULL),
    ('user_intake_settings', 'user_intake_settings_business_fk', 'user_id'),
    ('user_media', 'user_media_business_fk', 'user_id'),
    ('user_memory', 'user_memory_source_agent_id_fkey', 'user_id'),
    ('user_rewards', 'user_rewards_transaction_id_fkey', 'user_id'),
    ('website_blocks', 'website_blocks_page_id_fkey', NULL),
    ('website_content', 'website_content_business_fk', 'user_id'),
    ('website_page_views', 'website_page_views_business_fk', 'user_id'),
    ('website_page_views', 'website_page_views_page_id_fkey', 'user_id'),
    ('website_pages', 'website_pages_business_fk', 'user_id'),
    ('workflow_groups', 'workflow_groups_org_id_fkey', NULL)
  ) AS reviewed(child_table, fk_name, owner_column)
),
inbound_joined AS (
  SELECT
    inbound_catalog.*,
    inbound_review.child_table IS NOT NULL AND inbound_catalog.child_schema = 'public' AS reviewed,
    inbound_review.owner_column,
    (inbound_review.owner_column IS NULL OR EXISTS (
      SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = inbound_catalog.child_schema AND cols.table_name = inbound_catalog.child_table AND cols.column_name = inbound_review.owner_column
    )) AS owner_ok,
    CASE WHEN plan.parent_table IS NULL
      THEN format('%I = %L', plan.key_column, target.user_id)
      ELSE format('%I IN (SELECT id FROM public.%I WHERE user_id = %L)', plan.key_column, plan.parent_table, target.user_id)
    END AS parent_predicate,
    plan.ord AS parent_ord,
    plan.parent_table IS NULL AND inbound_catalog.parent_column = plan.key_column
      AND inbound_catalog.child_column = inbound_review.owner_column AS owner_is_target,
    target.user_id
  FROM inbound_catalog
  JOIN plan ON plan.table_name = inbound_catalog.parent_table
  CROSS JOIN target
  LEFT JOIN inbound_review USING (child_table, fk_name)
),
inbound_parents AS (
  SELECT
    needed.parent_ord,
    (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM (SELECT 1 FROM public.%I WHERE %s LIMIT 1) AS one_row', needed.parent_table, needed.parent_predicate), false, true, '')))[1]::text::bigint AS found
  FROM (
    SELECT DISTINCT inbound_joined.parent_ord, inbound_joined.parent_table, inbound_joined.parent_predicate
    FROM inbound_joined
    WHERE inbound_joined.user_id IS NOT NULL AND inbound_joined.reviewed AND inbound_joined.owner_column IS NOT NULL
      AND inbound_joined.owner_ok AND inbound_joined.key_width = 1 AND NOT inbound_joined.owner_is_target
  ) AS needed
),
inbound_rows AS (
  SELECT
    inbound_joined.*,
    CASE
      WHEN inbound_joined.user_id IS NULL OR NOT inbound_joined.reviewed OR inbound_joined.owner_column IS NULL
        OR NOT inbound_joined.owner_ok OR inbound_joined.key_width <> 1 THEN 0
      WHEN inbound_joined.owner_is_target OR inbound_parents.found = 0 THEN 0
      ELSE (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM %I.%I AS child_rows WHERE child_rows.%I IN (SELECT %I FROM public.%I WHERE %s) AND child_rows.%I IS DISTINCT FROM %L', inbound_joined.child_schema, inbound_joined.child_table, inbound_joined.child_column, inbound_joined.parent_column, inbound_joined.parent_table, inbound_joined.parent_predicate, inbound_joined.owner_column, inbound_joined.user_id), false, true, '')))[1]::text::bigint
    END AS found
  FROM inbound_joined
  LEFT JOIN inbound_parents USING (parent_ord)
),
guard_rows AS (
  SELECT 'G-1'::text AS guard, 'exactly one login has this email'::text AS item, counted.found::bigint AS found, (counted.target_email IS NULL OR counted.found <> 1) AS blocked, 'Edit the email line at the top. It must match exactly one login.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM matches)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-2a'::text AS guard, 'the account id and the email name the same login'::text AS item, counted.found::bigint AS found, (counted.found <> 1) AS blocked, 'The account picked and the email do not resolve to the same login. Reload the page and pick the account again.'::text AS clears, (false) AS info
  FROM (SELECT (CASE WHEN target.user_id IS NOT NULL AND target.user_id = params.subject_id THEN 1 ELSE 0 END) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-4'::text AS guard, 'not a platform admin'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Admins are never removed here. Remove the admin row by hand first if this really is a test account.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.admin_users AS admins WHERE admins.user_id = target.user_id OR lower(admins.email) = params.target_email)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-5'::text AS guard, 'nothing ever ran in Stripe live mode'::text AS item, counted.found::bigint AS found, (false) AS blocked, 'Reported only: real money with us. Our billing rows are kept, with their personal details removed.'::text AS clears, (counted.found > 0) AS info
  FROM (SELECT ((SELECT count(*) FROM public.business_os_billing_accounts AS billing WHERE billing.user_id = target.user_id AND billing.livemode)
      + (SELECT count(*) FROM public.business_os_boost_purchases AS boosts WHERE boosts.user_id = target.user_id AND boosts.livemode)
      + (SELECT count(*) FROM public.business_os_billing_events AS money WHERE money.user_id = target.user_id AND money.livemode)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-6'::text AS guard, 'no live plan subscription, test or live mode'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Cancel the subscription in the Stripe dashboard, in its mode, then wait for the webhook.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.business_os_billing_accounts AS billing WHERE billing.user_id = target.user_id
        AND (billing.subscription_status IN ('active', 'trialing', 'past_due', 'unpaid', 'paused') OR (billing.stripe_subscription_id IS NOT NULL AND billing.ended_at IS NULL)))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-7'::text AS guard, 'legacy subscription with a Stripe id'::text AS item, counted.found::bigint AS found, (false) AS blocked, 'Reported only: legacy money with us. The billing rows are kept, with their personal details removed.'::text AS clears, (counted.found > 0) AS info
  FROM (SELECT ((SELECT count(*) FROM public.user_subscriptions AS legacy WHERE legacy.user_id = target.user_id AND legacy.stripe_subscription_id IS NOT NULL)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-7'::text AS guard, 'legacy credit payment with a Stripe id'::text AS item, counted.found::bigint AS found, (false) AS blocked, 'Reported only: legacy money with us. The billing rows are kept, with their personal details removed.'::text AS clears, (counted.found > 0) AS info
  FROM (SELECT ((SELECT count(*) FROM public.credit_transactions AS legacy WHERE legacy.user_id = target.user_id AND legacy.stripe_payment_intent_id IS NOT NULL)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-7'::text AS guard, 'legacy billing event from Stripe'::text AS item, counted.found::bigint AS found, (false) AS blocked, 'Reported only: legacy money with us. The billing rows are kept, with their personal details removed.'::text AS clears, (counted.found > 0) AS info
  FROM (SELECT ((SELECT count(*) FROM public.billing_events AS legacy WHERE legacy.user_id = target.user_id AND legacy.stripe_event_id IS NOT NULL)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-8'::text AS guard, 'no Stripe account connected for client payments'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Disconnect Stripe from the business first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.stripe_connect_accounts AS connect WHERE connect.user_id = target.user_id)
      + (SELECT count(*) FROM public.plugin_connections AS plugins WHERE plugins.user_id = target.user_id AND plugins.plugin_key = 'stripe')) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-9'::text AS guard, 'money in flight: recurring payment plan(s) still running'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Finish or cancel these in the app first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.payment_plan_subscriptions AS money WHERE money.user_id = target.user_id AND money.status IN ('pending', 'active', 'past_due', 'paused'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-9'::text AS guard, 'money in flight: payment(s) still pending'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Finish or cancel these in the app first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.payment_transactions AS money WHERE money.user_id = target.user_id AND money.status IN ('pending'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-9'::text AS guard, 'money in flight: refund(s) still in flight'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Finish or cancel these in the app first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.payment_refunds AS money WHERE money.user_id = target.user_id AND money.status IN ('pending'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-9'::text AS guard, 'money in flight: unpaid invoice(s) owed to this business'::text AS item, counted.found::bigint AS found, (false) AS blocked, 'Reported only: these invoices are the business own data and are deleted with the account.'::text AS clears, (counted.found > 0) AS info
  FROM (SELECT ((SELECT count(*) FROM public.payment_invoices AS money WHERE money.user_id = target.user_id AND money.status IN ('sent', 'overdue'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-10'::text AS guard, fk_rows.fk_schema || '.' || fk_rows.fk_table || '.' || fk_rows.fk_column AS item, fk_rows.found::bigint AS found, true AS blocked,
    CASE WHEN fk_rows.kind IS NULL OR fk_rows.key_width <> 1
      THEN 'A link to the login nobody has reviewed. Engineering must classify it in the generator first.'
      ELSE 'Rows of other accounts or of the platform name this login. Clear them by hand first.' END AS clears, false AS info
  FROM fk_rows
  WHERE fk_rows.kind IS NULL OR fk_rows.key_width <> 1 OR (fk_rows.kind = 'actor' AND fk_rows.found > 0)
  UNION ALL
  SELECT 'G-10'::text AS guard, 'links to the login, reviewed'::text AS item, count(*)::bigint AS found, false AS blocked, ''::text AS clears, false AS info FROM fk_catalog
  UNION ALL
  SELECT 'G-11'::text AS guard, plan_state.table_name || '.' || plan_state.key_column AS item, NULL::bigint AS found, true AS blocked,
    'A column this script relies on is missing. Regenerate the script after the schema change.'::text AS clears, false AS info
  FROM plan_state
  WHERE plan_state.present AND NOT (plan_state.key_ok AND plan_state.parent_ok)
  UNION ALL
  SELECT 'G-12'::text AS guard, 'no stored files under the account folder'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Empty the listed folders in the Supabase Storage dashboard, then run the check again.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM storage.objects AS objects WHERE objects.bucket_id IN ('contact-documents', 'website-images', 'business-purge-snapshots', 'business-data-exports') AND starts_with(objects.name, target.user_id::text || '/'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: advisor_reports'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.advisor_reports AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: agents'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.agents AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: automation_slas'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.automation_slas AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: execution_insights'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.execution_insights AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: group_metrics_rollup'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.group_metrics_rollup AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: metric_baselines'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.metric_baselines AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: organization_members'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.organization_members AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-13'::text AS guard, 'no other account in its organisation: profiles'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account belongs to an organisation this login owns. Move it out first.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.profiles AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-14'::text AS guard, 'no consent ledger rows'::text AS item, counted.found::bigint AS found, (false) AS blocked, 'Reported only: the consent records of the business clients are kept under the closed account (NBQ-3).'::text AS clears, (counted.found > 0) AS info
  FROM (SELECT ((SELECT count(*) FROM public.marketing_consent_events AS consent WHERE consent.user_id = target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-15'::text AS guard, 'nobody else hangs below it in the invitation circle'::text AS item, counted.found::bigint AS found, (false) AS blocked, 'Reported only: the invitation link stays as a nameless link (NBQ-4).'::text AS clears, (counted.found > 0) AS info
  FROM (SELECT ((SELECT count(*) FROM public.business_os_account_lineage AS lineage WHERE (lineage.parent_account_id = target.user_id OR lineage.root_account_id = target.user_id) AND lineage.account_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-16'::text AS guard, 'no other account imported its shared agents'::text AS item, counted.found::bigint AS found, (counted.found > 0) AS blocked, 'Another account imported an agent it shared. Engineering must review this account.'::text AS clears, (false) AS info
  FROM (SELECT ((SELECT count(*) FROM public.shared_agent_imports AS imports JOIN public.shared_agents AS shared ON shared.id = imports.shared_agent_id WHERE shared.user_id = target.user_id AND imports.imported_by_user_id IS DISTINCT FROM target.user_id)) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
  UNION ALL
  SELECT 'G-17'::text AS guard, rel.relname || '.' || trg.tgname AS item, 1::bigint AS found, true AS blocked,
    'A trigger on a table this script empties has not been reviewed. Engineering must review it in the generator first.'::text AS clears, false AS info
  FROM pg_catalog.pg_trigger AS trg
  JOIN pg_catalog.pg_class AS rel ON rel.oid = trg.tgrelid
  JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public' AND NOT trg.tgisinternal AND (trg.tgtype::integer & 8) <> 0
    AND (
      rel.relname IN (SELECT plan.table_name FROM plan)
      OR rel.oid IN (SELECT fk_con.conrelid FROM pg_catalog.pg_constraint AS fk_con WHERE fk_con.contype = 'f' AND fk_con.confrelid = 'auth.users'::regclass)
      OR rel.relname IN (SELECT inbound_catalog.child_table FROM inbound_catalog WHERE inbound_catalog.child_schema = 'public')
    )
    AND (rel.relname::text, trg.tgname::text) NOT IN (VALUES ('payment_refunds', 'recompute_transaction_refund_state_trigger'), ('storage_usage', 'trigger_update_storage_on_delete'), ('storage_usage', 'trigger_update_storage_used'), ('marketing_consent_events', 'trg_mce_guard'))
  UNION ALL
  SELECT 'G-18'::text AS guard, inbound_rows.child_schema || '.' || inbound_rows.child_table || '.' || inbound_rows.child_column || ' to ' || inbound_rows.parent_table AS item,
    inbound_rows.found::bigint AS found, true AS blocked,
    CASE
      WHEN NOT inbound_rows.reviewed OR inbound_rows.key_width <> 1
        THEN 'A link pointing at a table this script empties has not been reviewed. Engineering must classify it in the generator first.'
      WHEN NOT inbound_rows.owner_ok
        THEN 'The owner column of this link is missing. Regenerate the script after the schema change.'
      ELSE 'Rows of another account point at rows this script removes, and would be deleted or emptied with them. Engineering must review this account.'
    END AS clears, false AS info
  FROM inbound_rows
  WHERE NOT inbound_rows.reviewed OR inbound_rows.key_width <> 1 OR NOT inbound_rows.owner_ok OR inbound_rows.found > 0
  UNION ALL
  SELECT 'G-18'::text AS guard, 'links pointing at removed tables, reviewed'::text AS item, count(*)::bigint AS found, false AS blocked, ''::text AS clears, false AS info FROM inbound_catalog
  UNION ALL
  SELECT 'G-19'::text AS guard, child_plan.table_name || '.' || att.attname || ' to ' || parent_plan.table_name AS item, 1::bigint AS found, true AS blocked,
    'Removing a row of the second table empties a NOT NULL column of the first (ON DELETE SET NULL or SET DEFAULT), which the database refuses, and the plan removes the second table first. Engineering must order the first table before it in the generator.'::text AS clears, false AS info
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS child_rel ON child_rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS child_nsp ON child_nsp.oid = child_rel.relnamespace
  JOIN pg_catalog.pg_class AS parent_rel ON parent_rel.oid = con.confrelid
  JOIN pg_catalog.pg_namespace AS parent_nsp ON parent_nsp.oid = parent_rel.relnamespace
  JOIN plan AS parent_plan ON parent_plan.table_name = parent_rel.relname::text
  JOIN plan AS child_plan ON child_plan.table_name = child_rel.relname::text
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
  WHERE con.contype = 'f' AND con.confdeltype IN ('n', 'd') AND con.conrelid <> con.confrelid
    AND parent_nsp.nspname = 'public' AND child_nsp.nspname = 'public'
    AND att.attnotnull AND (con.confdeltype = 'n' OR NOT att.atthasdef)
    AND child_plan.ord > parent_plan.ord
  UNION ALL
  SELECT 'G-11'::text AS guard, blank_state.table_name || '.' || blank_state.column_name AS item, NULL::bigint AS found, true AS blocked,
    'A column the anonymise blanks, or the column it finds the rows by, is missing or is not jsonb where it must be. Regenerate after the schema change.'::text AS clears, false AS info
  FROM (VALUES
    ('business_os_billing_accounts'::text, 'action_required_invoice_url'::text, false, '{user_id}'::text[]),
    ('business_os_billing_accounts', 'open_checkout_session_id', false, '{user_id}'),
    ('business_os_boost_purchases', 'receipt_url', false, '{user_id}'),
    ('business_os_credit_lots', 'reason', false, '{user_id}'),
    ('business_os_credit_lot_draws', 'reason', false, '{user_id}'),
    ('user_subscriptions', 'payment_method_last4', false, '{user_id}'),
    ('user_subscriptions', 'payment_method_brand', false, '{user_id}'),
    ('user_subscriptions', 'last_calculator_inputs', false, '{user_id}'),
    ('credit_transactions', 'description', false, '{user_id}'),
    ('credit_transactions', 'metadata', true, '{user_id}'),
    ('billing_events', 'payload', true, '{user_id}'),
    ('billing_events', 'error_message', false, '{user_id}'),
    ('token_usage', 'error_message', false, '{user_id}'),
    ('token_usage', 'request_payload', false, '{user_id}'),
    ('token_usage', 'response_metadata', false, '{user_id}'),
    ('token_usage', 'metadata', true, '{user_id}'),
    ('subscription_invoices', 'stripe_invoice_pdf', false, '{user_id}'),
    ('subscription_invoices', 'stripe_hosted_invoice_url', false, '{user_id}'),
    ('subscription_invoices', 'metadata', true, '{user_id}'),
    ('user_rewards', 'metadata', true, '{user_id}'),
    ('business_os_invites', 'email', false, '{redeemed_account_id,claimed_account_id}'),
    ('business_os_invites', 'personal_note', false, '{redeemed_account_id,claimed_account_id}'),
    ('business_os_invites', 'email_problem_detail', false, '{redeemed_account_id,claimed_account_id}'),
    ('business_os_invites', 'redemption_error_message', false, '{redeemed_account_id,claimed_account_id}')
  ) AS blank_state(table_name, column_name, needs_jsonb, key_columns)
  WHERE to_regclass(format('public.%I', blank_state.table_name)) IS NOT NULL
    AND (
      NOT EXISTS (
        SELECT 1 FROM information_schema.columns AS cols
        WHERE cols.table_schema = 'public' AND cols.table_name = blank_state.table_name AND cols.column_name = blank_state.column_name
          AND (NOT blank_state.needs_jsonb OR cols.data_type = 'jsonb')
      )
      OR (SELECT count(*) FROM information_schema.columns AS cols
          WHERE cols.table_schema = 'public' AND cols.table_name = blank_state.table_name AND cols.column_name::text = ANY (blank_state.key_columns))
        <> cardinality(blank_state.key_columns)
    )
  UNION ALL
  SELECT 'G-20'::text AS guard, 'auth.' || needed.table_name || ' is missing' AS item, NULL::bigint AS found, true AS blocked,
    'A table of the auth schema the closure relies on is missing. Supabase changed the auth schema. Engineering must review the generator first.'::text AS clears, false AS info
  FROM (VALUES ('users'::text), ('sessions'), ('mfa_factors'), ('audit_log_entries')) AS needed(table_name)
  WHERE to_regclass(format('auth.%I', needed.table_name)) IS NULL
  UNION ALL
  SELECT 'G-20'::text AS guard, 'auth.' || needed.table_name || '.' || needed.column_name AS item, NULL::bigint AS found, true AS blocked,
    'A column the closure writes or reads is missing. Supabase changed the auth schema. Engineering must review the generator first.'::text AS clears, false AS info
  FROM (VALUES
    ('users'::text, 'email'::text),
    ('users', 'phone'),
    ('users', 'encrypted_password'),
    ('users', 'raw_user_meta_data'),
    ('users', 'raw_app_meta_data'),
    ('users', 'banned_until'),
    ('users', 'confirmation_token'),
    ('users', 'recovery_token'),
    ('users', 'email_change_token_new'),
    ('users', 'email_change_token_current'),
    ('users', 'phone_change_token'),
    ('users', 'reauthentication_token'),
    ('users', 'email_change'),
    ('users', 'phone_change'),
    ('audit_log_entries', 'payload'),
    ('identities'::text, 'user_id'::text),
    ('sessions', 'user_id'),
    ('refresh_tokens', 'user_id'),
    ('mfa_amr_claims', 'session_id'),
    ('mfa_factors', 'user_id'),
    ('mfa_challenges', 'factor_id'),
    ('mfa_recovery_code_sets', 'user_id'),
    ('one_time_tokens', 'user_id'),
    ('oauth_authorizations', 'user_id'),
    ('oauth_consents', 'user_id'),
    ('webauthn_credentials', 'user_id'),
    ('webauthn_challenges', 'user_id'),
    ('flow_state', 'user_id')
  ) AS needed(table_name, column_name)
  WHERE to_regclass(format('auth.%I', needed.table_name)) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = 'auth' AND cols.table_name = needed.table_name AND cols.column_name = needed.column_name
    )
  UNION ALL
  SELECT 'G-20'::text AS guard, 'auth.' || rel.relname || '.' || att.attname || ' links to the login' AS item, 1::bigint AS found, true AS blocked,
    'A table of the auth schema that links to the login or to its sessions has not been reviewed. Engineering must add it to the closure in the generator first.'::text AS clears, false AS info
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND nsp.nspname = 'auth'
    AND con.confrelid IN (SELECT to_regclass('auth.users') UNION ALL SELECT to_regclass('auth.sessions'))
    AND rel.relname::text NOT IN ('identities', 'sessions', 'refresh_tokens', 'mfa_amr_claims', 'mfa_factors', 'mfa_challenges', 'mfa_recovery_code_sets', 'one_time_tokens', 'oauth_authorizations', 'oauth_consents', 'webauthn_credentials', 'webauthn_challenges', 'flow_state', 'scim_users')
  UNION ALL
  SELECT 'G-20'::text AS guard, 'auth.' || cols.table_name || ' has a user_id column' AS item, 1::bigint AS found, true AS blocked,
    'A table of the auth schema names a login without a link (W-5). Engineering must add it to the closure in the generator first.'::text AS clears, false AS info
  FROM information_schema.columns AS cols
  WHERE cols.table_schema = 'auth' AND cols.column_name = 'user_id' AND cols.table_name::text NOT IN ('identities', 'sessions', 'refresh_tokens', 'mfa_amr_claims', 'mfa_factors', 'mfa_challenges', 'mfa_recovery_code_sets', 'one_time_tokens', 'oauth_authorizations', 'oauth_consents', 'webauthn_credentials', 'webauthn_challenges', 'flow_state', 'scim_users')
  UNION ALL
  SELECT 'G-20'::text AS guard, 'auth.' || rel.relname || '.' || att.attname || ' names the login' AS item,
    (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM auth.%I WHERE %I = %L', rel.relname, att.attname, target.user_id), false, true, '')))[1]::text::bigint AS found, true AS blocked,
    'A row of the auth schema that must not exist names the login. Engineering must review this account.'::text AS clears, false AS info
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  CROSS JOIN target
  WHERE con.contype = 'f' AND nsp.nspname = 'auth' AND con.confrelid = 'auth.users'::regclass
    AND rel.relname::text IN ('scim_users') AND target.user_id IS NOT NULL
    AND (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM auth.%I WHERE %I = %L', rel.relname, att.attname, target.user_id), false, true, '')))[1]::text::bigint > 0
  UNION ALL
  SELECT 'G-20'::text AS guard, 'privilege ' || needed.privilege_name || ' on auth.' || needed.table_name AS item, NULL::bigint AS found, true AS blocked,
    'The function owner may not write this auth table. Engineering must review the grants first.'::text AS clears, false AS info
  FROM (VALUES
    ('users'::text, 'UPDATE'::text),
    ('audit_log_entries', 'DELETE'),
    ('identities', 'DELETE'),
    ('sessions', 'DELETE'),
    ('refresh_tokens', 'DELETE'),
    ('mfa_factors', 'DELETE'),
    ('mfa_recovery_code_sets', 'DELETE'),
    ('one_time_tokens', 'DELETE'),
    ('oauth_authorizations', 'DELETE'),
    ('oauth_consents', 'DELETE'),
    ('webauthn_credentials', 'DELETE'),
    ('webauthn_challenges', 'DELETE'),
    ('flow_state', 'DELETE')
  ) AS needed(table_name, privilege_name)
  WHERE to_regclass(format('auth.%I', needed.table_name)) IS NOT NULL
    AND NOT pg_catalog.has_table_privilege(format('auth.%I', needed.table_name), needed.privilege_name)
  UNION ALL
  SELECT 'G-20'::text AS guard, 'auth closure reviewed'::text AS item, 0::bigint AS found, false AS blocked, ''::text AS clears, false AS info
  UNION ALL
  SELECT 'G-21'::text AS guard, nsp.nspname || '.' || rel.relname || '.' || trg.tgname AS item, 1::bigint AS found, true AS blocked,
    'An update trigger on the login or on a table the anonymise blanks has not been reviewed. Engineering must review it in the generator first.'::text AS clears, false AS info
  FROM pg_catalog.pg_trigger AS trg
  JOIN pg_catalog.pg_class AS rel ON rel.oid = trg.tgrelid
  JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  WHERE NOT trg.tgisinternal AND (trg.tgtype::integer & 16) <> 0
    AND ((nsp.nspname = 'auth' AND rel.relname = 'users') OR (nsp.nspname = 'public' AND rel.relname::text IN ('business_os_billing_accounts', 'business_os_boost_purchases', 'business_os_credit_lots', 'business_os_credit_lot_draws', 'user_subscriptions', 'credit_transactions', 'billing_events', 'token_usage', 'subscription_invoices', 'user_rewards', 'business_os_invites')))
    AND (nsp.nspname::text, rel.relname::text, trg.tgname::text) NOT IN (VALUES ('public', 'token_usage', 'update_token_usage_updated_at'), ('public', 'user_subscriptions', 'trigger_update_user_subscriptions_updated_at'))
  UNION ALL
  SELECT 'G-22'::text AS guard, child_rel.relname || '.' || con.conname || ' to ' || parent_rel.relname AS item, 1::bigint AS found, true AS blocked,
    'A kept table links to a table the anonymise empties, so deleting it would change or refuse kept rows. Engineering must review the link in the generator first.'::text AS clears, false AS info
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS child_rel ON child_rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS child_nsp ON child_nsp.oid = child_rel.relnamespace
  JOIN pg_catalog.pg_class AS parent_rel ON parent_rel.oid = con.confrelid
  JOIN pg_catalog.pg_namespace AS parent_nsp ON parent_nsp.oid = parent_rel.relnamespace
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND child_nsp.nspname = 'public' AND parent_nsp.nspname = 'public' AND con.conrelid <> con.confrelid
    AND child_rel.relname::text IN ('business_os_billing_accounts', 'business_os_billing_events', 'business_os_boost_purchases', 'business_os_boost_reversal_events', 'business_os_credit_charges', 'business_os_credit_lots', 'business_os_credit_lot_draws', 'business_os_credit_totals', 'credit_transactions', 'user_subscriptions', 'billing_events', 'processed_webhook_events', 'marketing_consent_events', 'marketing_consent_state', 'business_os_account_lineage', 'token_usage', 'boost_pack_purchases', 'user_rewards', 'subscription_invoices')
    AND parent_rel.relname::text IN (SELECT plan.table_name FROM plan)
    AND (
      (child_rel.relname::text, con.conname::text) NOT IN (VALUES ('marketing_consent_events', 'marketing_consent_events_contact_id_fkey'), ('marketing_consent_state', 'marketing_consent_state_contact_id_fkey'))
      OR con.confdeltype <> 'n' OR att.attnotnull OR cardinality(con.conkey) <> 1
    )
)
    SELECT jsonb_build_object(
      'blockers', string_agg(guard_rows.guard || ' ' || guard_rows.item, ', ' ORDER BY guard_rows.guard, guard_rows.item) FILTER (WHERE guard_rows.blocked),
      'paid', coalesce(bool_or(guard_rows.info AND guard_rows.found > 0 AND guard_rows.guard IN ('G-5', 'G-7')), false))
    FROM guard_rows
  );
  v_blockers := v_guard ->> 'blockers';
  IF v_blockers IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCKED, nothing was removed: %', v_blockers;
  END IF;

  v_user_id := v_subject;
  v_receipt_mode := CASE WHEN (v_guard ->> 'paid')::boolean THEN 'pseudonymised_billing_kept' ELSE 'anonymised' END;
  v_receipt_ref := substr(replace(v_receipt_id::text, '-', ''), 1, 12);
  v_placeholder := 'deleted-' || v_receipt_ref || '@' || 'deleted.invalid';

  FOR v_step IN
    SELECT plan_values.table_name, plan_values.key_column, plan_values.parent_table
    FROM (VALUES
      (1, 'A'::text, 'payment_reminders'::text, 'user_id'::text, NULL::text),
      (2, 'A', 'scheduling_meetings', 'user_id', NULL),
      (3, 'A', 'payment_plan_installments', 'user_id', NULL),
      (4, 'A', 'agent_logs', 'user_id', NULL),
      (5, 'A', 'insight_automations', 'user_id', NULL),
      (6, 'A', 'payment_plan_subscriptions', 'user_id', NULL),
      (7, 'A', 'payment_refunds', 'user_id', NULL),
      (8, 'A', 'agent_scheduler_state', 'agent_id', 'agents'),
      (9, 'A', 'abandoned_bookings', 'user_id', NULL),
      (10, 'A', 'agent_memories', 'user_id', NULL),
      (11, 'A', 'agent_memory', 'user_id', NULL),
      (12, 'A', 'agent_prompt_threads', 'user_id', NULL),
      (13, 'A', 'agent_prompt_workflow_generation_sessions', 'user_id', NULL),
      (14, 'A', 'archived_records', 'user_id', NULL),
      (15, 'A', 'audit_trail', 'user_id', NULL),
      (16, 'A', 'business_chat_action_log', 'user_id', NULL),
      (17, 'A', 'business_chat_conversation', 'user_id', NULL),
      (18, 'A', 'business_chat_plan_cache', 'user_id', NULL),
      (19, 'A', 'business_chat_saved_plans', 'user_id', NULL),
      (20, 'A', 'business_chat_verified_questions', 'user_id', NULL),
      (21, 'A', 'business_events', 'user_id', NULL),
      (22, 'A', 'business_health_summaries', 'user_id', NULL),
      (23, 'A', 'business_os_data_exports', 'user_id', NULL),
      (24, 'A', 'business_subscribers', 'user_id', NULL),
      (25, 'A', 'channel_metrics_daily', 'user_id', NULL),
      (26, 'A', 'command_sessions', 'user_id', NULL),
      (27, 'A', 'contact_documents', 'user_id', NULL),
      (28, 'A', 'crm_tasks', 'user_id', NULL),
      (29, 'A', 'daily_briefing_sends', 'user_id', NULL),
      (30, 'A', 'data_decision_requests', 'user_id', NULL),
      (31, 'A', 'derived_metrics', 'user_id', NULL),
      (32, 'A', 'email_sends', 'user_id', NULL),
      (33, 'A', 'email_sequence_enrollments', 'user_id', NULL),
      (34, 'A', 'email_sequence_steps', 'user_id', NULL),
      (35, 'A', 'external_calendar_events', 'user_id', NULL),
      (36, 'A', 'insight_actions', 'user_id', NULL),
      (37, 'A', 'insight_hypotheses', 'user_id', NULL),
      (38, 'A', 'insight_measurements', 'user_id', NULL),
      (39, 'A', 'kernel_action_log', 'user_id', NULL),
      (40, 'A', 'lead_responses', 'user_id', NULL),
      (41, 'A', 'onboarding_conversations', 'user_id', NULL),
      (42, 'A', 'onboarding_prompt_ideas', 'user_id', NULL),
      (43, 'A', 'owner_insight_history', 'user_id', NULL),
      (44, 'A', 'payment_automation_executions', 'user_id', NULL),
      (45, 'A', 'payment_events', 'user_id', NULL),
      (46, 'A', 'payment_methods', 'user_id', NULL),
      (47, 'A', 'proposals', 'user_id', NULL),
      (48, 'A', 'run_memories', 'user_id', NULL),
      (49, 'A', 'saved_payment_methods', 'user_id', NULL),
      (50, 'A', 'scheduling_availability_exceptions', 'user_id', NULL),
      (51, 'A', 'smart_link_clicks', 'smart_link_id', 'smart_links'),
      (52, 'A', 'user_media', 'user_id', NULL),
      (53, 'A', 'user_memory', 'user_id', NULL),
      (54, 'A', 'website_blocks', 'page_id', 'website_pages'),
      (55, 'A', 'website_content', 'user_id', NULL),
      (56, 'A', 'website_page_views', 'user_id', NULL),
      (57, 'A', 'scheduling_bookings', 'user_id', NULL),
      (58, 'A', 'agent_executions', 'user_id', NULL),
      (59, 'A', 'agents', 'user_id', NULL),
      (60, 'A', 'crm_contacts', 'user_id', NULL),
      (61, 'A', 'daily_briefings', 'user_id', NULL),
      (62, 'A', 'email_campaigns', 'user_id', NULL),
      (63, 'A', 'email_sequences', 'user_id', NULL),
      (64, 'A', 'insights', 'user_id', NULL),
      (65, 'A', 'kernel_executions', 'user_id', NULL),
      (66, 'A', 'payment_automation_rules', 'user_id', NULL),
      (67, 'A', 'payment_invoices', 'user_id', NULL),
      (68, 'A', 'payment_plans', 'user_id', NULL),
      (69, 'A', 'payment_transactions', 'user_id', NULL),
      (70, 'A', 'scheduling_services', 'user_id', NULL),
      (71, 'A', 'smart_links', 'user_id', NULL),
      (72, 'A', 'website_pages', 'user_id', NULL),
      (73, 'A', 'user_capability_blocks', 'user_capability_id', 'user_capabilities'),
      (74, 'A', 'business_addresses', 'user_id', NULL),
      (75, 'A', 'business_intake_forms', 'user_id', NULL),
      (76, 'A', 'channel_connections', 'user_id', NULL),
      (77, 'A', 'crm_pipeline_stages', 'user_id', NULL),
      (78, 'A', 'marketing_consent_settings', 'user_id', NULL),
      (79, 'A', 'payment_processors', 'user_id', NULL),
      (80, 'A', 'plugin_connections', 'user_id', NULL),
      (81, 'A', 'stripe_connect_accounts', 'user_id', NULL),
      (82, 'A', 'user_capabilities', 'user_id', NULL),
      (83, 'A', 'user_intake_settings', 'user_id', NULL),
      (84, 'A', 'crm_activities', 'user_id', NULL),
      (85, 'B', 'storage_usage', 'user_id', NULL),
      (86, 'B', 'subscriptions', 'user_id', NULL),
      (87, 'B', 'business_os_boost_cap_overrides', 'user_id', NULL),
      (88, 'B', 'business_os_account_plans', 'user_id', NULL),
      (89, 'B', 'business_os_entitlement_overrides', 'user_id', NULL),
      (90, 'B', 'business_os_entitlement_shadow_events', 'user_id', NULL),
      (91, 'B', 'email_unsubscribes', 'user_id', NULL),
      (92, 'B', 'user_preferences', 'user_id', NULL),
      (93, 'B', 'notification_settings', 'user_id', NULL),
      (94, 'B', 'security_settings', 'user_id', NULL),
      (95, 'B', 'api_keys', 'user_id', NULL),
      (96, 'B', 'audit_logs', 'user_id', NULL),
      (97, 'B', 'auth_handoff_codes', 'user_id', NULL),
      (98, 'B', 'business_os_account_closures', 'user_id', NULL),
      (99, 'B', 'agent_configurations', 'user_id', NULL),
      (100, 'B', 'agent_execution_logs', 'user_id', NULL),
      (101, 'B', 'agent_intensity_metrics', 'user_id', NULL),
      (102, 'B', 'agent_stats', 'user_id', NULL),
      (103, 'B', 'agent_templates', 'user_id', NULL),
      (104, 'B', 'agentkit_analytics', 'user_id', NULL),
      (105, 'B', 'calibration_history', 'user_id', NULL),
      (106, 'B', 'calibration_sessions', 'user_id', NULL),
      (107, 'B', 'error_patterns', 'user_id', NULL),
      (108, 'B', 'execution_anomalies', 'user_id', NULL),
      (109, 'B', 'execution_baselines', 'user_id', NULL),
      (110, 'B', 'execution_insight_runs', 'user_id', NULL),
      (111, 'B', 'execution_insights', 'user_id', NULL),
      (112, 'B', 'pilot_step_routing_history', 'user_id', NULL),
      (113, 'B', 'plugin_performance', 'user_id', NULL),
      (114, 'B', 'shadow_failure_snapshots', 'user_id', NULL),
      (115, 'B', 'shared_agents', 'user_id', NULL),
      (116, 'B', 'workflow_executions', 'user_id', NULL),
      (117, 'B', 'advisor_reports', 'user_id', NULL),
      (118, 'B', 'automation_slas', 'user_id', NULL),
      (119, 'B', 'group_metrics_rollup', 'user_id', NULL),
      (120, 'B', 'metric_baselines', 'user_id', NULL),
      (121, 'B', 'organization_members', 'user_id', NULL),
      (122, 'C', 'business_profiles', 'user_id', NULL),
      (123, 'C', 'profiles', 'id', NULL),
      (124, 'C', 'organizations', 'owner_user_id', NULL),
      (125, 'C', 'business_os_invites', 'issuer_account_id', NULL)
    ) AS plan_values(ord, step, table_name, key_column, parent_table)
    ORDER BY plan_values.ord
  LOOP
    IF to_regclass(format('public.%I', v_step.table_name)) IS NULL THEN
      CONTINUE;
    END IF;
    IF v_step.parent_table IS NULL THEN
      EXECUTE format('DELETE FROM public.%I WHERE %I = %L', v_step.table_name, v_step.key_column, v_user_id);
    ELSE
      EXECUTE format('DELETE FROM public.%I WHERE %I IN (SELECT id FROM public.%I WHERE user_id = %L)', v_step.table_name, v_step.key_column, v_step.parent_table, v_user_id);
    END IF;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      v_counts := v_counts || jsonb_build_object(v_step.table_name, v_rows);
      v_total := v_total + v_rows;
      v_tables := v_tables + 1;
    END IF;
  END LOOP;

  FOR v_blank IN
    SELECT blank_values.ord, blank_values.table_name, blank_values.column_name,
      CASE blank_values.target
        WHEN 'null' THEN 'NULL'
        WHEN 'empty_object' THEN format('%L::jsonb', '{}')
        WHEN 'strip' THEN format('%I - %L::text[]', blank_values.column_name, blank_values.strip_keys)
        WHEN 'placeholder' THEN format('%L', v_placeholder)
      END AS set_sql,
      CASE blank_values.target
        WHEN 'null' THEN format('%I IS NOT NULL', blank_values.column_name)
        WHEN 'empty_object' THEN format('%I IS DISTINCT FROM %L::jsonb', blank_values.column_name, '{}')
        WHEN 'strip' THEN format('%I ?| %L::text[]', blank_values.column_name, blank_values.strip_keys)
        WHEN 'placeholder' THEN format('%I IS DISTINCT FROM %L', blank_values.column_name, v_placeholder)
      END AS still_sql,
      CASE blank_values.key_kind
        WHEN 'user_id' THEN format('user_id = %L', v_user_id)
        WHEN 'invite_redeemer' THEN format('(redeemed_account_id = %L OR claimed_account_id = %L)', v_user_id, v_user_id)
      END AS key_sql
    FROM (VALUES
      (1, 'business_os_billing_accounts'::text, 'action_required_invoice_url'::text, 'null'::text, '{}'::text[], 'user_id'::text),
      (2, 'business_os_billing_accounts', 'open_checkout_session_id', 'null', '{}', 'user_id'),
      (3, 'business_os_boost_purchases', 'receipt_url', 'null', '{}', 'user_id'),
      (4, 'business_os_credit_lots', 'reason', 'null', '{}', 'user_id'),
      (5, 'business_os_credit_lot_draws', 'reason', 'null', '{}', 'user_id'),
      (6, 'user_subscriptions', 'payment_method_last4', 'null', '{}', 'user_id'),
      (7, 'user_subscriptions', 'payment_method_brand', 'null', '{}', 'user_id'),
      (8, 'user_subscriptions', 'last_calculator_inputs', 'null', '{}', 'user_id'),
      (9, 'credit_transactions', 'description', 'null', '{}', 'user_id'),
      (10, 'credit_transactions', 'metadata', 'strip', '{agent_name}', 'user_id'),
      (11, 'billing_events', 'payload', 'empty_object', '{}', 'user_id'),
      (12, 'billing_events', 'error_message', 'null', '{}', 'user_id'),
      (13, 'token_usage', 'error_message', 'null', '{}', 'user_id'),
      (14, 'token_usage', 'request_payload', 'null', '{}', 'user_id'),
      (15, 'token_usage', 'response_metadata', 'null', '{}', 'user_id'),
      (16, 'token_usage', 'metadata', 'strip', '{user_goal,user_role,user_mode,agent_name}', 'user_id'),
      (17, 'subscription_invoices', 'stripe_invoice_pdf', 'null', '{}', 'user_id'),
      (18, 'subscription_invoices', 'stripe_hosted_invoice_url', 'null', '{}', 'user_id'),
      (19, 'subscription_invoices', 'metadata', 'empty_object', '{}', 'user_id'),
      (20, 'user_rewards', 'metadata', 'empty_object', '{}', 'user_id'),
      (21, 'business_os_invites', 'email', 'placeholder', '{}', 'invite_redeemer'),
      (22, 'business_os_invites', 'personal_note', 'null', '{}', 'invite_redeemer'),
      (23, 'business_os_invites', 'email_problem_detail', 'null', '{}', 'invite_redeemer'),
      (24, 'business_os_invites', 'redemption_error_message', 'null', '{}', 'invite_redeemer')
    ) AS blank_values(ord, table_name, column_name, target, strip_keys, key_kind)
    WHERE to_regclass(format('public.%I', blank_values.table_name)) IS NOT NULL
    ORDER BY 1
  LOOP
    IF v_blank.set_sql IS NULL OR v_blank.still_sql IS NULL OR v_blank.key_sql IS NULL THEN
      RAISE EXCEPTION 'A blank rule is not known, so everything was rolled back.';
    END IF;
    EXECUTE format('UPDATE public.%I SET %I = %s WHERE %s AND %s', v_blank.table_name, v_blank.column_name, v_blank.set_sql, v_blank.key_sql, v_blank.still_sql);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      v_blanked := v_blanked || jsonb_build_object(v_blank.table_name || '.' || v_blank.column_name, v_rows);
      v_blanked_total := v_blanked_total + v_rows;
    END IF;
  END LOOP;

  v_survivors := (
    SELECT string_agg(left_over.table_name || '.' || left_over.column_name, ', ' ORDER BY left_over.ord)
    FROM (
      SELECT blank_values.ord, blank_values.table_name, blank_values.column_name,
        CASE blank_values.target
          WHEN 'null' THEN 'NULL'
          WHEN 'empty_object' THEN format('%L::jsonb', '{}')
          WHEN 'strip' THEN format('%I - %L::text[]', blank_values.column_name, blank_values.strip_keys)
          WHEN 'placeholder' THEN format('%L', v_placeholder)
        END AS set_sql,
        CASE blank_values.target
          WHEN 'null' THEN format('%I IS NOT NULL', blank_values.column_name)
          WHEN 'empty_object' THEN format('%I IS DISTINCT FROM %L::jsonb', blank_values.column_name, '{}')
          WHEN 'strip' THEN format('%I ?| %L::text[]', blank_values.column_name, blank_values.strip_keys)
          WHEN 'placeholder' THEN format('%I IS DISTINCT FROM %L', blank_values.column_name, v_placeholder)
        END AS still_sql,
        CASE blank_values.key_kind
          WHEN 'user_id' THEN format('user_id = %L', v_user_id)
          WHEN 'invite_redeemer' THEN format('(redeemed_account_id = %L OR claimed_account_id = %L)', v_user_id, v_user_id)
        END AS key_sql
      FROM (VALUES
        (1, 'business_os_billing_accounts'::text, 'action_required_invoice_url'::text, 'null'::text, '{}'::text[], 'user_id'::text),
        (2, 'business_os_billing_accounts', 'open_checkout_session_id', 'null', '{}', 'user_id'),
        (3, 'business_os_boost_purchases', 'receipt_url', 'null', '{}', 'user_id'),
        (4, 'business_os_credit_lots', 'reason', 'null', '{}', 'user_id'),
        (5, 'business_os_credit_lot_draws', 'reason', 'null', '{}', 'user_id'),
        (6, 'user_subscriptions', 'payment_method_last4', 'null', '{}', 'user_id'),
        (7, 'user_subscriptions', 'payment_method_brand', 'null', '{}', 'user_id'),
        (8, 'user_subscriptions', 'last_calculator_inputs', 'null', '{}', 'user_id'),
        (9, 'credit_transactions', 'description', 'null', '{}', 'user_id'),
        (10, 'credit_transactions', 'metadata', 'strip', '{agent_name}', 'user_id'),
        (11, 'billing_events', 'payload', 'empty_object', '{}', 'user_id'),
        (12, 'billing_events', 'error_message', 'null', '{}', 'user_id'),
        (13, 'token_usage', 'error_message', 'null', '{}', 'user_id'),
        (14, 'token_usage', 'request_payload', 'null', '{}', 'user_id'),
        (15, 'token_usage', 'response_metadata', 'null', '{}', 'user_id'),
        (16, 'token_usage', 'metadata', 'strip', '{user_goal,user_role,user_mode,agent_name}', 'user_id'),
        (17, 'subscription_invoices', 'stripe_invoice_pdf', 'null', '{}', 'user_id'),
        (18, 'subscription_invoices', 'stripe_hosted_invoice_url', 'null', '{}', 'user_id'),
        (19, 'subscription_invoices', 'metadata', 'empty_object', '{}', 'user_id'),
        (20, 'user_rewards', 'metadata', 'empty_object', '{}', 'user_id'),
        (21, 'business_os_invites', 'email', 'placeholder', '{}', 'invite_redeemer'),
        (22, 'business_os_invites', 'personal_note', 'null', '{}', 'invite_redeemer'),
        (23, 'business_os_invites', 'email_problem_detail', 'null', '{}', 'invite_redeemer'),
        (24, 'business_os_invites', 'redemption_error_message', 'null', '{}', 'invite_redeemer')
      ) AS blank_values(ord, table_name, column_name, target, strip_keys, key_kind)
      WHERE to_regclass(format('public.%I', blank_values.table_name)) IS NOT NULL
    ) AS left_over
    WHERE (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM public.%I WHERE %s AND %s', left_over.table_name, left_over.key_sql, left_over.still_sql), false, true, '')))[1]::text::bigint > 0
  );
  IF v_survivors IS NOT NULL THEN
    RAISE EXCEPTION 'A blanked value is still there, so everything was rolled back: %', v_survivors;
  END IF;

  v_session_ids := ARRAY(SELECT sessions.id FROM auth.sessions AS sessions WHERE sessions.user_id = v_user_id);
  v_factor_ids := ARRAY(SELECT factors.id FROM auth.mfa_factors AS factors WHERE factors.user_id = v_user_id);

  UPDATE auth.users SET
    email = v_placeholder,
    phone = NULL,
    encrypted_password = '',
    raw_user_meta_data = '{}'::jsonb,
    raw_app_meta_data = pg_catalog.jsonb_build_object('provider', 'email', 'providers', pg_catalog.jsonb_build_array('email'), 'deleted', true),
    banned_until = now() + interval '100 years',
    confirmation_token = '',
    recovery_token = '',
    email_change_token_new = '',
    email_change_token_current = '',
    phone_change_token = '',
    reauthentication_token = '',
    email_change = '',
    phone_change = ''
  WHERE id = v_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'The login was not closed. Everything was rolled back.';
  END IF;

  FOR v_auth IN
    SELECT closure.table_name, closure.key_column
    FROM (VALUES
      (1, 'identities'::text, 'user_id'::text, 'delete'::text),
      (2, 'sessions', 'user_id', 'delete'),
      (3, 'refresh_tokens', 'user_id', 'delete'),
      (4, 'mfa_amr_claims', 'session_id', 'via_sessions'),
      (5, 'mfa_factors', 'user_id', 'delete'),
      (6, 'mfa_challenges', 'factor_id', 'via_factors'),
      (7, 'mfa_recovery_code_sets', 'user_id', 'delete'),
      (8, 'one_time_tokens', 'user_id', 'delete'),
      (9, 'oauth_authorizations', 'user_id', 'delete'),
      (10, 'oauth_consents', 'user_id', 'delete'),
      (11, 'webauthn_credentials', 'user_id', 'delete'),
      (12, 'webauthn_challenges', 'user_id', 'delete'),
      (13, 'flow_state', 'user_id', 'delete')
    ) AS closure(ord, table_name, key_column, action)
    WHERE closure.action = 'delete' AND to_regclass(format('auth.%I', closure.table_name)) IS NOT NULL
    ORDER BY closure.ord
  LOOP
    EXECUTE format('DELETE FROM auth.%I WHERE %I = %L', v_auth.table_name, v_auth.key_column, v_user_id);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      v_closed := v_closed || jsonb_build_object(v_auth.table_name, v_rows);
    END IF;
  END LOOP;

  DELETE FROM auth.audit_log_entries AS log_rows
  WHERE ((log_rows.payload::jsonb ->> 'actor_id') = v_user_id::text
      OR (log_rows.payload::jsonb -> 'traits' ->> 'user_id') = v_user_id::text
      OR lower(log_rows.payload::jsonb ->> 'actor_username') = v_email
      OR lower(log_rows.payload::jsonb -> 'traits' ->> 'user_email') = v_email);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN
    v_closed := v_closed || jsonb_build_object('audit_log_entries', v_rows);
  END IF;

  v_survivors := (
    WITH plan_keys AS (
      SELECT plan_values.table_name, plan_values.key_column
      FROM (VALUES
        (1, 'A'::text, 'payment_reminders'::text, 'user_id'::text, NULL::text),
        (2, 'A', 'scheduling_meetings', 'user_id', NULL),
        (3, 'A', 'payment_plan_installments', 'user_id', NULL),
        (4, 'A', 'agent_logs', 'user_id', NULL),
        (5, 'A', 'insight_automations', 'user_id', NULL),
        (6, 'A', 'payment_plan_subscriptions', 'user_id', NULL),
        (7, 'A', 'payment_refunds', 'user_id', NULL),
        (8, 'A', 'agent_scheduler_state', 'agent_id', 'agents'),
        (9, 'A', 'abandoned_bookings', 'user_id', NULL),
        (10, 'A', 'agent_memories', 'user_id', NULL),
        (11, 'A', 'agent_memory', 'user_id', NULL),
        (12, 'A', 'agent_prompt_threads', 'user_id', NULL),
        (13, 'A', 'agent_prompt_workflow_generation_sessions', 'user_id', NULL),
        (14, 'A', 'archived_records', 'user_id', NULL),
        (15, 'A', 'audit_trail', 'user_id', NULL),
        (16, 'A', 'business_chat_action_log', 'user_id', NULL),
        (17, 'A', 'business_chat_conversation', 'user_id', NULL),
        (18, 'A', 'business_chat_plan_cache', 'user_id', NULL),
        (19, 'A', 'business_chat_saved_plans', 'user_id', NULL),
        (20, 'A', 'business_chat_verified_questions', 'user_id', NULL),
        (21, 'A', 'business_events', 'user_id', NULL),
        (22, 'A', 'business_health_summaries', 'user_id', NULL),
        (23, 'A', 'business_os_data_exports', 'user_id', NULL),
        (24, 'A', 'business_subscribers', 'user_id', NULL),
        (25, 'A', 'channel_metrics_daily', 'user_id', NULL),
        (26, 'A', 'command_sessions', 'user_id', NULL),
        (27, 'A', 'contact_documents', 'user_id', NULL),
        (28, 'A', 'crm_tasks', 'user_id', NULL),
        (29, 'A', 'daily_briefing_sends', 'user_id', NULL),
        (30, 'A', 'data_decision_requests', 'user_id', NULL),
        (31, 'A', 'derived_metrics', 'user_id', NULL),
        (32, 'A', 'email_sends', 'user_id', NULL),
        (33, 'A', 'email_sequence_enrollments', 'user_id', NULL),
        (34, 'A', 'email_sequence_steps', 'user_id', NULL),
        (35, 'A', 'external_calendar_events', 'user_id', NULL),
        (36, 'A', 'insight_actions', 'user_id', NULL),
        (37, 'A', 'insight_hypotheses', 'user_id', NULL),
        (38, 'A', 'insight_measurements', 'user_id', NULL),
        (39, 'A', 'kernel_action_log', 'user_id', NULL),
        (40, 'A', 'lead_responses', 'user_id', NULL),
        (41, 'A', 'onboarding_conversations', 'user_id', NULL),
        (42, 'A', 'onboarding_prompt_ideas', 'user_id', NULL),
        (43, 'A', 'owner_insight_history', 'user_id', NULL),
        (44, 'A', 'payment_automation_executions', 'user_id', NULL),
        (45, 'A', 'payment_events', 'user_id', NULL),
        (46, 'A', 'payment_methods', 'user_id', NULL),
        (47, 'A', 'proposals', 'user_id', NULL),
        (48, 'A', 'run_memories', 'user_id', NULL),
        (49, 'A', 'saved_payment_methods', 'user_id', NULL),
        (50, 'A', 'scheduling_availability_exceptions', 'user_id', NULL),
        (51, 'A', 'smart_link_clicks', 'smart_link_id', 'smart_links'),
        (52, 'A', 'user_media', 'user_id', NULL),
        (53, 'A', 'user_memory', 'user_id', NULL),
        (54, 'A', 'website_blocks', 'page_id', 'website_pages'),
        (55, 'A', 'website_content', 'user_id', NULL),
        (56, 'A', 'website_page_views', 'user_id', NULL),
        (57, 'A', 'scheduling_bookings', 'user_id', NULL),
        (58, 'A', 'agent_executions', 'user_id', NULL),
        (59, 'A', 'agents', 'user_id', NULL),
        (60, 'A', 'crm_contacts', 'user_id', NULL),
        (61, 'A', 'daily_briefings', 'user_id', NULL),
        (62, 'A', 'email_campaigns', 'user_id', NULL),
        (63, 'A', 'email_sequences', 'user_id', NULL),
        (64, 'A', 'insights', 'user_id', NULL),
        (65, 'A', 'kernel_executions', 'user_id', NULL),
        (66, 'A', 'payment_automation_rules', 'user_id', NULL),
        (67, 'A', 'payment_invoices', 'user_id', NULL),
        (68, 'A', 'payment_plans', 'user_id', NULL),
        (69, 'A', 'payment_transactions', 'user_id', NULL),
        (70, 'A', 'scheduling_services', 'user_id', NULL),
        (71, 'A', 'smart_links', 'user_id', NULL),
        (72, 'A', 'website_pages', 'user_id', NULL),
        (73, 'A', 'user_capability_blocks', 'user_capability_id', 'user_capabilities'),
        (74, 'A', 'business_addresses', 'user_id', NULL),
        (75, 'A', 'business_intake_forms', 'user_id', NULL),
        (76, 'A', 'channel_connections', 'user_id', NULL),
        (77, 'A', 'crm_pipeline_stages', 'user_id', NULL),
        (78, 'A', 'marketing_consent_settings', 'user_id', NULL),
        (79, 'A', 'payment_processors', 'user_id', NULL),
        (80, 'A', 'plugin_connections', 'user_id', NULL),
        (81, 'A', 'stripe_connect_accounts', 'user_id', NULL),
        (82, 'A', 'user_capabilities', 'user_id', NULL),
        (83, 'A', 'user_intake_settings', 'user_id', NULL),
        (84, 'A', 'crm_activities', 'user_id', NULL),
        (85, 'B', 'storage_usage', 'user_id', NULL),
        (86, 'B', 'subscriptions', 'user_id', NULL),
        (87, 'B', 'business_os_boost_cap_overrides', 'user_id', NULL),
        (88, 'B', 'business_os_account_plans', 'user_id', NULL),
        (89, 'B', 'business_os_entitlement_overrides', 'user_id', NULL),
        (90, 'B', 'business_os_entitlement_shadow_events', 'user_id', NULL),
        (91, 'B', 'email_unsubscribes', 'user_id', NULL),
        (92, 'B', 'user_preferences', 'user_id', NULL),
        (93, 'B', 'notification_settings', 'user_id', NULL),
        (94, 'B', 'security_settings', 'user_id', NULL),
        (95, 'B', 'api_keys', 'user_id', NULL),
        (96, 'B', 'audit_logs', 'user_id', NULL),
        (97, 'B', 'auth_handoff_codes', 'user_id', NULL),
        (98, 'B', 'business_os_account_closures', 'user_id', NULL),
        (99, 'B', 'agent_configurations', 'user_id', NULL),
        (100, 'B', 'agent_execution_logs', 'user_id', NULL),
        (101, 'B', 'agent_intensity_metrics', 'user_id', NULL),
        (102, 'B', 'agent_stats', 'user_id', NULL),
        (103, 'B', 'agent_templates', 'user_id', NULL),
        (104, 'B', 'agentkit_analytics', 'user_id', NULL),
        (105, 'B', 'calibration_history', 'user_id', NULL),
        (106, 'B', 'calibration_sessions', 'user_id', NULL),
        (107, 'B', 'error_patterns', 'user_id', NULL),
        (108, 'B', 'execution_anomalies', 'user_id', NULL),
        (109, 'B', 'execution_baselines', 'user_id', NULL),
        (110, 'B', 'execution_insight_runs', 'user_id', NULL),
        (111, 'B', 'execution_insights', 'user_id', NULL),
        (112, 'B', 'pilot_step_routing_history', 'user_id', NULL),
        (113, 'B', 'plugin_performance', 'user_id', NULL),
        (114, 'B', 'shadow_failure_snapshots', 'user_id', NULL),
        (115, 'B', 'shared_agents', 'user_id', NULL),
        (116, 'B', 'workflow_executions', 'user_id', NULL),
        (117, 'B', 'advisor_reports', 'user_id', NULL),
        (118, 'B', 'automation_slas', 'user_id', NULL),
        (119, 'B', 'group_metrics_rollup', 'user_id', NULL),
        (120, 'B', 'metric_baselines', 'user_id', NULL),
        (121, 'B', 'organization_members', 'user_id', NULL),
        (122, 'C', 'business_profiles', 'user_id', NULL),
        (123, 'C', 'profiles', 'id', NULL),
        (124, 'C', 'organizations', 'owner_user_id', NULL),
        (125, 'C', 'business_os_invites', 'issuer_account_id', NULL)
      ) AS plan_values(ord, step, table_name, key_column, parent_table)
      WHERE plan_values.parent_table IS NULL
    )
    SELECT string_agg(left_over.item || ' ' || left_over.found, ', ' ORDER BY left_over.item)
    FROM (
      SELECT 'auth.users closed'::text AS item,
        (1 - (SELECT count(*) FROM auth.users AS users
          WHERE users.id = v_user_id AND users.email = v_placeholder AND users.phone IS NULL AND users.encrypted_password = ''
            AND users.banned_until > now() + interval '99 years'))::bigint AS found
      UNION ALL
      SELECT plan_keys.table_name,
        (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM public.%I WHERE %I = %L', plan_keys.table_name, plan_keys.key_column, v_user_id), false, true, '')))[1]::text::bigint
      FROM plan_keys
      WHERE to_regclass(format('public.%I', plan_keys.table_name)) IS NOT NULL
      UNION ALL
      SELECT nsp.nspname || '.' || rel.relname || '.' || att.attname,
        (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM %I.%I WHERE %I = %L', nsp.nspname, rel.relname, att.attname, v_user_id), false, true, '')))[1]::text::bigint
      FROM pg_catalog.pg_constraint AS con
      JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
      JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
      JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
      WHERE con.contype = 'f' AND con.confrelid = 'auth.users'::regclass AND nsp.nspname <> 'auth'
        AND NOT (nsp.nspname = 'public' AND (rel.relname::text, att.attname::text) IN (SELECT plan_keys.table_name, plan_keys.key_column FROM plan_keys))
        AND NOT (nsp.nspname = 'public' AND rel.relname::text IN ('business_os_billing_accounts', 'business_os_billing_events', 'business_os_boost_purchases', 'business_os_boost_reversal_events', 'business_os_credit_charges', 'business_os_credit_lots', 'business_os_credit_lot_draws', 'business_os_credit_totals', 'credit_transactions', 'user_subscriptions', 'billing_events', 'processed_webhook_events', 'marketing_consent_events', 'marketing_consent_state', 'business_os_account_lineage', 'token_usage', 'boost_pack_purchases', 'user_rewards', 'subscription_invoices'))
      UNION ALL
      SELECT 'auth.' || closure.table_name,
        (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM auth.%I WHERE %I = %L', closure.table_name, closure.key_column, v_user_id), false, true, '')))[1]::text::bigint
      FROM (VALUES
        (1, 'identities'::text, 'user_id'::text, 'delete'::text),
        (2, 'sessions', 'user_id', 'delete'),
        (3, 'refresh_tokens', 'user_id', 'delete'),
        (4, 'mfa_amr_claims', 'session_id', 'via_sessions'),
        (5, 'mfa_factors', 'user_id', 'delete'),
        (6, 'mfa_challenges', 'factor_id', 'via_factors'),
        (7, 'mfa_recovery_code_sets', 'user_id', 'delete'),
        (8, 'one_time_tokens', 'user_id', 'delete'),
        (9, 'oauth_authorizations', 'user_id', 'delete'),
        (10, 'oauth_consents', 'user_id', 'delete'),
        (11, 'webauthn_credentials', 'user_id', 'delete'),
        (12, 'webauthn_challenges', 'user_id', 'delete'),
        (13, 'flow_state', 'user_id', 'delete')
      ) AS closure(ord, table_name, key_column, action)
      WHERE closure.action = 'delete' AND to_regclass(format('auth.%I', closure.table_name)) IS NOT NULL
      UNION ALL
      SELECT 'auth.' || closure.table_name,
        (xpath('/row/row_count/text()', query_to_xml(format('SELECT count(*) AS row_count FROM auth.%I WHERE %I = ANY (%L::uuid[])', closure.table_name, closure.key_column, CASE WHEN closure.action = 'via_sessions' THEN v_session_ids ELSE v_factor_ids END), false, true, '')))[1]::text::bigint
      FROM (VALUES
        (1, 'identities'::text, 'user_id'::text, 'delete'::text),
        (2, 'sessions', 'user_id', 'delete'),
        (3, 'refresh_tokens', 'user_id', 'delete'),
        (4, 'mfa_amr_claims', 'session_id', 'via_sessions'),
        (5, 'mfa_factors', 'user_id', 'delete'),
        (6, 'mfa_challenges', 'factor_id', 'via_factors'),
        (7, 'mfa_recovery_code_sets', 'user_id', 'delete'),
        (8, 'one_time_tokens', 'user_id', 'delete'),
        (9, 'oauth_authorizations', 'user_id', 'delete'),
        (10, 'oauth_consents', 'user_id', 'delete'),
        (11, 'webauthn_credentials', 'user_id', 'delete'),
        (12, 'webauthn_challenges', 'user_id', 'delete'),
        (13, 'flow_state', 'user_id', 'delete')
      ) AS closure(ord, table_name, key_column, action)
      WHERE closure.action IN ('via_sessions', 'via_factors') AND to_regclass(format('auth.%I', closure.table_name)) IS NOT NULL
      UNION ALL
      SELECT 'auth.audit_log_entries'::text,
        (SELECT count(*) FROM auth.audit_log_entries AS log_rows WHERE ((log_rows.payload::jsonb ->> 'actor_id') = v_user_id::text
      OR (log_rows.payload::jsonb -> 'traits' ->> 'user_id') = v_user_id::text
      OR lower(log_rows.payload::jsonb ->> 'actor_username') = v_email
      OR lower(log_rows.payload::jsonb -> 'traits' ->> 'user_email') = v_email))::bigint
    ) AS left_over
    WHERE left_over.found > 0
  );
  IF v_survivors IS NOT NULL THEN
    RAISE EXCEPTION 'Something still names the login after the anonymise, so everything was rolled back: %', v_survivors;
  END IF;

  v_subject_id := v_user_id;
  v_removed_rows := v_total;
  v_removed_tables := v_tables;
  v_blanked_rows := v_blanked_total;
  v_report := jsonb_build_object('receipt_id', v_receipt_id, 'placeholder_ref', v_receipt_ref, 'receipt_mode', v_receipt_mode,
    'rows_removed', v_total, 'tables_removed', v_tables, 'rows_blanked', v_blanked_total, 'counts', v_counts, 'blanked', v_blanked, 'closed', v_closed);

  INSERT INTO public.audit_trail (action, entity_type, entity_id, resource_name, user_id, actor_id, details, severity, compliance_flags, created_at)
  VALUES (
    'ACCOUNT_PSEUDONYMISED', 'user', v_user_id::text, NULL,
    NULLIF(current_setting('cleanup.actor_id', true), '')::uuid, NULLIF(current_setting('cleanup.actor_id', true), '')::uuid,
    jsonb_build_object('source', coalesce(NULLIF(current_setting('cleanup.source', true), ''), 'admin_page'), 'receipt_id', v_receipt_id, 'mode', v_receipt_mode,
      'tables', v_tables, 'rows', v_total, 'rows_blanked', v_blanked_total, 'counts', v_counts, 'blanked', v_blanked, 'closed', v_closed),
    'critical', ARRAY['GDPR', 'SOC2']::text[], now()
  );

  RAISE NOTICE 'CLOSED. Removed % rows from % tables, blanked %, closed the login %', v_total, v_tables, v_blanked_total, v_user_id;
END;
    v_result := '[]'::jsonb;
  END IF;

  IF p_mode IN ('delete', 'anonymise') THEN
    INSERT INTO public.business_os_deletion_receipts (id, status, mode, subject_user_id, placeholder_ref, email_fingerprint, fingerprint_key_version, origin, executor_kind, executor_admin_id, executor_admin_email, reason_category, reason_note, statement_language, statement_text, owner_last_export_ready_at, owner_export_downloaded_at, admin_export_existed, rows_removed, rows_blanked, files_removed, tables_removed, requested_at, completed_at, retain_until, correlation_id)
    VALUES (
      v_receipt_id, 'completed', v_receipt_mode, v_subject_id, v_receipt_ref, (p_receipt ->> 'email_fingerprint'), (p_receipt ->> 'fingerprint_key_version')::smallint,
      (p_receipt ->> 'origin'), (p_receipt ->> 'executor_kind'), p_actor, NULLIF((p_receipt ->> 'executor_admin_email'), ''), (p_receipt ->> 'reason_category'), (p_receipt ->> 'reason_note'),
      (p_receipt ->> 'statement_language'), (p_receipt ->> 'statement_text'), (p_receipt ->> 'owner_last_export_ready_at')::timestamptz, (p_receipt ->> 'owner_export_downloaded_at')::timestamptz, (p_receipt ->> 'admin_export_existed')::boolean,
      v_removed_rows, v_blanked_rows, coalesce((p_receipt ->> 'files_removed')::bigint, 0), v_removed_tables, (p_receipt ->> 'requested_at')::timestamptz, now(), (p_receipt ->> 'retain_until')::timestamptz, (p_receipt ->> 'correlation_id')
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object('version', '792d801e13101316', 'mode', p_mode, 'rows', coalesce(v_result, '[]'::jsonb),
    'server_ms', (pg_catalog.date_part('epoch', pg_catalog.clock_timestamp() - pg_catalog.statement_timestamp()) * 1000)::bigint) || v_report;
END
$operator_cleanup$;

ALTER FUNCTION public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
