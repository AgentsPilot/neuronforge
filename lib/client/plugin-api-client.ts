// lib/client/plugin-api-client.ts

import { OAuthHandler } from './oauth-handler';
import { PluginInfo, UserPluginStatus, LLMContext, ExecutionResult, ApiResponse } from '@/lib/types/plugin-types'
import { requestDeduplicator } from '@/lib/utils/request-deduplication';
import { clientLogger } from '@/lib/logger/client';

export class PluginAPIClient {
  private baseUrl: string;
  private oauthHandler: OAuthHandler;

  constructor() {
    // In the browser, always use relative URLs. These routes authenticate from the
    // session cookie, and fetch() defaults to credentials:'same-origin' — so if
    // NEXT_PUBLIC_APP_URL ever differs from the browsing origin (preview deploys, the
    // *.agentpilot.io subdomain rewrite in middleware.ts), an absolute URL silently
    // drops the cookies and every call 401s.
    this.baseUrl = typeof window !== 'undefined' ? '' : (process.env.NEXT_PUBLIC_APP_URL || '');
    this.oauthHandler = new OAuthHandler();
    clientLogger.debug('PluginAPIClient initialized');
  }

  // Get all available plugins
  async getAvailablePlugins(options?: { includeBusinessOs?: boolean }): Promise<PluginInfo[]> {
    clientLogger.debug('Getting available plugins');

    try {
      // Business-OS-only plugins are hidden by default; internal surfaces (e.g. the plugin
      // test page) opt in. See docs/PLUGIN_VISIBILITY_SCOPING.md.
      const qs = options?.includeBusinessOs ? '?includeBusinessOs=true' : '';
      const response = await fetch(`${this.baseUrl}/api/plugins/available${qs}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to get available plugins');
      }

      return result.plugins;
    } catch (error: any) {
      clientLogger.error({ err: error }, 'Error getting available plugins');
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
      clientLogger.debug({ userId: userId || 'cookie-auth' }, 'Getting plugin status');

      try {
        // Use cookie auth if userId not provided, otherwise use query param for backward compatibility
        const url = userId
          ? `${this.baseUrl}/api/plugins/user-status?userId=${userId}`
          : `${this.baseUrl}/api/plugins/user-status`;

        const response = await fetch(url, { cache: 'no-store' });
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
        clientLogger.error({ err: error }, 'Error getting user plugin status');
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
    clientLogger.debug({ pluginKey, userId }, 'Connecting plugin');

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

      clientLogger.debug({ pluginKey, success: result.success }, 'Plugin connection result');

      // If OAuth succeeded, check if plugin requires additional configuration
      if (result.success) {
        const pluginDefinition = await this.getPluginDefinition(pluginKey);
        const additionalConfig = (pluginDefinition as any)?.additional_config;

        if (additionalConfig?.enabled) {
          clientLogger.debug({ pluginKey }, 'Plugin requires additional configuration');

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
      clientLogger.error({ err: error, pluginKey }, 'Error connecting plugin');
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Disconnect a plugin
  async disconnectPlugin(userId: string, pluginKey: string): Promise<{ success: boolean; message?: string; error?: string }> {
    clientLogger.debug({ pluginKey, userId }, 'Disconnecting plugin');

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

      clientLogger.debug({ pluginKey, success: result.success }, 'Disconnect result');

      return result;
    } catch (error: any) {
      clientLogger.error({ err: error, pluginKey }, 'Error disconnecting plugin');
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
    clientLogger.debug({ pluginName, actionName, userId }, 'Executing action');

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

      clientLogger.debug({
        pluginName,
        actionName,
        success: result.success,
        hasData: !!result.data
      }, 'Execution result');

      return result;
    } catch (error: any) {
      clientLogger.error({ err: error, pluginName, actionName }, 'Error executing action');
      return {
        success: false,
        error: error.message,
        message: `Failed to execute ${actionName}: ${error.message}`
      };
    }
  }

  // Get LLM context for user
  async getLLMContext(userId: string): Promise<LLMContext> {
    clientLogger.debug({ userId }, 'Getting LLM context');

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
      clientLogger.error({ err: error }, 'Error getting LLM context');
      throw error;
    }
  }

  // Get the full per-action schema block for the Form Tester (FR3/FR6).
  // Backed by the read-only, metadata-only GET /api/plugins/action-schema endpoint.
  async getActionSchema(
    plugin: string,
    action?: string
  ): Promise<{ success: boolean; plugin: string; actions: any[]; action_count: number; error?: string }> {
    clientLogger.debug({ plugin, action: action || 'all' }, 'Getting action schema');

    try {
      const query = action
        ? `plugin=${encodeURIComponent(plugin)}&action=${encodeURIComponent(action)}`
        : `plugin=${encodeURIComponent(plugin)}`;
      const response = await fetch(`${this.baseUrl}/api/plugins/action-schema?${query}`, {
        cache: 'no-store',
      });
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to get action schema');
      }

      return result;
    } catch (error: any) {
      clientLogger.error({ err: error, plugin, action }, 'Error getting action schema');
      throw error;
    }
  }

  // Record a per-execution audit entry for the tester via the isolated audit endpoint.
  // Non-blocking by design: failures are logged but never surfaced to the caller (CR2).
  async recordTesterAudit(input: {
    targetUserId: string;
    plugin: string;
    action: string;
    outcome: 'success' | 'error';
    durationMs?: number;
  }): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/plugins/test-audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
    } catch (error: any) {
      // Audit is best-effort — never block or fail the tester on audit errors.
      clientLogger.error({
        err: error,
        plugin: input.plugin,
        action: input.action,
      }, 'Error recording tester audit (non-blocking)');
    }
  }

  // Get plugin actions (for testing/UI purposes)
  async getPluginActions(pluginName?: string): Promise<any> {
    clientLogger.debug({ pluginName: pluginName || 'all' }, 'Getting plugin actions');

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
      clientLogger.error({ err: error }, 'Error getting plugin actions');
      throw error;
    }
  }

  // Utility method to check if a plugin is connected
  async isPluginConnected(userId: string, pluginKey: string): Promise<boolean> {
    try {
      const status = await this.getUserPluginStatus(userId);
      return status.connected.some(plugin => plugin.key === pluginKey);
    } catch (error) {
      clientLogger.error({ err: error }, 'Error checking plugin connection status');
      return false;
    }
  }

  // Get connection status for a specific plugin
  async getPluginConnectionStatus(userId: string, pluginKey: string): Promise<any> {
    clientLogger.debug({ pluginKey }, 'Getting connection status');

    try {
      const response = await fetch(`${this.baseUrl}/api/plugins/disconnect?userId=${userId}&pluginKey=${pluginKey}`);
      const result = await response.json();

      return result;
    } catch (error: any) {
      clientLogger.error({ err: error }, 'Error getting plugin connection status');
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
      clientLogger.error({ err: error }, 'Error testing connections');
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