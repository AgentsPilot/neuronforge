-- Agent Generation AI Config for V5 Generator
-- These control the provider/model used for technical workflow LLM review
-- Category: agent_creation

INSERT INTO system_settings_config (key, value, category, description)
VALUES
  ('agent_generation_ai_provider', '"openai"', 'agent_creation',
   'AI provider for V5 generator technical workflow LLM review'),
  ('agent_generation_ai_model', '"gpt-5.2"', 'agent_creation',
   'AI model for V5 generator technical workflow LLM review')
ON CONFLICT (key) DO NOTHING;
