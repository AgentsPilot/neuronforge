// lib/server/base-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { ExecutionResult } from '@/lib/types/plugin-types';
import { createLogger } from '@/lib/logger';
import { applyParamConstraintGuard } from './param-constraint-guard';
import { AccessStrategyResolver } from './access-strategy';

export abstract class BasePluginExecutor {
  protected userConnections: UserPluginConnections;
  protected pluginManager: PluginManagerV2;
  protected accessResolver: AccessStrategyResolver;
  protected debug = process.env.NODE_ENV === 'development';
  protected pluginName: string;
  protected logger: ReturnType<typeof createLogger>;

  constructor(pluginName: string, userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    this.pluginName = pluginName;
    this.userConnections = userConnections;
    this.pluginManager = pluginManager;
    this.accessResolver = new AccessStrategyResolver(userConnections);
    this.logger = createLogger({ module: 'PluginExecutor' }).child({ plugin: pluginName });
  }

  // Template method - implements common execution flow
  async executeAction(userId: string, actionName: string, parameters: any): Promise<ExecutionResult> {
    this.logger.info({ userId, actionName }, 'Executing plugin action');

    try {
      // Step 0: Normalize parameters before validation
      // Config values may resolve as strings when the schema expects arrays.
      // E.g., add_labels: "AgentsPilot" should become ["AgentsPilot"]
      const pluginDef = this.pluginManager.getPluginDefinition(this.pluginName);
      const actionDef = pluginDef?.actions?.[actionName];
      if (actionDef?.parameters?.properties) {
        for (const [key, schema] of Object.entries(actionDef.parameters.properties) as [string, any][]) {
          if (schema.type === 'array' && key in parameters && typeof parameters[key] === 'string') {
            parameters[key] = [parameters[key]];
            this.logger.debug({ param: key, value: parameters[key] }, 'Normalized string → array for schema compliance');
          }
        }
      }

      // Step 0b: Runtime param-constraint guard (Item 4).
      // Right before validation and the external call, clamp out-of-range numerics
      // and fall back invalid enums to THIS action's own declared bounds — so a bad
      // generated value (e.g. max_results:500 vs the plugin's maximum:100) self-heals
      // instead of blocking the run. Generic, schema-driven, never throws, never
      // blocks; clamping here means both validation and the plugin see the safe value.
      if (actionDef?.parameters) {
        const guarded = applyParamConstraintGuard(
          actionDef.parameters,
          parameters,
          { pluginName: this.pluginName, actionName },
          this.logger,
        );
        parameters = guarded.params;
      }

      // Step 1: Validate parameters against plugin schema
      const validation = this.pluginManager.validateActionParameters(this.pluginName, actionName, parameters);

      if (validation.blocked) {
        return {
          success: false,
          error: validation.block_reason,
          message: validation.block_reason
        };
      }

      if (validation.confirmations_required.length > 0) {
        this.logger.debug({
          confirmations: validation.confirmations_required
        }, 'Confirmations required (would be handled via UI)');
        // In production, confirmations would be handled via UI
      }

      if (!validation.valid) {
        return {
          success: false,
          error: 'Parameter validation failed',
          message: validation.errors.join(', ')
        };
      }
      
      // Step 2: Resolve access / eligibility strategy — the SINGLE source of the connection
      // for every strategy (oauth / platform_key / db_active). This supersedes the old
      // `getConnection` + `isSystem` short-circuit: the resolver returns the (real or virtual)
      // connection when eligible, and a fail-closed denial otherwise. A denied strategy — e.g.
      // a `db_active` internal plugin for a non-tenant — MUST block here and never reach
      // executeSpecificAction (which for internal plugins would otherwise receive a null
      // connection and lose tenant scoping).
      const pluginDefinition = this.pluginManager.getPluginDefinition(this.pluginName);
      if (!pluginDefinition) {
        return {
          success: false,
          error: 'plugin_not_found',
          message: `Plugin ${this.pluginName} definition not found.`
        };
      }

      const resolution = await this.accessResolver.resolve(userId, this.pluginName, {
        authConfig: pluginDefinition.plugin.auth_config,
        accessStrategy: pluginDefinition.plugin.access_strategy,
      });

      if (!resolution.eligible) {
        // Strategy-specific error contract: oauth → 'auth_failed' (byte-identical to the prior
        // behavior), db_active → 'access_denied'. Not collapsed to one generic code.
        this.logger.info(
          { userId, strategy: resolution.strategy, reason: resolution.reason },
          'Plugin access denied'
        );
        return {
          success: false,
          error: resolution.errorCode || 'access_denied',
          message: resolution.message || 'Access denied.'
        };
      }

      const connection = resolution.connection;

      // Step 3: Execute the specific action (implemented by subclass)
      const result = await this.executeSpecificAction(connection, actionName, parameters);

      // Step 4: Format success response using output guidance
      const outputGuidance = this.pluginManager.getOutputGuidance(this.pluginName, actionName);
      const successMessage = this.formatSuccessMessage(
        outputGuidance?.success_description || 'Action completed',
        result,
        parameters
      );

      return {
        success: true,
        data: result,
        message: successMessage
      };

    } catch (error: any) {
      this.logger.error({ err: error, actionName }, 'Plugin action execution failed');

      // Map error to user-friendly message
      const errorMessage = this.mapErrorToMessage(actionName, error);

      return {
        success: false,
        error: error.code || 'execution_error',
        message: errorMessage
      };
    }
  }

  // Abstract method - subclasses must implement this to execute plugin-specific actions
  protected abstract executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any>;

  // Common utility: Format success message with variable substitution
  protected formatSuccessMessage(template: string, result: any, parameters: any): string {
    let message = template;
    
    // Replace common variables
    message = message.replace(/{recipient_count}/g, result.recipient_count?.toString() || '0');
    message = message.replace(/{email_count}/g, result.total_found?.toString() || '0');
    message = message.replace(/{message_count}/g, result.message_count?.toString() || '0');
    message = message.replace(/{total_recipients}/g, this.countRecipients(parameters.recipients).toString());
    message = message.replace(/{max_results}/g, parameters.max_results?.toString() || '10');
    message = message.replace(/{message_id}/g, result.message_id || '');
    message = message.replace(/{draft_id}/g, result.draft_id || '');
    message = message.replace(/{channel_id}/g, result.channel_id || '');
    message = message.replace(/{thread_id}/g, result.thread_id || '');
    
    return message;
  }

  // Common utility: Map execution errors to user-friendly messages
  protected mapErrorToMessage(actionName: string, error: any): string {
    const outputGuidance = this.pluginManager.getOutputGuidance(this.pluginName, actionName);
    const commonErrors = outputGuidance?.common_errors || {};
    
    // First, let subclass handle plugin-specific errors
    const pluginSpecificError = this.mapPluginSpecificError(error, commonErrors);
    if (pluginSpecificError) {
        return pluginSpecificError;
    }

    /*
     * ───────────────────────────────────────────────────────────────────────────
     * THE STATUS, NOT A SUBSTRING OF THE SENTENCE.
     *
     * These were `error.message?.includes('401')`, and a plain substring test on
     * a free-text message is a liar. An executor builds its errors as
     * `Gmail API error: ${status} - ${body}`, so the body travels inside the
     * message — and a body mentioning 401 anywhere, a message id, a byte count,
     * a timestamp, a quoted subject line, makes an unrelated failure report
     * itself as an expired connection.
     *
     * That is not hypothetical. An owner spent a day being told
     *
     *   Your Gmail connection has expired. Please reconnect in Settings →
     *   Connected Apps.
     *
     * about an agent whose Gmail connection was healthy the whole time — the
     * refresh token was good, and ANOTHER agent was reading the same mailbox
     * successfully on the same account. The message sent us hunting an OAuth
     * problem that did not exist, which is worse than no message: a wrong
     * cause is acted on, and the owner is told to reconnect something that
     * works.
     *
     * `400` was the worst of them. It matched `includes('invalid')` too, so any
     * message containing the word "invalid" — "invalid date", "invalid
     * spreadsheet range" — became "Invalid request parameters."
     *
     * So the status is read from where a status actually lives: a `status` or
     * `statusCode` field if the thrower set one, else the `NNN` that this
     * codebase's own `… API error: NNN - …` convention puts in a known place.
     * A number found loose in prose is not a status and no longer pretends to
     * be one.
     * ───────────────────────────────────────────────────────────────────────────
     */
    const status = this.httpStatusOf(error);

    if (status === 401 || /\bunauthorized\b/i.test(error.message ?? '')) {
      return commonErrors.auth_failed || 'Authentication failed. Please reconnect this plugin.';
    }

    if (status === 403) {
      return commonErrors.quota_exceeded || 'Rate limit exceeded. Please try again later.';
    }

    if (status === 429) {
      return commonErrors.api_rate_limit || 'Too many requests. Please wait a moment and try again.';
    }

    if (status === 404) {
      return commonErrors.not_found || 'Resource not found.';
    }

    if (status === 400) {
      return commonErrors.invalid_recipient || commonErrors.invalid_request || 'Invalid request parameters.';
    }
    
    // Default error message
    return `${this.pluginName} ${actionName} failed: ${error.message || 'Unknown error'}`;
  }

  /**
   * The HTTP status an error actually carries, or null.
   *
   * Looked for in three places, narrowest first: an explicit numeric field set
   * by whoever threw, and then the `NNN` immediately after this codebase's own
   * `… API error: ` / `… failed: ` prefix, which every executor here builds the
   * same way. Nothing else counts — a number loose in prose is prose.
   */
  private httpStatusOf(error: any): number | null {
    const explicit = error?.status ?? error?.statusCode ?? error?.response?.status;
    if (typeof explicit === 'number' && explicit >= 100 && explicit < 600) return explicit;

    const message = typeof error?.message === 'string' ? error.message : '';
    const framed = message.match(/(?:API error|failed):\s*(\d{3})\b/i);
    if (framed) {
      const code = Number(framed[1]);
      if (code >= 100 && code < 600) return code;
    }

    return null;
  }

  // Hook method for plugin-specific error handling
  protected mapPluginSpecificError(error: any, commonErrors: Record<string, string>): string | null {
    // Default implementation returns null (no plugin-specific handling)
    // Subclasses can override to check for provider-specific error codes
    return null;
  }
  
  // Common utility: Count recipients in email parameters.
  // WP-42: when a recipients field is a single-email string (LLM emission style),
  // count it as one recipient — previously `.length` on the string returned the
  // character count, inflating `total_recipients` (e.g., "user@x.com" → 10).
  protected countRecipients(recipients: any): number {
    if (!recipients) return 0;
    // Recursively count actual addresses. Flattens nested arrays (e.g. [["a@b.com"]]
    // that arise when an array-typed input is wrapped in a DSL array literal) and
    // splits comma-separated strings — a flat `v.length` undercounts a nested list
    // (counting the inner array as 1), which both misreports recipient_count AND can
    // bypass the total_recipients >10/>50 safety guards. See RUNTIME_RCA for the email
    // recipient-nesting bug (agent bb821b6b, 2026-07-05).
    const countField = (v: unknown): number => {
      if (Array.isArray(v)) return v.reduce((n: number, e) => n + countField(e), 0);
      if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean).length;
      return 0;
    };
    return countField(recipients.to) + countField(recipients.cc) + countField(recipients.bcc);
  }

  /**
   * Phase 4 — calibration outbound-message marking.
   *
   * When an action runs during calibration, the StepExecutor injects a
   * `params._calibration = { isCalibration, round, redirectTo }` marker. Messaging
   * executors (email/Slack/etc.) call this to get ready-to-prepend banners so the
   * recipient can tell the message came from a calibration test run and which
   * round, and `redirectTo` (the owner's address) so they can send the test to
   * the owner instead of the real (possibly third-party) recipients.
   *
   * Returns `isCalibration: false` (and empty strings) outside calibration, so
   * callers can prepend unconditionally without branching.
   */
  protected getCalibrationNotice(parameters: any): {
    isCalibration: boolean;
    subjectPrefix: string;
    htmlBanner: string;
    textBanner: string;
    redirectTo?: string;
    /**
     * True when the calibration run is degraded (an earlier step failed). A
     * messaging executor should SKIP the real send rather than deliver an
     * empty/placeholder message. Opt-in — same contract as redirectTo.
     */
    suppressSend?: boolean;
  } {
    const cal = parameters?._calibration;
    if (!cal?.isCalibration) {
      return { isCalibration: false, subjectPrefix: '', htmlBanner: '', textBanner: '', suppressSend: false };
    }
    // Only show a round number from the 2nd send onward. A calibration that
    // produces a single message needs no "round 1" noise; the number appears
    // once there's actually more than one (round 2, 3, …) to disambiguate.
    const round = typeof cal.round === 'number' ? cal.round : undefined;
    const showRound = round !== undefined && round >= 2;
    const roundSuffix = showRound ? ` · round ${round}` : '';
    const roundParen = showRound ? ` (round ${round})` : '';
    const sentence = `⚙️ This message was generated by a calibration test run${roundParen}, not a live run.`;
    const redirectTo = typeof cal.redirectTo === 'string' && cal.redirectTo.length > 0 ? cal.redirectTo : undefined;
    return {
      isCalibration: true,
      subjectPrefix: `[Calibration test${roundSuffix}] `,
      htmlBanner: `<div style="background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;padding:10px 14px;border-radius:8px;margin-bottom:14px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:13px;">${sentence}</div>`,
      textBanner: `${sentence}\n\n`,
      redirectTo,
      suppressSend: cal.suppressSend === true,
    };
  }

  // Common utility: Get connection status
  async getConnectionStatus(userId: string): Promise<any> {
    this.logger.debug({ userId }, 'Getting connection status');

    return await this.userConnections.getConnectionStatus(userId, this.pluginName);
  }

  // Common utility: Test connection with a simple API call
  async testConnection(userId: string): Promise<ExecutionResult> {
    this.logger.debug({ userId }, 'Testing connection');
    
    try {
      // Get plugin definition for auth config
      const pluginDefinition = this.pluginManager.getPluginDefinition(this.pluginName);
      if (!pluginDefinition) {
        return {
          success: false,
          error: 'plugin_not_found',
          message: `Plugin ${this.pluginName} definition not found.`
        };
      }

      // Route through the same access-strategy resolver as executeAction so non-OAuth
      // strategies (e.g. db_active internal plugins) are tested correctly. Previously this
      // called getConnection() directly, which for an internal `auth_type` returned null for
      // every user — misreporting valid tenants as "not connected".
      const resolution = await this.accessResolver.resolve(userId, this.pluginName, {
        authConfig: pluginDefinition.plugin.auth_config,
        accessStrategy: pluginDefinition.plugin.access_strategy,
      });
      if (!resolution.eligible || !resolution.connection) {
        return {
          success: false,
          error: resolution.errorCode || 'no_connection',
          message: resolution.message || `${this.pluginName} not connected. Please connect in Settings.`
        };
      }

      // Subclasses can override this to test with a specific API call
      const testResult = await this.performConnectionTest(resolution.connection);
      
      return {
        success: true,
        data: testResult,
        message: `${this.pluginName} connection active`
      };
    } catch (error: any) {
      return {
        success: false,
        error: 'connection_test_error',
        message: `Connection test error: ${error.message}`
      };
    }
  }

  // Optional method for subclasses to override with plugin-specific connection test
  protected async performConnectionTest(connection: any): Promise<any> {
    // Default implementation - subclasses can override
    return {
      status: 'connected',
      has_token: !!connection.access_token,
      expires_at: connection.expires_at
    };
  }

  // Common utility: Build authorization header
  protected buildAuthHeader(accessToken: string): Record<string, string> {
    return {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    };
  }

  // Common utility: Handle API response
  protected async handleApiResponse(response: Response, operationName: string): Promise<any> {
    if (!response.ok) {
      const errorData = await response.text();
      this.logger.error({
        operationName,
        status: response.status,
        errorData
      }, 'API operation failed');
      throw new Error(`${operationName} failed: ${response.status} - ${errorData}`);
    }

    // 204 No Content — nothing to parse
    if (response.status === 204) {
      return {};
    }

    // Read body as text first, then parse as JSON.
    // This avoids double body stream consumption (response.json() then response.text()
    // would fail in production since the body stream can only be read once).
    const bodyText = await response.text();
    try {
      return JSON.parse(bodyText);
    } catch (parseError) {
      this.logger.error({
        operationName,
        status: response.status,
        bodyPreview: bodyText.substring(0, 200),
      }, 'Failed to parse response as JSON');
      throw new Error(
        `${operationName} failed: expected JSON response but received unparseable body (status ${response.status})`
      );
    }
  }

  // Common utility: Validate required parameters
  protected validateRequiredParams(parameters: any, required: string[]): void {
    for (const field of required) {
      if (!parameters[field]) {
        throw new Error(`Missing required parameter: ${field}`);
      }
    }
  }

  // Common utility: Get plugin-specific API base URL (can be overridden)
  protected getApiBaseUrl(): string {
    // Subclasses should override this with their specific API base URL
    throw new Error('getApiBaseUrl must be implemented by subclass');
  }
}