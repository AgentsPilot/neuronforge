/**
 * Effort Estimator — model resolver.
 *
 * Reads `effort_estimator_model` from `system_settings_config` and resolves
 * it to `{ provider, model }` for the provider factory. Falls back to
 * `gpt-4o-mini` on OpenAI when:
 *   - the row is missing (AC-7 — emits DEBUG log),
 *   - the row value is malformed,
 *   - the repository call fails.
 *
 * Uses `SystemConfigRepository` per CLAUDE.md mandatory rule #1 — all DB
 * access goes through the repository layer (caught by user code review on
 * 2026-06-10; the first pass used `supabaseServer` directly which bypassed
 * the existing repository and was a rule #1 violation).
 *
 * Caching: 5-minute TTL, module-scoped (per cold instance). Operators can
 * call `clearModelCache()` from tests to bypass.
 */
import { systemConfigRepository } from '@/lib/repositories';
import { createLogger } from '@/lib/logger';
import type { ProviderName } from '@/lib/ai/providerFactory';

const logger = createLogger({ module: 'effort-estimator', service: 'modelResolver' });

export interface ResolvedModel {
  provider: ProviderName;
  model: string;
}

/** Default when the DB row is missing/invalid. AC-7 mandates `gpt-4o-mini` on OpenAI. */
export const DEFAULT_MODEL: ResolvedModel = {
  provider: 'openai',
  model: 'gpt-4o-mini',
};

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { value: ResolvedModel; expiresAt: number } | null = null;

/**
 * Resolve which `{ provider, model }` to use for the effort estimator LLM call.
 *
 * Lookup order:
 *   1. In-process cache (5-minute TTL).
 *   2. `system_settings_config.effort_estimator_model` JSONB row.
 *   3. Default `gpt-4o-mini` on OpenAI.
 *
 * Value shapes accepted in the DB:
 *   - `{ "provider": "openai", "model": "gpt-4o-mini" }` (preferred)
 *   - Bare string `"gpt-4o-mini"` — assumed openai
 *   - JSON-encoded string `'"gpt-4o-mini"'` (some admin UIs store all values
 *     as JSON-encoded strings)
 */
export async function resolveEffortEstimatorModel(): Promise<ResolvedModel> {
  if (cache && Date.now() < cache.expiresAt) return cache.value;

  try {
    const { data, error } = await systemConfigRepository.getByKey('effort_estimator_model');

    if (error || !data) {
      // AC-7: missing row → default + DEBUG log.
      logger.debug(
        { err: error ?? null, key: 'effort_estimator_model' },
        'effort_estimator_model row missing — falling back to gpt-4o-mini default'
      );
      cache = { value: DEFAULT_MODEL, expiresAt: Date.now() + CACHE_TTL_MS };
      return DEFAULT_MODEL;
    }

    const resolved = parseConfigValue(data.value);
    cache = { value: resolved, expiresAt: Date.now() + CACHE_TTL_MS };
    return resolved;
  } catch (err) {
    // Any unexpected failure (network, DNS, SDK throw) — log + default.
    logger.debug({ err }, 'Effort estimator model resolution threw — using gpt-4o-mini default');
    return DEFAULT_MODEL;
  }
}

/**
 * Parse the JSONB `value` column into a `{ provider, model }` pair.
 * Tolerant of the three observed shapes (object / bare string / JSON-encoded
 * string). Anything we can't recognise falls back to the default model.
 */
function parseConfigValue(raw: unknown): ResolvedModel {
  let parsed: unknown = raw;

  if (typeof parsed === 'string') {
    // Could be a JSON-encoded string (e.g. '"gpt-4o-mini"') or a bare model name.
    try {
      parsed = JSON.parse(parsed);
    } catch {
      // Bare string — leave as-is.
    }
  }

  if (parsed && typeof parsed === 'object') {
    const obj = parsed as { provider?: unknown; model?: unknown };
    if (typeof obj.model === 'string' && obj.model.length > 0) {
      const provider = isProviderName(obj.provider) ? obj.provider : 'openai';
      return { provider, model: obj.model };
    }
  }

  if (typeof parsed === 'string' && parsed.length > 0) {
    return { provider: 'openai', model: parsed };
  }

  logger.debug({ raw }, 'effort_estimator_model value unrecognised — using gpt-4o-mini default');
  return DEFAULT_MODEL;
}

function isProviderName(p: unknown): p is ProviderName {
  return p === 'openai' || p === 'anthropic' || p === 'kimi';
}

/** Test helper — clears the in-process cache. */
export function clearModelCache(): void {
  cache = null;
}
