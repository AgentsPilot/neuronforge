-- Migration: Add FAQs for Analytics Dashboard Page
-- Date: 2026-05-31
-- Description: Adds help articles for the business analytics dashboard

-- Analytics Dashboard FAQs (/v2/analytics)
INSERT INTO help_articles (topic, keywords, body, url, page_context) VALUES
('Navigate to analytics', ARRAY['analytics', 'dashboard', 'find', 'where', 'locate', 'access', 'navigate'], 'Access the **Analytics Dashboard** by clicking the **System Status** card on your main dashboard, or navigate to [Analytics](/v2/analytics) directly. The analytics page provides comprehensive business insights and ROI tracking.', '/v2/analytics', '/v2/dashboard'),

('Understand ROI savings', ARRAY['roi', 'savings', 'money saved', 'value', 'cost savings', 'automation savings', 'business value'], 'The **Savings from Automation** metric shows total labor cost saved based on manual time estimates and your hourly rate. If an agent processes 100 items that would take 5 minutes each manually, that saves 8.3 hours. At $50/hour, that equals $415 saved. Configure your hourly rate in [Settings](/v2/settings).', '/v2/settings', '/v2/analytics'),

('View execution volume', ARRAY['runs', 'operations', 'executions', 'volume', 'total runs', 'how many', 'activity'], 'The **Total Operations** card displays the number of automated tasks run in the selected period. Click the time filter (7d, 30d, 90d, All time) to adjust the view. The growth percentage compares to the previous equal-length period.', NULL, '/v2/analytics'),

('Check reliability score', ARRAY['success rate', 'reliability', 'failures', 'errors', 'failed', 'success', 'quality'], 'The **Reliability Score** shows what percentage of operations completed without errors. Green (≥95%) = Excellent, Yellow (90-94%) = Good, Red (<90%) = Needs attention. Click failed operations count to see which agents need help.', NULL, '/v2/analytics'),

('Understand platform cost', ARRAY['cost', 'efficiency', 'price', 'spend', 'platform cost', 'cost per execution', 'tokens'], '**Automation Efficiency** displays the average platform cost per execution (LLM tokens and API calls). Lower is better. This helps you understand operational costs and optimize expensive agents. Typical costs range from $0.001 to $0.10 per run depending on complexity.', NULL, '/v2/analytics'),

('Change time period', ARRAY['time', 'date', 'range', 'filter', 'period', '7 days', '30 days', '90 days', 'all time'], 'Use the **time range selector** (dropdown with calendar icon) to view analytics for different periods: Last 7 days, Last 30 days, Last 90 days, or All time. All metrics and charts update automatically when you change the period.', NULL, '/v2/analytics'),

('Enable advanced mode', ARRAY['advanced', 'toggle', 'drill down', 'agent breakdown', 'detailed', 'per agent', 'advanced metrics'], 'Toggle **Show Advanced Metrics** to see per-agent performance breakdown. This reveals which automations generate the most value, have the highest success rates, and when they last ran. Click any agent card to view full details.', NULL, '/v2/analytics'),

('Read volume trends chart', ARRAY['chart', 'graph', 'volume', 'trends', 'execution volume', 'performance chart', 'visualize'], 'The **Execution Volume & Performance** chart shows two metrics over time: Total operations (blue line, left axis) and Success rate (green area, right axis). Hover over any point to see detailed data for that day. Use this to spot growth trends and reliability patterns.', NULL, '/v2/analytics'),

('Understand cost breakdown', ARRAY['cost trends', 'investment', 'spending', 'cost chart', 'stacked area', 'breakdown'], 'The **Investment in Automation** chart breaks down platform costs into three categories: Agent Setup (blue, one-time creation costs), Operations (purple, execution costs), and Integrations (amber, plugin API costs). The stacked view shows total spend over time.', NULL, '/v2/analytics'),

('Refresh analytics data', ARRAY['refresh', 'update', 'reload', 'latest', 'current data', 'real time'], 'Click the **Refresh** button (circular arrow icon) to update all analytics with the latest data. Analytics auto-refresh every 5 minutes. The timestamp shows when data was last updated (e.g., "Updated 2m ago").', NULL, '/v2/analytics'),

('View agent performance', ARRAY['agent', 'breakdown', 'per agent', 'individual', 'agent stats', 'which agent', 'compare agents'], 'Enable Advanced Mode to see the **Agent Performance Breakdown** grid. Each card shows: Operations count, Reliability percentage, Value Generated (ROI), Status badge, and Last run time. Click any card to navigate to that agent detail page.', NULL, '/v2/analytics'),

('No data showing', ARRAY['empty', 'no data', 'blank', 'nothing showing', 'no analytics', 'missing data'], 'If analytics show "No data available", ensure: (1) You have run at least one agent, (2) Selected time period includes your runs (try "All time"), (3) Runs were production runs (not calibration/test runs). New accounts show zero until first production execution.', NULL, '/v2/analytics'),

('Improve success rate', ARRAY['improve', 'fix failures', 'increase reliability', 'better success', 'reduce errors', 'troubleshoot'], 'To improve reliability: (1) Review failed executions on agent detail pages, (2) Check plugin connections are active, (3) Validate input data quality, (4) Review error messages in execution logs, (5) Test in Sandbox before production. Target ≥95% for production agents.', NULL, '/v2/analytics'),

('Calculate time saved', ARRAY['time saved', 'hours automated', 'how calculated', 'manual time', 'hours reclaimed'], 'Time saved = (Items processed × Manual time per item). Example: Agent processes 50 emails at 3 minutes each = 150 minutes (2.5 hours) saved. Set **manual time per item** in agent settings for accurate ROI tracking. Default estimates are used if not configured.', NULL, '/v2/analytics'),

('Set hourly rate', ARRAY['hourly rate', 'salary', 'cost', 'wage', 'configure rate', 'roi calculation'], 'Your **hourly rate** determines money saved calculations (Hours saved × Hourly rate = $ saved). Update it in Settings → Profile to reflect your team''s labor cost. Common rates: $25-50/hr for operations, $75-150/hr for specialists, $200+/hr for executives.', '/v2/settings', '/v2/analytics'),

('Compare time periods', ARRAY['compare', 'vs previous', 'growth', 'trend', 'change', 'improvement', 'month over month'], 'Green trend arrows (↑ +12.5%) mean improvement vs previous period. Red arrows (↓ -8.2%) mean decline. Comparison periods match your selected range: 7d compares to previous 7 days, 30d to previous 30 days, etc. Zero runs in previous period shows 0% change.', NULL, '/v2/analytics'),

('Export analytics data', ARRAY['export', 'download', 'csv', 'report', 'save data'], 'Currently, analytics cannot be exported directly. To capture data: (1) Take screenshots of charts, (2) Copy metrics manually, or (3) Use the API endpoint `/api/v2/analytics/system-overview` programmatically. Data export feature is planned for a future release.', NULL, '/v2/analytics');
