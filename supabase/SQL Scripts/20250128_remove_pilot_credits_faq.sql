-- Update Pilot Credits FAQ - Remove Conversion Rate
-- Date: 2025-01-28
-- Description: Remove the LLM token to Pilot Credits conversion rate from FAQ (shouldn't be shown to users)

UPDATE help_articles
SET body = '**Pilot Credits** show the cost of the debug execution in real-time. The counter updates as steps complete. Debug executions consume credits just like normal runs, so be mindful when testing large workflows.'
WHERE topic = 'Pilot credits usage'
AND page_context = '/v2/sandbox/[agentId]';

-- Verify update
SELECT topic, body
FROM help_articles
WHERE topic = 'Pilot credits usage'
AND page_context = '/v2/sandbox/[agentId]';
