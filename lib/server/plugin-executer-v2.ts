// lib/server/plugin-executer-v2.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { BasePluginExecutor } from './base-plugin-executor';
import { ExecutionResult } from '@/lib/types/plugin-types';

// Import all plugin executors
import { GmailPluginExecutor } from './gmail-plugin-executor';
import { GoogleDrivePluginExecutor } from './google-drive-plugin-executor';
import { GoogleSheetsPluginExecutor } from './google-sheets-plugin-executor';
import { GoogleDocsPluginExecutor } from './google-docs-plugin-executor';
import { GoogleCalendarPluginExecutor } from './google-calendar-plugin-executor';
import { SlackPluginExecutor } from './slack-plugin-executor';
import { WhatsAppPluginExecutor } from './whatsapp-plugin-executor';
import { HubSpotPluginExecutor } from './hubspot-plugin-executor';
import { ChatGPTResearchPluginExecutor } from './chatgpt-research-plugin-executor';

let pluginExecuterInstance: PluginExecuterV2 | null = null;

// Type for plugin executor constructor
type PluginExecutorConstructor = new (
  userConnections: UserPluginConnections,
  pluginManager: PluginManagerV2
) => BasePluginExecutor;

export class PluginExecuterV2 {
  // Registry mapping plugin names to their executor classes
  private static executorRegistry: Record<string, PluginExecutorConstructor> = {
    'google-mail': GmailPluginExecutor,
    'google-drive': GoogleDrivePluginExecutor,
    'google-sheets': GoogleSheetsPluginExecutor,
    'google-docs': GoogleDocsPluginExecutor,
    'google-calendar': GoogleCalendarPluginExecutor,
    'slack': SlackPluginExecutor,
    'whatsapp': WhatsAppPluginExecutor,
    'hubspot': HubSpotPluginExecutor,
    'chatgpt-research': ChatGPTResearchPluginExecutor,
    // Add new plugin executors here
  };

  private pluginInstances: Map<string, BasePluginExecutor> = new Map();
  private pluginManager: PluginManagerV2;
  private userConnections: UserPluginConnections;
  private debug = process.env.NODE_ENV === 'development';
  private initialized = false;

  private constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    this.userConnections = userConnections;
    this.pluginManager = pluginManager;
    if (this.debug) console.log('DEBUG: PluginExecuterV2 initialized');
  }

  // Singleton factory for serverless functions
  static async getInstance(): Promise<PluginExecuterV2> {
    if (!pluginExecuterInstance) {
      if (process.env.NODE_ENV === 'development') {
        console.log('DEBUG: Creating new PluginExecuterV2 instance for serverless function');
      }

      const userConnections = UserPluginConnections.getInstance();
      const pluginManager = await PluginManagerV2.getInstance();
      pluginExecuterInstance = new PluginExecuterV2(userConnections, pluginManager);
      await pluginExecuterInstance.initialize();
    }
    return pluginExecuterInstance;
  }

  // Initialize plugin executer
  async initialize(): Promise<void> {
    if (this.initialized) {
      if (this.debug) console.log('DEBUG: PluginExecuterV2 already initialized, skipping');
      return;
    }

    if (this.debug) console.log('DEBUG: Initializing PluginExecuterV2');
    // Plugin instances will be created lazily on-demand
    this.initialized = true;
    if (this.debug) console.log('DEBUG: PluginExecuterV2 initialization complete');
  }

  // Unified execute method - routes to appropriate plugin executor
  async execute(userId: string, pluginName: string, actionName: string, parameters: any): Promise<ExecutionResult> {
    if (this.debug) {
      console.log(`DEBUG: PluginExecuterV2.execute - ${pluginName}.${actionName} for user ${userId}`);
    }

    try {
      // Get or create the executor instance for this plugin
      const executor = this.getOrCreateExecutor(pluginName);

      // Execute the action using the executor
      const result = await executor.executeAction(userId, actionName, parameters || {});

      return result;
    } catch (error: any) {
      if (this.debug) {
        console.error(`DEBUG: PluginExecuterV2.execute - Error executing ${pluginName}.${actionName}:`, error);
      }

      return {
        success: false,
        error: 'execution_error',
        message: error.message || 'Unknown error occurred during execution'
      };
    }
  }

  // Lazy instantiation: Get existing executor or create new one
  private getOrCreateExecutor(pluginName: string): BasePluginExecutor {
    // Check if we already have an instance
    if (this.pluginInstances.has(pluginName)) {
      if (this.debug) {
        console.log(`DEBUG: PluginExecuterV2 - Reusing existing executor for ${pluginName}`);
      }
      return this.pluginInstances.get(pluginName)!;
    }

    // Look up executor class in registry
    const ExecutorClass = PluginExecuterV2.executorRegistry[pluginName];
    if (!ExecutorClass) {
      throw new Error(`Plugin executor not found for: ${pluginName}. Please ensure it's registered in PluginExecuterV2.executorRegistry`);
    }

    // Create new instance
    if (this.debug) {
      console.log(`DEBUG: PluginExecuterV2 - Creating new executor instance for ${pluginName}`);
    }

    const executor = new ExecutorClass(this.userConnections, this.pluginManager);

    // Cache the instance
    this.pluginInstances.set(pluginName, executor);

    return executor;
  }
}
