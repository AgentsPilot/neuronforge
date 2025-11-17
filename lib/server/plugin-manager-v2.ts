// lib/server/plugin-manager-v2.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginDefinition, ActionDefinition, ValidationResult, RuleDefinition, ActionablePlugin, UserConnection, ActionRuleDefinition } from '@/lib/types/plugin-types'
import { PluginDefinitionContext } from '@/lib/types/plugin-definition-context'
import * as fs from 'fs';
import * as path from 'path';

const corePluginFiles = [
      'google-mail-plugin-v2.json',
      'google-drive-plugin-v2.json',
      'google-sheets-plugin-v2.json',
      'google-docs-plugin-v2.json',
      'google-calendar-plugin-v2.json',
      'slack-plugin-v2.json',
      'whatsapp-plugin-v2.json',
      'hubspot-plugin-v2.json',
      'chatgpt-research-plugin-v2.json',
      'linkedin-plugin-v2.json',
      'airtable-plugin-v2.json',
      // Add other plugin files here as you create them
    ];
console.log('Plugin-Manager-v2 Loaded:', {
  Plugin_Definitions: Object.values(corePluginFiles),  
  Total_Plugins: Object.keys(corePluginFiles).length
})


let pluginManagerInstance: PluginManagerV2 | null = null;

export class PluginManagerV2 {
  private plugins: Map<string, PluginDefinition> = new Map();
  private userConnections: UserPluginConnections;
  public static debug = process.env.NODE_ENV === 'development';
  private debug = process.env.NODE_ENV === 'development';
  private initialized = false;

  constructor(userConnections: UserPluginConnections) {
    this.userConnections = userConnections;
    if (this.debug) console.log('DEBUG: Server PluginManagerV2 initialized');
  }

  // Singleton factory for serverless functions
  static async getInstance(): Promise<PluginManagerV2> {
    if (!pluginManagerInstance) {
      if (PluginManagerV2.debug) {
        console.log('DEBUG: Creating new PluginManagerV2 instance for serverless function');
      }
      
      const userConnections = UserPluginConnections.getInstance();
      pluginManagerInstance = new PluginManagerV2(userConnections);
      await pluginManagerInstance.initializeWithCorePlugins();
    }
    return pluginManagerInstance;
  }

  // Initialize plugin manager with core plugins (called once per cold start)
  async initializeWithCorePlugins(): Promise<void> {
    if (this.initialized) {
      if (this.debug) console.log('DEBUG: PluginManagerV2 already initialized, skipping');
      return;
    }

    await this.loadCorePlugins();
    this.initialized = true;
    if (this.debug) console.log(`DEBUG: Plugin manager initialized with ${this.plugins.size} plugins`);
  }

  // Load core plugins from JSON files with environment variable substitution
  private async loadCorePlugins(): Promise<void> {
    if (this.debug) console.log('DEBUG: Loading core plugins from filesystem');
        
    // Get the plugins directory path (relative to project root)
    const pluginsDir = path.join(process.cwd(), 'lib', 'plugins', 'definitions');

    for (const fileName of corePluginFiles) {
      try {
        const pluginName = fileName.replace('-plugin-v2.json', '');
        const filePath = path.join(pluginsDir, fileName);
        
        if (this.debug) console.log(`DEBUG: Loading plugin from ${filePath}`);
        
        // Read and parse JSON file
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const pluginDefinition = JSON.parse(fileContent);
        
        // Process environment variables
        const processedDefinition = this.processEnvironmentVariables(pluginDefinition);
        
        // Validate plugin definition
        this.validatePluginDefinition(processedDefinition);
        
        // Load the plugin
        this.plugins.set(pluginName, processedDefinition);
        
        if (this.debug) console.log(`DEBUG: Successfully loaded plugin ${pluginName}`);
      } catch (error) {
        console.error(`DEBUG: Failed to load plugin from ${fileName}:`, error);
        // Continue loading other plugins even if one fails
      }
    }
  }

  // Process environment variables in plugin definition
  private processEnvironmentVariables(definition: any): any {
    if (this.debug) console.log('DEBUG: Processing environment variables in plugin definition');
    
    const processed = JSON.parse(JSON.stringify(definition)); // Deep clone
    
    const replaceEnvVars = (obj: any): void => {
      for (const key in obj) {
        if (typeof obj[key] === 'string') {
          // Replace ${VAR_NAME} with process.env.VAR_NAME
          obj[key] = obj[key].replace(/\$\{([^}]+)\}/g, (match: string, varName: string) => {
            const envValue = process.env[varName];
            if (!envValue) {
              console.warn(`DEBUG: Environment variable ${varName} not found, keeping placeholder`);
              return match;
            }
            if (this.debug) console.log(`DEBUG: Replaced ${varName} with environment value`);
            return envValue;
          });
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          replaceEnvVars(obj[key]);
        }
      }
    };
    
    replaceEnvVars(processed);
    return processed;
  }

  // Get all available plugins in registry (static)
  getAvailablePlugins(): Record<string, PluginDefinition> {
    if (this.debug) console.log(`DEBUG: Getting available plugins, total: ${this.plugins.size}`);

    const result: Record<string, PluginDefinition> = {};
    for (const [name, definition] of this.plugins) {
      result[name] = definition;
    }
    return result;
  }

  // Get actionable system plugins (no OAuth required, auto-available for all users)
  getActionableSystemPlugins(userId: string): Record<string, ActionablePlugin> {
    if (this.debug) console.log(`DEBUG: Getting actionable system plugins for user ${userId}`);

    const systemPlugins: Record<string, ActionablePlugin> = {};

    for (const [pluginKey, definition] of this.plugins.entries()) {
      // Check if this is a system plugin
      if (definition.plugin.isSystem) {
        if (this.debug) console.log(`DEBUG: Found system plugin: ${pluginKey}`);

        // Create a virtual connection for system plugins (no database record needed)
        systemPlugins[pluginKey] = {
          definition,
          connection: {
            user_id: userId,
            plugin_key: pluginKey,
            plugin_name: definition.plugin.displayName || definition.plugin.name,
            access_token: 'system', // Placeholder - not used by system plugins
            refresh_token: null,
            expires_at: null, // System plugins don't expire
            scope: null,
            username: 'System',
            email: null,
            profile_data: { isSystem: true },
            settings: {},
            status: 'active',
            id: `system-${userId}-${pluginKey}`,
            connected_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        };
      }
    }

    if (this.debug) console.log(`DEBUG: Found ${Object.keys(systemPlugins).length} system plugins`);
    return systemPlugins;
  }

  // Get all active plugin keys (including expired tokens) + system plugins
  // Use for: Showing users all their active services regardless of token status
  async getAllActivePluginKeys(userId: string): Promise<string[]> {
    if (this.debug) console.log(`DEBUG: Getting all active plugin keys for user ${userId} (including expired)`);

    // Get ALL active OAuth plugins (including those with expired tokens)
    const allActiveOAuthConnections = await this.userConnections.getAllActivePlugins(userId);
    const activeOAuthKeys = allActiveOAuthConnections.map(conn => conn.plugin_key);

    // Get system plugins
    const systemPlugins = this.getActionableSystemPlugins(userId);
    const systemPluginKeys = Object.keys(systemPlugins);

    // Combine both (deduplicate in case of overlap)
    const allActiveKeys = [...new Set([...activeOAuthKeys, ...systemPluginKeys])];

    if (this.debug) console.log(`DEBUG: Found ${allActiveKeys.length} total active plugin keys (OAuth: ${activeOAuthKeys.length}, System: ${systemPluginKeys.length})`);

    return allActiveKeys;
  }
  
  // Get user's connected plugins (active status only, no token refresh - FAST)
  // Use for: UI display, status checks, listing connected services
  // @param userId - The user ID to get connected plugins for
  // @param options.includeSystemPlugins - Whether to include system plugins (default: true)
  async getConnectedPlugins(
    userId: string,
    options: { includeSystemPlugins?: boolean } = {}
  ): Promise<Record<string, ActionablePlugin>> {
    const { includeSystemPlugins = true } = options;

    if (this.debug) console.log(`DEBUG: Getting connected plugins (status only) for user ${userId}, includeSystemPlugins: ${includeSystemPlugins}`);

    const actionablePlugins: Record<string, ActionablePlugin> = {};

    // Get connected plugin connections (simple query, no token operations)
    const connections = await this.userConnections.getConnectedPlugins(userId);

    if (this.debug) console.log(`DEBUG: Found ${connections.length} connected plugins`);

    // Build actionable plugins from connections
    for (const connection of connections) {
      const pluginKey = connection.plugin_key;
      const definition = this.plugins.get(pluginKey);

      if (!definition) {
        if (this.debug) console.log(`DEBUG: Plugin ${pluginKey} connected but not in registry, skipping`);
        continue;
      }

      actionablePlugins[pluginKey] = {
        definition,
        connection
      };
      if (this.debug) console.log(`DEBUG: Plugin ${pluginKey} is connected (status='active')`);
    }

    // Add system plugins (no database connection required, always available)
    // Only if includeSystemPlugins is true (default)
    if (includeSystemPlugins) {
      const systemPlugins = this.getActionableSystemPlugins(userId);
      for (const [pluginKey, systemPlugin] of Object.entries(systemPlugins)) {
        // Only add if not already present (OAuth connection takes precedence)
        if (!actionablePlugins[pluginKey]) {
          actionablePlugins[pluginKey] = systemPlugin;
          if (this.debug) console.log(`DEBUG: Added system plugin ${pluginKey} to connected plugins`);
        }
      }

      if (this.debug) console.log(`DEBUG: Returning ${Object.keys(actionablePlugins).length} connected plugins (${connections.length} OAuth + ${Object.keys(systemPlugins).length} system)`);
    } else {
      if (this.debug) console.log(`DEBUG: Returning ${Object.keys(actionablePlugins).length} connected plugins (${connections.length} OAuth, system plugins excluded)`);
    }

    return actionablePlugins;
  }

  // Get plugins with expired tokens (active but need refresh)
  // Returns plugin keys that are active in DB but have expired tokens
  async getActiveExpiredPluginKeys(userId: string): Promise<string[]> {
    if (this.debug) console.log(`DEBUG: Getting active expired plugin keys for user ${userId}`);

    // Get all active connections (including expired)
    const allActive = await this.userConnections.getAllActivePlugins(userId);

    // Get valid connected plugins (expired filtered out)
    const validConnected = await this.userConnections.getConnectedPlugins(userId);
    const validKeys = new Set(validConnected.map(conn => conn.plugin_key));

    // Find plugins that are active but not in valid list (meaning expired)
    const expiredKeys = allActive
      .filter(conn => !validKeys.has(conn.plugin_key))
      .map(conn => conn.plugin_key);

    if (this.debug) console.log(`DEBUG: Found ${expiredKeys.length} active plugins with expired tokens`);

    return expiredKeys;
  }

  // Get user's executable plugins (with valid refreshed tokens - SLOW but READY)
  // Use for: Before actual plugin execution, ensuring tokens are valid
  async getExecutablePlugins(userId: string, options = { forceRefresh: false }): Promise<Record<string, ActionablePlugin>> {
    if (this.debug) console.log(`DEBUG: Getting executable plugins for user ${userId} (forceRefresh: ${options.forceRefresh})`);

    // Get ALL active plugins (including expired ones) so we can refresh them
    const allActiveConnections = await this.userConnections.getAllActivePlugins(userId);
    const executablePlugins: Record<string, ActionablePlugin> = {};

    // Process each connection to ensure token validity for execution
    for (const conn of allActiveConnections) {
      const pluginKey = conn.plugin_key;
      const definition = this.plugins.get(pluginKey);

      if (!definition) {
        if (this.debug) console.log(`DEBUG: Plugin ${pluginKey} connected but not in registry, skipping`);
        continue;
      }

      // System plugins are always executable (no tokens needed)
      if (definition.plugin.isSystem) {
        executablePlugins[pluginKey] = {
          definition,
          connection: conn
        };
        if (this.debug) console.log(`DEBUG: System plugin ${pluginKey} is always executable`);
        continue;
      }

      // Check if token is expired or needs refresh
      if (conn.expires_at) {
        const isExpired = !this.userConnections.isTokenValid(conn.expires_at);
        const shouldRefresh = options.forceRefresh ||
                             isExpired ||
                             this.userConnections.shouldRefreshToken(conn.expires_at, 5);

        if (shouldRefresh) {
          const minutesUntilExpiry = Math.floor((new Date(conn.expires_at).getTime() - Date.now()) / 60000);

          if (isExpired) {
            console.log(`🔄 Token Refresh: ${pluginKey} token EXPIRED (${-minutesUntilExpiry} minutes ago), attempting refresh...`);
          } else {
            console.log(`🔄 Token Refresh: ${pluginKey} token expires in ${minutesUntilExpiry} minutes, refreshing for execution...`);
          }

          // Get auth config for token refresh
          const authConfig = definition.plugin.auth_config;

          // Attempt to refresh the token
          const refreshedConnection = await this.userConnections.refreshToken(conn, authConfig);

          if (refreshedConnection) {
            console.log(`✅ Token Refresh Success: ${pluginKey} is now executable`);
            executablePlugins[pluginKey] = {
              definition,
              connection: refreshedConnection
            };
          } else {
            console.error(`❌ Token Refresh Failed: ${pluginKey} - user needs to reconnect, skipping from executable list`);
            // Plugin not executable - skip it
          }
          continue;
        }
      }

      // Token is valid or doesn't expire - plugin is executable
      executablePlugins[pluginKey] = {
        definition,
        connection: conn
      };
      if (this.debug) console.log(`DEBUG: Plugin ${pluginKey} token is valid, executable`);
    }

    if (this.debug) console.log(`DEBUG: Returning ${Object.keys(executablePlugins).length} executable plugins out of ${allActiveConnections.length} active`);

    return executablePlugins;
  }

  /**
   * @deprecated Use getConnectedPlugins() for status checks or getExecutablePlugins() for execution
   * This method will be removed in v3.0
   *
   * Migration guide:
   * - For UI display / status checks: use getConnectedPlugins(userId)
   * - For plugin execution: use getExecutablePlugins(userId)
   */
  async getUserActionablePlugins(userId: string, options = { skipTokenRefresh: false }): Promise<Record<string, ActionablePlugin>> {
    if (this.debug) console.log(`DEBUG: [DEPRECATED] getUserActionablePlugins called (skipTokenRefresh: ${options.skipTokenRefresh})`);
    console.warn('⚠️ DEPRECATION WARNING: getUserActionablePlugins() is deprecated. Use getConnectedPlugins() for status or getExecutablePlugins() for execution.');

    // Redirect to new methods based on option
    if (options.skipTokenRefresh) {
      return this.getConnectedPlugins(userId);
    } else {
      return this.getExecutablePlugins(userId);
    }
  }

  // Get disconnected plugins (plugins available but not connected)
  // @param connectedKeys - Optional pre-fetched connected keys to avoid duplicate DB query
  async getDisconnectedPlugins(
    userId: string,
    connectedKeys?: string[]
  ): Promise<Record<string, { plugin: PluginDefinition; reason: string; auth_url: string }>> {
    if (this.debug) console.log(`DEBUG: Getting disconnected plugins for user ${userId}`);

    const allPlugins = this.getAvailablePlugins();
    const availablePluginKeys = Object.keys(allPlugins);

    // Get disconnected plugin keys, passing connectedKeys if available to avoid duplicate query
    const disconnectedKeys = await this.userConnections.getDisconnectedPluginKeys(
      userId,
      availablePluginKeys,
      connectedKeys
    );

    if (this.debug) console.log(`DEBUG: Found ${disconnectedKeys.length} disconnected plugin keys`);

    const disconnectedPlugins: Record<string, { plugin: PluginDefinition; reason: string; auth_url: string }> = {};

    // Build the disconnected plugins object with definitions
    for (const pluginKey of disconnectedKeys) {
      const definition = allPlugins[pluginKey];
      if (definition) {
        // Skip system plugins (they're never "disconnected" - always available)
        if (definition.plugin.isSystem) {
          if (this.debug) console.log(`DEBUG: Skipping system plugin ${pluginKey} from disconnected list`);
          continue;
        }

        disconnectedPlugins[pluginKey] = {
          plugin: definition,
          reason: 'not_connected', // Simplified reason since we're just checking active status
          auth_url: definition.plugin.auth_config.auth_url
        };

        if (this.debug) console.log(`DEBUG: Plugin ${pluginKey} is disconnected`);
      }
    }

    if (this.debug) console.log(`DEBUG: Returning ${Object.keys(disconnectedPlugins).length} disconnected plugins`);

    return disconnectedPlugins;
  }

  // Validate action parameters against plugin schema and rules
  validateActionParameters(pluginName: string, actionName: string, parameters: any): ValidationResult {
    if (this.debug) console.log(`DEBUG: Validating parameters for ${pluginName}.${actionName}`);
    
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      return {
        valid: false,
        errors: [`Plugin ${pluginName} not found`],
        confirmations_required: [],
        blocked: true,
        block_reason: `Plugin ${pluginName} not found`
      };
    }

    const action = plugin.actions[actionName];
    if (!action) {
      return {
        valid: false,
        errors: [`Action ${actionName} not found in plugin ${pluginName}`],
        confirmations_required: [],
        blocked: true,
        block_reason: `Action ${actionName} not found`
      };
    }

    // Validate parameters against JSON Schema
    const schemaErrors = this.validateParametersAgainstSchema(parameters, action.parameters);
    
    // Validate against plugin rules
    const ruleValidation = this.validateRules(action.rules, parameters);
    
    const result: ValidationResult = {
      valid: schemaErrors.length === 0 && !ruleValidation.blocked,
      errors: [...schemaErrors, ...ruleValidation.errors],
      confirmations_required: ruleValidation.confirmations,
      blocked: ruleValidation.blocked,
      block_reason: ruleValidation.block_reason
    };

    if (this.debug) console.log(`DEBUG: Validation result for ${pluginName}.${actionName}:`, result);
    
    return result;
  }

  // Generate complete LLM context (actionable + available plugins)
  async generateLLMContext(userId: string): Promise<{
    connected_plugins: Record<string, any>;
    available_plugins: Record<string, any>;
  }> {
    if (this.debug) console.log(`DEBUG: Generating LLM context for user ${userId}`);
    
    const actionablePlugins = await this.getUserActionablePlugins(userId);
    const disconnectedPlugins = await this.getDisconnectedPlugins(userId);
    
    // Format actionable plugins for LLM (can perform actions)
    const llmConnectedPlugins: Record<string, any> = {};
    for (const [pluginName, actionablePlugin] of Object.entries(actionablePlugins)) {
      llmConnectedPlugins[pluginName] = {
        name: actionablePlugin.definition.plugin.name,
        description: actionablePlugin.definition.plugin.description,
        context: actionablePlugin.definition.plugin.context,
        status: 'ready',
        actions: this.formatActionsForLLM(actionablePlugin.definition.actions)
      };
    }
    
    // Format available plugins for LLM (guidance only)
    const llmAvailablePlugins: Record<string, any> = {};
    for (const [pluginName, data] of Object.entries(disconnectedPlugins)) {
      llmAvailablePlugins[pluginName] = {
        name: data.plugin.plugin.name,
        description: data.plugin.plugin.description,
        reason: data.reason,
        auth_url: data.auth_url,
        message: `To use ${data.plugin.plugin.name}, please connect it in Settings → Connected Apps`
      };
    }

    const context = {
      connected_plugins: llmConnectedPlugins,
      available_plugins: llmAvailablePlugins
    };

    if (this.debug) console.log(`DEBUG: LLM context generated - Connected: ${Object.keys(llmConnectedPlugins).length}, Available: ${Object.keys(llmAvailablePlugins).length}`);
    
    return context;
  }

  // Generate a Skinny LLM context (actionable filtered plugins)
  async generateSkinnyLLMContextByPluginName(userId: string, filteredPlugins: string[], includeRules?: boolean, includeOutputGuidence?: boolean): Promise<Record<string, PluginDefinition>>
  {
    if (this.debug) console.log(`DEBUG: Generating Skinny LLM context user: ${userId} with filtered plugins: ${filteredPlugins.join(', ')}`);  
    
    // Format actionable plugins for LLM (can perform actions)
    const llmPluginsContext: Record<string, PluginDefinition> = {};
    for (const pluginName of filteredPlugins) {
      const pluginDef = this.getPluginDefinition(pluginName);
      if (!pluginDef) {
        if (this.debug) console.log(`DEBUG: Plugin ${pluginName} not found in registry, skipping`);
        continue;
      }
      llmPluginsContext[pluginName] = pluginDef;
      if (!includeRules || !includeOutputGuidence) {
        for (const [actionName, action] of Object.entries(llmPluginsContext[pluginName].actions)) {
          if (!includeRules) {
            action.rules = {};
          }
          if (!includeOutputGuidence) {
            action.output_guidance = { success_message: "", common_errors: {} };
          }
        }      
      }      
    }
    if (this.debug) console.log(`DEBUG: Skinny LLM context generated: ${Object.keys(llmPluginsContext).length}`);
    return llmPluginsContext;
  }

  // Get plugin definition by name
  getPluginDefinition(pluginName: string): PluginDefinition | undefined {
    if (this.debug) console.log(`DEBUG: Getting plugin definition for ${pluginName}`);
    return this.plugins.get(pluginName);
  }

    // Get action definition
  getActionDefinition(pluginName: string, actionName: string): ActionDefinition | undefined {
    if (this.debug) console.log(`DEBUG: Getting action definition for ${pluginName}.${actionName}`);
    
    const plugin = this.plugins.get(pluginName);
    return plugin?.actions[actionName];
  }

  // Get output guidance for action
  getOutputGuidance(pluginName: string, actionName: string): { success_message: string; common_errors: Record<string, string> } | undefined {
    if (this.debug) console.log(`DEBUG: Getting output guidance for ${pluginName}.${actionName}`);
    
    const action = this.getActionDefinition(pluginName, actionName);
    return action?.output_guidance;
  }

  // Convert connected plugins to PluginDefinitionContext array
  convertToPluginDefinitionContext(connectedPlugins: Record<string, ActionablePlugin>): PluginDefinitionContext[] {    
    return Object.values(connectedPlugins).map(p => new PluginDefinitionContext(p.definition));
  }

  // Get multiple plugin definition by name
  getPluginsDefinitionContext(plugins: string[]): PluginDefinitionContext[] {    
    const pluginsDefs: PluginDefinitionContext[] = [];
    for (const name of plugins) {
      const def = this.getPluginDefinition(name);
      if (def) {
        pluginsDefs.push(new PluginDefinitionContext(def));
      }  
    }
    return pluginsDefs;
  }

  // Get plugin Display Name by name
  getPluginDisplayName(pluginName: string): string {
    if (this.debug) console.log(`DEBUG: Getting plugin display name for ${pluginName}`);
    const plugin = this.getPluginDefinition(pluginName);
    return plugin?.plugin.displayName || plugin?.plugin.label || pluginName;
  }

  // Private helper methods

  // Validate plugin definition structure
  private validatePluginDefinition(definition: PluginDefinition): void {
    if (this.debug) console.log('DEBUG: Validating plugin definition structure');
    
    if (!definition.plugin?.name) {
      throw new Error('Plugin definition missing required field: plugin.name');
    }
    
    if (!definition.plugin?.auth_config) {
      throw new Error('Plugin definition missing required field: plugin.auth_config');
    }
    
    if (!definition.actions || Object.keys(definition.actions).length === 0) {
      throw new Error('Plugin definition must have at least one action');
    }
    
    // Validate each action has required fields
    for (const [actionName, action] of Object.entries(definition.actions)) {
      if (!action.description || !action.parameters || !action.output_guidance) {
        throw new Error(`Action ${actionName} missing required fields`);
      }
    }
    
    if (this.debug) console.log('DEBUG: Plugin definition validation passed');
  }

  // Validate parameters against JSON Schema
  private validateParametersAgainstSchema(parameters: any, schema: any): string[] {
    if (this.debug) console.log('DEBUG: Validating parameters against schema');

    const errors: string[] = [];
    
    // Check required fields
    if (schema.required) {
      for (const required of schema.required) {
        if (!parameters || parameters[required] === undefined || parameters[required] === null) {
          errors.push(`Missing required parameter: ${required}`);
        }
      }
    }
    
    // Basic type checking for properties
    if (schema.properties && parameters) {
      for (const [key, value] of Object.entries(parameters)) {
        const propSchema = schema.properties[key];
        if (propSchema && propSchema.type) {
          const actualType = typeof value;
          const expectedType = propSchema.type;
          
          if (expectedType === 'array' && !Array.isArray(value)) {
            errors.push(`Parameter ${key} should be array, got ${actualType}`);
          } else if (expectedType === 'object' && (actualType !== 'object' || Array.isArray(value) || value === null)) {
            errors.push(`Parameter ${key} should be object, got ${actualType}`);
          } else if (expectedType === 'integer') {
            // In JavaScript, integers are numbers - check if it's a number and is an integer
            if (actualType !== 'number') {
              errors.push(`Parameter ${key} should be integer, got ${actualType}`);
            } else if (!Number.isInteger(value)) {
              errors.push(`Parameter ${key} should be integer, got decimal number`);
            }
          } else if (expectedType === 'number' && actualType !== 'number') {
            errors.push(`Parameter ${key} should be number, got ${actualType}`);
          } else if (expectedType === 'string' && actualType !== 'string') {
            errors.push(`Parameter ${key} should be string, got ${actualType}`);
          } else if (expectedType === 'boolean' && actualType !== 'boolean') {
            errors.push(`Parameter ${key} should be boolean, got ${actualType}`);
          }
        }
      }
    }

    if (this.debug) console.log(`DEBUG: Schema validation found ${errors.length} errors`);

    return errors;
  }

  // Validate rules against parameters
  private validateRules(rules: ActionRuleDefinition, parameters: any): {
    blocked: boolean;
    block_reason?: string;
    confirmations: string[];
    errors: string[];
  } {
    if (this.debug) console.log('DEBUG: Validating rules');
    
    const result = {
      blocked: false,
      block_reason: "",
      confirmations: [] as string[],
      errors: [] as string[]
    };
    
    // Extract values for rule evaluation
    const ruleContext = this.extractRuleContext(parameters);
    
    // Check limit rules (blocking)
    if (rules.limits) {
      for (const [ruleName, rule] of Object.entries(rules.limits)) {
        if (this.evaluateCondition(rule.condition, ruleContext)) {
          result.blocked = true;
          result.block_reason = rule.message;
          if (this.debug) console.log(`DEBUG: Rule ${ruleName} blocked action: ${rule.message}`);
          break;
        }
      }
    }
    
    // Check confirmation rules
    if (rules.confirmations && !result.blocked) {
      for (const [ruleName, rule] of Object.entries(rules.confirmations)) {
        if (this.evaluateCondition(rule.condition, ruleContext)) {
          result.confirmations.push(rule.message);
          if (this.debug) console.log(`DEBUG: Rule ${ruleName} requires confirmation: ${rule.message}`);
        }
      }
    }
    
    return result;
  }

  // Extract values from parameters for rule evaluation
  private extractRuleContext(parameters: any): Record<string, any> {
    if (this.debug) console.log('DEBUG: Extracting rule context from parameters');
    
    const context: Record<string, any> = {};
    
    // Extract recipient count
    if (parameters.recipients) {
      const to = parameters.recipients.to || [];
      const cc = parameters.recipients.cc || [];
      const bcc = parameters.recipients.bcc || [];
      context.total_recipients = to.length + cc.length + bcc.length;
      
      // Check for external domains (simplified - replace with actual domain logic)
      context.has_external_recipients = [...to, ...cc, ...bcc].some((email: string) => 
        !email.includes('@yourdomain.com')
      );
    }
    
    // Extract subject length
    if (parameters.content?.subject) {
      context.subject = parameters.content.subject;
      context.subject_length = parameters.content.subject.length;
    }
    
    if (this.debug) console.log('DEBUG: Rule context extracted:', context);
    
    return context;
  }

  // Simple condition evaluation (supports basic comparisons)
  private evaluateCondition(condition: string, context: Record<string, any>): boolean {
    if (this.debug) console.log(`DEBUG: Evaluating condition: ${condition}`);
    
    try {
      // Simple regex-based condition parsing
      const match = condition.match(/(\w+)\s*(>|<|==|!=|>=|<=)\s*(\w+)/);
      
      if (!match) {
        if (this.debug) console.log('DEBUG: Could not parse condition');
        return false;
      }
      
      const [, variable, operator, value] = match;
      const contextValue = context[variable];
      const compareValue = isNaN(Number(value)) ? value : Number(value);
      
      let result = false;
      
      switch (operator) {
        case '>':
          result = contextValue > compareValue;
          break;
        case '<':
          result = contextValue < compareValue;
          break;
        case '>=':
          result = contextValue >= compareValue;
          break;
        case '<=':
          result = contextValue <= compareValue;
          break;
        case '==':
          result = contextValue == compareValue;
          break;
        case '!=':
          result = contextValue != compareValue;
          break;
      }
      
      if (this.debug) console.log(`DEBUG: Condition ${condition} evaluated to ${result} (${contextValue} ${operator} ${compareValue})`);
      
      return result;
    } catch (error) {
      if (this.debug) console.log('DEBUG: Error evaluating condition:', error);
      return false;
    }
  }

  // Format actions for LLM consumption
  private formatActionsForLLM(actions: Record<string, ActionDefinition>): Record<string, any> {
    if (this.debug) console.log('DEBUG: Formatting actions for LLM');
    
    const formatted: Record<string, any> = {};
    
    for (const [actionName, action] of Object.entries(actions)) {
      formatted[actionName] = {
        description: action.description,
        usage_context: action.usage_context,
        parameters: action.parameters,
        rules: action.rules,
        output_guidance: action.output_guidance        
      };
    }
    
    return formatted;
  }
}