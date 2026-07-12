// lib/calibration/calibrationRcaConfig.ts
// DB-backed config-with-defaults accessor for the automated calibration RCA
// service (FR-13, FR-8). Mirrors lib/agentkit/v6/config/AgentGenerationConfigService.ts
// (system_settings_config-backed, in-memory ~5-min TTL cache, DEFAULT_CONFIG
// fallback) — but uses Pino, not the reference's console.*.
//
// Why a direct service-role Supabase client here (not a repository):
// this reads ONLY platform config from `system_settings_config` — never
// user/evidence data — following the established AgentGenerationConfigService
// config-service precedent for the RLS bypass. All EVIDENCE reads in the RCA
// service go through repositories (SA Comment 4).

import { createClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'CalibrationRcaConfig', service: 'v6-calibration' });

export interface CalibrationRcaConfig {
  provider: 'openai' | 'anthropic';
  model: string;
  temperature: number;
  /** Hard ceiling for the RCA LLM call. Always paired with the caller's
   *  runtime remaining-budget cap (C2) — this is the config default, not the
   *  effective deadline. */
  timeoutMs: number;
  maxTokens: number;
}

// In-memory cache (module scope — same lifetime as the serverless instance).
let configCache: CalibrationRcaConfig | null = null;
let cacheLastUpdated = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Code-level default fallback (FR-13). The model string lives ONLY here — the
 * RCA service must never hardcode a model literal or use getDefaultModel().
 * `claude-sonnet-4-6` is the documented mid-tier reasoning default (best
 * speed/intelligence balance) per docs/AI_PROVIDER_MODELS.md; overridable via
 * the system_settings_config rows without a code change.
 */
export const DEFAULT_CONFIG: CalibrationRcaConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  temperature: 0,
  timeoutMs: 25000,
  maxTokens: 4000,
};

/** system_settings_config keys backing this config. */
const KEYS = {
  provider: 'calibration_rca_provider',
  model: 'calibration_rca_model',
  temperature: 'calibration_rca_temperature',
  timeoutMs: 'calibration_rca_timeout_ms',
  maxTokens: 'calibration_rca_max_tokens',
} as const;

function parseSetting(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    // Not JSON — coerce to number when it looks numeric, else keep the string.
    return isNaN(Number(value)) ? value : Number(value);
  }
}

async function loadConfigFromDatabase(): Promise<CalibrationRcaConfig> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      logger.warn('Supabase credentials not configured — using calibration RCA defaults');
      return DEFAULT_CONFIG;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: settings, error } = await supabase
      .from('system_settings_config')
      .select('key, value')
      .like('key', 'calibration_rca_%');

    if (error) {
      logger.warn({ err: error }, 'Failed to load calibration RCA config from database — using defaults');
      return DEFAULT_CONFIG;
    }

    if (!settings || settings.length === 0) {
      logger.debug('No calibration RCA config rows found — using defaults');
      return DEFAULT_CONFIG;
    }

    const config: CalibrationRcaConfig = { ...DEFAULT_CONFIG };

    for (const { key, value } of settings) {
      const parsed = parseSetting(value);
      switch (key) {
        case KEYS.provider:
          if (parsed === 'openai' || parsed === 'anthropic') config.provider = parsed;
          break;
        case KEYS.model:
          if (typeof parsed === 'string' && parsed.trim()) config.model = parsed;
          break;
        case KEYS.temperature:
          if (!isNaN(Number(parsed))) config.temperature = Number(parsed);
          break;
        case KEYS.timeoutMs:
          if (!isNaN(Number(parsed))) config.timeoutMs = Number(parsed);
          break;
        case KEYS.maxTokens:
          if (!isNaN(Number(parsed))) config.maxTokens = Number(parsed);
          break;
      }
    }

    logger.info({ provider: config.provider, model: config.model }, 'Loaded calibration RCA config from database');
    return config;
  } catch (err) {
    logger.error({ err }, 'Error loading calibration RCA config — using defaults');
    return DEFAULT_CONFIG;
  }
}

/**
 * Get calibration RCA config with smart caching (~5-min TTL). Falls back to
 * DEFAULT_CONFIG whenever the DB is unavailable or empty.
 */
export async function getCalibrationRcaConfig(): Promise<CalibrationRcaConfig> {
  const now = Date.now();
  if (configCache && now - cacheLastUpdated < CACHE_TTL_MS) {
    return configCache;
  }
  configCache = await loadConfigFromDatabase();
  cacheLastUpdated = now;
  return configCache;
}

/** Manually refresh the cache (e.g. after an admin config change). */
export async function refreshCalibrationRcaConfig(): Promise<void> {
  configCache = await loadConfigFromDatabase();
  cacheLastUpdated = Date.now();
  logger.info('Calibration RCA config cache refreshed');
}

/** Clear the cache (for tests). */
export function clearCalibrationRcaConfigCache(): void {
  configCache = null;
  cacheLastUpdated = 0;
}

/**
 * Server-side feature-flag accessor for the automated calibration RCA (FR-19).
 * Reads the `CALIBRATION_AUTO_RCA_ENABLED` env flag (server-only — no
 * `NEXT_PUBLIC_` prefix). Extracted from the inline route check so the flag-off
 * path is unit-testable in isolation. When this returns `false`, the alert path
 * behaves exactly as today: no LLM call, no RCA generation, no RCA-attempt
 * metadata write (AC-9).
 */
export function isCalibrationAutoRcaEnabled(): boolean {
  return process.env.CALIBRATION_AUTO_RCA_ENABLED === 'true';
}
