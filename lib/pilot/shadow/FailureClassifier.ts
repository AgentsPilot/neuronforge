/**
 * FailureClassifier - Intelligent runtime error classification
 *
 * Classifies errors into categories for appropriate recovery strategies:
 * - Transient (retry with delay)
 * - Permanent (stop execution, user intervention needed)
 * - Configuration (auth/permission issues)
 * - Data shape (auto-repairable via RepairEngine)
 *
 * This handles the 20% of errors that slip through static validation.
 *
 * @module lib/pilot/shadow/FailureClassifier
 */

import { createLogger } from '@/lib/logger';
import type { FailureClassification, StepFailureContext, FailureCategory } from './types';

const logger = createLogger({ module: 'FailureClassifier', service: 'shadow-agent' });

interface ErrorInput {
  message: string;
  code?: string;
  status?: number;
  statusCode?: number;
}

export class FailureClassifier {
  // Transient network/timeout errors
  private static TRANSIENT_PATTERNS = [
    { pattern: /timeout|timed out/i, retryDelay: 5000, severity: 'medium' as const },
    { pattern: /ETIMEDOUT|ECONNRESET|ENOTFOUND|ECONNREFUSED/i, retryDelay: 3000, severity: 'medium' as const },
    { pattern: /503|502|504/i, retryDelay: 10000, severity: 'medium' as const },
    { pattern: /network error|connection error/i, retryDelay: 5000, severity: 'medium' as const },
    { pattern: /socket hang up/i, retryDelay: 3000, severity: 'medium' as const }
  ];

  // Rate limit errors (transient but need longer delays)
  private static RATE_LIMIT_PATTERNS = [
    { pattern: /rate limit/i, retryDelay: 60000, severity: 'high' as const },
    { pattern: /429/i, retryDelay: 60000, severity: 'high' as const },
    { pattern: /quota exceeded/i, retryDelay: 300000, severity: 'critical' as const },
    { pattern: /too many requests/i, retryDelay: 60000, severity: 'high' as const }
  ];

  // Auth/permission errors (configuration - user must fix)
  private static AUTH_PATTERNS = [
    { pattern: /401|unauthorized/i, severity: 'critical' as const },
    { pattern: /403|forbidden/i, severity: 'critical' as const },
    { pattern: /invalid.*token/i, severity: 'critical' as const },
    { pattern: /token expired/i, severity: 'critical' as const },
    { pattern: /access denied/i, severity: 'critical' as const },
    { pattern: /authentication failed/i, severity: 'critical' as const },
    { pattern: /permission denied/i, severity: 'critical' as const }
  ];

  // Invalid parameter errors (configuration - user must fix)
  private static PARAM_PATTERNS = [
    { pattern: /not found/i, category: 'execution_error' as FailureCategory, severity: 'high' as const },
    { pattern: /invalid.*parameter/i, category: 'execution_error' as FailureCategory, severity: 'high' as const },
    { pattern: /unable to parse/i, category: 'execution_error' as FailureCategory, severity: 'high' as const },
    { pattern: /range.*not found/i, category: 'execution_error' as FailureCategory, severity: 'high' as const },
    { pattern: /spreadsheet.*not found/i, category: 'execution_error' as FailureCategory, severity: 'high' as const },
    { pattern: /column.*not found/i, category: 'execution_error' as FailureCategory, severity: 'high' as const },
    { pattern: /file.*not found/i, category: 'execution_error' as FailureCategory, severity: 'high' as const },
    { pattern: /folder.*not found/i, category: 'execution_error' as FailureCategory, severity: 'high' as const }
  ];

  // Data shape mismatches (auto-repairable)
  private static DATA_SHAPE_PATTERNS = [
    { pattern: /expected array.*got object/i, category: 'data_shape_mismatch' as FailureCategory },
    { pattern: /expected object.*got array/i, category: 'data_shape_mismatch' as FailureCategory },
    { pattern: /cannot read property.*of undefined/i, category: 'data_shape_mismatch' as FailureCategory },
    { pattern: /cannot read properties of undefined/i, category: 'data_shape_mismatch' as FailureCategory },
    { pattern: /undefined is not an object/i, category: 'data_shape_mismatch' as FailureCategory },
    { pattern: /cannot iterate over/i, category: 'data_shape_mismatch' as FailureCategory }
  ];

  /**
   * Classify an error with context
   */
  classify(
    error: ErrorInput,
    context?: StepFailureContext
  ): FailureClassification {
    const errorMsg = this.extractErrorMessage(error);
    const statusCode = this.extractStatusCode(error);

    logger.debug({
      errorMsg,
      statusCode,
      stepId: context?.stepId
    }, 'Classifying error');

    // Priority order:
    // 1. Rate limits (specific retry delays)
    for (const { pattern, retryDelay, severity } of FailureClassifier.RATE_LIMIT_PATTERNS) {
      if (pattern.test(errorMsg) || (statusCode === 429)) {
        logger.info({
          pattern: pattern.source,
          retryDelay,
          stepId: context?.stepId
        }, 'Classified as rate limit error');

        return {
          category: 'execution_error',
          sub_type: 'retryable',
          is_auto_retryable: true,
          severity
        };
      }
    }

    // 2. Transient network errors
    for (const { pattern, retryDelay, severity } of FailureClassifier.TRANSIENT_PATTERNS) {
      if (pattern.test(errorMsg)) {
        logger.info({
          pattern: pattern.source,
          retryDelay,
          stepId: context?.stepId
        }, 'Classified as transient network error');

        return {
          category: 'execution_error',
          sub_type: 'retryable',
          is_auto_retryable: true,
          severity
        };
      }
    }

    // 3. Auth errors (user must reconnect plugin)
    for (const { pattern, severity } of FailureClassifier.AUTH_PATTERNS) {
      if (pattern.test(errorMsg) || statusCode === 401 || statusCode === 403) {
        logger.warn({
          pattern: pattern.source,
          stepId: context?.stepId
        }, 'Classified as authentication error');

        return {
          category: 'execution_error',
          sub_type: 'auth',
          is_auto_retryable: false,
          severity
        };
      }
    }

    // 4. Data shape mismatches (auto-repairable via RepairEngine)
    for (const { pattern, category } of FailureClassifier.DATA_SHAPE_PATTERNS) {
      if (pattern.test(errorMsg)) {
        logger.info({
          pattern: pattern.source,
          stepId: context?.stepId
        }, 'Classified as data shape mismatch');

        return {
          category,
          sub_type: 'data_structure',
          is_auto_retryable: false, // Requires repair, not simple retry
          severity: 'medium'
        };
      }
    }

    // 5. Invalid parameters (user must fix config)
    for (const { pattern, category, severity } of FailureClassifier.PARAM_PATTERNS) {
      if (pattern.test(errorMsg) || statusCode === 404) {
        logger.warn({
          pattern: pattern.source,
          stepId: context?.stepId
        }, 'Classified as parameter error');

        return {
          category,
          sub_type: 'api_error',
          is_auto_retryable: false,
          severity
        };
      }
    }

    // 6. Check for missing variable references
    if (context && this.isMissingVariableError(errorMsg, context)) {
      logger.warn({
        stepId: context.stepId,
        errorMsg
      }, 'Classified as missing variable');

      return {
        category: 'data_unavailable',
        sub_type: 'missing_variable',
        is_auto_retryable: false,
        severity: 'high'
      };
    }

    // 7. Check for invalid step order (dependency not met)
    if (context && this.isStepOrderError(errorMsg, context)) {
      logger.warn({
        stepId: context.stepId,
        errorMsg
      }, 'Classified as invalid step order');

      return {
        category: 'invalid_step_order',
        sub_type: 'dependency_not_met',
        is_auto_retryable: false,
        severity: 'critical'
      };
    }

    // Default: permanent execution error (stop execution)
    logger.warn({
      errorMsg,
      statusCode,
      stepId: context?.stepId
    }, 'Classified as permanent error (unrecognized pattern)');

    return {
      category: 'execution_error',
      sub_type: 'unknown',
      is_auto_retryable: false,
      severity: 'high'
    };
  }

  /**
   * Extract error message from various error formats
   */
  private extractErrorMessage(error: ErrorInput | Error | string): string {
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    if ('message' in error) return error.message;
    return JSON.stringify(error);
  }

  /**
   * Extract HTTP status code from error
   */
  private extractStatusCode(error: ErrorInput | any): number | null {
    if ('status' in error) return error.status;
    if ('statusCode' in error) return error.statusCode;

    // Check if status code is embedded in message
    const statusMatch = error.message?.match(/\b(4\d{2}|5\d{2})\b/);
    if (statusMatch) {
      return parseInt(statusMatch[1], 10);
    }

    return null;
  }

  /**
   * Check if error is due to missing variable reference
   */
  private isMissingVariableError(errorMsg: string, context: StepFailureContext): boolean {
    // Look for variable reference patterns like {{variable_name}}
    const variablePattern = /\{\{([^}]+)\}\}/g;
    const matches = errorMsg.matchAll(variablePattern);

    for (const match of matches) {
      const varName = match[1];
      // Check if this variable exists in available variables
      if (!context.availableVariableKeys.includes(varName)) {
        logger.debug({
          missingVar: varName,
          availableVars: context.availableVariableKeys
        }, 'Detected missing variable reference');
        return true;
      }
    }

    // Also check for common missing variable error messages
    if (/variable.*not found|undefined variable|missing variable/i.test(errorMsg)) {
      return true;
    }

    return false;
  }

  /**
   * Check if error is due to invalid step execution order
   */
  private isStepOrderError(errorMsg: string, context: StepFailureContext): boolean {
    // Check for dependency-related error messages
    const dependencyPatterns = [
      /depends on|dependency|prerequisite/i,
      /must run before|run after/i,
      /step.*not completed/i
    ];

    for (const pattern of dependencyPatterns) {
      if (pattern.test(errorMsg)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Determine if an error is retryable based on classification
   */
  isRetryable(classification: FailureClassification): boolean {
    return classification.is_auto_retryable;
  }

  /**
   * Get suggested retry delay in milliseconds
   */
  getRetryDelay(classification: FailureClassification, errorMsg: string): number {
    if (!classification.is_auto_retryable) {
      return 0;
    }

    // Check rate limits (longer delay)
    for (const { pattern, retryDelay } of FailureClassifier.RATE_LIMIT_PATTERNS) {
      if (pattern.test(errorMsg)) {
        return retryDelay;
      }
    }

    // Check transient errors (shorter delay)
    for (const { pattern, retryDelay } of FailureClassifier.TRANSIENT_PATTERNS) {
      if (pattern.test(errorMsg)) {
        return retryDelay;
      }
    }

    // Default retry delay for retryable errors
    return 5000; // 5 seconds
  }
}
