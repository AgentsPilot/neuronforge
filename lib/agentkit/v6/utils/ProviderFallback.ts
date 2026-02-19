/**
 * Provider Fallback & Retry Utility
 *
 * Handles automatic retry with exponential backoff and provider fallback
 * when LLM APIs are overloaded or rate-limited.
 *
 * Strategy:
 * 1. Try primary provider (Anthropic by default) with exponential backoff
 * 2. If still failing after retries, automatically fall back to secondary provider (OpenAI)
 * 3. Log all retry attempts and fallback events for monitoring
 *
 * Use Cases:
 * - Anthropic API overloaded (529 errors)
 * - Rate limit errors (429)
 * - Temporary API outages
 * - Service degradation
 */

export interface ProviderConfig {
  provider: 'anthropic' | 'openai'
  model?: string
  temperature?: number
  max_tokens?: number
}

export interface RetryConfig {
  maxRetries?: number          // Max retries per provider (default: 2)
  initialDelayMs?: number      // Initial retry delay (default: 1000ms)
  maxDelayMs?: number          // Max retry delay (default: 10000ms)
  backoffMultiplier?: number   // Exponential backoff multiplier (default: 2)
  enableFallback?: boolean     // Enable provider fallback (default: true)
}

export interface RetryResult<T> {
  success: boolean
  data?: T
  error?: any
  attemptsUsed: number
  provider: 'anthropic' | 'openai'
  fellBackToSecondary: boolean
  totalDurationMs: number
}

/**
 * Check if an error is retryable (overloaded, rate limit, timeout)
 */
function isRetryableError(error: any): boolean {
  if (!error) return false

  const errorMessage = error.message || JSON.stringify(error)
  const errorType = error.type || error.error?.type

  // Anthropic overloaded errors
  if (errorType === 'overloaded_error') return true
  if (errorMessage.includes('Overloaded')) return true
  if (errorMessage.includes('overloaded')) return true

  // Rate limit errors
  if (errorType === 'rate_limit_error') return true
  if (errorMessage.includes('rate limit')) return true
  if (errorMessage.includes('429')) return true

  // Timeout errors
  if (errorType === 'timeout_error') return true
  if (errorMessage.includes('timeout')) return true
  if (errorMessage.includes('ETIMEDOUT')) return true

  // Server errors (5xx)
  if (errorMessage.includes('500')) return true
  if (errorMessage.includes('502')) return true
  if (errorMessage.includes('503')) return true
  if (errorMessage.includes('529')) return true

  return false
}

/**
 * Get default model for a provider
 */
function getDefaultModel(provider: 'anthropic' | 'openai'): string {
  return provider === 'anthropic' ? 'claude-opus-4.5' : 'gpt-5.2'
}

/**
 * Execute a function with automatic retry and provider fallback
 *
 * @param fn - Async function to execute (receives ProviderConfig)
 * @param primaryConfig - Primary provider configuration
 * @param retryConfig - Retry and fallback configuration
 * @returns Result with success status, data, and metadata
 */
export async function withProviderFallback<T>(
  fn: (config: ProviderConfig) => Promise<T>,
  primaryConfig: ProviderConfig,
  retryConfig: RetryConfig = {}
): Promise<RetryResult<T>> {
  const {
    maxRetries = 2,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    backoffMultiplier = 2,
    enableFallback = true
  } = retryConfig

  const startTime = Date.now()
  let totalAttempts = 0
  let fellBackToSecondary = false

  // Ensure model is set
  const primaryWithModel: ProviderConfig = {
    ...primaryConfig,
    model: primaryConfig.model || getDefaultModel(primaryConfig.provider)
  }

  // Try primary provider with retries
  console.log(`[ProviderFallback] Trying primary provider: ${primaryWithModel.provider} (${primaryWithModel.model})`)

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    totalAttempts++

    try {
      const result = await fn(primaryWithModel)

      const duration = Date.now() - startTime
      console.log(`[ProviderFallback] ✓ Success with ${primaryWithModel.provider} after ${totalAttempts} attempt(s) in ${duration}ms`)

      return {
        success: true,
        data: result,
        attemptsUsed: totalAttempts,
        provider: primaryWithModel.provider,
        fellBackToSecondary: false,
        totalDurationMs: duration
      }
    } catch (error) {
      console.error(`[ProviderFallback] Attempt ${attempt + 1}/${maxRetries + 1} failed with ${primaryWithModel.provider}:`, error)

      // Check if error is retryable
      if (!isRetryableError(error)) {
        console.error(`[ProviderFallback] Error is not retryable, aborting`)
        return {
          success: false,
          error,
          attemptsUsed: totalAttempts,
          provider: primaryWithModel.provider,
          fellBackToSecondary: false,
          totalDurationMs: Date.now() - startTime
        }
      }

      // If we have retries left, wait and try again
      if (attempt < maxRetries) {
        const delayMs = Math.min(
          initialDelayMs * Math.pow(backoffMultiplier, attempt),
          maxDelayMs
        )
        console.log(`[ProviderFallback] Waiting ${delayMs}ms before retry...`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      } else {
        // Out of retries for primary provider
        console.error(`[ProviderFallback] ✗ Primary provider ${primaryWithModel.provider} failed after ${maxRetries + 1} attempts`)

        // If fallback disabled, return error
        if (!enableFallback) {
          return {
            success: false,
            error,
            attemptsUsed: totalAttempts,
            provider: primaryWithModel.provider,
            fellBackToSecondary: false,
            totalDurationMs: Date.now() - startTime
          }
        }
      }
    }
  }

  // Fall back to secondary provider
  const secondaryProvider: 'anthropic' | 'openai' =
    primaryConfig.provider === 'anthropic' ? 'openai' : 'anthropic'

  const secondaryConfig: ProviderConfig = {
    provider: secondaryProvider,
    model: getDefaultModel(secondaryProvider),
    temperature: primaryConfig.temperature,
    max_tokens: primaryConfig.max_tokens
  }

  console.log(`[ProviderFallback] 🔄 Falling back to secondary provider: ${secondaryProvider} (${secondaryConfig.model})`)
  fellBackToSecondary = true

  // Try secondary provider with retries
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    totalAttempts++

    try {
      const result = await fn(secondaryConfig)

      const duration = Date.now() - startTime
      console.log(`[ProviderFallback] ✓ Success with fallback provider ${secondaryProvider} after ${totalAttempts} total attempt(s) in ${duration}ms`)

      return {
        success: true,
        data: result,
        attemptsUsed: totalAttempts,
        provider: secondaryProvider,
        fellBackToSecondary: true,
        totalDurationMs: duration
      }
    } catch (error) {
      console.error(`[ProviderFallback] Fallback attempt ${attempt + 1}/${maxRetries + 1} failed with ${secondaryProvider}:`, error)

      // If we have retries left, wait and try again
      if (attempt < maxRetries) {
        const delayMs = Math.min(
          initialDelayMs * Math.pow(backoffMultiplier, attempt),
          maxDelayMs
        )
        console.log(`[ProviderFallback] Waiting ${delayMs}ms before retry...`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      } else {
        // Out of retries for both providers
        console.error(`[ProviderFallback] ✗ Both providers failed after ${totalAttempts} total attempts`)
        return {
          success: false,
          error,
          attemptsUsed: totalAttempts,
          provider: secondaryProvider,
          fellBackToSecondary: true,
          totalDurationMs: Date.now() - startTime
        }
      }
    }
  }

  // Should never reach here, but TypeScript requires it
  return {
    success: false,
    error: new Error('Unexpected fallback completion'),
    attemptsUsed: totalAttempts,
    provider: secondaryConfig.provider,
    fellBackToSecondary: true,
    totalDurationMs: Date.now() - startTime
  }
}

/**
 * Helper: Check if an error indicates provider overload
 */
export function isProviderOverloaded(error: any): boolean {
  const errorType = error?.type || error?.error?.type
  const errorMessage = error?.message || JSON.stringify(error)

  return (
    errorType === 'overloaded_error' ||
    errorMessage.includes('Overloaded') ||
    errorMessage.includes('overloaded')
  )
}

/**
 * Helper: Check if an error indicates rate limiting
 */
export function isRateLimited(error: any): boolean {
  const errorType = error?.type || error?.error?.type
  const errorMessage = error?.message || JSON.stringify(error)

  return (
    errorType === 'rate_limit_error' ||
    errorMessage.includes('rate limit') ||
    errorMessage.includes('429')
  )
}
