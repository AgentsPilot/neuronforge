/**
 * Thread-based Provider Configuration
 *
 * Utility for resolving AI provider and model settings when creating
 * a new thread. Once a thread is created, the provider and model are
 * stored as dedicated columns and cannot be changed.
 */

import { ProviderFactory, PROVIDERS, type ProviderName } from '@/lib/ai/providerFactory';

export interface ResolvedProviderConfig {
  provider: ProviderName;
  model: string;
}

/**
 * Resolves the AI provider and model to use when creating a new thread.
 *
 * This function is ONLY used during thread creation (init-thread).
 * Once a thread is created, the provider and model are stored as dedicated
 * columns (ai_provider, ai_model) and become immutable.
 *
 * Resolution order:
 * 1. Request-specified provider/model (if provided)
 * 2. Provider defaults - each provider defines its own defaultModel
 *
 * @param requestProvider - Provider specified in the request (optional, defaults to 'openai')
 * @param requestModel - Model specified in the request (optional, defaults to provider's default)
 * @returns Resolved provider name and model
 */
export function resolveThreadProviderConfig(
  requestProvider?: ProviderName,
  requestModel?: string
): ResolvedProviderConfig {
  // Use requested provider or default to OpenAI
  const provider: ProviderName = requestProvider || PROVIDERS.OPENAI;

  // Use requested model or get the provider's default model
  const model: string = requestModel || ProviderFactory.getProvider(provider).defaultModel;

  return { provider, model };
}