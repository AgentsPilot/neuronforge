/**
 * FailureClassifier - Categorize step execution errors
 *
 * Pure function: takes an error + step context and returns a classification.
 * No database access, no side effects, no client data.
 *
 * 7 failure categories:
 * 1. execution_error    - Plugin failed, API error, timeout
 * 2. missing_step       - Workflow missing required step
 * 3. invalid_step_order - Dependencies not met
 * 4. capability_mismatch- Plugin can't do requested action
 * 5. logic_error        - Conditional logic broken
 * 6. data_shape_mismatch- Expected array, got object (or vice versa)
 * 7. data_unavailable   - Empty results, missing fields
 *
 * @module lib/pilot/shadow/FailureClassifier
 */

import type { FailureClassification, StepFailureContext } from './types';

export class FailureClassifier {
  /**
   * Classify a step failure into one of 7 categories.
   *
   * @param error - The error thrown or reported by the step
   * @param _stepContext - Metadata about the failed step (reserved for future sub-type detection)
   * @returns Classification with category, severity, and auto-retry flag
   */
  classify(
    error: { message: string; code?: string },
    _stepContext: StepFailureContext
  ): FailureClassification {
    const code = (error.code || '').toUpperCase();
    const msg = (error.message || '').toLowerCase();

    // --- 1. Data shape mismatch ---
    // These error codes are thrown by StepExecutor when input type is wrong
    if (this.isDataShapeMismatch(code, msg)) {
      return {
        category: 'data_shape_mismatch',
        sub_type: this.detectShapeMismatchSubType(code),
        severity: 'high',
        is_auto_retryable: false,
      };
    }

    // --- 2. Data unavailable ---
    if (this.isDataUnavailable(code, msg)) {
      return {
        category: 'data_unavailable',
        severity: 'medium',
        is_auto_retryable: false,
      };
    }

    // --- 3. Retryable execution errors (transient) ---
    if (this.isRetryableError(code, msg)) {
      return {
        category: 'execution_error',
        sub_type: 'retryable',
        severity: 'low',
        is_auto_retryable: true,
      };
    }

    // --- 4. Auth errors ---
    if (this.isAuthError(code, msg)) {
      return {
        category: 'execution_error',
        sub_type: 'auth',
        severity: 'critical',
        is_auto_retryable: false,
      };
    }

    // --- 5. Capability mismatch ---
    if (this.isCapabilityMismatch(code, msg)) {
      return {
        category: 'capability_mismatch',
        severity: 'high',
        is_auto_retryable: false,
      };
    }

    // --- 6. Invalid step order ---
    if (this.isInvalidStepOrder(code, msg)) {
      return {
        category: 'invalid_step_order',
        severity: 'high',
        is_auto_retryable: false,
      };
    }

    // --- 7. Missing step ---
    if (this.isMissingStep(code, msg)) {
      return {
        category: 'missing_step',
        severity: 'critical',
        is_auto_retryable: false,
      };
    }

    // --- 8. Logic error ---
    if (this.isLogicError(code, msg)) {
      return {
        category: 'logic_error',
        severity: 'medium',
        is_auto_retryable: false,
      };
    }

    // --- Default: execution error ---
    return {
      category: 'execution_error',
      sub_type: 'unknown',
      severity: 'medium',
      is_auto_retryable: false,
    };
  }

  // ---- Private detection methods ----

  private isDataShapeMismatch(code: string, msg: string): boolean {
    const shapeCodes = [
      'INVALID_INPUT_TYPE',
      'INVALID_TRANSFORM_INPUT',
      'INVALID_SCATTER_INPUT',
      'INVALID_ITERATE_OVER',
    ];
    if (shapeCodes.includes(code)) return true;

    // Message-based detection
    if (msg.includes('expected array') || msg.includes('expected object')) return true;
    if (msg.includes('requires array input') || msg.includes('requires object input')) return true;
    if (msg.includes('but received object') || msg.includes('but received array')) return true;
    if (msg.includes('not an array') || msg.includes('not an object')) return true;

    return false;
  }

  private detectShapeMismatchSubType(code: string): string {
    switch (code) {
      case 'INVALID_TRANSFORM_INPUT': return 'transform_input';
      case 'INVALID_SCATTER_INPUT': return 'scatter_input';
      case 'INVALID_ITERATE_OVER': return 'iterate_input';
      default: return 'generic';
    }
  }

  private isDataUnavailable(code: string, msg: string): boolean {
    if (code === 'MISSING_INPUT_DATA' || code === 'NO_DATA') return true;
    if (msg.includes('no input data')) return true;
    if (msg.includes('empty result') || msg.includes('no results')) return true;
    if (msg.includes('missing required field') || msg.includes('field not found')) return true;
    if (msg.includes('no data available') || msg.includes('data not found')) return true;
    return false;
  }

  private isRetryableError(code: string, msg: string): boolean {
    const retryableCodes = [
      '429', '503', '504',
      'TIMEOUT', 'RATE_LIMIT', 'RATE_LIMITED',
      'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
      'NETWORK_ERROR', 'SERVICE_UNAVAILABLE',
    ];
    if (retryableCodes.includes(code)) return true;
    if (msg.includes('rate limit') || msg.includes('too many requests')) return true;
    if (msg.includes('timeout') || msg.includes('timed out')) return true;
    if (msg.includes('temporarily unavailable') || msg.includes('service unavailable')) return true;
    return false;
  }

  /**
   * Determine if an error is an authentication error vs configuration error.
   *
   * Based on HTTP/OAuth industry standards:
   * - 401 = Authentication failure (invalid/missing credentials)
   * - 403 = Authorization failure (valid auth, insufficient permissions)
   *
   * Key insight: 403 errors can be EITHER:
   * - Auth errors (missing OAuth scopes, requires Partner Program)
   * - Config errors (wrong resource ID - "spreadsheet '123' not found")
   *
   * This method uses universal patterns that work for ANY API plugin (thousands of APIs).
   *
   * @see https://auth0.com/blog/forbidden-unauthorized-http-status-codes/
   * @see https://developers.google.com/nest/device-access/reference/errors/authorization
   */
  private isAuthError(code: string, msg: string): boolean {
    const msgLower = msg.toLowerCase();

    // ============================================
    // PATTERN 1: HTTP 401 = ALWAYS AUTH ERROR
    // ============================================
    // Industry standard: 401 means invalid/missing credentials
    // No ambiguity - ALWAYS an authentication failure
    const authCodes = ['401', 'UNAUTHORIZED', 'AUTH_ERROR'];
    if (authCodes.includes(code)) {
      return true; // Auth error - requires re-authentication
    }

    // ============================================
    // PATTERN 2: QUOTED VALUES = CONFIG ERROR
    // ============================================
    // Universal pattern: Error messages quote user-provided values
    // Examples: "spreadsheet \"123\"", "channel 'general'", "range `UrgentEmails`"
    // Matches: "value", 'value', or `value` (all JSON quote styles)
    const hasQuotedValue = /["'`][^"'`]+["'`]/.test(msg);

    // If error has quoted value, it's about a specific resource = config error
    // This works for ALL APIs (Slack, Google, HubSpot, Airtable, Stripe, etc.)
    if (hasQuotedValue) {
      // Exception: If it's also asking to reconnect, auth takes precedence
      if (!msgLower.includes('reconnect')) {
        return false; // Configuration error (wrong resource ID/name)
      }
    }

    // ============================================
    // PATTERN 3: "RECONNECT" = AUTH/CONNECTION ERROR
    // ============================================
    // Universal UX pattern: "Please reconnect" indicates auth lost
    // Examples: "Please reconnect WhatsApp", "Please reconnect Google"
    if (msgLower.includes('reconnect')) {
      return true; // Auth error - connection/token expired
    }

    // ============================================
    // PATTERN 4: OAUTH/CREDENTIAL KEYWORDS = AUTH ERROR
    // ============================================
    // OAuth 2.0 standard error keywords
    // @see https://www.oauth.com/oauth2-servers/access-tokens/access-token-response/

    // Token errors (OAuth spec)
    if (msgLower.includes('invalid token') || msgLower.includes('invalid_token')) return true;
    if (msgLower.includes('expired token') || msgLower.includes('expired_token')) return true;
    if (msgLower.includes('invalid oauth') || msgLower.includes('invalid access token')) return true;

    // Credential errors
    if (msgLower.includes('unauthorized') || msgLower.includes('authentication failed')) return true;
    if (msgLower.includes('invalid credentials') || msgLower.includes('authentication required')) return true;
    if (msgLower.includes('invalid api key') || msgLower.includes('missing api key')) return true;

    // ============================================
    // PATTERN 5: SCOPE/PERMISSION CONTEXT CHECK
    // ============================================

    // Service-level permission issues (auth errors)
    // These require app/account configuration changes
    if (msgLower.includes('partner program')) return true; // LinkedIn Partner Program
    if (msgLower.includes('administrator access required')) return true; // LinkedIn admin
    if (msgLower.includes('missing scopes')) return true; // OAuth scopes
    if (msgLower.includes('insufficient permissions') && !hasQuotedValue) return true; // Generic permission

    // 403/FORBIDDEN handling
    // Generic 403 without quoted value = likely auth/scope issue
    // 403 with quoted value already handled above (config error)
    if (code === '403' || code === 'FORBIDDEN') {
      // At this point, no quoted value was found
      // Generic 403 = insufficient scopes/permissions = auth error
      return true;
    }

    // Generic "permission denied" or "access denied"
    // If no quoted value (already checked above), it's auth
    if (msgLower.includes('permission denied') || msgLower.includes('access denied')) {
      return true; // Auth error (generic permission issue)
    }

    // ============================================
    // DEFAULT: NOT AN AUTH ERROR
    // ============================================
    // If none of the auth patterns matched, it's likely a config/parameter error
    return false;
  }

  private isCapabilityMismatch(code: string, msg: string): boolean {
    if (code === 'UNSUPPORTED_ACTION' || code === 'CAPABILITY_MISMATCH') return true;
    if (msg.includes('does not support') || msg.includes('not supported')) return true;
    if (msg.includes('unsupported action') || msg.includes('unsupported operation')) return true;
    if (msg.includes('action not available') || msg.includes('operation not available')) return true;
    return false;
  }

  private isInvalidStepOrder(code: string, msg: string): boolean {
    if (code === 'DEPENDENCY_NOT_MET' || code === 'INVALID_STEP_ORDER') return true;
    if (msg.includes('depends on') && msg.includes('not been executed')) return true;
    if (msg.includes('dependencies not met')) return true;
    if (msg.includes('prerequisite step') || msg.includes('required step not completed')) return true;
    return false;
  }

  private isMissingStep(code: string, msg: string): boolean {
    if (code === 'MISSING_STEP' || code === 'STEP_NOT_FOUND') return true;
    if (msg.includes('missing required step')) return true;
    if (msg.includes('step not found') || msg.includes('referenced step missing')) return true;
    return false;
  }

  private isLogicError(code: string, msg: string): boolean {
    if (code === 'CONDITION_EVALUATION_ERROR' || code === 'LOGIC_ERROR') return true;
    if (msg.includes('condition evaluation') || msg.includes('conditional logic')) return true;
    if (msg.includes('condition failed') || msg.includes('invalid condition')) return true;
    return false;
  }
}
