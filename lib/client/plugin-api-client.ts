// lib/client/plugin-api-client.ts

import { OAuthHandler } from './oauth-handler';
import { PluginInfo, UserPluginStatus, LLMContext, ExecutionResult, ApiResponse } from '@/lib/types/plugin-types'

export class PluginAPIClient {
  private baseUrl: string;
  private oauthHandler: OAuthHandler;
  private debug = process.env.NODE_ENV === 'development';

  constructor() {
    this.baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    this.oauthHandler = new OAuthHandler();
    if (this.debug) console.log('DEBUG: Client - PluginAPIClient initialized');
  }

  // Get all available plugins
  async getAvailablePlugins(): Promise<PluginInfo[]> {
    if (this.debug) console.log('DEBUG: Client - Getting available plugins');

    try {
      const response = await fetch(`${this.baseUrl}/api/plugins/available`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to get available plugins');
      }

      return result.plugins;
    } catch (error: any) {
      console.error('DEBUG: Client - Error getting available plugins:', error);
      throw error;
    }
  }

  // Get user's plugin status (connected vs disconnected)
  async getUserPluginStatus(userId: string): Promise<UserPluginStatus> {
    if (this.debug) console.log(`DEBUG: Client - Getting plugin status for user ${userId}`);

    try {
      const response = await fetch(`${this.baseUrl}/api/plugins/user-status?userId=${userId}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to get user plugin status');
      }

      return {
        connected: result.connected,
        disconnected: result.disconnected,
        summary: result.summary
      };
    } catch (error: any) {
      console.error('DEBUG: Client - Error getting user plugin status:', error);
      throw error;
    }
  }

  // Connect a plugin (initiate OAuth flow)
  async connectPlugin(userId: string, pluginKey: string): Promise<{ success: boolean; data?: any; error?: string }> {
    if (this.debug) console.log(`DEBUG: Client - Connecting plugin ${pluginKey} for user ${userId}`);

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

      if (this.debug) console.log(`DEBUG: Client - Plugin connection result for ${pluginKey}:`, { success: result.success });

      return result;
    } catch (error: any) {
      console.error(`DEBUG: Client - Error connecting plugin ${pluginKey}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Disconnect a plugin
  async disconnectPlugin(userId: string, pluginKey: string): Promise<{ success: boolean; message?: string; error?: string }> {
    if (this.debug) console.log(`DEBUG: Client - Disconnecting plugin ${pluginKey} for user ${userId}`);

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

      if (this.debug) console.log(`DEBUG: Client - Disconnect result for ${pluginKey}:`, { success: result.success });

      return result;
    } catch (error: any) {
      console.error(`DEBUG: Client - Error disconnecting plugin ${pluginKey}:`, error);
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
    if (this.debug) console.log(`DEBUG: Client - Executing ${pluginName}.${actionName} for user ${userId}`);

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

      if (this.debug) console.log(`DEBUG: Client - Execution result for ${pluginName}.${actionName}:`, { 
        success: result.success,
        hasData: !!result.data
      });

      return result;
    } catch (error: any) {
      console.error(`DEBUG: Client - Error executing action ${pluginName}.${actionName}:`, error);
      return {
        success: false,
        error: error.message,
        message: `Failed to execute ${actionName}: ${error.message}`
      };
    }
  }

  // Get LLM context for user
  async getLLMContext(userId: string): Promise<LLMContext> {
    if (this.debug) console.log(`DEBUG: Client - Getting LLM context for user ${userId}`);

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
      console.error('DEBUG: Client - Error getting LLM context:', error);
      throw error;
    }
  }

  // Get plugin actions (for testing/UI purposes)
  async getPluginActions(pluginName?: string): Promise<any> {
    if (this.debug) console.log(`DEBUG: Client - Getting plugin actions${pluginName ? ` for ${pluginName}` : ''}`);

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
      console.error('DEBUG: Client - Error getting plugin actions:', error);
      throw error;
    }
  }

  // Utility method to check if a plugin is connected
  async isPluginConnected(userId: string, pluginKey: string): Promise<boolean> {
    try {
      const status = await this.getUserPluginStatus(userId);
      return status.connected.some(plugin => plugin.key === pluginKey);
    } catch (error) {
      console.error(`DEBUG: Client - Error checking plugin connection status:`, error);
      return false;
    }
  }

  // Get connection status for a specific plugin
  async getPluginConnectionStatus(userId: string, pluginKey: string): Promise<any> {
    if (this.debug) console.log(`DEBUG: Client - Getting connection status for ${pluginKey}`);

    try {
      const response = await fetch(`${this.baseUrl}/api/plugins/disconnect?userId=${userId}&pluginKey=${pluginKey}`);
      const result = await response.json();

      return result;
    } catch (error: any) {
      console.error(`DEBUG: Client - Error getting plugin connection status:`, error);
      throw error;
    }
  }

  // Get plugin auth configuration from server
  private async getPluginAuthConfig(pluginKey: string): Promise<any> {
  // Get plugin definition which includes processed auth_config
  const availablePlugins = await this.getAvailablePlugins();
  const plugin = availablePlugins.find(p => p.key === pluginKey);
  
  if (!plugin) {
    throw new Error(`Plugin ${pluginKey} not found`);
  }
  
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
      } catch (error) {
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
      console.error('DEBUG: Client - Error testing connections:', error);
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