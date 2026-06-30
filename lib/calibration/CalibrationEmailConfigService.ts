// lib/calibration/CalibrationEmailConfigService.ts
// Single source of truth for the calibration result-email summary provider/model.
// Mirrors the per-feature config pattern (cf. AgentGenerationConfigService): one
// DEFAULT_CONFIG, one set of keys, one DB-resolving getter. Every consumer
// (batch-route tail, calibrationResultEmail, the admin route) imports from here
// so the default is declared exactly once.
//
// The seed SQL (supabase/SQL Scripts/20260628_calibration_email_config.sql) must
// mirror CALIBRATION_EMAIL_DEFAULTS.

import type { SupabaseClient } from '@supabase/supabase-js';
import { SystemConfigService } from '@/lib/services/SystemConfigService';
import type { ProviderName } from '@/lib/ai/providerFactory';

export interface CalibrationEmailConfig {
  provider: ProviderName;
  model: string;
}

/** Cheapest reliable default for the short summary (see lib/ai/pricing.ts). */
export const CALIBRATION_EMAIL_DEFAULTS: CalibrationEmailConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
};

export const CALIBRATION_EMAIL_PROVIDER_KEY = 'agent_calibration_notification_email_provider';
export const CALIBRATION_EMAIL_MODEL_KEY = 'agent_calibration_notification_email_model';

/**
 * Resolve the calibration-email summary provider/model from system config,
 * falling back to CALIBRATION_EMAIL_DEFAULTS. (SystemConfigService caches reads.)
 */
export async function getCalibrationEmailConfig(supabase: SupabaseClient): Promise<CalibrationEmailConfig> {
  const [provider, model] = await Promise.all([
    SystemConfigService.getString(supabase, CALIBRATION_EMAIL_PROVIDER_KEY, CALIBRATION_EMAIL_DEFAULTS.provider),
    SystemConfigService.getString(supabase, CALIBRATION_EMAIL_MODEL_KEY, CALIBRATION_EMAIL_DEFAULTS.model),
  ]);
  // Provider is validated downstream (calibrationResultEmail) against the
  // factory's supported set; an invalid DB value falls back to the default there.
  return { provider: provider as ProviderName, model };
}
