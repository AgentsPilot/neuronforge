-- Create table for HelpBot page contexts
-- This allows admins to configure help topics and quick questions per page via admin UI

CREATE TABLE IF NOT EXISTS public.helpbot_page_contexts (
  page_route TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  quick_questions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_helpbot_page_contexts_route ON public.helpbot_page_contexts(page_route);

-- Add RLS policies (admin only)
ALTER TABLE public.helpbot_page_contexts ENABLE ROW LEVEL SECURITY;

-- Allow all users to read page contexts (needed for HelpBot to function)
CREATE POLICY "Anyone can read page contexts"
  ON public.helpbot_page_contexts
  FOR SELECT
  USING (true);

-- Only allow service role to insert/update/delete (admin operations)
CREATE POLICY "Service role can manage page contexts"
  ON public.helpbot_page_contexts
  FOR ALL
  USING (auth.role() = 'service_role');

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_helpbot_page_contexts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_helpbot_page_contexts_timestamp ON public.helpbot_page_contexts;
CREATE TRIGGER update_helpbot_page_contexts_timestamp
  BEFORE UPDATE ON public.helpbot_page_contexts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_helpbot_page_contexts_updated_at();

-- Insert default page contexts (migrated from hardcoded PAGE_CONTEXTS)
INSERT INTO public.helpbot_page_contexts (page_route, title, description, quick_questions) VALUES
  ('/v2/dashboard', 'Dashboard', 'Your command center for managing agents, viewing analytics, and monitoring system health',
   '["How do I create a new agent?", "What are Pilot Credits?", "How do I check my credit balance?"]'::jsonb),

  ('/v2/agent-list', 'Agent List', 'View and manage all your automation agents in one place',
   '["How do I filter agents?", "What does the AIS score mean?", "How do I delete an agent?"]'::jsonb),

  ('/v2/agents/[id]', 'Agent Details', 'View detailed information about a specific agent',
   '["How do I edit this agent?", "How do I view execution history?", "How do I pause/activate this agent?"]'::jsonb),

  ('/v2/agents/[id]/run', 'Run Agent', 'Execute your agent with specific inputs and view real-time results',
   '["How do I provide input data?", "Can I schedule this to run automatically?", "How do I view execution logs?"]'::jsonb),

  ('/v2/agents/new', 'Create Agent', 'Build a new automation agent using our conversational interface',
   '["What makes a good agent prompt?", "How do I connect plugins?", "What triggers can I use?"]'::jsonb),

  ('/v2/templates', 'Agent Templates', 'Browse and use pre-built agent templates for common use cases',
   '["How do I use a template?", "Can I customize templates?", "What templates are available?"]'::jsonb),

  ('/v2/analytics', 'Analytics', 'View performance metrics, costs, and usage trends for your agents',
   '["How do I export analytics data?", "What metrics are tracked?", "How is cost calculated?"]'::jsonb),

  ('/v2/billing', 'Billing', 'Manage your Pilot Credits, subscriptions, and payment methods',
   '["How do I buy more credits?", "What payment methods are accepted?", "Can I get a refund?"]'::jsonb),

  ('/v2/monitoring', 'Monitoring', 'Real-time execution logs and system health monitoring',
   '["How do I filter logs?", "What do the different status codes mean?", "Can I export logs?"]'::jsonb),

  ('/v2/notifications', 'Notifications', 'Configure alert preferences and integrations like Slack',
   '["How do I enable Slack notifications?", "What events trigger alerts?", "How do I mute notifications?"]'::jsonb),

  ('/v2/settings', 'Settings', 'Manage API keys, plugin connections, and account preferences',
   '["How do I add an API key?", "How do I connect a plugin?", "How do I change my password?"]'::jsonb)

ON CONFLICT (page_route) DO NOTHING;

COMMENT ON TABLE public.helpbot_page_contexts IS 'Stores page-specific context information for HelpBot assistance';
COMMENT ON COLUMN public.helpbot_page_contexts.page_route IS 'The route path (e.g., /v2/dashboard)';
COMMENT ON COLUMN public.helpbot_page_contexts.title IS 'Display title for the page';
COMMENT ON COLUMN public.helpbot_page_contexts.description IS 'Description of what the page does';
COMMENT ON COLUMN public.helpbot_page_contexts.quick_questions IS 'Array of suggested questions users might ask';
