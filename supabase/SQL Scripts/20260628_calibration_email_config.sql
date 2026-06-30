-- Calibration result email AI config
-- Provider/model used to LLM-summarize the post-creation calibration result email.
-- Defaults to the cheapest reliable option (see lib/ai/pricing.ts).
-- SOURCE OF TRUTH for the defaults: CALIBRATION_EMAIL_DEFAULTS in
-- lib/calibration/CalibrationEmailConfigService.ts — keep these values in sync.
-- Read at the batch-calibration tail via SystemConfigService and passed to
-- sendCalibrationResultEmail; editable via GET/PUT /api/admin/calibration-email-config.
-- Category: calibration

INSERT INTO system_settings_config (key, value, category, description)
VALUES
  ('agent_calibration_notification_email_provider', '"openai"', 'calibration',
   'AI provider for the calibration result email summary'),
  ('agent_calibration_notification_email_model', '"gpt-4o-mini"', 'calibration',
   'AI model for the calibration result email summary')
ON CONFLICT (key) DO NOTHING;
