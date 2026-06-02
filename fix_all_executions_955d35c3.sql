-- Fix ALL execution_metrics for agent 955d35c3-32a3-4fb5-a922-1fb798f4a349
-- This agent is a BULK workflow (5 minutes total, not per-item)
--
-- PROBLEM: All historical executions have incorrect time_saved_seconds
-- calculated using old per-item logic (items × 120 seconds)
--
-- SOLUTION: Update all rows to use 300 seconds (5 minutes total)

BEGIN;

-- 1. Show current state - how much is currently recorded
SELECT
  COUNT(*) as total_executions,
  SUM(em.time_saved_seconds) as current_total_seconds,
  ROUND(SUM(em.time_saved_seconds) / 3600.0) as current_total_hours,
  ROUND(SUM(em.time_saved_seconds) / 3600.0 * 100) as current_total_usd_at_100hr,
  COUNT(*) * 300 as new_total_seconds,
  ROUND(COUNT(*) * 300 / 3600.0) as new_total_hours,
  ROUND(COUNT(*) * 300 / 3600.0 * 100) as new_total_usd_at_100hr
FROM execution_metrics em
WHERE em.agent_id = '955d35c3-32a3-4fb5-a922-1fb798f4a349';

-- 2. Show breakdown by execution (most recent 10)
SELECT
  ae.created_at,
  em.execution_id,
  em.total_items,
  em.time_saved_seconds as current_seconds,
  ROUND((em.time_saved_seconds / 3600.0 * 100)::numeric, 2) as current_usd,
  300 as new_seconds,
  ROUND((300 / 3600.0 * 100)::numeric, 2) as new_usd,
  ROUND((em.time_saved_seconds / 3600.0 * 100)::numeric, 2) -
    ROUND((300 / 3600.0 * 100)::numeric, 2) as reduction_usd
FROM execution_metrics em
JOIN agent_executions ae ON ae.id = em.execution_id
WHERE em.agent_id = '955d35c3-32a3-4fb5-a922-1fb798f4a349'
ORDER BY ae.created_at DESC
LIMIT 10;

-- 3. Update ALL execution_metrics for this agent
UPDATE execution_metrics
SET
  time_saved_seconds = 300,  -- 5 minutes total for bulk workflow
  manual_time_per_item_seconds = NULL  -- Clear per-item rate (not applicable)
WHERE agent_id = '955d35c3-32a3-4fb5-a922-1fb798f4a349';

-- 4. Show updated totals
SELECT
  COUNT(*) as total_executions_updated,
  SUM(em.time_saved_seconds) as new_total_seconds,
  ROUND(SUM(em.time_saved_seconds) / 3600.0, 1) as new_total_hours,
  ROUND(SUM(em.time_saved_seconds) / 3600.0 * 100) as new_total_usd_at_100hr
FROM execution_metrics em
WHERE em.agent_id = '955d35c3-32a3-4fb5-a922-1fb798f4a349';

-- 5. Verify specific execution (the one currently displayed)
SELECT
  em.execution_id,
  ae.created_at,
  em.time_saved_seconds,
  ROUND((em.time_saved_seconds / 3600.0 * 100)::numeric, 2) as value_usd
FROM execution_metrics em
JOIN agent_executions ae ON ae.id = em.execution_id
WHERE em.execution_id = '494784cd-e467-460b-a1fc-735a991f540a';

COMMIT;

-- EXPECTED RESULTS (if there are 77 executions):
-- Old total: varies based on item counts (currently showing $17.0K in dashboard)
-- New total: 77 executions × 300 seconds = 23,100 seconds = 6.4 hours = $641.67 at $100/hr
--
-- VERIFICATION STEPS:
-- 1. Run this script
-- 2. Refresh dashboard (Cmd+Shift+R)
-- 3. "Total Saved" should change from $17.0K to ~$641
-- 4. Agent detail page "Value Saved This Run" should show $8.33
-- 5. Performance Trends should reflect new calculations
