-- Fix category for helpbot theme colors that were incorrectly created with 'general' category
-- This migration ensures theme colors are in the 'helpbot' category so they can be retrieved correctly

UPDATE system_settings_config
SET category = 'helpbot'
WHERE key IN (
  'helpbot_theme_primary_color',
  'helpbot_theme_secondary_color',
  'helpbot_theme_border_color',
  'helpbot_theme_shadow_color',
  'helpbot_theme_close_button_color'
)
AND category != 'helpbot';

-- Verify the update
SELECT key, category, value
FROM system_settings_config
WHERE key LIKE 'helpbot_theme_%'
ORDER BY key;
