-- Migration: Update Pilot Credits FAQs to remove business model exposure
-- Removes "1 credit = 10 tokens" explanations from user-facing FAQ entries
-- Also updates rollover statement (credits now expire, don't roll over)

-- Update Dashboard FAQ entry (Pilot Credits)
UPDATE help_articles
SET body = '**Pilot Credits** are your usage currency. The circular gauge shows: **Left** = available credits, **Right** = used credits, **Percentage** = usage. Click the gauge or visit [Billing](/v2/billing) to manage your credits.'
WHERE topic = 'Pilot Credits'
  AND page_context = '/v2/dashboard';

-- Update Billing FAQ entry (Credit system)
UPDATE help_articles
SET body = '**Pilot Credits** are our platform currency for running agents and using AI features. Credits are allocated based on your subscription plan and expire monthly. Manage them on the [Billing](/v2/billing) page.'
WHERE topic = 'Credit system'
  AND page_context = '/v2/billing';
