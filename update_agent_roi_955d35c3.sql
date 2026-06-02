-- Update ROI configuration for bug filter agent
-- Agent ID: 955d35c3-32a3-4fb5-a922-1fb798f4a349
--
-- This agent filters GitHub bug reports and emails critical ones
-- It's a BULK workflow (processes all items together, not individually)
-- Estimated manual time: 5 minutes total regardless of item count
--
-- BEFORE: Calculated as 60 items × 7 min/item = $700 (WRONG)
-- AFTER:  Calculated as 5 minutes total = $8.33 (CORRECT)

BEGIN;

-- Show current configuration
SELECT
  id,
  agent_name,
  manual_time_per_item_seconds AS current_manual_time_per_item,
  agent_config->'roi_estimate' AS current_roi_estimate
FROM agents
WHERE id = '955d35c3-32a3-4fb5-a922-1fb798f4a349';

-- Update agent configuration for bulk workflow
UPDATE agents
SET
  -- Set manual_time_per_item_seconds to NULL for bulk workflows
  manual_time_per_item_seconds = NULL,

  -- Store bulk workflow ROI estimate in agent_config
  agent_config = jsonb_set(
    COALESCE(agent_config, '{}'::jsonb),
    '{roi_estimate}',
    jsonb_build_object(
      'total_manual_time_seconds', 300,  -- 5 minutes = 300 seconds
      'is_bulk_workflow', true,
      'reasoning', 'Bulk filtering workflow: Scanning 60+ GitHub bug reports, filtering for critical/high priority, copying relevant ones, and sending a summary email takes approximately 5 minutes total regardless of the number of bugs found. This is a one-pass bulk operation, not per-item processing.'
    )
  ),

  updated_at = NOW()

WHERE id = '955d35c3-32a3-4fb5-a922-1fb798f4a349';

-- Show updated configuration
SELECT
  id,
  agent_name,
  manual_time_per_item_seconds AS new_manual_time_per_item,
  agent_config->'roi_estimate' AS new_roi_estimate,
  updated_at
FROM agents
WHERE id = '955d35c3-32a3-4fb5-a922-1fb798f4a349';

-- Verify the update
DO $$
DECLARE
  v_is_bulk boolean;
  v_total_time integer;
BEGIN
  SELECT
    (agent_config->'roi_estimate'->>'is_bulk_workflow')::boolean,
    (agent_config->'roi_estimate'->>'total_manual_time_seconds')::integer
  INTO v_is_bulk, v_total_time
  FROM agents
  WHERE id = '955d35c3-32a3-4fb5-a922-1fb798f4a349';

  IF v_is_bulk = true AND v_total_time = 300 THEN
    RAISE NOTICE '✅ SUCCESS: Agent configured as bulk workflow with 300 seconds (5 minutes) total time';
    RAISE NOTICE 'Next execution will calculate: $%.2f per run (at $100/hour)', (300.0 / 3600.0 * 100.0);
  ELSE
    RAISE EXCEPTION '❌ FAILED: Configuration not applied correctly. is_bulk=%, total_time=%', v_is_bulk, v_total_time;
  END IF;
END $$;

-- Optional: Show recent execution metrics (if any exist)
-- These will continue to show the old calculation until the agent runs again
SELECT
  em.execution_id,
  ae.created_at AS execution_time,
  em.total_items,
  em.time_saved_seconds AS old_time_saved_seconds,
  em.time_saved_seconds / 3600.0 * 100 AS old_value_saved_usd,
  300 AS new_time_saved_seconds,
  300.0 / 3600.0 * 100 AS new_value_saved_usd
FROM execution_metrics em
JOIN agent_executions ae ON ae.id = em.execution_id
WHERE em.agent_id = '955d35c3-32a3-4fb5-a922-1fb798f4a349'
ORDER BY ae.created_at DESC
LIMIT 5;

COMMIT;

-- NEXT STEPS:
-- 1. Run this script to update the agent configuration
-- 2. Trigger a new execution of the agent
-- 3. The new execution will use the bulk workflow calculation (300 seconds = $8.33 at $100/hour)
-- 4. Verify in the UI that "Value Saved This Run" shows ~$8.33 instead of $700
