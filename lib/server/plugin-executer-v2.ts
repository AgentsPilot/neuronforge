// lib/server/plugin-executer-v2.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { BasePluginExecutor } from './base-plugin-executor';
import { ExecutionResult } from '@/lib/types/plugin-types';
import { createLogger } from '@/lib/logger';

// Import all plugin executors
import { GmailPluginExecutor } from './gmail-plugin-executor';
import { GoogleDrivePluginExecutor } from './google-drive-plugin-executor';
import { GoogleSheetsPluginExecutor } from './google-sheets-plugin-executor';
import { GoogleDocsPluginExecutor } from './google-docs-plugin-executor';
import { GoogleCalendarPluginExecutor } from './google-calendar-plugin-executor';
import { SlackPluginExecutor } from './slack-plugin-executor';
import { WhatsAppPluginExecutor } from './whatsapp-business-plugin-executor';
import { HubSpotPluginExecutor } from './hubspot-plugin-executor';
import { ChatGPTResearchPluginExecutor } from './chatgpt-research-plugin-executor';
import { LinkedInPluginExecutor } from './linkedin-plugin-executor';
import { AirtablePluginExecutor } from './airtable-plugin-executor';

const logger = createLogger({ module: 'PluginExecuter', service: 'plugin-system' });
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
    'whatsapp-business': WhatsAppPluginExecutor,
    'hubspot': HubSpotPluginExecutor,
    'chatgpt-research': ChatGPTResearchPluginExecutor,
    'linkedin': LinkedInPluginExecutor,
    'airtable': AirtablePluginExecutor,
    // Add new plugin executors here
  };

  private pluginInstances: Map<string, BasePluginExecutor> = new Map();
  public readonly pluginManager: PluginManagerV2;
  public readonly userConnections: UserPluginConnections;
  public static debug = process.env.NODE_ENV === 'development';
  private debug = process.env.NODE_ENV === 'development';
  private initialized = false;

  private constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    this.userConnections = userConnections;
    this.pluginManager = pluginManager;
    logger.debug('PluginExecuterV2 initialized');
  }

  // Singleton factory for serverless functions
  static async getInstance(): Promise<PluginExecuterV2> {
    if (!pluginExecuterInstance) {
      logger.debug('Creating new PluginExecuterV2 instance for serverless function');

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
      logger.debug('PluginExecuterV2 already initialized, skipping');
      return;
    }

    // Plugin instances will be created lazily on-demand
    this.initialized = true;
    logger.info('PluginExecuterV2 initialization complete');
  }

  // Unified execute method - routes to appropriate plugin executor
  async execute(userId: string, pluginName: string, actionName: string, parameters: any): Promise<ExecutionResult> {
    logger.info({ userId, pluginName, actionName }, 'Executing plugin action');

    try {
      // Get or create the executor instance for this plugin
      const executor = this.getOrCreateExecutor(pluginName);

      // Execute the action using the executor
      const result = await executor.executeAction(userId, actionName, parameters || {});

      return result;
    } catch (error: any) {
      logger.error({ err: error, pluginName, actionName }, 'Plugin execution error');

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
      logger.debug({ pluginName }, 'Reusing existing executor');
      return this.pluginInstances.get(pluginName)!;
    }

    // Look up executor class in registry
    const ExecutorClass = PluginExecuterV2.executorRegistry[pluginName];
    if (!ExecutorClass) {
      throw new Error(`Plugin executor not found for: ${pluginName}. Please ensure it's registered in PluginExecuterV2.executorRegistry`);
    }

    // Create new instance
    logger.debug({ pluginName }, 'Creating new executor instance');

    const executor = new ExecutorClass(this.userConnections, this.pluginManager);

    // Cache the instance
    this.pluginInstances.set(pluginName, executor);

    return executor;
  }

  /**
   * Fetch dynamic options for a plugin parameter
   * Used by fetch-options API for populating dynamic dropdowns
   */
  async fetchDynamicOptions(
    pluginName: string,
    fetchMethod: string,
    connection: any,
    options: { page?: number; limit?: number; [key: string]: any }
  ): Promise<{ value: string; label: string; description?: string; icon?: string; group?: string }[]> {
    const executor = this.getOrCreateExecutor(pluginName);

    // Check if the method exists on the executor
    if (typeof (executor as any)[fetchMethod] !== 'function') {
      throw new Error(`Method ${fetchMethod} not implemented in ${pluginName} executor`);
    }

    // Call the dynamic fetch method
    return await (executor as any)[fetchMethod](connection, options);
  }
}
