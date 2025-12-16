// lib/client/plugin-api-client.ts

import { OAuthHandler } from './oauth-handler';
import { PluginInfo, UserPluginStatus, LLMContext, ExecutionResult, ApiResponse } from '@/lib/types/plugin-types'
import { requestDeduplicator } from '@/lib/utils/request-deduplication';
import { clientLogger } from '@/lib/logger/client';

export class PluginAPIClient {
  private baseUrl: string;
  private oauthHandler: OAuthHandler;

  constructor() {
    this.baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    this.oauthHandler = new OAuthHandler();
    clientLogger.debug('PluginAPIClient initialized');
  }

  // Get all available plugins
  async getAvailablePlugins(): Promise<PluginInfo[]> {
    clientLogger.debug('Getting available plugins');

    try {
      const response = await fetch(`${this.baseUrl}/api/plugins/available`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to get available plugins');
      }

      return result.plugins;
    } catch (error: any) {
      clientLogger.error('Error getting available plugins', error);
      throw error;
    }
  }

  // Get user's plugin status (connected vs disconnected)
  // userId is optional - if not provided, will use cookie-based authentication
  async getUserPluginStatus(userId?: string): Promise<UserPluginStatus> {
    // Create unique cache key based on userId
    const cacheKey = `plugin-status-${userId || 'current-user'}`;

    // Wrap the entire fetch operation in deduplication
    return requestDeduplicator.deduplicate(cacheKey, async () => {
      clientLogger.debug('Getting plugin status', { userId: userId || 'cookie-auth' });

      try {
        // Use cookie auth if userId not provided, otherwise use query param for backward compatibility
        const url = userId
          ? `${this.baseUrl}/api/plugins/user-status?userId=${userId}`
          : `${this.baseUrl}/api/plugins/user-status`;

        const response = await fetch(url);
        const result = await response.json();

        if (!result.success) {
          throw new Error(result.error || 'Failed to get user plugin status');
        }

        return {
          connected: result.connected,
          active_expired: result.active_expired || [],
          disconnected: result.disconnected,
          summary: result.summary
        };
      } catch (error: any) {
        clientLogger.error('Error getting user plugin status', error);
        throw error;
      }
    });
  }

  // Connect a plugin (initiate OAuth flow)
  async connectPlugin(
    userId: string,
    pluginKey: string,
    onAdditionalConfigRequired?: (pluginKey: string, pluginName: string, additionalConfig: any) => void
  ): Promise<{ success: boolean; data?: any; error?: string; requiresAdditionalConfig?: boolean }> {
    clientLogger.debug('Connecting plugin', { pluginKey, userId });

    try {
      // Get plugin auth configuration from server
      const authConfig = await this.getPluginAuthConfig(pluginKey);

      // Check if popups are blocked first
      const popupBlocked = await this.oauthHandler.testPopupBlocking();
      if (popupBlocked) {
        throw new Error('Popup blocked. Please allow popups for this site and try again.');
      }

      // Initiate OAuth flow
      const result = await this.oauthHandler.initiateOAuth(userId, pluginKey, authConfig);

      clientLogger.debug('Plugin connection result', { pluginKey, success: result.success });

      // If OAuth succeeded, check if plugin requires additional configuration
      if (result.success) {
        const pluginDefinition = await this.getPluginDefinition(pluginKey);
        const additionalConfig = (pluginDefinition as any)?.additional_config;

        if (additionalConfig?.enabled) {
          clientLogger.debug('Plugin requires additional configuration', { pluginKey });

          // Trigger callback if provided
          if (onAdditionalConfigRequired) {
            onAdditionalConfigRequired(pluginKey, pluginDefinition.name, additionalConfig);
          }

          return {
            ...result,
            requiresAdditionalConfig: true
          };
        }
      }

      return result;
    } catch (error: any) {
      clientLogger.error('Error connecting plugin', error, { pluginKey });
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Disconnect a plugin
  async disconnectPlugin(userId: string, pluginKey: string): Promise<{ success: boolean; message?: string; error?: string }> {
    clientLogger.debug('Disconnecting plugin', { pluginKey, userId });

    try {
      const response = await fetch(`${this.baseUrl}/api/plugins/disconnect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId,
          pluginKey
        })
      });

      const result = await response.json();

      clientLogger.debug('Disconnect result', { pluginKey, success: result.success });

      return result;
    } catch (error: any) {
      clientLogger.error('Error disconnecting plugin', error, { pluginKey });
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Execute a plugin action
  async executeAction(
    userId: string,
    pluginName: string,
    actionName: string,
    parameters: any
  ): Promise<ExecutionResult> {
    clientLogger.debug('Executing action', { pluginName, actionName, userId });

    try {
      const response = await fetch(`${this.baseUrl}/api/plugins/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId,
          pluginName,
          actionName,
          parameters
        })
      });

      const result = await response.json();

      clientLogger.debug('Execution result', {
        pluginName,
        actionName,
        success: result.success,
        hasData: !!result.data
      });

      return result;
    } catch (error: any) {
      clientLogger.error('Error executing action', error, { pluginName, actionName });
      return {
        success: false,
        error: error.message,
        message: `Failed to execute ${actionName}: ${error.message}`
      };
    }
  }

  // Get LLM context for user
  async getLLMContext(userId: string): Promise<LLMContext> {
    clientLogger.debug('Getting LLM context', { userId });

    try {
      const response = await fetch(`${this.baseUrl}/api/llm/context?userId=${userId}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to get LLM context');
      }

      return {
        connected_plugins: result.context.connected_plugins,
        available_plugins: result.context.available_plugins,
        summary: result.summary
      };
    } catch (error: any) {
      clientLogger.error('Error getting LLM context', error);
      throw error;
    }
  }

  // Get plugin actions (for testing/UI purposes)
  async getPluginActions(pluginName?: string): Promise<any> {
    clientLogger.debug('Getting plugin actions', { pluginName: pluginName || 'all' });

    try {
      const url = pluginName
        ? `${this.baseUrl}/api/plugins/execute?plugin=${pluginName}`
        : `${this.baseUrl}/api/plugins/execute`;

      const response = await fetch(url);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to get plugin actions');
      }

      return result;
    } catch (error: any) {
      clientLogger.error('Error getting plugin actions', error);
      throw error;
    }
  }

  // Utility method to check if a plugin is connected
  async isPluginConnected(userId: string, pluginKey: string): Promise<boolean> {
    try {
      const status = await this.getUserPluginStatus(userId);
      return status.connected.some(plugin => plugin.key === pluginKey);
    } catch (error) {
      clientLogger.error('Error checking plugin connection status', error as Error);
      return false;
    }
  }

  // Get connection status for a specific plugin
  async getPluginConnectionStatus(userId: string, pluginKey: string): Promise<any> {
    clientLogger.debug('Getting connection status', { pluginKey });

    try {
      const response = await fetch(`${this.baseUrl}/api/plugins/disconnect?userId=${userId}&pluginKey=${pluginKey}`);
      const result = await response.json();

      return result;
    } catch (error: any) {
      clientLogger.error('Error getting plugin connection status', error);
      throw error;
    }
  }

  // Get plugin definition from server
  async getPluginDefinition(pluginKey: string): Promise<any> {
    const availablePlugins = await this.getAvailablePlugins();
    const plugin = availablePlugins.find(p => p.key === pluginKey);

    if (!plugin) {
      throw new Error(`Plugin ${pluginKey} not found`);
    }

    return plugin;
  }

  // Get plugin auth configuration from server
  private async getPluginAuthConfig(pluginKey: string): Promise<any> {
    // Get plugin definition which includes processed auth_config
    const plugin = await this.getPluginDefinition(pluginKey);

    // The auth_config should be included in the plugin definition from server
    return plugin.auth_config;
  }

  // Batch operations
  async getMultiplePluginStatuses(userId: string, pluginKeys: string[]): Promise<Record<string, any>> {
    const statuses: Record<string, any> = {};
    
    // For now, make individual requests
    // In production, you might want a batch endpoint
    for (const pluginKey of pluginKeys) {
      try {
        statuses[pluginKey] = await this.getPluginConnectionStatus(userId, pluginKey);
      } catch (error: any) {
        statuses[pluginKey] = { error: error.message };
      }
    }
    
    return statuses;
  }

  // Test all connections for a user
  async testAllConnections(userId: string): Promise<Record<string, boolean>> {
    try {
      const status = await this.getUserPluginStatus(userId);
      const results: Record<string, boolean> = {};

      for (const plugin of status.connected) {
        results[plugin.key] = true; // Connected plugins are assumed working
      }

      for (const plugin of status.disconnected) {
        results[plugin.key] = false; // Disconnected plugins are not working
      }

      return results;
    } catch (error) {
      clientLogger.error('Error testing connections', error as Error);
      return {};
    }
  }
}

let clientInstance: PluginAPIClient | null = null;

export function getPluginAPIClient(): PluginAPIClient {
  if (!clientInstance) {
    clientInstance = new PluginAPIClient();
  }
  return clientInstance;
}