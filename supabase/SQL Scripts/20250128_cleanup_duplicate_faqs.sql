-- Cleanup Script: Remove Duplicate FAQ Entries
-- Date: 2025-01-28
-- Description: Removes duplicate help articles created by running migration twice

-- First, let's see what we have (for verification)
-- Run this query first to see duplicates:
-- SELECT topic, page_context, COUNT(*) as count
-- FROM help_articles
-- WHERE page_context IN ('/v2/agents/[id]/run', '/v2/sandbox/[agentId]')
-- GROUP BY topic, page_context
-- HAVING COUNT(*) > 1;

-- Delete duplicates, keeping only the one with the lowest ID (first inserted)
DELETE FROM help_articles
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY topic, page_context
        ORDER BY id ASC
      ) as row_num
    FROM help_articles
    WHERE page_context IN ('/v2/agents/[id]/run', '/v2/sandbox/[agentId]')
  ) t
  WHERE row_num > 1
);

-- Verify the cleanup (should show 0 duplicates)
SELECT topic, page_context, COUNT(*) as count
FROM help_articles
WHERE page_context IN ('/v2/agents/[id]/run', '/v2/sandbox/[agentId]')
GROUP BY topic, page_context
HAVING COUNT(*) > 1;

-- Show final count (should be 21 total: 9 run agent + 12 sandbox)
SELECT page_context, COUNT(*) as count
FROM help_articles
WHERE page_context IN ('/v2/agents/[id]/run', '/v2/sandbox/[agentId]')
GROUP BY page_context
ORDER BY page_context;
