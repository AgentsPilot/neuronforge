-- Fix the specific execution that's currently being displayed
-- Execution ID: 494784cd-e467-460b-a1fc-735a991f540a
-- Created: 2026-06-01 21:29:55
--
-- PROBLEM: Stored time_saved_seconds = 25200 (210 items × 120 sec/item)
-- FIX: Should be time_saved_seconds = 300 (5 minutes total for bulk workflow)

BEGIN;

-- Show current value
SELECT
  execution_id,
  total_items,
  time_saved_seconds as current_seconds,
  time_saved_seconds / 3600.0 * 100 as current_usd,
  300 as new_seconds,
  300.0 / 3600.0 * 100 as new_usd
FROM execution_metrics
WHERE execution_id = '494784cd-e467-460b-a1fc-735a991f540a';

-- Update to bulk workflow calculation
UPDATE execution_metrics
SET
  time_saved_seconds = 300,  -- 5 minutes total (bulk workflow)
  manual_time_per_item_seconds = NULL  -- Clear per-item rate (not applicable for bulk)
WHERE execution_id = '494784cd-e467-460b-a1fc-735a991f540a';

-- Show new value
SELECT
  execution_id,
  total_items,
  time_saved_seconds as new_seconds,
  time_saved_seconds / 3600.0 * 100 as new_usd
FROM execution_metrics
WHERE execution_id = '494784cd-e467-460b-a1fc-735a991f540a';

COMMIT;

-- NEXT STEPS:
-- 1. Run this script to fix the stored metrics
-- 2. Refresh the browser (or hard refresh with Cmd+Shift+R)
-- 3. "Value Saved This Run" should now show $8.33 instead of $700.00
--
-- IMPORTANT: Future executions of this agent will automatically calculate correctly
-- because MetricsCollector.ts now checks agent_config.roi_estimate.is_bulk_workflow
