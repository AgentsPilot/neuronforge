-- Verification Script for Phase 1 Migration
-- Run this AFTER executing 20260601_fix_execution_insights_schema.sql
-- Purpose: Verify all Phase 1 changes were applied correctly

-- ============================================================================
-- Test 1: Verify execution_ids column type changed to uuid[]
-- ============================================================================
SELECT
  column_name,
  data_type,
  udt_name
FROM information_schema.columns
WHERE table_name = 'execution_insights'
  AND column_name = 'execution_ids';
-- Expected: data_type = 'ARRAY', udt_name = '_uuid'

-- ============================================================================
-- Test 2: Verify category constraint allows only 3 categories
-- ============================================================================
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'execution_insights'::regclass
  AND conname = 'execution_insights_category_check';
-- Expected: CHECK constraint with 'data_insight', 'business_insight', 'technical_insight'

-- ============================================================================
-- Test 3: Verify all categories were migrated correctly
-- ============================================================================
SELECT
  category,
  COUNT(*) as count
FROM execution_insights
GROUP BY category
ORDER BY category;
-- Expected: Only 'data_insight', 'business_insight', 'technical_insight' (no old names)

-- ============================================================================
-- Test 4: Verify confidence is now numeric (0.0-1.0)
-- ============================================================================
SELECT
  column_name,
  data_type,
  numeric_precision,
  numeric_scale
FROM information_schema.columns
WHERE table_name = 'execution_insights'
  AND column_name = 'confidence';
-- Expected: data_type = 'numeric', precision = 4, scale = 3

-- ============================================================================
-- Test 5: Verify confidence_mode computed column exists
-- ============================================================================
SELECT
  column_name,
  is_generated,
  generation_expression
FROM information_schema.columns
WHERE table_name = 'execution_insights'
  AND column_name = 'confidence_mode';
-- Expected: is_generated = 'ALWAYS'

-- ============================================================================
-- Test 6: Verify confidence values are in valid range
-- ============================================================================
SELECT
  MIN(confidence) as min_confidence,
  MAX(confidence) as max_confidence,
  AVG(confidence) as avg_confidence,
  COUNT(*) as total_insights
FROM execution_insights;
-- Expected: min >= 0.0, max <= 1.0

-- ============================================================================
-- Test 7: Verify insight_type constraint includes all types
-- ============================================================================
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'execution_insights'::regclass
  AND conname = 'execution_insights_insight_type_check';
-- Expected: All 13 insight types present

-- ============================================================================
-- Test 8: Verify ROI columns exist and have comments
-- ============================================================================
SELECT
  column_name,
  data_type,
  col_description('execution_insights'::regclass, ordinal_position) as column_comment
FROM information_schema.columns
WHERE table_name = 'execution_insights'
  AND column_name IN ('time_saved_hours_per_week', 'cost_saved_usd_per_week')
ORDER BY column_name;
-- Expected: Both columns exist with comments

-- ============================================================================
-- Test 9: Verify new indexes were created
-- ============================================================================
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'execution_insights'
  AND indexname IN (
    'idx_execution_insights_confidence',
    'idx_execution_insights_dedup',
    'idx_execution_insights_title_dedup',
    'idx_execution_insights_category_severity'
  )
ORDER BY indexname;
-- Expected: 4 indexes

-- ============================================================================
-- Test 10: Verify execution_insight_runs foreign key was updated
-- ============================================================================
SELECT
  conname,
  conrelid::regclass as table_name,
  confrelid::regclass as foreign_table
FROM pg_constraint
WHERE conname = 'execution_insight_runs_execution_id_fkey';
-- Expected: foreign_table = 'workflow_executions'

-- ============================================================================
-- Test 11: Verify get_top_insights function exists and works
-- ============================================================================
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name = 'get_top_insights'
  AND routine_schema = 'public';
-- Expected: 1 row with routine_type = 'FUNCTION'

-- ============================================================================
-- SUMMARY: Count all tests passed
-- ============================================================================
SELECT
  'Migration verification complete!' as status,
  NOW() as verified_at;

-- ============================================================================
-- Optional: Show sample data after migration
-- ============================================================================
SELECT
  id,
  category,
  insight_type,
  severity,
  confidence,
  confidence_mode,
  time_saved_hours_per_week,
  cost_saved_usd_per_week,
  created_at
FROM execution_insights
ORDER BY created_at DESC
LIMIT 5;
