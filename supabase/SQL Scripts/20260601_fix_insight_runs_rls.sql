-- Fix RLS policies for execution_insight_runs table
-- Created: 2026-06-01
-- Purpose: Enable proper INSERT and UPDATE operations for insight linking

-- ============================================================================
-- PART 1: Check current RLS status
-- ============================================================================

-- Check if RLS is enabled
SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename = 'execution_insight_runs';

-- Show existing policies
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'execution_insight_runs';

-- ============================================================================
-- PART 2: Add RLS policies for execution_insight_runs
-- ============================================================================

-- Enable RLS if not already enabled
ALTER TABLE execution_insight_runs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to recreate them)
DROP POLICY IF EXISTS "Users can insert their own insight runs" ON execution_insight_runs;
DROP POLICY IF EXISTS "Users can view their own insight runs" ON execution_insight_runs;
DROP POLICY IF EXISTS "Users can update their own insight runs" ON execution_insight_runs;
DROP POLICY IF EXISTS "Users can delete their own insight runs" ON execution_insight_runs;

-- Policy 1: Allow users to INSERT their own insight runs
CREATE POLICY "Users can insert their own insight runs"
  ON execution_insight_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy 2: Allow users to SELECT their own insight runs
CREATE POLICY "Users can view their own insight runs"
  ON execution_insight_runs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy 3: Allow users to UPDATE their own insight runs
-- CRITICAL: This policy enables linkInsightRun() to update insight_id
CREATE POLICY "Users can update their own insight runs"
  ON execution_insight_runs
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy 4: Allow users to DELETE their own insight runs
CREATE POLICY "Users can delete their own insight runs"
  ON execution_insight_runs
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- PART 3: Verify policies were created
-- ============================================================================

SELECT
  policyname,
  cmd,
  CASE
    WHEN cmd = 'INSERT' THEN '✅ Allows createInsightRun()'
    WHEN cmd = 'UPDATE' THEN '✅ Allows linkInsightRun()'
    WHEN cmd = 'SELECT' THEN '✅ Allows queries'
    WHEN cmd = 'DELETE' THEN '✅ Allows cleanup'
  END as purpose
FROM pg_policies
WHERE tablename = 'execution_insight_runs'
ORDER BY cmd;

-- ============================================================================
-- PART 4: Test UPDATE operation (simulates linkInsightRun)
-- ============================================================================

-- Show unlinked runs for current user
SELECT
  id,
  execution_id,
  title,
  insight_id,
  user_id,
  created_at
FROM execution_insight_runs
WHERE user_id = auth.uid()
  AND insight_id IS NULL
ORDER BY created_at DESC
LIMIT 5;

-- ============================================================================
-- PART 5: Manual fix for existing NULL insight_ids
-- ============================================================================

-- This query links existing unlinked runs to their corresponding insights
-- Run this AFTER applying the RLS policies

WITH unlinked_runs AS (
  SELECT
    r.id as run_id,
    r.execution_id,
    r.title,
    r.user_id,
    i.id as matching_insight_id
  FROM execution_insight_runs r
  INNER JOIN execution_insights i
    ON i.agent_id = r.agent_id
    AND i.title = r.title
    AND i.user_id = r.user_id
  WHERE r.insight_id IS NULL
    AND r.user_id = auth.uid() -- Only update for current user
)
UPDATE execution_insight_runs
SET insight_id = unlinked_runs.matching_insight_id
FROM unlinked_runs
WHERE execution_insight_runs.id = unlinked_runs.run_id
RETURNING
  execution_insight_runs.id,
  execution_insight_runs.title,
  execution_insight_runs.insight_id;

-- ============================================================================
-- PART 6: Verify all runs are now linked
-- ============================================================================

SELECT
  COUNT(*) FILTER (WHERE insight_id IS NOT NULL) as linked_count,
  COUNT(*) FILTER (WHERE insight_id IS NULL) as unlinked_count,
  COUNT(*) as total_count
FROM execution_insight_runs
WHERE user_id = auth.uid();

-- Expected: unlinked_count should be 0 after running the manual fix

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON POLICY "Users can update their own insight runs" ON execution_insight_runs IS
  'Allows InsightRepository.linkInsightRun() to update insight_id field after storing run snapshot';
