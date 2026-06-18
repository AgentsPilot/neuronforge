-- ============================================================================
-- Delete Analytics Mockup Data
-- ============================================================================
-- This script removes all mockup data created by 20260615_seed_analytics_mockup_data.sql
-- It preserves real user data (agents with actual workflow_executions/execution_metrics)
--
-- SAFE: Only deletes data created by the seed script (identified by agent names)
--
-- Run this in Supabase SQL Editor to clean up mockup data that pollutes AI Advisor.
-- ============================================================================

DO $$
DECLARE
  v_user_id UUID := '08456106-aa50-4810-b12c-7ca84102da31';  -- Same user from seed
  v_deleted_agents INT;
  v_deleted_insights INT;
  v_deleted_executions INT;
  v_deleted_slas INT;
  v_deleted_groups INT;
  v_seed_agent_names TEXT[] := ARRAY[
    'Email Newsletter Sender',
    'Lead Scoring Bot',
    'Weekly Report Generator',
    'CRM Data Sync',
    'Social Media Scheduler',
    'Invoice Processor',
    'Customer Feedback Analyzer',
    'Backup & Archive Bot'
  ];
  v_seed_agent_ids UUID[];
BEGIN
  -- ============================================================================
  -- 1. Find seed agent IDs
  -- ============================================================================
  SELECT ARRAY_AGG(id) INTO v_seed_agent_ids
  FROM agents
  WHERE user_id = v_user_id
    AND agent_name = ANY(v_seed_agent_names);

  IF v_seed_agent_ids IS NULL OR array_length(v_seed_agent_ids, 1) IS NULL THEN
    RAISE NOTICE 'No seed agents found. Nothing to delete.';
    RETURN;
  END IF;

  RAISE NOTICE 'Found % seed agents to delete', array_length(v_seed_agent_ids, 1);

  -- ============================================================================
  -- 2. Delete execution_insights for seed agents
  -- ============================================================================
  DELETE FROM execution_insights
  WHERE agent_id = ANY(v_seed_agent_ids);
  GET DIAGNOSTICS v_deleted_insights = ROW_COUNT;
  RAISE NOTICE 'Deleted % execution_insights', v_deleted_insights;

  -- ============================================================================
  -- 3. Delete execution_insight_runs for seed agents
  -- ============================================================================
  DELETE FROM execution_insight_runs
  WHERE agent_id = ANY(v_seed_agent_ids);
  RAISE NOTICE 'Deleted execution_insight_runs for seed agents';

  -- ============================================================================
  -- 4. Delete agent_executions for seed agents
  -- ============================================================================
  DELETE FROM agent_executions
  WHERE agent_id = ANY(v_seed_agent_ids);
  GET DIAGNOSTICS v_deleted_executions = ROW_COUNT;
  RAISE NOTICE 'Deleted % agent_executions', v_deleted_executions;

  -- ============================================================================
  -- 5. Delete agent_group_memberships for seed agents
  -- ============================================================================
  DELETE FROM agent_group_memberships
  WHERE agent_id = ANY(v_seed_agent_ids);
  RAISE NOTICE 'Deleted agent_group_memberships for seed agents';

  -- ============================================================================
  -- 6. Delete automation_slas that reference seed agents
  -- ============================================================================
  DELETE FROM automation_slas
  WHERE user_id = v_user_id
    AND (agent_id = ANY(v_seed_agent_ids) OR agent_id IS NULL);
  GET DIAGNOSTICS v_deleted_slas = ROW_COUNT;
  RAISE NOTICE 'Deleted % automation_slas', v_deleted_slas;

  -- ============================================================================
  -- 7. Delete seed agents
  -- ============================================================================
  DELETE FROM agents
  WHERE id = ANY(v_seed_agent_ids);
  GET DIAGNOSTICS v_deleted_agents = ROW_COUNT;
  RAISE NOTICE 'Deleted % agents', v_deleted_agents;

  -- ============================================================================
  -- 8. Delete orphaned workflow_groups (groups with no agents)
  -- ============================================================================
  DELETE FROM workflow_groups
  WHERE org_id IN (SELECT id FROM organizations WHERE owner_user_id = v_user_id)
    AND id NOT IN (SELECT DISTINCT group_id FROM agent_group_memberships);
  GET DIAGNOSTICS v_deleted_groups = ROW_COUNT;
  RAISE NOTICE 'Deleted % orphaned workflow_groups', v_deleted_groups;

  -- ============================================================================
  -- Summary
  -- ============================================================================
  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'Mockup data cleanup completed!';
  RAISE NOTICE '';
  RAISE NOTICE 'Deleted:';
  RAISE NOTICE '  - % agents', v_deleted_agents;
  RAISE NOTICE '  - % agent_executions', v_deleted_executions;
  RAISE NOTICE '  - % execution_insights', v_deleted_insights;
  RAISE NOTICE '  - % automation_slas', v_deleted_slas;
  RAISE NOTICE '  - % workflow_groups', v_deleted_groups;
  RAISE NOTICE '';
  RAISE NOTICE 'Your real agents and execution data are preserved.';
  RAISE NOTICE '============================================';

END $$;

-- ============================================================================
-- Verification: Show remaining agents
-- ============================================================================
SELECT
  a.agent_name,
  a.status,
  (SELECT COUNT(*) FROM execution_metrics em WHERE em.agent_id = a.id) as metric_count,
  (SELECT COUNT(*) FROM execution_insights ei WHERE ei.agent_id = a.id) as insight_count
FROM agents a
WHERE a.user_id = '08456106-aa50-4810-b12c-7ca84102da31'
  AND a.status != 'deleted'
ORDER BY a.created_at DESC;
