-- TEST ACCOUNT CLEANUP, DELETE. Removes one test account completely, or nothing at all.
-- Run the check file first and continue only when it says OK.
-- Runbook: docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md
-- 1. The email of the test account to remove.
SELECT set_config('cleanup.target_email', 'name+test1@example.com', true) AS edit_target_email;
-- 2. The test tag. Only an account whose email contains this text can be removed. Never leave it empty.
SELECT set_config('cleanup.test_tag', '+test', true) AS edit_test_tag;
-- 3. Type the same email again to confirm.
SELECT set_config('cleanup.confirm_email', 'type-the-email-again', true) AS edit_confirm_email;

DO $cleanup$
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
    (2, 'A', 'payment_plan_installments', 'user_id', NULL),
    (3, 'A', 'agent_logs', 'user_id', NULL),
    (4, 'A', 'insight_automations', 'user_id', NULL),
    (5, 'A', 'payment_plan_subscriptions', 'user_id', NULL),
    (6, 'A', 'payment_refunds', 'user_id', NULL),
    (7, 'A', 'agent_scheduler_state', 'agent_id', 'agents'),
    (8, 'A', 'agent_memories', 'user_id', NULL),
    (9, 'A', 'agent_memory', 'user_id', NULL),
    (10, 'A', 'agent_prompt_threads', 'user_id', NULL),
    (11, 'A', 'agent_prompt_workflow_generation_sessions', 'user_id', NULL),
    (12, 'A', 'archived_records', 'user_id', NULL),
    (13, 'A', 'audit_trail', 'user_id', NULL),
    (14, 'A', 'business_chat_action_log', 'user_id', NULL),
    (15, 'A', 'business_chat_conversation', 'user_id', NULL),
    (16, 'A', 'business_chat_plan_cache', 'user_id', NULL),
    (17, 'A', 'business_chat_saved_plans', 'user_id', NULL),
    (18, 'A', 'business_chat_verified_questions', 'user_id', NULL),
    (19, 'A', 'business_events', 'user_id', NULL),
    (20, 'A', 'business_health_summaries', 'user_id', NULL),
    (21, 'A', 'business_subscribers', 'user_id', NULL),
    (22, 'A', 'channel_metrics_daily', 'user_id', NULL),
    (23, 'A', 'command_sessions', 'user_id', NULL),
    (24, 'A', 'contact_documents', 'user_id', NULL),
    (25, 'A', 'crm_tasks', 'user_id', NULL),
    (26, 'A', 'daily_briefing_sends', 'user_id', NULL),
    (27, 'A', 'data_decision_requests', 'user_id', NULL),
    (28, 'A', 'derived_metrics', 'user_id', NULL),
    (29, 'A', 'email_sends', 'user_id', NULL),
    (30, 'A', 'email_sequence_enrollments', 'user_id', NULL),
    (31, 'A', 'email_sequence_steps', 'user_id', NULL),
    (32, 'A', 'external_calendar_events', 'user_id', NULL),
    (33, 'A', 'insight_actions', 'user_id', NULL),
    (34, 'A', 'insight_hypotheses', 'user_id', NULL),
    (35, 'A', 'insight_measurements', 'user_id', NULL),
    (36, 'A', 'kernel_action_log', 'user_id', NULL),
    (37, 'A', 'lead_responses', 'user_id', NULL),
    (38, 'A', 'onboarding_conversations', 'user_id', NULL),
    (39, 'A', 'onboarding_prompt_ideas', 'user_id', NULL),
    (40, 'A', 'owner_insight_history', 'user_id', NULL),
    (41, 'A', 'payment_automation_executions', 'user_id', NULL),
    (42, 'A', 'payment_events', 'user_id', NULL),
    (43, 'A', 'payment_methods', 'user_id', NULL),
    (44, 'A', 'proposals', 'user_id', NULL),
    (45, 'A', 'run_memories', 'user_id', NULL),
    (46, 'A', 'saved_payment_methods', 'user_id', NULL),
    (47, 'A', 'scheduling_availability_exceptions', 'user_id', NULL),
    (48, 'A', 'smart_link_clicks', 'smart_link_id', 'smart_links'),
    (49, 'A', 'user_media', 'user_id', NULL),
    (50, 'A', 'user_memory', 'user_id', NULL),
    (51, 'A', 'website_blocks', 'page_id', 'website_pages'),
    (52, 'A', 'website_content', 'user_id', NULL),
    (53, 'A', 'website_page_views', 'user_id', NULL),
    (54, 'A', 'agent_executions', 'user_id', NULL),
    (55, 'A', 'agents', 'user_id', NULL),
    (56, 'A', 'crm_contacts', 'user_id', NULL),
    (57, 'A', 'daily_briefings', 'user_id', NULL),
    (58, 'A', 'email_campaigns', 'user_id', NULL),
    (59, 'A', 'email_sequences', 'user_id', NULL),
    (60, 'A', 'insights', 'user_id', NULL),
    (61, 'A', 'kernel_executions', 'user_id', NULL),
    (62, 'A', 'payment_automation_rules', 'user_id', NULL),
    (63, 'A', 'payment_invoices', 'user_id', NULL),
    (64, 'A', 'payment_plans', 'user_id', NULL),
    (65, 'A', 'payment_transactions', 'user_id', NULL),
    (66, 'A', 'scheduling_bookings', 'user_id', NULL),
    (67, 'A', 'scheduling_services', 'user_id', NULL),
    (68, 'A', 'smart_links', 'user_id', NULL),
    (69, 'A', 'website_pages', 'user_id', NULL),
    (70, 'A', 'user_capability_blocks', 'user_capability_id', 'user_capabilities'),
    (71, 'A', 'business_addresses', 'user_id', NULL),
    (72, 'A', 'business_intake_forms', 'user_id', NULL),
    (73, 'A', 'channel_connections', 'user_id', NULL),
    (74, 'A', 'crm_pipeline_stages', 'user_id', NULL),
    (75, 'A', 'marketing_consent_settings', 'user_id', NULL),
    (76, 'A', 'payment_processors', 'user_id', NULL),
    (77, 'A', 'plugin_connections', 'user_id', NULL),
    (78, 'A', 'stripe_connect_accounts', 'user_id', NULL),
    (79, 'A', 'user_capabilities', 'user_id', NULL),
    (80, 'A', 'user_intake_settings', 'user_id', NULL),
    (81, 'A', 'crm_activities', 'user_id', NULL),
    (82, 'B', 'billing_events', 'user_id', NULL),
    (83, 'B', 'boost_pack_purchases', 'user_id', NULL),
    (84, 'B', 'user_rewards', 'user_id', NULL),
    (85, 'B', 'credit_transactions', 'user_id', NULL),
    (86, 'B', 'token_usage', 'user_id', NULL),
    (87, 'B', 'storage_usage', 'user_id', NULL),
    (88, 'B', 'user_subscriptions', 'user_id', NULL),
    (89, 'B', 'subscriptions', 'user_id', NULL),
    (90, 'B', 'subscription_invoices', 'user_id', NULL),
    (91, 'B', 'business_os_boost_purchases', 'user_id', NULL),
    (92, 'B', 'business_os_credit_lot_draws', 'user_id', NULL),
    (93, 'B', 'business_os_credit_lots', 'user_id', NULL),
    (94, 'B', 'business_os_credit_charges', 'user_id', NULL),
    (95, 'B', 'business_os_credit_totals', 'user_id', NULL),
    (96, 'B', 'business_os_billing_events', 'user_id', NULL),
    (97, 'B', 'business_os_billing_accounts', 'user_id', NULL),
    (98, 'B', 'business_os_boost_cap_overrides', 'user_id', NULL),
    (99, 'B', 'business_os_account_plans', 'user_id', NULL),
    (100, 'B', 'business_os_entitlement_overrides', 'user_id', NULL),
    (101, 'B', 'business_os_entitlement_shadow_events', 'user_id', NULL),
    (102, 'B', 'processed_webhook_events', 'user_id', NULL),
    (103, 'B', 'marketing_consent_state', 'user_id', NULL),
    (104, 'B', 'email_unsubscribes', 'user_id', NULL),
    (105, 'B', 'user_preferences', 'user_id', NULL),
    (106, 'B', 'notification_settings', 'user_id', NULL),
    (107, 'B', 'security_settings', 'user_id', NULL),
    (108, 'B', 'api_keys', 'user_id', NULL),
    (109, 'B', 'audit_logs', 'user_id', NULL),
    (110, 'B', 'auth_handoff_codes', 'user_id', NULL),
    (111, 'B', 'agent_configurations', 'user_id', NULL),
    (112, 'B', 'agent_execution_logs', 'user_id', NULL),
    (113, 'B', 'agent_intensity_metrics', 'user_id', NULL),
    (114, 'B', 'agent_stats', 'user_id', NULL),
    (115, 'B', 'agent_templates', 'user_id', NULL),
    (116, 'B', 'agentkit_analytics', 'user_id', NULL),
    (117, 'B', 'calibration_history', 'user_id', NULL),
    (118, 'B', 'calibration_sessions', 'user_id', NULL),
    (119, 'B', 'error_patterns', 'user_id', NULL),
    (120, 'B', 'execution_anomalies', 'user_id', NULL),
    (121, 'B', 'execution_baselines', 'user_id', NULL),
    (122, 'B', 'execution_insight_runs', 'user_id', NULL),
    (123, 'B', 'execution_insights', 'user_id', NULL),
    (124, 'B', 'pilot_step_routing_history', 'user_id', NULL),
    (125, 'B', 'plugin_performance', 'user_id', NULL),
    (126, 'B', 'shadow_failure_snapshots', 'user_id', NULL),
    (127, 'B', 'shared_agents', 'user_id', NULL),
    (128, 'B', 'workflow_executions', 'user_id', NULL),
    (129, 'B', 'advisor_reports', 'user_id', NULL),
    (130, 'B', 'automation_slas', 'user_id', NULL),
    (131, 'B', 'group_metrics_rollup', 'user_id', NULL),
    (132, 'B', 'metric_baselines', 'user_id', NULL),
    (133, 'B', 'organization_members', 'user_id', NULL),
    (134, 'C', 'business_profiles', 'user_id', NULL),
    (135, 'C', 'profiles', 'id', NULL),
    (136, 'C', 'organizations', 'owner_user_id', NULL),
    (137, 'C', 'business_os_account_lineage', 'account_id', NULL),
    (138, 'C', 'business_os_invites', 'issuer_account_id', NULL)
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
    ('public'::text, 'admin_users'::text, 'user_id'::text, 'tenancy'::text, NULL::text),
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
    ('advisor_reports'::text, 'advisor_reports_org_id_fkey'::text, 'user_id'::text),
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
    ('email_sends', 'email_sends_business_fk', 'user_id'),
    ('email_sends', 'email_sends_campaign_id_fkey', 'user_id'),
    ('email_sends', 'email_sends_contact_id_fkey', 'user_id'),
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
  FROM (SELECT ((SELECT count(*) FROM storage.objects AS objects WHERE objects.bucket_id IN ('contact-documents', 'website-images', 'business-purge-snapshots') AND starts_with(objects.name, target.user_id::text || '/'))) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted
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
      (2, 'A', 'payment_plan_installments', 'user_id', NULL),
      (3, 'A', 'agent_logs', 'user_id', NULL),
      (4, 'A', 'insight_automations', 'user_id', NULL),
      (5, 'A', 'payment_plan_subscriptions', 'user_id', NULL),
      (6, 'A', 'payment_refunds', 'user_id', NULL),
      (7, 'A', 'agent_scheduler_state', 'agent_id', 'agents'),
      (8, 'A', 'agent_memories', 'user_id', NULL),
      (9, 'A', 'agent_memory', 'user_id', NULL),
      (10, 'A', 'agent_prompt_threads', 'user_id', NULL),
      (11, 'A', 'agent_prompt_workflow_generation_sessions', 'user_id', NULL),
      (12, 'A', 'archived_records', 'user_id', NULL),
      (13, 'A', 'audit_trail', 'user_id', NULL),
      (14, 'A', 'business_chat_action_log', 'user_id', NULL),
      (15, 'A', 'business_chat_conversation', 'user_id', NULL),
      (16, 'A', 'business_chat_plan_cache', 'user_id', NULL),
      (17, 'A', 'business_chat_saved_plans', 'user_id', NULL),
      (18, 'A', 'business_chat_verified_questions', 'user_id', NULL),
      (19, 'A', 'business_events', 'user_id', NULL),
      (20, 'A', 'business_health_summaries', 'user_id', NULL),
      (21, 'A', 'business_subscribers', 'user_id', NULL),
      (22, 'A', 'channel_metrics_daily', 'user_id', NULL),
      (23, 'A', 'command_sessions', 'user_id', NULL),
      (24, 'A', 'contact_documents', 'user_id', NULL),
      (25, 'A', 'crm_tasks', 'user_id', NULL),
      (26, 'A', 'daily_briefing_sends', 'user_id', NULL),
      (27, 'A', 'data_decision_requests', 'user_id', NULL),
      (28, 'A', 'derived_metrics', 'user_id', NULL),
      (29, 'A', 'email_sends', 'user_id', NULL),
      (30, 'A', 'email_sequence_enrollments', 'user_id', NULL),
      (31, 'A', 'email_sequence_steps', 'user_id', NULL),
      (32, 'A', 'external_calendar_events', 'user_id', NULL),
      (33, 'A', 'insight_actions', 'user_id', NULL),
      (34, 'A', 'insight_hypotheses', 'user_id', NULL),
      (35, 'A', 'insight_measurements', 'user_id', NULL),
      (36, 'A', 'kernel_action_log', 'user_id', NULL),
      (37, 'A', 'lead_responses', 'user_id', NULL),
      (38, 'A', 'onboarding_conversations', 'user_id', NULL),
      (39, 'A', 'onboarding_prompt_ideas', 'user_id', NULL),
      (40, 'A', 'owner_insight_history', 'user_id', NULL),
      (41, 'A', 'payment_automation_executions', 'user_id', NULL),
      (42, 'A', 'payment_events', 'user_id', NULL),
      (43, 'A', 'payment_methods', 'user_id', NULL),
      (44, 'A', 'proposals', 'user_id', NULL),
      (45, 'A', 'run_memories', 'user_id', NULL),
      (46, 'A', 'saved_payment_methods', 'user_id', NULL),
      (47, 'A', 'scheduling_availability_exceptions', 'user_id', NULL),
      (48, 'A', 'smart_link_clicks', 'smart_link_id', 'smart_links'),
      (49, 'A', 'user_media', 'user_id', NULL),
      (50, 'A', 'user_memory', 'user_id', NULL),
      (51, 'A', 'website_blocks', 'page_id', 'website_pages'),
      (52, 'A', 'website_content', 'user_id', NULL),
      (53, 'A', 'website_page_views', 'user_id', NULL),
      (54, 'A', 'agent_executions', 'user_id', NULL),
      (55, 'A', 'agents', 'user_id', NULL),
      (56, 'A', 'crm_contacts', 'user_id', NULL),
      (57, 'A', 'daily_briefings', 'user_id', NULL),
      (58, 'A', 'email_campaigns', 'user_id', NULL),
      (59, 'A', 'email_sequences', 'user_id', NULL),
      (60, 'A', 'insights', 'user_id', NULL),
      (61, 'A', 'kernel_executions', 'user_id', NULL),
      (62, 'A', 'payment_automation_rules', 'user_id', NULL),
      (63, 'A', 'payment_invoices', 'user_id', NULL),
      (64, 'A', 'payment_plans', 'user_id', NULL),
      (65, 'A', 'payment_transactions', 'user_id', NULL),
      (66, 'A', 'scheduling_bookings', 'user_id', NULL),
      (67, 'A', 'scheduling_services', 'user_id', NULL),
      (68, 'A', 'smart_links', 'user_id', NULL),
      (69, 'A', 'website_pages', 'user_id', NULL),
      (70, 'A', 'user_capability_blocks', 'user_capability_id', 'user_capabilities'),
      (71, 'A', 'business_addresses', 'user_id', NULL),
      (72, 'A', 'business_intake_forms', 'user_id', NULL),
      (73, 'A', 'channel_connections', 'user_id', NULL),
      (74, 'A', 'crm_pipeline_stages', 'user_id', NULL),
      (75, 'A', 'marketing_consent_settings', 'user_id', NULL),
      (76, 'A', 'payment_processors', 'user_id', NULL),
      (77, 'A', 'plugin_connections', 'user_id', NULL),
      (78, 'A', 'stripe_connect_accounts', 'user_id', NULL),
      (79, 'A', 'user_capabilities', 'user_id', NULL),
      (80, 'A', 'user_intake_settings', 'user_id', NULL),
      (81, 'A', 'crm_activities', 'user_id', NULL),
      (82, 'B', 'billing_events', 'user_id', NULL),
      (83, 'B', 'boost_pack_purchases', 'user_id', NULL),
      (84, 'B', 'user_rewards', 'user_id', NULL),
      (85, 'B', 'credit_transactions', 'user_id', NULL),
      (86, 'B', 'token_usage', 'user_id', NULL),
      (87, 'B', 'storage_usage', 'user_id', NULL),
      (88, 'B', 'user_subscriptions', 'user_id', NULL),
      (89, 'B', 'subscriptions', 'user_id', NULL),
      (90, 'B', 'subscription_invoices', 'user_id', NULL),
      (91, 'B', 'business_os_boost_purchases', 'user_id', NULL),
      (92, 'B', 'business_os_credit_lot_draws', 'user_id', NULL),
      (93, 'B', 'business_os_credit_lots', 'user_id', NULL),
      (94, 'B', 'business_os_credit_charges', 'user_id', NULL),
      (95, 'B', 'business_os_credit_totals', 'user_id', NULL),
      (96, 'B', 'business_os_billing_events', 'user_id', NULL),
      (97, 'B', 'business_os_billing_accounts', 'user_id', NULL),
      (98, 'B', 'business_os_boost_cap_overrides', 'user_id', NULL),
      (99, 'B', 'business_os_account_plans', 'user_id', NULL),
      (100, 'B', 'business_os_entitlement_overrides', 'user_id', NULL),
      (101, 'B', 'business_os_entitlement_shadow_events', 'user_id', NULL),
      (102, 'B', 'processed_webhook_events', 'user_id', NULL),
      (103, 'B', 'marketing_consent_state', 'user_id', NULL),
      (104, 'B', 'email_unsubscribes', 'user_id', NULL),
      (105, 'B', 'user_preferences', 'user_id', NULL),
      (106, 'B', 'notification_settings', 'user_id', NULL),
      (107, 'B', 'security_settings', 'user_id', NULL),
      (108, 'B', 'api_keys', 'user_id', NULL),
      (109, 'B', 'audit_logs', 'user_id', NULL),
      (110, 'B', 'auth_handoff_codes', 'user_id', NULL),
      (111, 'B', 'agent_configurations', 'user_id', NULL),
      (112, 'B', 'agent_execution_logs', 'user_id', NULL),
      (113, 'B', 'agent_intensity_metrics', 'user_id', NULL),
      (114, 'B', 'agent_stats', 'user_id', NULL),
      (115, 'B', 'agent_templates', 'user_id', NULL),
      (116, 'B', 'agentkit_analytics', 'user_id', NULL),
      (117, 'B', 'calibration_history', 'user_id', NULL),
      (118, 'B', 'calibration_sessions', 'user_id', NULL),
      (119, 'B', 'error_patterns', 'user_id', NULL),
      (120, 'B', 'execution_anomalies', 'user_id', NULL),
      (121, 'B', 'execution_baselines', 'user_id', NULL),
      (122, 'B', 'execution_insight_runs', 'user_id', NULL),
      (123, 'B', 'execution_insights', 'user_id', NULL),
      (124, 'B', 'pilot_step_routing_history', 'user_id', NULL),
      (125, 'B', 'plugin_performance', 'user_id', NULL),
      (126, 'B', 'shadow_failure_snapshots', 'user_id', NULL),
      (127, 'B', 'shared_agents', 'user_id', NULL),
      (128, 'B', 'workflow_executions', 'user_id', NULL),
      (129, 'B', 'advisor_reports', 'user_id', NULL),
      (130, 'B', 'automation_slas', 'user_id', NULL),
      (131, 'B', 'group_metrics_rollup', 'user_id', NULL),
      (132, 'B', 'metric_baselines', 'user_id', NULL),
      (133, 'B', 'organization_members', 'user_id', NULL),
      (134, 'C', 'business_profiles', 'user_id', NULL),
      (135, 'C', 'profiles', 'id', NULL),
      (136, 'C', 'organizations', 'owner_user_id', NULL),
      (137, 'C', 'business_os_account_lineage', 'account_id', NULL),
      (138, 'C', 'business_os_invites', 'issuer_account_id', NULL)
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
        (2, 'A', 'payment_plan_installments', 'user_id', NULL),
        (3, 'A', 'agent_logs', 'user_id', NULL),
        (4, 'A', 'insight_automations', 'user_id', NULL),
        (5, 'A', 'payment_plan_subscriptions', 'user_id', NULL),
        (6, 'A', 'payment_refunds', 'user_id', NULL),
        (7, 'A', 'agent_scheduler_state', 'agent_id', 'agents'),
        (8, 'A', 'agent_memories', 'user_id', NULL),
        (9, 'A', 'agent_memory', 'user_id', NULL),
        (10, 'A', 'agent_prompt_threads', 'user_id', NULL),
        (11, 'A', 'agent_prompt_workflow_generation_sessions', 'user_id', NULL),
        (12, 'A', 'archived_records', 'user_id', NULL),
        (13, 'A', 'audit_trail', 'user_id', NULL),
        (14, 'A', 'business_chat_action_log', 'user_id', NULL),
        (15, 'A', 'business_chat_conversation', 'user_id', NULL),
        (16, 'A', 'business_chat_plan_cache', 'user_id', NULL),
        (17, 'A', 'business_chat_saved_plans', 'user_id', NULL),
        (18, 'A', 'business_chat_verified_questions', 'user_id', NULL),
        (19, 'A', 'business_events', 'user_id', NULL),
        (20, 'A', 'business_health_summaries', 'user_id', NULL),
        (21, 'A', 'business_subscribers', 'user_id', NULL),
        (22, 'A', 'channel_metrics_daily', 'user_id', NULL),
        (23, 'A', 'command_sessions', 'user_id', NULL),
        (24, 'A', 'contact_documents', 'user_id', NULL),
        (25, 'A', 'crm_tasks', 'user_id', NULL),
        (26, 'A', 'daily_briefing_sends', 'user_id', NULL),
        (27, 'A', 'data_decision_requests', 'user_id', NULL),
        (28, 'A', 'derived_metrics', 'user_id', NULL),
        (29, 'A', 'email_sends', 'user_id', NULL),
        (30, 'A', 'email_sequence_enrollments', 'user_id', NULL),
        (31, 'A', 'email_sequence_steps', 'user_id', NULL),
        (32, 'A', 'external_calendar_events', 'user_id', NULL),
        (33, 'A', 'insight_actions', 'user_id', NULL),
        (34, 'A', 'insight_hypotheses', 'user_id', NULL),
        (35, 'A', 'insight_measurements', 'user_id', NULL),
        (36, 'A', 'kernel_action_log', 'user_id', NULL),
        (37, 'A', 'lead_responses', 'user_id', NULL),
        (38, 'A', 'onboarding_conversations', 'user_id', NULL),
        (39, 'A', 'onboarding_prompt_ideas', 'user_id', NULL),
        (40, 'A', 'owner_insight_history', 'user_id', NULL),
        (41, 'A', 'payment_automation_executions', 'user_id', NULL),
        (42, 'A', 'payment_events', 'user_id', NULL),
        (43, 'A', 'payment_methods', 'user_id', NULL),
        (44, 'A', 'proposals', 'user_id', NULL),
        (45, 'A', 'run_memories', 'user_id', NULL),
        (46, 'A', 'saved_payment_methods', 'user_id', NULL),
        (47, 'A', 'scheduling_availability_exceptions', 'user_id', NULL),
        (48, 'A', 'smart_link_clicks', 'smart_link_id', 'smart_links'),
        (49, 'A', 'user_media', 'user_id', NULL),
        (50, 'A', 'user_memory', 'user_id', NULL),
        (51, 'A', 'website_blocks', 'page_id', 'website_pages'),
        (52, 'A', 'website_content', 'user_id', NULL),
        (53, 'A', 'website_page_views', 'user_id', NULL),
        (54, 'A', 'agent_executions', 'user_id', NULL),
        (55, 'A', 'agents', 'user_id', NULL),
        (56, 'A', 'crm_contacts', 'user_id', NULL),
        (57, 'A', 'daily_briefings', 'user_id', NULL),
        (58, 'A', 'email_campaigns', 'user_id', NULL),
        (59, 'A', 'email_sequences', 'user_id', NULL),
        (60, 'A', 'insights', 'user_id', NULL),
        (61, 'A', 'kernel_executions', 'user_id', NULL),
        (62, 'A', 'payment_automation_rules', 'user_id', NULL),
        (63, 'A', 'payment_invoices', 'user_id', NULL),
        (64, 'A', 'payment_plans', 'user_id', NULL),
        (65, 'A', 'payment_transactions', 'user_id', NULL),
        (66, 'A', 'scheduling_bookings', 'user_id', NULL),
        (67, 'A', 'scheduling_services', 'user_id', NULL),
        (68, 'A', 'smart_links', 'user_id', NULL),
        (69, 'A', 'website_pages', 'user_id', NULL),
        (70, 'A', 'user_capability_blocks', 'user_capability_id', 'user_capabilities'),
        (71, 'A', 'business_addresses', 'user_id', NULL),
        (72, 'A', 'business_intake_forms', 'user_id', NULL),
        (73, 'A', 'channel_connections', 'user_id', NULL),
        (74, 'A', 'crm_pipeline_stages', 'user_id', NULL),
        (75, 'A', 'marketing_consent_settings', 'user_id', NULL),
        (76, 'A', 'payment_processors', 'user_id', NULL),
        (77, 'A', 'plugin_connections', 'user_id', NULL),
        (78, 'A', 'stripe_connect_accounts', 'user_id', NULL),
        (79, 'A', 'user_capabilities', 'user_id', NULL),
        (80, 'A', 'user_intake_settings', 'user_id', NULL),
        (81, 'A', 'crm_activities', 'user_id', NULL),
        (82, 'B', 'billing_events', 'user_id', NULL),
        (83, 'B', 'boost_pack_purchases', 'user_id', NULL),
        (84, 'B', 'user_rewards', 'user_id', NULL),
        (85, 'B', 'credit_transactions', 'user_id', NULL),
        (86, 'B', 'token_usage', 'user_id', NULL),
        (87, 'B', 'storage_usage', 'user_id', NULL),
        (88, 'B', 'user_subscriptions', 'user_id', NULL),
        (89, 'B', 'subscriptions', 'user_id', NULL),
        (90, 'B', 'subscription_invoices', 'user_id', NULL),
        (91, 'B', 'business_os_boost_purchases', 'user_id', NULL),
        (92, 'B', 'business_os_credit_lot_draws', 'user_id', NULL),
        (93, 'B', 'business_os_credit_lots', 'user_id', NULL),
        (94, 'B', 'business_os_credit_charges', 'user_id', NULL),
        (95, 'B', 'business_os_credit_totals', 'user_id', NULL),
        (96, 'B', 'business_os_billing_events', 'user_id', NULL),
        (97, 'B', 'business_os_billing_accounts', 'user_id', NULL),
        (98, 'B', 'business_os_boost_cap_overrides', 'user_id', NULL),
        (99, 'B', 'business_os_account_plans', 'user_id', NULL),
        (100, 'B', 'business_os_entitlement_overrides', 'user_id', NULL),
        (101, 'B', 'business_os_entitlement_shadow_events', 'user_id', NULL),
        (102, 'B', 'processed_webhook_events', 'user_id', NULL),
        (103, 'B', 'marketing_consent_state', 'user_id', NULL),
        (104, 'B', 'email_unsubscribes', 'user_id', NULL),
        (105, 'B', 'user_preferences', 'user_id', NULL),
        (106, 'B', 'notification_settings', 'user_id', NULL),
        (107, 'B', 'security_settings', 'user_id', NULL),
        (108, 'B', 'api_keys', 'user_id', NULL),
        (109, 'B', 'audit_logs', 'user_id', NULL),
        (110, 'B', 'auth_handoff_codes', 'user_id', NULL),
        (111, 'B', 'agent_configurations', 'user_id', NULL),
        (112, 'B', 'agent_execution_logs', 'user_id', NULL),
        (113, 'B', 'agent_intensity_metrics', 'user_id', NULL),
        (114, 'B', 'agent_stats', 'user_id', NULL),
        (115, 'B', 'agent_templates', 'user_id', NULL),
        (116, 'B', 'agentkit_analytics', 'user_id', NULL),
        (117, 'B', 'calibration_history', 'user_id', NULL),
        (118, 'B', 'calibration_sessions', 'user_id', NULL),
        (119, 'B', 'error_patterns', 'user_id', NULL),
        (120, 'B', 'execution_anomalies', 'user_id', NULL),
        (121, 'B', 'execution_baselines', 'user_id', NULL),
        (122, 'B', 'execution_insight_runs', 'user_id', NULL),
        (123, 'B', 'execution_insights', 'user_id', NULL),
        (124, 'B', 'pilot_step_routing_history', 'user_id', NULL),
        (125, 'B', 'plugin_performance', 'user_id', NULL),
        (126, 'B', 'shadow_failure_snapshots', 'user_id', NULL),
        (127, 'B', 'shared_agents', 'user_id', NULL),
        (128, 'B', 'workflow_executions', 'user_id', NULL),
        (129, 'B', 'advisor_reports', 'user_id', NULL),
        (130, 'B', 'automation_slas', 'user_id', NULL),
        (131, 'B', 'group_metrics_rollup', 'user_id', NULL),
        (132, 'B', 'metric_baselines', 'user_id', NULL),
        (133, 'B', 'organization_members', 'user_id', NULL),
        (134, 'C', 'business_profiles', 'user_id', NULL),
        (135, 'C', 'profiles', 'id', NULL),
        (136, 'C', 'organizations', 'owner_user_id', NULL),
        (137, 'C', 'business_os_account_lineage', 'account_id', NULL),
        (138, 'C', 'business_os_invites', 'issuer_account_id', NULL)
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
    'BUSINESS_TEST_ACCOUNT_REMOVED', 'user', v_user_id::text, NULL, NULL, NULLIF(current_setting('cleanup.actor_id', true), '')::uuid,
    jsonb_build_object('source', coalesce(NULLIF(current_setting('cleanup.source', true), ''), 'operator_sql'), 'script', 'scripts/test-account-cleanup-delete.sql', 'tables', v_tables, 'rows', v_total, 'counts', v_counts),
    'warning', ARRAY['SOC2']::text[], now()
  );

  RAISE NOTICE 'CLEAN. Removed % rows from % tables and the login %', v_total, v_tables, v_user_id;
END
$cleanup$;

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
SELECT report.line, report.rows_removed, report.result, report.tables_removed, report.removed_login, report.removed_at, report.same_run
FROM (
  SELECT 0 AS sort_order, per_table.table_name AS line, per_table.rows_removed,
    NULL::text AS result, NULL::bigint AS tables_removed, NULL::text AS removed_login, NULL::timestamptz AS removed_at, NULL::boolean AS same_run
  FROM per_table
  UNION ALL
  SELECT 1, 'TOTAL', summary.rows_removed, summary.result, summary.tables_removed, summary.removed_login, summary.removed_at, summary.same_run
  FROM summary
) AS report
ORDER BY report.sort_order, report.line;
