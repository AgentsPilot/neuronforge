-- Migration: Seed Help Articles
-- Migrates existing QA_DATABASE content to help_articles table

-- Dashboard FAQs
INSERT INTO help_articles (topic, keywords, body, url, page_context) VALUES
('View all agents', ARRAY['three agents', 'only three', 'top 3', 'top three', 'limited agents', 'show more agents', 'all agents', 'why only', 'see all', 'showing few'], 'The **Active Agents** card shows only the **top 3 most active agents** to save space. Click the card or "+X more" text to view all agents. To see your complete agent list, visit the [Agent List](/v2/agent-list) page.', '/v2/agent-list', '/v2/dashboard'),

('Agent statistics', ARRAY['agent statistics', 'view agents', 'agent count', 'execution count', 'runs', 'executions', 'agent list', 'list agents'], 'The **Active Agents** card shows your running agents with execution counts. Each agent displays its total number of runs. For a detailed view of all agents, go to the [Agent List](/v2/agent-list) page.', '/v2/agent-list', '/v2/dashboard'),

('Pilot Credits', ARRAY['credit metrics', 'credits', 'pilot credits', 'balance', 'tokens', 'how many', 'gauge', 'percentage', 'usage', 'remaining'], '**Pilot Credits** are your usage currency. The circular gauge shows: **Left** = available credits, **Right** = used credits, **Percentage** = usage. 1 credit = 10 tokens by default. Click the gauge or visit [Billing](/v2/billing) to manage your credits.', '/v2/billing', '/v2/dashboard'),

('Create agent', ARRAY['create agent', 'new agent', 'add agent', 'make agent', 'build agent', 'start', 'setup agent', 'configure agent'], E'There are 2 ways to create agents:\n1. Click the **+ button** in the bottom-right footer\n2. Use the **search bar** at the top - describe what you want to automate and press Enter\n\nYou can also go directly to [Create Agent](/v2/agents/new).', '/v2/agents/new', '/v2/dashboard'),

('System alerts', ARRAY['system alerts', 'failures', 'errors', 'problems', 'issues', 'failed', 'alerts card', 'error card'], E'The **System Alerts** card shows agent failures in the last 24 hours:\n- **Green** (0) = All systems operational ✓\n- **Red** (>0) = Issues detected\nClick the card or visit [Analytics](/v2/analytics) to view detailed error logs.', '/v2/analytics', '/v2/dashboard'),

('Recent activity', ARRAY['recent activity', 'activity', 'top agents', 'most active', 'progress bars', 'activity card', 'running agents'], 'The **Recent Activity** card displays your top 3 most active agents with progress bars. Bar length shows relative execution count. This helps identify which agents are running most frequently.', NULL, '/v2/dashboard'),

('Last run time', ARRAY['last run', 'when run', 'execution time', 'last execution', 'recent run', 'last execution time'], 'The **Last Run** time in the footer shows when your most recent agent completed. Times are displayed as relative (e.g., "2h ago", "5m ago", "just now"). Updates automatically after each execution.', NULL, '/v2/dashboard'),

('Dashboard navigation', ARRAY['cards', 'sections', 'navigate', 'overview', 'dashboard layout', 'dashboard structure'], E'The dashboard has 4 main cards:\n1. **Active Agents** - View running agents ([Agent List](/v2/agent-list))\n2. **System Alerts** - Monitor failures ([Analytics](/v2/analytics))\n3. **Recent Activity** - Top 3 agents by execution\n4. **Credit Usage** - Track spending ([Billing](/v2/billing))', NULL, '/v2/dashboard'),

('Footer features', ARRAY['footer', 'bottom', 'buttons', 'menu', 'three dots', '3 dots', 'dots menu'], E'The **footer** at the bottom has several features:\n- **Last Run**: Shows when your most recent agent executed\n- **Connected Plugins**: Displays active integrations with colorful icons\n- **Dark Mode**: Toggle light/dark theme\n- **+ Button**: Create a new agent\n- **3-dot Menu**: Quick access to Agent List, Dashboard, and Create Agent', NULL, '/v2/dashboard'),

('Plugin integrations', ARRAY['plugins', 'integrations', 'connected', 'connections', 'gmail', 'slack', 'github'], 'The footer displays your **connected plugins** as colorful icons (Gmail, Slack, GitHub, etc.). These show which integrations are actively connected. A green dot indicates the plugin is active. Hover over an icon to see the plugin name.', '/v2/settings', '/v2/dashboard');

-- Agent List FAQs
INSERT INTO help_articles (topic, keywords, body, url, page_context) VALUES
('Filter agents', ARRAY['filter', 'filtering', 'status filter', 'tabs', 'show', 'display', 'view by status'], 'Use the tabs at the top to filter by status: **All**, **Active**, **Paused**, or **Stopped**. You can also search by name using the search bar.', NULL, '/v2/agent-list'),

('Agent statuses', ARRAY['status', 'statuses', 'active', 'paused', 'stopped', 'agent status', 'status badge'], '**Active** = running, **Paused** = temporarily stopped, **Stopped** = disabled. Toggle status by clicking the status badge in each agent card.', NULL, '/v2/agent-list'),

('Edit agent', ARRAY['edit', 'modify', 'change agent', 'update agent', 'configure', 'settings'], 'Click any agent card to view details, then use the **Edit** button. You can modify configuration, schedule, and settings.', NULL, '/v2/agent-list'),

('Delete agent', ARRAY['delete', 'remove agent', 'remove', 'delete agent', 'uninstall'], 'Open the agent details page, click the **Actions** menu (three dots), and select **Delete**. This action cannot be undone.', NULL, '/v2/agent-list'),

('Search agents', ARRAY['search', 'find agent', 'locate agent', 'search bar', 'find by name'], 'Use the search bar at the top to find agents by name. Results update as you type.', NULL, '/v2/agent-list'),

('Sort agents', ARRAY['sort', 'sorting', 'order', 'arrange', 'organize'], 'Click the sort dropdown to order agents by: **Newest first**, **Oldest first**, **Name A-Z**, or **Name Z-A**.', NULL, '/v2/agent-list'),

('Agent pagination', ARRAY['pagination', 'pages', 'next page', 'previous page', 'page navigation'], 'Use the pagination controls at the bottom to navigate between pages. Shows 12 agents per page by default.', NULL, '/v2/agent-list');

-- Analytics FAQs
INSERT INTO help_articles (topic, keywords, body, url, page_context) VALUES
('Cost tracking', ARRAY['cost', 'costs', 'spending', 'expensive', 'price', 'money', 'how much', 'cost breakdown'], 'The [Analytics](/v2/analytics) dashboard tracks **token usage** and **costs** by agent. View trends over time and identify high-cost agents. Filter by date range to analyze spending patterns.', '/v2/analytics', '/v2/analytics'),

('Metrics tracked', ARRAY['metrics', 'tracking', 'tracked', 'monitor', 'data', 'statistics', 'stats'], 'We track: **API calls**, **token usage** (input/output), **cost per agent**, **success rate**, and **latency**. All metrics update in real-time on the [Analytics](/v2/analytics) page.', '/v2/analytics', '/v2/analytics'),

('Export analytics', ARRAY['export', 'download', 'csv', 'json', 'save data', 'download data', 'export data'], 'Click the **Export** button (top right) on the [Analytics](/v2/analytics) page to download analytics as CSV or JSON. Choose date range and metrics to export.', '/v2/analytics', '/v2/analytics'),

('Token usage', ARRAY['tokens', 'token usage', 'input', 'output', 'token count', 'usage data'], 'Token usage shows both **input tokens** (prompt) and **output tokens** (response). Total cost = (input tokens × input rate) + (output tokens × output rate). View detailed breakdowns in [Analytics](/v2/analytics).', '/v2/analytics', '/v2/analytics');

-- Billing FAQs
INSERT INTO help_articles (topic, keywords, body, url, page_context) VALUES
('Add credits', ARRAY['add', 'buy', 'purchase credits', 'get more credits', 'top up', 'recharge'], 'Visit [Billing](/v2/billing) and click **Add Credits** to purchase more. Credits are added instantly to your balance. We accept all major payment methods.', '/v2/billing', '/v2/billing'),

('Credit system', ARRAY['pilot credits', 'what are credits', 'credit system', 'how credits work'], '**Pilot Credits** are our token-based currency. 1 credit = 10 tokens (configurable). Credits never expire and roll over. Manage them on the [Billing](/v2/billing) page.', '/v2/billing', '/v2/billing'),

('Usage calculation', ARRAY['usage', 'how calculated', 'pricing', 'cost calculation', 'billing calculation'], 'Usage is based on **input + output tokens** consumed by your agents. Pricing varies by AI model used (OpenAI, Anthropic, Kimi). View details in [Billing](/v2/billing).', '/v2/billing', '/v2/billing'),

('Payment history', ARRAY['invoice', 'receipt', 'payment history', 'transactions', 'past payments', 'billing history'], 'View all past invoices and payment history in the **Transactions** tab on the [Billing](/v2/billing) page. Download receipts as PDF for accounting.', '/v2/billing', '/v2/billing');

-- Settings FAQs
INSERT INTO help_articles (topic, keywords, body, url, page_context) VALUES
('API keys', ARRAY['api key', 'openai', 'anthropic', 'kimi', 'add key', 'update key', 'api keys', 'llm keys'], 'Go to [Settings](/v2/settings) → **API Keys** to add or update keys for OpenAI, Anthropic, and Kimi. Keys are encrypted and secure.', '/v2/settings', '/v2/settings'),

('Connect integrations', ARRAY['integration', 'connect', 'gmail', 'slack', 'github', 'integrations', 'plugins', 'connect service'], 'Visit [Settings](/v2/settings) → **Integrations** to connect services like Gmail, Slack, GitHub. Click **Connect** next to each service.', '/v2/settings', '/v2/settings'),

('Update profile', ARRAY['profile', 'name', 'email', 'password', 'account info', 'personal info', 'update profile'], 'Go to [Settings](/v2/settings) → **Profile** to update your name, email, and password. Changes are saved automatically.', '/v2/settings', '/v2/settings'),

('Dark mode', ARRAY['theme', 'dark mode', 'light mode', 'appearance', 'color scheme'], 'Toggle between light and dark mode using the **Dark Mode** button in the footer, or set your preference in [Settings](/v2/settings) → **Appearance**', '/v2/settings', '/v2/settings');

-- Agent Creation FAQs
INSERT INTO help_articles (topic, keywords, body, url, page_context) VALUES
('Agent builder', ARRAY['how does', 'agent builder', 'builder work', 'conversational', 'chat builder'], 'The agent builder uses a conversational interface. Simply describe what you want your agent to do, and the system will guide you through configuration step-by-step.', NULL, '/v2/agents/new'),

('Required information', ARRAY['information', 'need to provide', 'required', 'what do i need', 'setup requirements'], 'You need to provide: **Agent name**, **Description** of what it does, **Schedule** (manual or automated), and optionally **Integrations** (Gmail, Slack, etc.).', NULL, '/v2/agents/new'),

('Test agent', ARRAY['test', 'test agent', 'try', 'preview', 'before saving', 'test before'], 'Yes! After configuring your agent, you can test it before deploying. Use the preview panel to see how your agent will behave.', NULL, '/v2/agents/new'),

-- Navigation FAQs for "find/where is" queries
('Find billing page', ARRAY['find billing', 'where billing', 'where is billing', 'locate billing', 'billing page', 'go to billing', 'access billing', 'navigate billing', 'how find billing'], 'To access your billing information, click on the **Credit Usage** card on the [Dashboard](/v2/dashboard) or visit [Billing](/v2/billing) directly. You can manage credits, view transactions, and update payment methods there.', '/v2/billing', '/v2/dashboard'),

('Find agent list page', ARRAY['find agents', 'where agents', 'where are agents', 'locate agents', 'agent page', 'agents page', 'view all agents', 'see agents', 'how find agents'], 'To view all your agents, click the **Active Agents** card on the [Dashboard](/v2/dashboard) or visit the [Agent List](/v2/agent-list) page directly. You can filter, search, and manage all agents there.', '/v2/agent-list', '/v2/dashboard'),

('Find analytics page', ARRAY['find analytics', 'where analytics', 'where is analytics', 'locate analytics', 'analytics page', 'view analytics', 'how find analytics'], 'To view detailed analytics and performance metrics, click the **System Alerts** card on the [Dashboard](/v2/dashboard) or visit [Analytics](/v2/analytics) directly.', '/v2/analytics', '/v2/dashboard');
