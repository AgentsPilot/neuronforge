/**
 * ErrorPatternService
 *
 * Business logic layer for error pattern detection and auto-recovery.
 * Integrates with StepExecutor for error capture and ErrorRecovery for fix application.
 *
 * Part of Phase 1: Error Learning (Memory System Enhancement)
 *
 * @module lib/services/ErrorPatternService
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  ErrorPatternRepository,
  ErrorPattern,
  RecoveryAttempt,
  AutoFixMethod,
  AutoFixConfig,
  UpsertErrorPatternInput,
} from '@/lib/repositories/ErrorPatternRepository';
import { createLogger, Logger } from '@/lib/logger';
import { getInsightsConfigService, ErrorLearningConfig } from './InsightsConfigService';

// ============ Types ============

export interface CaptureErrorInput {
  userId: string;
  agentId?: string;
  executionId?: string;
  plugin: string;
  action?: string;
  stepType?: string;
  errorCode: string;
  errorMessage?: string;
}

export interface RecoveryResult {
  applied: boolean;
  method?: AutoFixMethod;
  success?: boolean;
  patternId?: string;
  message?: string;
}

export interface AutoFixSuggestion {
  pattern: ErrorPattern;
  suggestedMethod: AutoFixMethod;
  suggestedConfig: AutoFixConfig;
  reason: string;
}

// Default auto-fix configurations by method
const DEFAULT_AUTO_FIX_CONFIGS: Record<AutoFixMethod, AutoFixConfig> = {
  retry_with_backoff: { max_retries: 3, backoff_ms: 1000 },
  wait_and_retry: { wait_ms: 5000, max_retries: 2 },
  skip: {},
  fallback: { fallback_value: null },
};

// Error codes that map to specific recovery methods
const ERROR_CODE_TO_METHOD: Record<string, AutoFixMethod> = {
  '429': 'wait_and_retry', // Rate limited
  '503': 'retry_with_backoff', // Service unavailable
  '502': 'retry_with_backoff', // Bad gateway
  '504': 'retry_with_backoff', // Gateway timeout
  TIMEOUT: 'retry_with_backoff',
  RATE_LIMIT: 'wait_and_retry',
  NETWORK_ERROR: 'retry_with_backoff',
  EMPTY_RESULT: 'skip', // Data-related - skip or fallback
  AUTH_EXPIRED: 'skip', // Requires user action - skip
};

// Default config values (used when config service unavailable)
const DEFAULT_ERROR_LEARNING_CONFIG: ErrorLearningConfig = {
  enabled: true,
  min_occurrences: 3,
  min_success_rate: 0.5,
  min_attempts_for_evaluation: 5,
};

// ============ Service ============

export class ErrorPatternService {
  private repository: ErrorPatternRepository;
  private logger: Logger;
  private supabase: SupabaseClient;
  private configCache: ErrorLearningConfig | null = null;
  private configCacheExpiry: number = 0;
  private readonly CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.repository = new ErrorPatternRepository(supabase);
    this.logger = createLogger({ service: 'ErrorPatternService' });
  }

  /**
   * Get error learning configuration (cached)
   */
  private async getConfig(): Promise<ErrorLearningConfig> {
    const now = Date.now();
    if (this.configCache && now < this.configCacheExpiry) {
      return this.configCache;
    }

    try {
      const configService = getInsightsConfigService(this.supabase);
      this.configCache = await configService.getErrorLearningConfig();
      this.configCacheExpiry = now + this.CONFIG_CACHE_TTL_MS;
      return this.configCache;
    } catch (err) {
      this.logger.error({ err }, 'Failed to load error learning config, using defaults');
      return DEFAULT_ERROR_LEARNING_CONFIG;
    }
  }

  /**
   * Capture an error occurrence
   *
   * Call this from StepExecutor when a step fails.
   * This creates/updates the error pattern in the database.
   */
  async captureError(input: CaptureErrorInput): Promise<string | null> {
    try {
      const upsertInput: UpsertErrorPatternInput = {
        user_id: input.userId,
        agent_id: input.agentId,
        error_code: this.normalizeErrorCode(input.errorCode),
        plugin: input.plugin,
        action: input.action,
        step_type: input.stepType,
        error_message: this.sanitizeErrorMessage(input.errorMessage),
      };

      const { data: patternId, error } = await this.repository.upsert(upsertInput);

      if (error) {
        this.logger.error({ err: error, input }, 'Failed to capture error pattern');
        return null;
      }

      this.logger.debug(
        { patternId, errorCode: input.errorCode, plugin: input.plugin },
        'Error pattern captured'
      );

      return patternId;
    } catch (error) {
      // Non-blocking - don't fail execution due to error capture
      this.logger.error({ err: error, input }, 'Error capturing pattern (non-blocking)');
      return null;
    }
  }

  /**
   * Check if there's an auto-fix available for this error
   *
   * Call this from ErrorRecovery before attempting standard recovery.
   * Returns the fix config if auto-fix is enabled and has good success rate.
   */
  async checkAutoFix(
    userId: string,
    agentId: string | null,
    errorCode: string,
    plugin: string,
    action?: string
  ): Promise<{
    hasAutoFix: boolean;
    pattern?: ErrorPattern;
    method?: AutoFixMethod;
    config?: AutoFixConfig;
  }> {
    try {
      const normalizedCode = this.normalizeErrorCode(errorCode);

      const { data: pattern, error } = await this.repository.findMatchingPattern(
        userId,
        agentId,
        normalizedCode,
        plugin,
        action
      );

      if (error || !pattern) {
        return { hasAutoFix: false };
      }

      // Check if auto-fix is enabled and has acceptable success rate
      if (!pattern.auto_fix_enabled) {
        return { hasAutoFix: false };
      }

      // Get config for thresholds
      const config = await this.getConfig();

      // If we have enough attempts, check success rate
      if (
        pattern.auto_fix_applied_count >= config.min_attempts_for_evaluation &&
        (pattern.auto_fix_success_rate ?? 0) < config.min_success_rate
      ) {
        this.logger.info(
          { patternId: pattern.id, successRate: pattern.auto_fix_success_rate },
          'Auto-fix success rate too low, skipping'
        );
        return { hasAutoFix: false };
      }

      return {
        hasAutoFix: true,
        pattern,
        method: pattern.auto_fix_method!,
        config: pattern.auto_fix_config,
      };
    } catch (error) {
      this.logger.error({ err: error }, 'Error checking auto-fix');
      return { hasAutoFix: false };
    }
  }

  /**
   * Record the result of an auto-fix attempt
   *
   * Call this after applying auto-fix to track effectiveness.
   */
  async recordAutoFixResult(patternId: string, success: boolean): Promise<void> {
    try {
      await this.repository.recordAutoFixResult(patternId, success);
    } catch (error) {
      // Non-blocking
      this.logger.error({ err: error, patternId }, 'Failed to record auto-fix result');
    }
  }

  /**
   * Record a manual recovery attempt
   *
   * Call this when user manually recovers from an error.
   * Helps learn which recovery methods work.
   */
  async recordRecoveryAttempt(
    patternId: string,
    userId: string,
    method: string,
    success: boolean,
    executionId?: string
  ): Promise<void> {
    try {
      const attempt: RecoveryAttempt = {
        method,
        success,
        timestamp: new Date().toISOString(),
        execution_id: executionId,
      };

      await this.repository.addRecoveryAttempt(patternId, userId, attempt);

      this.logger.debug({ patternId, method, success }, 'Recovery attempt recorded');
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to record recovery attempt');
    }
  }

  /**
   * Get auto-fix suggestions for a user
   *
   * Returns patterns that have enough occurrences to suggest auto-fix.
   */
  async getAutoFixSuggestions(
    userId: string,
    agentId?: string
  ): Promise<AutoFixSuggestion[]> {
    try {
      const { data: patterns, error } = await this.repository.findEligibleForAutoFix(
        userId,
        agentId
      );

      if (error || !patterns) {
        return [];
      }

      return patterns.map((pattern) => this.buildSuggestion(pattern));
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to get auto-fix suggestions');
      return [];
    }
  }

  /**
   * Enable auto-fix for a pattern
   */
  async enableAutoFix(
    patternId: string,
    userId: string,
    method: AutoFixMethod,
    config?: AutoFixConfig
  ): Promise<boolean> {
    try {
      const { error } = await this.repository.enableAutoFix(
        {
          pattern_id: patternId,
          method,
          config: config || DEFAULT_AUTO_FIX_CONFIGS[method],
        },
        userId
      );

      return !error;
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to enable auto-fix');
      return false;
    }
  }

  /**
   * Disable auto-fix for a pattern
   */
  async disableAutoFix(patternId: string, userId: string): Promise<boolean> {
    try {
      const { error } = await this.repository.disableAutoFix(patternId, userId);
      return !error;
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to disable auto-fix');
      return false;
    }
  }

  /**
   * Get patterns with low success rate (candidates for disabling)
   */
  async getPoorPerformingPatterns(userId: string): Promise<ErrorPattern[]> {
    try {
      const config = await this.getConfig();
      const { data } = await this.repository.findLowSuccessRatePatterns(
        userId,
        config.min_success_rate,
        config.min_attempts_for_evaluation
      );

      return data || [];
    } catch {
      return [];
    }
  }

  /**
   * Auto-disable poorly performing auto-fixes
   *
   * Call this periodically (e.g., weekly cron) to maintain quality.
   */
  async autoDisablePoorPerformers(userId: string): Promise<number> {
    try {
      const patterns = await this.getPoorPerformingPatterns(userId);
      let disabledCount = 0;

      for (const pattern of patterns) {
        const disabled = await this.disableAutoFix(pattern.id, userId);
        if (disabled) {
          disabledCount++;
          this.logger.info(
            { patternId: pattern.id, successRate: pattern.auto_fix_success_rate },
            'Auto-disabled poor performing auto-fix'
          );
        }
      }

      return disabledCount;
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to auto-disable poor performers');
      return 0;
    }
  }

  /**
   * Get error pattern statistics
   */
  async getStatistics(userId: string) {
    return this.repository.getStatistics(userId);
  }

  /**
   * Get all patterns for a user
   */
  async getPatterns(
    userId: string,
    options?: {
      agentId?: string;
      minOccurrences?: number;
      autoFixEnabledOnly?: boolean;
      limit?: number;
    }
  ) {
    return this.repository.findByUser(userId, options);
  }

  // ============ Private Helpers ============

  /**
   * Normalize error codes for consistent matching
   */
  private normalizeErrorCode(code: string | number): string {
    const strCode = String(code).toUpperCase().trim();

    // Map common variations
    if (strCode.includes('TIMEOUT') || strCode.includes('ETIMEDOUT')) {
      return 'TIMEOUT';
    }
    if (strCode.includes('RATE') || strCode.includes('THROTTL')) {
      return 'RATE_LIMIT';
    }
    if (strCode.includes('NETWORK') || strCode.includes('ECONNREFUSED')) {
      return 'NETWORK_ERROR';
    }
    if (strCode.includes('AUTH') || strCode.includes('401') || strCode.includes('403')) {
      return strCode.includes('EXPIRED') ? 'AUTH_EXPIRED' : 'AUTH_FAILED';
    }

    return strCode;
  }

  /**
   * Sanitize error message to remove potential PII
   */
  private sanitizeErrorMessage(message?: string): string | null {
    if (!message) return null;

    // Truncate to reasonable length
    let sanitized = message.substring(0, 500);

    // Remove potential emails
    sanitized = sanitized.replace(/[\w.-]+@[\w.-]+\.\w+/g, '[EMAIL]');

    // Remove potential API keys/tokens
    sanitized = sanitized.replace(/[A-Za-z0-9_-]{32,}/g, '[TOKEN]');

    // Remove potential URLs with query params
    sanitized = sanitized.replace(/https?:\/\/[^\s]+\?[^\s]*/g, '[URL]');

    return sanitized;
  }

  /**
   * Build a suggestion for an error pattern
   */
  private buildSuggestion(pattern: ErrorPattern): AutoFixSuggestion {
    // Determine suggested method based on error code
    const suggestedMethod =
      ERROR_CODE_TO_METHOD[pattern.error_code] || 'retry_with_backoff';

    // Check recovery history for what has worked
    const successfulMethods = pattern.recovery_attempts
      .filter((a) => a.success)
      .map((a) => a.method);

    // If a method has worked before, prefer it
    let finalMethod = suggestedMethod;
    if (successfulMethods.length > 0) {
      const methodCounts = successfulMethods.reduce(
        (acc, m) => {
          acc[m] = (acc[m] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );
      const mostSuccessful = Object.entries(methodCounts).sort(
        (a, b) => b[1] - a[1]
      )[0];
      if (mostSuccessful && mostSuccessful[1] >= 2) {
        finalMethod = mostSuccessful[0] as AutoFixMethod;
      }
    }

    const suggestedConfig = DEFAULT_AUTO_FIX_CONFIGS[finalMethod] || {};

    // Build reason
    let reason = `This error (${pattern.error_code}) has occurred ${pattern.occurrence_count} times`;
    if (successfulMethods.length > 0) {
      reason += `. "${finalMethod}" has successfully recovered ${successfulMethods.filter((m) => m === finalMethod).length} times.`;
    } else {
      reason += `. "${finalMethod}" is recommended for ${pattern.error_code} errors.`;
    }

    return {
      pattern,
      suggestedMethod: finalMethod,
      suggestedConfig,
      reason,
    };
  }
}

// Singleton factory
let _instance: ErrorPatternService | null = null;
let _lastSupabase: SupabaseClient | null = null;

export function getErrorPatternService(supabase: SupabaseClient): ErrorPatternService {
  if (!_instance || _lastSupabase !== supabase) {
    _instance = new ErrorPatternService(supabase);
    _lastSupabase = supabase;
  }
  return _instance;
}
