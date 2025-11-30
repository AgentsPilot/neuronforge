// lib/server/base-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { ExecutionResult } from '@/lib/types/plugin-types';
import { createLogger } from '@/lib/logger';

export abstract class BasePluginExecutor {
  protected userConnections: UserPluginConnections;
  protected pluginManager: PluginManagerV2;
  protected debug = process.env.NODE_ENV === 'development';
  protected pluginName: string;
  protected logger: ReturnType<typeof createLogger>;

  constructor(pluginName: string, userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    this.pluginName = pluginName;
    this.userConnections = userConnections;
    this.pluginManager = pluginManager;
    this.logger = createLogger({ module: 'PluginExecutor', plugin: pluginName });

    this.logger.debug('Plugin executor initialized');
  }

  // Template method - implements common execution flow
  async executeAction(userId: string, actionName: string, parameters: any): Promise<ExecutionResult> {
    this.logger.info({ userId, actionName }, 'Executing plugin action');

    try {
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
      
      // Step 2: Get user connection with auth config
      const pluginDefinition = this.pluginManager.getPluginDefinition(this.pluginName);
      if (!pluginDefinition) {
        return {
          success: false,
          error: 'plugin_not_found',
          message: `Plugin ${this.pluginName} definition not found.`
        };
      }

      const authConfig = pluginDefinition.plugin.auth_config;
      const connection = await this.userConnections.getConnection(userId, this.pluginName, authConfig);

      // For system plugins, connection will be a virtual connection
      // For OAuth plugins, connection must exist or we fail
      const isSystemPlugin = pluginDefinition.plugin.isSystem;

      if (!connection && !isSystemPlugin) {
        return {
          success: false,
          error: 'auth_failed',
          message: `${this.pluginName} connection not found or expired. Please reconnect in Settings.`
        };
      }

      // Step 3: Execute the specific action (implemented by subclass)
      const result = await this.executeSpecificAction(connection, actionName, parameters);

      // Step 4: Format success response using output guidance
      const outputGuidance = this.pluginManager.getOutputGuidance(this.pluginName, actionName);
      const successMessage = this.formatSuccessMessage(
        outputGuidance?.success_message || 'Action completed',
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

    // Check for common error patterns
    if (error.message?.includes('401') || error.message?.includes('unauthorized')) {
      return commonErrors.auth_failed || 'Authentication failed. Please reconnect this plugin.';
    }
    
    if (error.message?.includes('403') || error.message?.includes('quota')) {
      return commonErrors.quota_exceeded || 'Rate limit exceeded. Please try again later.';
    }
    
    if (error.message?.includes('400') || error.message?.includes('invalid')) {
      return commonErrors.invalid_recipient || commonErrors.invalid_request || 'Invalid request parameters.';
    }
    
    if (error.message?.includes('429')) {
      return commonErrors.api_rate_limit || 'Too many requests. Please wait a moment and try again.';
    }

    if (error.message?.includes('404')) {
      return commonErrors.not_found || 'Resource not found.';
    }
    
    // Default error message
    return `${this.pluginName} ${actionName} failed: ${error.message || 'Unknown error'}`;
  }

  // Hook method for plugin-specific error handling
  protected mapPluginSpecificError(error: any, commonErrors: Record<string, string>): string | null {
    // Default implementation returns null (no plugin-specific handling)
    // Subclasses can override to check for provider-specific error codes
    return null;
  }
  
  // Common utility: Count recipients in email parameters
  protected countRecipients(recipients: any): number {
    if (!recipients) return 0;
    
    const to = recipients.to?.length || 0;
    const cc = recipients.cc?.length || 0;
    const bcc = recipients.bcc?.length || 0;
    
    return to + cc + bcc;
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

      const authConfig = pluginDefinition.plugin.auth_config;
      const connection = await this.userConnections.getConnection(userId, this.pluginName, authConfig);
      if (!connection) {
        return {
          success: false,
          error: 'no_connection',
          message: `${this.pluginName} not connected. Please connect in Settings.`
        };
      }

      // Subclasses can override this to test with a specific API call
      const testResult = await this.performConnectionTest(connection);
      
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

    return await response.json();
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