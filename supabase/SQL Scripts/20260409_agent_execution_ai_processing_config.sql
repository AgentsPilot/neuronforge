-- Agent Execution AI Processing Config
-- These control the provider/model used for ai_processing steps in the Pilot workflow engine
-- (classify, generate, extract, summarize via callLLMDirect)
-- Category: agent_execution

INSERT INTO system_settings_config (key, value, category, description)
VALUES
  ('agent_execution_ai_processing_provider', '"anthropic"', 'agent_execution',
   'AI provider used for agent pilot step execution (ai_processing steps via callLLMDirect)'),
  ('agent_execution_ai_processing_model', '"claude-sonnet-4-6"', 'agent_execution',
   'AI model used for agent pilot step execution (ai_processing steps via callLLMDirect)')
ON CONFLICT (key) DO NOTHING;
