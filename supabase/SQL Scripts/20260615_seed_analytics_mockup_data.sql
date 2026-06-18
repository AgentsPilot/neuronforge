-- ============================================================================
-- Mock Data Seed for Analytics Hub (Production Schema Compatible)
-- ============================================================================
-- This script creates sample data for testing the Groups, SLAs, and Advisor tabs.
-- It matches the exact production table schemas used by the application.
--
-- User ID is set in v_user_id variable below.
-- Schema validated against production tables (2026-06-15).
--
-- Tables seeded:
-- 1. organizations / organization_members
-- 2. agents (with org_id, tags, plugins_required, manual_time_per_item_seconds)
-- 3. workflow_groups / agent_group_memberships
-- 4. agent_executions (with execution_type, run_mode, logs, result)
-- 5. automation_slas
-- 6. execution_insights (for AI Advisor)
--
-- NOTE: execution_metrics not seeded (FK to workflow_executions, not agent_executions)
--
-- Run this script in Supabase SQL Editor after setting up the required tables.
-- ============================================================================

-- Set your user ID here (replace with your actual user UUID)
DO $$
DECLARE
  v_user_id UUID := '08456106-aa50-4810-b12c-7ca84102da31';  -- offir.omer@gmail.com
  v_org_id UUID;
  v_group_marketing UUID;
  v_group_sales UUID;
  v_group_reporting UUID;
  v_group_data UUID;
  v_agent_1 UUID;
  v_agent_2 UUID;
  v_agent_3 UUID;
  v_agent_4 UUID;
  v_agent_5 UUID;
  v_agent_6 UUID;
  v_agent_7 UUID;
  v_agent_8 UUID;
  v_exec_id UUID;
  v_random_agent UUID;
  v_exec_status TEXT;
  v_exec_duration INTEGER;
  v_exec_items INTEGER;
  v_exec_time TIMESTAMPTZ;
  v_manual_time INTEGER;
BEGIN
  -- ============================================================================
  -- 1. Ensure Organization Exists
  -- ============================================================================
  SELECT id INTO v_org_id FROM organizations WHERE owner_user_id = v_user_id LIMIT 1;

  IF v_org_id IS NULL THEN
    INSERT INTO organizations (name, owner_user_id, settings)
    VALUES ('Demo Organization', v_user_id, '{"industry": "Technology", "size": "small"}'::jsonb)
    RETURNING id INTO v_org_id;

    -- Add owner as member
    INSERT INTO organization_members (org_id, user_id, role)
    VALUES (v_org_id, v_user_id, 'owner')
    ON CONFLICT (org_id, user_id) DO NOTHING;
  END IF;

  RAISE NOTICE 'Using organization: %', v_org_id;

  -- ============================================================================
  -- 2. Create Sample Agents (Workflows)
  -- Matches production schema with all required fields
  -- ============================================================================

  -- Agent 1: Email Newsletter Sender
  INSERT INTO agents (
    id, user_id, org_id, agent_name, description, status,
    plugins_required, manual_time_per_item_seconds, insights_enabled,
    tags, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_user_id, v_org_id,
    'Email Newsletter Sender',
    'Sends weekly newsletter to all subscribers using email templates',
    'active',
    '["gmail", "google-sheets"]'::jsonb,
    300, -- 5 minutes manual time per newsletter
    true,
    ARRAY['marketing', 'email', 'weekly'],
    NOW() - INTERVAL '45 days',
    NOW() - INTERVAL '1 hour'
  ) RETURNING id INTO v_agent_1;

  -- Agent 2: Lead Scoring Bot
  INSERT INTO agents (
    id, user_id, org_id, agent_name, description, status,
    plugins_required, manual_time_per_item_seconds, insights_enabled,
    tags, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_user_id, v_org_id,
    'Lead Scoring Bot',
    'Analyzes incoming leads and assigns scores based on engagement',
    'active',
    '["hubspot", "google-sheets"]'::jsonb,
    120, -- 2 minutes per lead manually
    true,
    ARRAY['sales', 'leads', 'scoring'],
    NOW() - INTERVAL '60 days',
    NOW() - INTERVAL '30 minutes'
  ) RETURNING id INTO v_agent_2;

  -- Agent 3: Weekly Report Generator
  INSERT INTO agents (
    id, user_id, org_id, agent_name, description, status,
    plugins_required, manual_time_per_item_seconds, insights_enabled,
    tags, schedule_cron, timezone, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_user_id, v_org_id,
    'Weekly Report Generator',
    'Generates weekly performance reports and sends to stakeholders',
    'active',
    '["google-sheets", "gmail", "notion"]'::jsonb,
    600, -- 10 minutes per report manually
    true,
    ARRAY['reporting', 'analytics', 'weekly'],
    '0 9 * * 1', -- Every Monday at 9 AM
    'America/New_York',
    NOW() - INTERVAL '30 days',
    NOW() - INTERVAL '24 hours'
  ) RETURNING id INTO v_agent_3;

  -- Agent 4: CRM Data Sync
  INSERT INTO agents (
    id, user_id, org_id, agent_name, description, status,
    plugins_required, manual_time_per_item_seconds, insights_enabled,
    tags, schedule_cron, timezone, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_user_id, v_org_id,
    'CRM Data Sync',
    'Synchronizes customer data between CRM and marketing tools',
    'active',
    '["hubspot", "salesforce", "google-sheets"]'::jsonb,
    180, -- 3 minutes per sync manually
    true,
    ARRAY['data', 'sync', 'crm', 'integration'],
    '0 */4 * * *', -- Every 4 hours
    'UTC',
    NOW() - INTERVAL '90 days',
    NOW() - INTERVAL '15 minutes'
  ) RETURNING id INTO v_agent_4;

  -- Agent 5: Social Media Scheduler
  INSERT INTO agents (
    id, user_id, org_id, agent_name, description, status,
    plugins_required, manual_time_per_item_seconds, insights_enabled,
    tags, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_user_id, v_org_id,
    'Social Media Scheduler',
    'Schedules and posts content across social media platforms',
    'active',
    '["notion", "slack"]'::jsonb,
    240, -- 4 minutes per post manually
    true,
    ARRAY['marketing', 'social', 'content'],
    NOW() - INTERVAL '20 days',
    NOW() - INTERVAL '2 hours'
  ) RETURNING id INTO v_agent_5;

  -- Agent 6: Invoice Processor
  INSERT INTO agents (
    id, user_id, org_id, agent_name, description, status,
    plugins_required, manual_time_per_item_seconds, insights_enabled,
    tags, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_user_id, v_org_id,
    'Invoice Processor',
    'Processes incoming invoices and updates accounting records',
    'active',
    '["gmail", "google-sheets"]'::jsonb,
    420, -- 7 minutes per invoice manually
    true,
    ARRAY['finance', 'invoicing', 'accounting'],
    NOW() - INTERVAL '75 days',
    NOW() - INTERVAL '3 hours'
  ) RETURNING id INTO v_agent_6;

  -- Agent 7: Customer Feedback Analyzer
  INSERT INTO agents (
    id, user_id, org_id, agent_name, description, status,
    plugins_required, manual_time_per_item_seconds, insights_enabled,
    tags, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_user_id, v_org_id,
    'Customer Feedback Analyzer',
    'Analyzes customer feedback and categorizes sentiment',
    'active',
    '["typeform", "google-sheets", "slack"]'::jsonb,
    360, -- 6 minutes per feedback analysis manually
    true,
    ARRAY['customer', 'feedback', 'sentiment'],
    NOW() - INTERVAL '15 days',
    NOW() - INTERVAL '4 hours'
  ) RETURNING id INTO v_agent_7;

  -- Agent 8: Backup & Archive (ungrouped)
  INSERT INTO agents (
    id, user_id, org_id, agent_name, description, status,
    plugins_required, manual_time_per_item_seconds, insights_enabled,
    tags, schedule_cron, timezone, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_user_id, v_org_id,
    'Backup & Archive Bot',
    'Creates daily backups of important documents',
    'active',
    '["google-drive", "dropbox"]'::jsonb,
    150, -- 2.5 minutes per backup manually
    true,
    ARRAY['backup', 'archive', 'maintenance'],
    '0 2 * * *', -- Every day at 2 AM
    'UTC',
    NOW() - INTERVAL '10 days',
    NOW() - INTERVAL '6 hours'
  ) RETURNING id INTO v_agent_8;

  RAISE NOTICE 'Created 8 sample agents';

  -- ============================================================================
  -- 3. Create Workflow Groups
  -- ============================================================================

  INSERT INTO workflow_groups (id, org_id, name, description, color, display_order, created_at)
  VALUES (gen_random_uuid(), v_org_id, 'Marketing Automations',
    'Email campaigns, social media scheduling, and lead nurturing workflows',
    '#8b5cf6', 1, NOW() - INTERVAL '40 days')
  RETURNING id INTO v_group_marketing;

  INSERT INTO workflow_groups (id, org_id, name, description, color, display_order, created_at)
  VALUES (gen_random_uuid(), v_org_id, 'Sales Operations',
    'CRM updates, lead scoring, and pipeline management',
    '#3b82f6', 2, NOW() - INTERVAL '35 days')
  RETURNING id INTO v_group_sales;

  INSERT INTO workflow_groups (id, org_id, name, description, color, display_order, created_at)
  VALUES (gen_random_uuid(), v_org_id, 'Client Reporting',
    'Weekly reports, analytics dashboards, and client updates',
    '#22c55e', 3, NOW() - INTERVAL '30 days')
  RETURNING id INTO v_group_reporting;

  INSERT INTO workflow_groups (id, org_id, name, description, color, display_order, created_at)
  VALUES (gen_random_uuid(), v_org_id, 'Data Processing',
    'ETL pipelines, data validation, and sync jobs',
    '#f97316', 4, NOW() - INTERVAL '25 days')
  RETURNING id INTO v_group_data;

  RAISE NOTICE 'Created 4 workflow groups';

  -- ============================================================================
  -- 4. Assign Agents to Groups
  -- ============================================================================

  INSERT INTO agent_group_memberships (agent_id, group_id) VALUES
    (v_agent_1, v_group_marketing),
    (v_agent_5, v_group_marketing),
    (v_agent_2, v_group_sales),
    (v_agent_4, v_group_sales),
    (v_agent_3, v_group_reporting),
    (v_agent_7, v_group_reporting),
    (v_agent_6, v_group_data);

  RAISE NOTICE 'Assigned agents to groups (Agent 8 left ungrouped)';

  -- ============================================================================
  -- 5. Create Sample Executions with Metrics
  -- ============================================================================

  FOR i IN 1..150 LOOP
    -- Select random agent
    v_random_agent := CASE (random() * 7)::int
      WHEN 0 THEN v_agent_1
      WHEN 1 THEN v_agent_2
      WHEN 2 THEN v_agent_3
      WHEN 3 THEN v_agent_4
      WHEN 4 THEN v_agent_5
      WHEN 5 THEN v_agent_6
      WHEN 6 THEN v_agent_7
      ELSE v_agent_8
    END;

    -- Get manual time for this agent
    v_manual_time := CASE
      WHEN v_random_agent = v_agent_1 THEN 300
      WHEN v_random_agent = v_agent_2 THEN 120
      WHEN v_random_agent = v_agent_3 THEN 600
      WHEN v_random_agent = v_agent_4 THEN 180
      WHEN v_random_agent = v_agent_5 THEN 240
      WHEN v_random_agent = v_agent_6 THEN 420
      WHEN v_random_agent = v_agent_7 THEN 360
      ELSE 150
    END;

    v_exec_time := NOW() - (random() * INTERVAL '30 days');
    v_exec_status := CASE WHEN random() > 0.05 THEN 'success' ELSE 'failed' END;
    v_exec_duration := (random() * 290000 + 10000)::int;
    v_exec_items := (random() * 49 + 1)::int;

    -- Insert execution
    INSERT INTO agent_executions (
      id, agent_id, user_id, execution_type, status, run_mode,
      scheduled_at, started_at, completed_at, execution_duration_ms, logs, result, created_at
    ) VALUES (
      gen_random_uuid(), v_random_agent, v_user_id,
      CASE WHEN random() > 0.3 THEN 'scheduled' ELSE 'manual' END,
      v_exec_status, 'production',
      v_exec_time, -- scheduled_at
      v_exec_time, -- started_at
      v_exec_time + (v_exec_duration * INTERVAL '1 millisecond'),
      v_exec_duration,
      jsonb_build_object(
        'tokensUsed', jsonb_build_object('total', (random() * 5000 + 500)::int),
        'stepsCompleted', (random() * 5 + 1)::int,
        'stepsFailed', CASE WHEN v_exec_status = 'failed' THEN 1 ELSE 0 END
      ),
      CASE WHEN v_exec_status = 'success'
        THEN jsonb_build_object('items_processed', v_exec_items)
        ELSE NULL
      END,
      v_exec_time
    ) RETURNING id INTO v_exec_id;

    -- NOTE: execution_metrics table has FK to workflow_executions, not agent_executions.
    -- For real execution metrics, use the actual workflow_executions table or run actual workflows.
    -- The agent_executions data above is sufficient for Groups, SLAs, and Overview tabs.
  END LOOP;

  RAISE NOTICE 'Created 150 executions';

  -- ============================================================================
  -- 6. Create Sample SLAs
  -- ============================================================================

  INSERT INTO automation_slas (id, user_id, org_id, name, description, applies_to_all,
    metric_name, target_value, threshold_type, status, alert_channels, created_at)
  VALUES (gen_random_uuid(), v_user_id, v_org_id, 'High Success Rate',
    'Maintain at least 95% success rate across all workflows',
    true, 'success_rate', 95, 'above', 'active',
    '[{"type": "email", "value": "alerts@company.com"}]'::jsonb, NOW() - INTERVAL '20 days');

  INSERT INTO automation_slas (id, user_id, org_id, name, description, group_id,
    metric_name, target_value, threshold_type, status, alert_channels, created_at)
  VALUES (gen_random_uuid(), v_user_id, v_org_id, 'Fast Marketing Automation',
    'Marketing workflows should complete within 5 minutes',
    v_group_marketing, 'avg_duration_ms', 300000, 'below', 'active',
    '[{"type": "email", "value": "marketing@company.com"}]'::jsonb, NOW() - INTERVAL '15 days');

  INSERT INTO automation_slas (id, user_id, org_id, name, description, group_id,
    metric_name, target_value, threshold_type, status, alert_channels, created_at)
  VALUES (gen_random_uuid(), v_user_id, v_org_id, 'Sales Activity Minimum',
    'At least 10 sales automation runs per day',
    v_group_sales, 'execution_count', 10, 'above', 'active',
    '[{"type": "slack", "value": "#sales-alerts"}]'::jsonb, NOW() - INTERVAL '10 days');

  INSERT INTO automation_slas (id, user_id, org_id, name, description, agent_id,
    metric_name, target_value, threshold_type, status, alert_channels, created_at)
  VALUES (gen_random_uuid(), v_user_id, v_org_id, 'Weekly Report On Time',
    'Weekly report must complete within 15 minutes',
    v_agent_3, 'avg_duration_ms', 900000, 'below', 'active',
    '[{"type": "email", "value": "reports@company.com"}]'::jsonb, NOW() - INTERVAL '5 days');

  INSERT INTO automation_slas (id, user_id, org_id, name, description, group_id,
    metric_name, target_value, threshold_type, status, alert_channels, created_at)
  VALUES (gen_random_uuid(), v_user_id, v_org_id, 'Data Processing Throughput',
    'Process at least 100 items per execution',
    v_group_data, 'items_processed', 100, 'above', 'paused',
    '[]'::jsonb, NOW() - INTERVAL '25 days');

  RAISE NOTICE 'Created 5 SLAs';

  -- ============================================================================
  -- 7. Create Sample Insights
  -- ============================================================================

  INSERT INTO execution_insights (
    id, user_id, agent_id, execution_ids,
    insight_type, category, severity, confidence,
    title, description, business_impact, recommendation,
    pattern_data, metrics, status, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_user_id, v_agent_4, ARRAY[v_exec_id]::uuid[],
    'data_unavailable', 'data_insight', 'high', 0.85,
    'Empty Results Detected',
    'CRM Data Sync returned empty results in 15% of recent executions.',
    'Missing data may cause downstream workflows to fail or produce incomplete reports.',
    'Add validation step to check for data before processing. Consider retry logic.',
    jsonb_build_object('occurrences', 8, 'affected_steps', ARRAY['fetch_contacts', 'sync_data']),
    jsonb_build_object('total_executions', 53, 'affected_executions', 8, 'pattern_frequency', 0.15),
    'new', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'
  );

  INSERT INTO execution_insights (
    id, user_id, agent_id, execution_ids,
    insight_type, category, severity, confidence,
    title, description, business_impact, recommendation,
    pattern_data, metrics, status, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_user_id, v_agent_1, ARRAY[]::uuid[],
    'performance_degradation', 'technical_insight', 'medium', 0.72,
    'Performance Degradation',
    'Email Newsletter Sender duration increased by 40% over the past week.',
    'Slower processing may cause newsletter delays. Scheduled sends may miss windows.',
    'Review email list size and consider batching. Check for API rate limiting.',
    jsonb_build_object('occurrences', 12, 'affected_steps', ARRAY['send_emails']),
    jsonb_build_object('total_executions', 28, 'affected_executions', 12, 'pattern_frequency', 0.43),
    'new', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'
  );

  INSERT INTO execution_insights (
    id, user_id, agent_id, execution_ids,
    insight_type, category, severity, confidence,
    title, description, business_impact, recommendation,
    pattern_data, metrics, cost_saved_usd_per_week,
    status, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_user_id, v_agent_6, ARRAY[]::uuid[],
    'cost_optimization', 'technical_insight', 'low', 0.68,
    'Redundant Processing Detected',
    'Invoice Processor is processing the same invoices multiple times (12%).',
    'Duplicate processing wastes resources and may cause accounting issues.',
    'Implement deduplication logic using invoice IDs.',
    jsonb_build_object('occurrences', 6, 'affected_steps', ARRAY['process_invoice']),
    jsonb_build_object('total_executions', 50, 'affected_executions', 6, 'pattern_frequency', 0.12),
    15.50,
    'new', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days'
  );

  INSERT INTO execution_insights (
    id, user_id, agent_id, execution_ids,
    insight_type, category, severity, confidence,
    title, description, business_impact, recommendation,
    pattern_data, metrics, time_saved_hours_per_week,
    status, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_user_id, v_agent_2, ARRAY[]::uuid[],
    'volume_trend', 'business_insight', 'low', 0.78,
    'Lead Volume Increasing',
    'Lead Scoring Bot processed 35% more leads this week vs last week.',
    'Higher lead volume indicates growing inbound interest. Good for pipeline.',
    'Monitor lead quality alongside quantity. Scale resources if growth continues.',
    jsonb_build_object('occurrences', 28, 'affected_steps', ARRAY['score_lead']),
    jsonb_build_object('total_executions', 45, 'affected_executions', 28, 'pattern_frequency', 0.62),
    12.5,
    'viewed', NOW() - INTERVAL '4 days', NOW() - INTERVAL '1 day'
  );

  RAISE NOTICE 'Created 4 insights';

  -- ============================================================================
  -- Done!
  -- ============================================================================
  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'Mock data seed completed successfully!';
  RAISE NOTICE 'Organization ID: %', v_org_id;
  RAISE NOTICE '';
  RAISE NOTICE 'Created:';
  RAISE NOTICE '  - 8 agents (workflows)';
  RAISE NOTICE '  - 4 workflow groups';
  RAISE NOTICE '  - 150 executions';
  RAISE NOTICE '  - 5 SLAs';
  RAISE NOTICE '  - 4 insights';
  RAISE NOTICE '';
  RAISE NOTICE 'Now visit /v2/analytics to see the data!';
  RAISE NOTICE '============================================';

END $$;

-- ============================================================================
-- Verification Queries (uncomment to run)
-- ============================================================================

-- Check groups with agent counts
SELECT
  wg.name,
  wg.color,
  COUNT(agm.agent_id) as agent_count
FROM workflow_groups wg
LEFT JOIN agent_group_memberships agm ON wg.id = agm.group_id
GROUP BY wg.id, wg.name, wg.color
ORDER BY wg.display_order;

-- Check SLAs
SELECT name, metric_name, target_value, threshold_type, status
FROM automation_slas
ORDER BY created_at DESC;

-- Check agent executions summary
SELECT
  a.agent_name,
  COUNT(ae.id) as total_runs,
  ROUND(AVG(ae.execution_duration_ms)::numeric / 1000, 1) as avg_duration_sec,
  COUNT(CASE WHEN ae.status = 'success' THEN 1 END) as successful,
  COUNT(CASE WHEN ae.status = 'failed' THEN 1 END) as failed
FROM agents a
LEFT JOIN agent_executions ae ON a.id = ae.agent_id
WHERE a.status = 'active'
GROUP BY a.id, a.agent_name
ORDER BY total_runs DESC;

-- Check insights
SELECT
  ei.title,
  ei.category,
  ei.severity,
  ei.confidence,
  ei.status,
  a.agent_name
FROM execution_insights ei
JOIN agents a ON ei.agent_id = a.id
ORDER BY ei.created_at DESC;
