/**
 * ErrorRecovery - Handle errors with retry logic and fallback strategies
 *
 * Responsibilities:
 * - Retry failed steps with exponential backoff
 * - Execute fallback steps
 * - Rollback on error
 * - Determine if errors are retryable
 *
 * @module lib/orchestrator/ErrorRecovery
 */

import type {
  RetryPolicy,
  WorkflowStep,
  ExecutionContext,
  RollbackAction,
} from './types';
import { ExecutionError } from './types';
import { PluginExecuterV2 } from '@/lib/server/plugin-executer-v2';

export class ErrorRecovery {
  /**
   * Default retry policy
   */
  private static readonly DEFAULT_RETRY_POLICY: RetryPolicy = {
    maxRetries: 3,
    backoffMs: 1000,
    backoffMultiplier: 2,
    retryableErrors: [
      'TIMEOUT',
      'RATE_LIMIT',
      'NETWORK_ERROR',
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      '429',  // Rate limit HTTP status
      '503',  // Service unavailable
      '504',  // Gateway timeout
    ],
  };

  /**
   * Execute function with retry logic
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    policy?: Partial<RetryPolicy>,
    stepId?: string
  ): Promise<T> {
    const finalPolicy: RetryPolicy = {
      ...ErrorRecovery.DEFAULT_RETRY_POLICY,
      ...policy,
    };

    let lastError: Error;
    let attempt = 0;

    while (attempt <= finalPolicy.maxRetries) {
      try {
        const result = await fn();

        if (attempt > 0) {
          console.log(`[ErrorRecovery] Retry succeeded on attempt ${attempt + 1} for step ${stepId || 'unknown'}`);
        }

        return result;
      } catch (error: any) {
        lastError = error;
        attempt++;

        console.error(`[ErrorRecovery] Attempt ${attempt}/${finalPolicy.maxRetries + 1} failed for step ${stepId || 'unknown'}:`, error.message);

        // Check if error is retryable
        const isRetryable = this.isRetryableError(error, finalPolicy.retryableErrors);

        if (!isRetryable) {
          console.log(`[ErrorRecovery] Error is not retryable: ${error.message}`);
          throw error;
        }

        if (attempt > finalPolicy.maxRetries) {
          console.log(`[ErrorRecovery] Max retries (${finalPolicy.maxRetries}) reached`);
          throw error;
        }

        // Calculate backoff delay
        const delay = this.calculateBackoff(attempt, finalPolicy.backoffMs, finalPolicy.backoffMultiplier);

        console.log(`[ErrorRecovery] Retrying in ${delay}ms (attempt ${attempt}/${finalPolicy.maxRetries})`);

        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  /**
   * Execute with fallback steps
   */
  async executeWithFallback<T>(
    primaryFn: () => Promise<T>,
    fallbackSteps: WorkflowStep[],
    context: ExecutionContext
  ): Promise<T> {
    try {
      return await primaryFn();
    } catch (primaryError: any) {
      console.warn(`[ErrorRecovery] Primary execution failed, trying ${fallbackSteps.length} fallback steps:`, primaryError.message);

      // Try each fallback step in sequence
      for (let i = 0; i < fallbackSteps.length; i++) {
        const fallbackStep = fallbackSteps[i];

        try {
          console.log(`[ErrorRecovery] Attempting fallback ${i + 1}/${fallbackSteps.length}: ${fallbackStep.name}`);

          // Execute fallback step
          // (In practice, this would use StepExecutor, but we avoid circular dependency)
          // The WorkflowOrchestrator should handle this

          throw new Error('Fallback execution should be handled by WorkflowOrchestrator');
        } catch (fallbackError: any) {
          console.error(`[ErrorRecovery] Fallback ${i + 1} failed:`, fallbackError.message);

          if (i === fallbackSteps.length - 1) {
            // Last fallback failed, throw original error
            throw new ExecutionError(
              `Primary and all ${fallbackSteps.length} fallback steps failed. Original error: ${primaryError.message}`,
              'ALL_FALLBACKS_FAILED',
              undefined,
              {
                primaryError: primaryError.message,
                fallbackErrors: [fallbackError.message],
              }
            );
          }
        }
      }

      throw primaryError;
    }
  }

  /**
   * Rollback step execution
   */
  async rollbackStep(
    step: WorkflowStep,
    context: ExecutionContext
  ): Promise<void> {
    if (!step.rollbackAction) {
      console.log(`[ErrorRecovery] No rollback action defined for step ${step.id}`);
      return;
    }

    console.log(`[ErrorRecovery] Rolling back step ${step.id}`);

    try {
      const rollbackAction = step.rollbackAction;

      // Resolve rollback parameters
      const resolvedParams = context.resolveAllVariables(rollbackAction.params);

      // Execute rollback via PluginExecuterV2
      const result = await PluginExecuterV2.execute(
        context.userId,
        rollbackAction.plugin,
        rollbackAction.action,
        resolvedParams
      );

      if (result.success) {
        console.log(`[ErrorRecovery] Rollback successful for step ${step.id}`);
      } else {
        console.error(`[ErrorRecovery] Rollback failed for step ${step.id}:`, result.error);
        // Don't throw - rollback failures are logged but not fatal
      }
    } catch (error: any) {
      console.error(`[ErrorRecovery] Rollback error for step ${step.id}:`, error);
      // Don't throw - rollback failures are logged but not fatal
    }
  }

  /**
   * Rollback multiple steps in reverse order
   */
  async rollbackSteps(
    steps: WorkflowStep[],
    context: ExecutionContext
  ): Promise<void> {
    console.log(`[ErrorRecovery] Rolling back ${steps.length} steps`);

    // Rollback in reverse order
    const reversedSteps = [...steps].reverse();

    for (const step of reversedSteps) {
      await this.rollbackStep(step, context);
    }

    console.log(`[ErrorRecovery] Rollback complete`);
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: any, retryableErrors: string[]): boolean {
    const errorMessage = error.message || '';
    const errorCode = error.code || '';
    const errorStatus = error.status || error.statusCode || '';

    return retryableErrors.some(pattern => {
      return (
        errorMessage.includes(pattern) ||
        errorCode === pattern ||
        String(errorStatus) === pattern
      );
    });
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoff(
    attempt: number,
    baseDelay: number,
    multiplier: number
  ): number {
    // Exponential backoff: baseDelay * (multiplier ^ (attempt - 1))
    const delay = baseDelay * Math.pow(multiplier, attempt - 1);

    // Add jitter (±20%) to avoid thundering herd
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);

    return Math.floor(delay + jitter);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Determine recovery strategy based on error
   */
  determineRecoveryStrategy(error: any): 'retry' | 'fallback' | 'rollback' | 'fail' {
    const errorCode = error.code || '';
    const errorMessage = error.message || '';

    // Transient errors → retry
    if (
      errorCode.includes('TIMEOUT') ||
      errorCode.includes('RATE_LIMIT') ||
      errorCode.includes('NETWORK') ||
      errorCode === 'ECONNRESET' ||
      errorCode === 'ETIMEDOUT'
    ) {
      return 'retry';
    }

    // Auth errors → fail (no point retrying)
    if (
      errorCode.includes('UNAUTHORIZED') ||
      errorCode.includes('FORBIDDEN') ||
      errorMessage.includes('authentication') ||
      errorMessage.includes('permission')
    ) {
      return 'fail';
    }

    // Plugin errors → fallback if available
    if (
      errorCode === 'PLUGIN_EXECUTION_FAILED' ||
      errorCode === 'PLUGIN_NOT_AVAILABLE'
    ) {
      return 'fallback';
    }

    // Data integrity errors → rollback
    if (
      errorCode.includes('VALIDATION') ||
      errorCode.includes('CONSTRAINT') ||
      errorMessage.includes('integrity')
    ) {
      return 'rollback';
    }

    // Default: retry
    return 'retry';
  }

  /**
   * Create user-friendly error message
   */
  formatErrorMessage(error: any, stepName?: string): string {
    const prefix = stepName ? `Step "${stepName}" failed: ` : 'Execution failed: ';

    if (error.code) {
      return `${prefix}${error.message} (${error.code})`;
    }

    return `${prefix}${error.message}`;
  }

  /**
   * Check if step should continue on error
   */
  shouldContinueOnError(step: WorkflowStep, error: any): boolean {
    // If step explicitly says continueOnError
    if (step.continueOnError) {
      return true;
    }

    // If error is non-critical (warning-level)
    if (this.isNonCriticalError(error)) {
      return true;
    }

    return false;
  }

  /**
   * Check if error is non-critical
   */
  private isNonCriticalError(error: any): boolean {
    const warningCodes = [
      'VALIDATION_WARNING',
      'PARTIAL_SUCCESS',
      'DEPRECATED_FEATURE',
    ];

    return warningCodes.includes(error.code);
  }

  /**
   * Aggregate errors from multiple steps
   */
  aggregateErrors(errors: Array<{ stepId: string; error: Error }>): Error {
    const errorMessages = errors
      .map(e => `- Step ${e.stepId}: ${e.error.message}`)
      .join('\n');

    return new ExecutionError(
      `Multiple steps failed:\n${errorMessages}`,
      'MULTIPLE_STEP_FAILURES',
      undefined,
      { failedSteps: errors.map(e => e.stepId) }
    );
  }

  /**
   * Create circuit breaker for repeated failures
   */
  createCircuitBreaker(
    maxFailures: number = 5,
    resetTimeoutMs: number = 60000
  ): CircuitBreaker {
    return new CircuitBreaker(maxFailures, resetTimeoutMs);
  }
}

/**
 * Circuit Breaker pattern implementation
 */
export class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private maxFailures: number,
    private resetTimeoutMs: number
  ) {}

  /**
   * Execute function through circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      // Check if it's time to try again
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        console.log('[CircuitBreaker] Transitioning to half-open state');
        this.state = 'half-open';
      } else {
        throw new ExecutionError(
          'Circuit breaker is open due to repeated failures',
          'CIRCUIT_BREAKER_OPEN'
        );
      }
    }

    try {
      const result = await fn();

      // Success - reset circuit breaker
      if (this.state === 'half-open') {
        console.log('[CircuitBreaker] Transitioning to closed state');
        this.state = 'closed';
        this.failures = 0;
      }

      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();

      if (this.failures >= this.maxFailures) {
        console.log(`[CircuitBreaker] Opening circuit after ${this.failures} failures`);
        this.state = 'open';
      }

      throw error;
    }
  }

  /**
   * Get current state
   */
  getState(): 'closed' | 'open' | 'half-open' {
    return this.state;
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.lastFailureTime = 0;
  }
}
