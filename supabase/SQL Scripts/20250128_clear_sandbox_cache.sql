-- Clear Cache for Sandbox Page
-- Date: 2025-01-28
-- Description: Clears cached help responses for sandbox page to allow FAQs to take precedence

-- Show current cache entries for sandbox page
SELECT
  id,
  LEFT(question, 50) as question_preview,
  source,
  hit_count,
  created_at
FROM support_cache
WHERE page_context LIKE '/v2/sandbox/%'
ORDER BY created_at DESC;

-- Delete all cached entries for sandbox page
-- This allows FAQs to be served for all questions instead of stale AI answers
DELETE FROM support_cache
WHERE page_context LIKE '/v2/sandbox/%';

-- Verify deletion
SELECT COUNT(*) as remaining_sandbox_cache_entries
FROM support_cache
WHERE page_context LIKE '/v2/sandbox/%';
