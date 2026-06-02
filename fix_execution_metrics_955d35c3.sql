-- Fix execution_metrics for agent 955d35c3-32a3-4fb5-a922-1fb798f4a349
-- This agent is a BULK workflow (5 minutes total, not per-item)
-- Update all existing execution_metrics rows to use correct time_saved_seconds

BEGIN;

-- Show current state
SELECT
  em.execution_id,
  ae.created_at,
  em.total_items,
  em.time_saved_seconds as current_time_saved,
  em.time_saved_seconds / 3600.0 * 100 as current_value_usd,
  300 as new_time_saved,
  300.0 / 3600.0 * 100 as new_value_usd
FROM execution_metrics em
JOIN agent_executions ae ON ae.id = em.execution_id
WHERE em.agent_id = '955d35c3-32a3-4fb5-a922-1fb798f4a349'
ORDER BY ae.created_at DESC;

-- Update all execution_metrics for this agent
UPDATE execution_metrics
SET
  time_saved_seconds = 300,  -- 5 minutes total for bulk workflow
  manual_time_per_item_seconds = NULL,  -- Not per-item, it's bulk
  updated_at = NOW()
WHERE agent_id = '955d35c3-32a3-4fb5-a922-1fb798f4a349';

-- Show updated state
SELECT
  em.execution_id,
  ae.created_at,
  em.total_items,
  em.time_saved_seconds as new_time_saved,
  em.time_saved_seconds / 3600.0 * 100 as new_value_usd
FROM execution_metrics em
JOIN agent_executions ae ON ae.id = em.execution_id
WHERE em.agent_id = '955d35c3-32a3-4fb5-a922-1fb798f4a349'
ORDER BY ae.created_at DESC;

COMMIT;

-- VERIFICATION:
-- After running this script:
-- 1. Refresh the agent detail page in the browser
-- 2. "Value Saved This Run" should now show ~$8.33 instead of $700.00
-- 3. If it still shows $700, clear browser cache or do a hard refresh (Cmd+Shift+R)
