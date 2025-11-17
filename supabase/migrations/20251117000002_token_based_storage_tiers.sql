-- Migration: Token-based storage tiers
-- Replace named tiers with token threshold-based storage allocation

-- Remove old tier-based configs
DELETE FROM ais_system_config WHERE config_key LIKE 'storage_tier_%';

-- Add token-based storage tiers (pilot tokens threshold → storage MB)
-- Format: storage_tokens_X where X is the minimum pilot tokens for that tier
INSERT INTO ais_system_config (config_key, config_value, category, description, updated_at) VALUES
  ('storage_tokens_0', '1000', 'storage', 'Storage quota (MB) for 0-10,000 pilot tokens', NOW()),
  ('storage_tokens_10000', '5000', 'storage', 'Storage quota (MB) for 10,000-50,000 pilot tokens', NOW()),
  ('storage_tokens_50000', '25000', 'storage', 'Storage quota (MB) for 50,000-100,000 pilot tokens', NOW()),
  ('storage_tokens_100000', '100000', 'storage', 'Storage quota (MB) for 100,000-500,000 pilot tokens', NOW()),
  ('storage_tokens_500000', '500000', 'storage', 'Storage quota (MB) for 500,000+ pilot tokens', NOW())
ON CONFLICT (config_key) DO UPDATE SET
  config_value = EXCLUDED.config_value,
  description = EXCLUDED.description,
  updated_at = NOW();
