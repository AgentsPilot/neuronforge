/**
 * Context Window Limits and Token Estimation
 *
 * Provides context window sizes for all supported models and
 * utilities for estimating token usage and validating requests.
 */

import type { ProviderName } from './providerFactory';

/**
 * Context window sizes (in tokens) for each model.
 * These represent the total context (input + output) the model supports.
 */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // OpenAI GPT-5.2 Series
  'gpt-5.2': 256000,
  'gpt-5.2-pro': 256000,

  // OpenAI GPT-5.1 Series
  'gpt-5.1': 256000,

  // OpenAI GPT-5 Series
  'gpt-5': 128000,
  'gpt-5-mini': 128000,
  'gpt-5-nano': 128000,

  // OpenAI GPT-4.1 Series
  'gpt-4.1': 1000000,
  'gpt-4.1-mini': 1000000,
  'gpt-4.1-nano': 128000,

  // OpenAI o-Series
  'o3': 200000,
  'o4-mini': 200000,

  // OpenAI GPT-4o Series
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,

  // OpenAI Legacy
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-3.5-turbo': 16385,

  // Anthropic Claude 4.5 Series
  'claude-opus-4-5-20251101': 200000,
  'claude-sonnet-4-5-20250929': 200000,
  'claude-haiku-4-5-20251001': 200000,

  // Anthropic Claude 4.1 Series
  'claude-opus-4-1-20250805': 200000,

  // Anthropic Claude 4 Series
  'claude-opus-4-20250514': 200000,
  'claude-sonnet-4-20250514': 200000,

  // Anthropic Claude 3.7 Series
  'claude-3-7-sonnet-20250219': 200000,

  // Anthropic Claude 3.5 Series
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-5-haiku-20241022': 200000,

  // Anthropic Claude 3 Series (Legacy)
  'claude-3-opus-20240229': 200000,
  'claude-3-sonnet-20240229': 200000,
  'claude-3-haiku-20240307': 200000,

  // Kimi K2 Series
  'kimi-k2-0905-preview': 256000,
  'kimi-k2-thinking': 256000,
  'kimi-k2-0711-preview': 128000,

  // Kimi K1.5 Series
  'kimi-k1.5': 128000,
  'kimi-k1.5-long': 128000,

  // Kimi Linear Series
  'kimi-linear-48b': 1000000,

  // Kimi Specialized
  'kimi-dev-72b': 128000,
  'kimi-vl': 128000,
};

/**
 * Default context limit for unknown models (conservative estimate)
 */
export const DEFAULT_CONTEXT_LIMIT = 32000;

/**
 * Thresholds for context usage validation
 */
export const CONTEXT_THRESHOLDS = {
  /** Percentage at which to log a warning */
  WARNING: 0.80,
  /** Percentage at which to throw an error */
  ERROR: 0.95,
} as const;

/**
 * Get the context window limit for a specific model.
 * Returns a default value for unknown models.
 */
export function getModelContextLimit(model: string): number {
  return MODEL_CONTEXT_LIMITS[model] ?? DEFAULT_CONTEXT_LIMIT;
}

/**
 * Estimate the number of tokens in a string.
 * Uses a simple heuristic: ~4 characters per token for English text.
 * This is approximately 80% accurate for most use cases.
 *
 * For JSON content (which we use), this tends to slightly overestimate
 * which is safer for validation purposes.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // ~4 characters per token is a reasonable estimate for English/JSON
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for an array of chat messages
 */
export function estimateMessagesTokens(
  messages: Array<{ role: string; content: string }>
): number {
  let total = 0;
  for (const msg of messages) {
    // Add overhead for role and message structure (~4 tokens per message)
    total += 4;
    total += estimateTokens(msg.content);
  }
  // Add overhead for the overall structure
  total += 3;
  return total;
}

export interface ContextValidationResult {
  valid: boolean;
  estimatedTokens: number;
  contextLimit: number;
  usagePercent: number;
  warning?: string;
  error?: string;
}

/**
 * Validate context usage before making an API call.
 * Returns validation result with warnings/errors if thresholds exceeded.
 *
 * @param messages - The chat messages to validate
 * @param model - The model being used
 * @param maxOutputTokens - The max_tokens parameter (reserved for output)
 */
export function validateContextUsage(
  messages: Array<{ role: string; content: string }>,
  model: string,
  maxOutputTokens: number = 8192
): ContextValidationResult {
  const contextLimit = getModelContextLimit(model);
  const inputTokens = estimateMessagesTokens(messages);

  // Total tokens = input + reserved output
  const totalEstimated = inputTokens + maxOutputTokens;
  const usagePercent = totalEstimated / contextLimit;

  const result: ContextValidationResult = {
    valid: true,
    estimatedTokens: inputTokens,
    contextLimit,
    usagePercent,
  };

  if (usagePercent >= CONTEXT_THRESHOLDS.ERROR) {
    result.valid = false;
    result.error = `Context limit exceeded: estimated ${inputTokens.toLocaleString()} input tokens + ${maxOutputTokens.toLocaleString()} output = ${totalEstimated.toLocaleString()} total (${(usagePercent * 100).toFixed(1)}% of ${contextLimit.toLocaleString()} limit for ${model}). Reduce conversation history or use a model with larger context.`;
  } else if (usagePercent >= CONTEXT_THRESHOLDS.WARNING) {
    result.warning = `High context usage: estimated ${inputTokens.toLocaleString()} input tokens + ${maxOutputTokens.toLocaleString()} output = ${totalEstimated.toLocaleString()} total (${(usagePercent * 100).toFixed(1)}% of ${contextLimit.toLocaleString()} limit for ${model}).`;
  }

  return result;
}