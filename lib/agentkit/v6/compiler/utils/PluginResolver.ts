/**
 * Plugin Resolver Utility
 *
 * Maps IR concepts to actual plugin names and operations from the V2 plugin registry.
 * This ensures V6 compiler generates valid PILOT_DSL that can be executed by PluginExecuterV2.
 *
 * Key Responsibilities:
 * 1. Resolve plugin names (e.g., "gmail" → "google-mail")
 * 2. Find correct operation names (e.g., "read" → "read_range" for google-sheets)
 * 3. Validate plugins and operations exist
 * 4. Extract parameter schemas and output schemas
 */

import type { PluginManagerV2 } from '../../../../server/plugin-manager-v2'
import type { PluginDefinition, ActionDefinition } from '@/lib/types/plugin-types'

export interface PluginResolution {
  plugin_name: string
  operation: string
  action_def?: ActionDefinition
  parameters_schema?: any
  output_schema?: any
}

export class PluginResolver {
  private pluginManager?: PluginManagerV2
  private availablePlugins: Record<string, PluginDefinition> = {}

  constructor(pluginManager?: PluginManagerV2) {
    this.pluginManager = pluginManager

    if (pluginManager) {
      this.availablePlugins = pluginManager.getAvailablePlugins()
      console.log('[PluginResolver] Initialized with', Object.keys(this.availablePlugins).length, 'plugins')
    } else {
      console.log('[PluginResolver] ⚠ Running in legacy mode (no PluginManagerV2)')
    }
  }

  /**
   * Resolve tabular data source plugin and operation
   * Schema-driven: finds plugin by capability, not hardcoded name
   */
  resolveTabularDataSource(sourceHint?: string): PluginResolution {
    if (!this.pluginManager) {
      // Legacy fallback - find first available tabular plugin by capability
      const tabularPlugin = this.findPluginByCapability('tabular', 'read')
      if (!tabularPlugin) {
        throw new Error('[PluginResolver] No tabular plugin found in legacy mode. No plugins available.')
      }
      return {
        plugin_name: tabularPlugin,
        operation: 'read'
      }
    }

    // Determine plugin based on source hint OR find by capability
    const pluginName = sourceHint
      ? this.findPluginBySourceHint(sourceHint, 'tabular')
      : this.findPluginByCapability('tabular', 'read')

    if (!pluginName) {
      // CRITICAL FIX: Throw error instead of silently returning 'unknown'
      // This ensures compilation fails fast with a clear error message
      throw new Error(`[PluginResolver] No tabular plugin found for source hint: ${sourceHint || 'none'}. Available plugins: ${Object.keys(this.availablePlugins).join(', ')}`)
    }

    const operation = this.findReadOperation(pluginName)
    const actionDef = this.getActionDefinition(pluginName, operation)

    return {
      plugin_name: pluginName,
      operation,
      action_def: actionDef,
      parameters_schema: actionDef?.parameters,
      output_schema: actionDef?.output_schema
    }
  }

  /**
   * Resolve delivery plugin and operation generically
   * Works for ANY delivery plugin (email, slack, SMS, etc.)
   */
  resolveDelivery(
    pluginKey: string,
    operationType: 'send' | 'post' | 'publish' = 'send'
  ): PluginResolution {
    if (!this.pluginManager) {
      return {
        plugin_name: pluginKey,
        operation: `${operationType}_message`
      }
    }

    const operation = this.findOperationByType(pluginKey, operationType as any)
    const actionDef = this.getActionDefinition(pluginKey, operation)

    console.log(`[PluginResolver] ✓ Resolved ${pluginKey}.${operation} for delivery`)

    return {
      plugin_name: pluginKey,
      operation,
      action_def: actionDef,
      parameters_schema: actionDef?.parameters,
      output_schema: actionDef?.output_schema
    }
  }

  /**
   * Resolve email delivery plugin and operation
   * Schema-driven: finds first plugin with email send capability
   * @deprecated Use resolveDelivery() instead for plugin-agnostic approach
   */
  resolveEmailDelivery(): PluginResolution {
    // Find any email plugin by capability (not hardcoded name)
    const pluginName = this.findPluginByCapability('communication', 'send', ['email', 'mail'])

    if (!pluginName) {
      // CRITICAL FIX: Throw error instead of silently returning 'unknown'
      throw new Error(`[PluginResolver] No email plugin found. Available plugins: ${Object.keys(this.availablePlugins).join(', ')}`)
    }

    const operation = this.findSendEmailOperation(pluginName)
    const actionDef = this.getActionDefinition(pluginName, operation)

    return {
      plugin_name: pluginName,
      operation,
      action_def: actionDef,
      parameters_schema: actionDef?.parameters,
      output_schema: actionDef?.output_schema
    }
  }

  /**
   * Resolve data source plugin and operation generically
   * Works for ANY plugin by operation type (read, search, list, fetch, write, append, update, upsert, delete)
   */
  resolveDataSource(
    pluginKey: string,
    operationType: 'read' | 'search' | 'list' | 'fetch' | 'write' | 'append' | 'update' | 'upsert' | 'delete'
  ): PluginResolution {
    if (!this.pluginManager) {
      // Legacy fallback
      return {
        plugin_name: pluginKey,
        operation: operationType
      }
    }

    const operation = this.findOperationByType(pluginKey, operationType)
    const actionDef = this.getActionDefinition(pluginKey, operation)

    console.log(`[PluginResolver] ✓ Resolved ${pluginKey}.${operation} for ${operationType} operation`)

    return {
      plugin_name: pluginKey,
      operation,
      action_def: actionDef,
      parameters_schema: actionDef?.parameters,
      output_schema: actionDef?.output_schema
    }
  }

  /**
   * Resolve delivery method to plugin name (schema-driven)
   * This replaces all hardcoded pluginMap objects across the codebase
   * @param deliveryMethod - The delivery method from IR (e.g., 'email', 'slack', 'webhook')
   * @returns The plugin name to use
   */
  resolveDeliveryMethodToPlugin(deliveryMethod: string): string {
    // Define capability mapping for delivery methods
    const deliveryCapabilities: Record<string, { category: string; keywords: string[] }> = {
      email: { category: 'communication', keywords: ['email', 'mail'] },
      slack: { category: 'communication', keywords: ['message', 'slack'] },
      sms: { category: 'communication', keywords: ['sms', 'text'] },
      webhook: { category: 'any', keywords: ['http', 'request', 'post'] },
      api_call: { category: 'any', keywords: ['http', 'request', 'post'] },
      database: { category: 'database', keywords: ['insert', 'write', 'query'] },
      file: { category: 'file', keywords: ['write', 'save'] }
    }

    const capability = deliveryCapabilities[deliveryMethod]

    if (!capability) {
      // If delivery method is already a plugin name, return it
      if (this.availablePlugins[deliveryMethod]) {
        return deliveryMethod
      }
      console.warn(`[PluginResolver] Unknown delivery method: ${deliveryMethod}`)
      return deliveryMethod
    }

    // Find plugin by capability
    const plugin = this.findPluginByCapability(capability.category, 'send', capability.keywords)
      || this.findPluginByCapability(capability.category, 'post', capability.keywords)
      || this.findPluginByCapability('any', 'send', capability.keywords)

    if (plugin) {
      console.log(`[PluginResolver] ✓ Resolved delivery method "${deliveryMethod}" to plugin: ${plugin}`)
      return plugin
    }

    // Fallback: return method as-is (might be a plugin name)
    console.warn(`[PluginResolver] No plugin found for delivery method: ${deliveryMethod}`)
    return deliveryMethod
  }

  /**
   * Resolve Slack message delivery
   * @deprecated Use resolveDelivery() or resolveDeliveryMethodToPlugin() instead
   */
  resolveSlackDelivery(): PluginResolution {
    const pluginName = this.findPluginByCapability('communication', 'send', ['message', 'slack'])
    if (!pluginName) {
      throw new Error(`[PluginResolver] No messaging plugin found with send capability. Available plugins: ${Object.keys(this.availablePlugins).join(', ')}`)
    }
    const operation = this.findSendMessageOperation(pluginName)
    const actionDef = this.getActionDefinition(pluginName, operation)

    return {
      plugin_name: pluginName,
      operation,
      action_def: actionDef,
      parameters_schema: actionDef?.parameters,
      output_schema: actionDef?.output_schema
    }
  }

  /**
   * Resolve webhook/HTTP delivery
   * @deprecated Use resolveDelivery() or resolveDeliveryMethodToPlugin() instead
   */
  resolveWebhookDelivery(): PluginResolution {
    const pluginName = this.findPluginByCapability('any', 'post', ['http', 'request'])
    if (!pluginName) {
      throw new Error(`[PluginResolver] No HTTP plugin found with post capability. Available plugins: ${Object.keys(this.availablePlugins).join(', ')}`)
    }
    return {
      plugin_name: pluginName,
      operation: 'post'
    }
  }

  /**
   * Resolve database delivery
   * @deprecated Use resolveDelivery() or resolveDeliveryMethodToPlugin() instead
   */
  resolveDatabaseDelivery(operation: string = 'insert'): PluginResolution {
    const pluginName = this.findPluginByCapability('database', 'insert')
    if (!pluginName) {
      throw new Error(`[PluginResolver] No database plugin found with insert capability. Available plugins: ${Object.keys(this.availablePlugins).join(', ')}`)
    }
    return {
      plugin_name: pluginName,
      operation
    }
  }

  // ============================================================================
  // Private Helper Methods - Schema-Driven (No Hardcoded Plugin Names)
  // ============================================================================

  /**
   * Find plugin by capability (schema-driven, no hardcoding)
   * @param category - Plugin category (e.g., 'tabular', 'communication', 'api')
   * @param operationType - Required operation type (e.g., 'read', 'send')
   * @param actionKeywords - Optional keywords to match in action names
   */
  private findPluginByCapability(
    category: string,
    operationType: string,
    actionKeywords?: string[]
  ): string | null {
    for (const [pluginName, plugin] of Object.entries(this.availablePlugins)) {
      // Check if plugin matches category (via plugin.plugin.category or infer from actions)
      const pluginCategory = plugin.plugin?.category || this.inferPluginCategory(plugin)

      if (pluginCategory !== category && category !== 'any') {
        continue
      }

      // Check if plugin has required operation type
      const hasOperation = Object.keys(plugin.actions).some(actionName => {
        const actionLower = actionName.toLowerCase()

        // Check operation type
        if (!actionLower.includes(operationType)) {
          return false
        }

        // Check action keywords if provided
        if (actionKeywords && actionKeywords.length > 0) {
          return actionKeywords.some(kw => actionLower.includes(kw.toLowerCase()))
        }

        return true
      })

      if (hasOperation) {
        console.log(`[PluginResolver] ✓ Found ${category} plugin with ${operationType} capability: ${pluginName}`)
        return pluginName
      }
    }

    return null
  }

  /**
   * Find plugin by source hint (schema-driven matching)
   * Matches source hint against plugin name and plugin description
   */
  private findPluginBySourceHint(sourceHint: string, preferredCategory?: string): string | null {
    const lowerHint = sourceHint.toLowerCase()

    // First pass: exact or partial plugin name match
    for (const [pluginName, plugin] of Object.entries(this.availablePlugins)) {
      const pluginNameLower = pluginName.toLowerCase()
      const pluginDesc = (plugin.plugin?.description || '').toLowerCase()

      // Check if hint matches plugin name or description
      if (pluginNameLower.includes(lowerHint) || lowerHint.includes(pluginNameLower)) {
        console.log(`[PluginResolver] ✓ Matched plugin by name: ${pluginName}`)
        return pluginName
      }

      // Check common variations in hint against plugin name parts
      const pluginParts = pluginNameLower.split('-')
      if (pluginParts.some(part => lowerHint.includes(part) && part.length > 2)) {
        console.log(`[PluginResolver] ✓ Matched plugin by name part: ${pluginName}`)
        return pluginName
      }
    }

    // Second pass: match by category if specified
    if (preferredCategory) {
      return this.findPluginByCapability(preferredCategory, 'read')
    }

    return null
  }

  /**
   * Infer plugin category from its actions (when category not explicitly set)
   */
  private inferPluginCategory(plugin: PluginDefinition): string {
    const actionNames = Object.keys(plugin.actions).map(a => a.toLowerCase())

    // Check for tabular operations
    if (actionNames.some(a => a.includes('read_range') || a.includes('write_range') || a.includes('spreadsheet'))) {
      return 'tabular'
    }

    // Check for communication operations
    if (actionNames.some(a => a.includes('send') && (a.includes('email') || a.includes('message')))) {
      return 'communication'
    }

    // Check for search/list operations (API-like)
    if (actionNames.some(a => a.includes('search') || a.includes('list'))) {
      return 'api'
    }

    return 'unknown'
  }

  /**
   * Find read operation for a plugin
   */
  private findReadOperation(pluginName: string): string {
    console.log(`[PluginResolver] findReadOperation called for: ${pluginName}`)
    const plugin = this.availablePlugins[pluginName]

    if (!plugin) {
      console.warn(`[PluginResolver] Plugin not found: ${pluginName}, using fallback`)
      return 'read'
    }

    if (!plugin.actions || typeof plugin.actions !== 'object') {
      console.warn(`[PluginResolver] Plugin ${pluginName} has invalid actions, using fallback`)
      return 'read'
    }

    // Search for read-like operations
    const readKeywords = ['read', 'get', 'fetch', 'retrieve', 'list', 'query']
    const actionNames = Object.keys(plugin.actions)
    console.log(`[PluginResolver] Available actions for ${pluginName}:`, actionNames)

    // Actions is an object with action names as keys
    for (const [actionName, actionDef] of Object.entries(plugin.actions)) {
      const actionNameLower = actionName.toLowerCase()

      // Check if action name contains any read keyword
      if (readKeywords.some(keyword => actionNameLower.includes(keyword))) {
        // Prefer "read_range" over just "read"
        if (actionNameLower.includes('range')) {
          console.log(`[PluginResolver] ✓ Found read operation with range: ${actionName}`)
          return actionName
        }
      }
    }

    // Second pass: just find first read-like action
    for (const [actionName, actionDef] of Object.entries(plugin.actions)) {
      const actionNameLower = actionName.toLowerCase()
      if (readKeywords.some(keyword => actionNameLower.includes(keyword))) {
        console.log(`[PluginResolver] ✓ Found read operation: ${actionName}`)
        return actionName
      }
    }

    console.warn(`[PluginResolver] No read operation found for ${pluginName}, using fallback`)
    return 'read'
  }

  /**
   * Find email plugin (schema-driven, no hardcoded preference)
   * @deprecated Use findPluginByCapability('communication', 'send', ['email', 'mail']) instead
   */
  private findEmailPlugin(): string {
    // Schema-driven: find any plugin with email send capability
    const emailPlugin = this.findPluginByCapability('communication', 'send', ['email', 'mail'])

    if (emailPlugin) {
      return emailPlugin
    }

    // Fallback: find any communication plugin with send capability
    const commPlugin = this.findPluginByCapability('communication', 'send')

    if (commPlugin) {
      console.warn(`[PluginResolver] No email-specific plugin found, using ${commPlugin}`)
      return commPlugin
    }

    // CRITICAL FIX: Throw error instead of silently returning 'unknown'
    throw new Error(`[PluginResolver] No email plugin found. Available plugins: ${Object.keys(this.availablePlugins).join(', ')}`)
  }

  /**
   * Find send email operation for a plugin
   */
  private findSendEmailOperation(pluginName: string): string {
    const plugin = this.availablePlugins[pluginName]

    if (!plugin) {
      console.warn(`[PluginResolver] Plugin not found: ${pluginName}, using fallback`)
      return 'send_email'
    }

    // Search for send email operation
    for (const [actionName, actionDef] of Object.entries(plugin.actions)) {
      const actionNameLower = actionName.toLowerCase()
      if (actionNameLower.includes('send') && (actionNameLower.includes('email') || actionNameLower.includes('mail'))) {
        return actionName
      }
    }

    console.warn(`[PluginResolver] No send email operation found for ${pluginName}, using fallback`)
    return 'send_email'
  }

  /**
   * Find operation by type (generic method for any plugin)
   * This replaces hardcoded operation searches
   */
  private findOperationByType(
    pluginName: string,
    operationType: 'read' | 'search' | 'list' | 'fetch' | 'send' | 'post' | 'publish' | 'write' | 'append' | 'update' | 'upsert' | 'delete' | string
  ): string {
    const plugin = this.availablePlugins[pluginName]

    if (!plugin) {
      console.warn(`[PluginResolver] Plugin not found: ${pluginName}, using fallback`)
      return operationType
    }

    // Normalize operation type: if it's an action name (contains underscore), extract semantic type
    // This handles cases where IR specifies exact action names like "write_range" or "append_rows"
    let normalizedOpType = operationType
    if (operationType.includes('_')) {
      const firstPart = operationType.split('_')[0]
      const knownSemanticTypes = ['read', 'search', 'list', 'fetch', 'send', 'post', 'publish', 'write', 'append', 'update', 'upsert', 'delete']
      if (knownSemanticTypes.includes(firstPart)) {
        console.log(`[PluginResolver] Normalized operation type: ${operationType} → ${firstPart}`)
        normalizedOpType = firstPart
      }
    }

    // Define keywords for each operation type
    const keywords: Record<string, string[]> = {
      read: ['read', 'get', 'fetch', 'retrieve'],
      search: ['search', 'query', 'find', 'list'],
      list: ['list', 'get_all', 'fetch_all', 'search'],
      fetch: ['fetch', 'get', 'retrieve'],
      send: ['send', 'post', 'create', 'deliver'],
      post: ['post', 'send', 'create', 'publish'],
      publish: ['publish', 'post', 'send', 'create'],
      write: ['write', 'create', 'insert', 'add'],
      append: ['append', 'add_rows', 'insert_rows', 'write'],
      update: ['update', 'modify', 'edit', 'patch'],
      upsert: ['upsert', 'insert_or_update', 'merge'],
      delete: ['delete', 'remove', 'destroy']
    }

    // Use normalized operation type for keyword lookup
    const operationKeywords = keywords[normalizedOpType] || [normalizedOpType]
    const actionNames = Object.keys(plugin.actions)

    console.log(`[PluginResolver] Finding ${operationType} operation for ${pluginName} (normalized: ${normalizedOpType})`)
    console.log(`[PluginResolver] Available actions:`, actionNames)
    console.log(`[PluginResolver] Using keywords:`, operationKeywords)

    // First pass: Look for actions marked as "PREFERRED" in their usage_context
    // This respects plugin-defined preferences without hardcoding
    //
    // Key insight: When IR requests "write_range" but plugin marks "append_rows" as PREFERRED,
    // we should use append_rows. The PREFERRED action's usage_context should describe
    // the semantic use cases (e.g., "adding", "logging", "saving") that we match against.
    for (const [actionName, actionDef] of Object.entries(plugin.actions)) {
      const usageContext = ((actionDef as any)?.usage_context || '').toLowerCase()
      const actionNameLower = actionName.toLowerCase()

      // Check if this action is marked as PREFERRED
      if (usageContext.includes('preferred')) {
        // Check if the PREFERRED action is semantically relevant to the requested operation
        // For "write" operations, "append" is often the better choice for adding data
        const semanticMatches =
          // Direct keyword match in action name
          operationKeywords.some(kw => actionNameLower.includes(kw)) ||
          // Keyword appears in usage_context
          operationKeywords.some(kw => usageContext.includes(kw)) ||
          // Semantic equivalence: write/append are related operations for adding data
          (normalizedOpType === 'write' && (actionNameLower.includes('append') || usageContext.includes('adding') || usageContext.includes('saving'))) ||
          (normalizedOpType === 'append' && (actionNameLower.includes('write') || actionNameLower.includes('insert')))

        if (semanticMatches) {
          console.log(`[PluginResolver] ✓ Found PREFERRED action from usage_context: ${actionName}`)
          return actionName
        }
      }
    }

    // Second pass: Check for exact action name match, but skip if usage_context says not to use it
    if (plugin.actions[operationType]) {
      const actionDef = plugin.actions[operationType] as any
      const usageContext = (actionDef?.usage_context || '').toLowerCase()

      // Skip this action if usage_context discourages it (contains "do not use" or "only use when")
      const isDiscouraged = usageContext.includes('do not use') ||
                            usageContext.includes("don't use") ||
                            usageContext.includes('only use when')

      if (!isDiscouraged) {
        console.log(`[PluginResolver] ✓ Exact action match: ${operationType}`)
        return operationType
      } else {
        console.log(`[PluginResolver] ⚠ Action ${operationType} is discouraged by usage_context, looking for alternatives...`)
      }
    }

    // Third pass: Check for semantic intent matches
    // For append operations, find append actions
    if (normalizedOpType === 'append') {
      for (const [actionName, actionDef] of Object.entries(plugin.actions)) {
        const actionNameLower = actionName.toLowerCase()
        if (actionNameLower.includes('append')) {
          console.log(`[PluginResolver] ✓ Found append action: ${actionName}`)
          return actionName
        }
      }
    }

    // For write operations where write_range was discouraged, try append_rows
    // This handles the case where IR says "write_range" but plugin prefers append for data adding
    if (normalizedOpType === 'write') {
      for (const [actionName, actionDef] of Object.entries(plugin.actions)) {
        const actionNameLower = actionName.toLowerCase()
        const usageContext = ((actionDef as any)?.usage_context || '').toLowerCase()
        // Look for append/add operations that are PREFERRED or commonly used for adding data
        if ((actionNameLower.includes('append') || actionNameLower.includes('add_rows')) &&
            (usageContext.includes('preferred') || usageContext.includes('adding') || usageContext.includes('logging'))) {
          console.log(`[PluginResolver] ✓ Found append action as alternative to write: ${actionName}`)
          return actionName
        }
      }
    }

    // For read operations, prefer "range" actions (more specific)
    if (normalizedOpType === 'read') {
      for (const [actionName, actionDef] of Object.entries(plugin.actions)) {
        const actionNameLower = actionName.toLowerCase()
        if (actionNameLower.includes('range') && actionNameLower.includes('read')) {
          console.log(`[PluginResolver] ✓ Found read_range action: ${actionName}`)
          return actionName
        }
      }
    }

    // Fourth pass: find first matching action by keywords
    for (const [actionName, actionDef] of Object.entries(plugin.actions)) {
      const actionNameLower = actionName.toLowerCase()
      if (operationKeywords.some(keyword => actionNameLower.includes(keyword))) {
        console.log(`[PluginResolver] ✓ Found ${normalizedOpType} operation: ${actionName}`)
        return actionName
      }
    }

    console.warn(`[PluginResolver] No ${operationType} operation found for ${pluginName}, using fallback`)
    return operationType
  }

  /**
   * Find send message operation (for Slack, Discord, etc.)
   */
  private findSendMessageOperation(pluginName: string): string {
    const plugin = this.availablePlugins[pluginName]

    if (!plugin) {
      return 'send_message'
    }

    // Search for send message operation
    for (const [actionName, actionDef] of Object.entries(plugin.actions)) {
      const actionNameLower = actionName.toLowerCase()
      if (actionNameLower.includes('send') && actionNameLower.includes('message')) {
        return actionName
      }
    }

    // Try "post_message" (common in Slack)
    for (const [actionName, actionDef] of Object.entries(plugin.actions)) {
      if (actionName.toLowerCase().includes('post')) {
        return actionName
      }
    }

    return 'send_message'
  }

  /**
   * Get action definition for validation
   */
  private getActionDefinition(pluginName: string, actionName: string): ActionDefinition | undefined {
    const plugin = this.availablePlugins[pluginName]

    if (!plugin) {
      return undefined
    }

    return plugin.actions[actionName]
  }

  /**
   * Validate plugin and operation exist
   */
  validatePluginOperation(pluginName: string, operation: string): boolean {
    if (!this.pluginManager) {
      // Skip validation in legacy mode
      return true
    }

    const plugin = this.availablePlugins[pluginName]

    if (!plugin) {
      console.error(`[PluginResolver] ✗ Plugin not found: ${pluginName}`)
      return false
    }

    const action = plugin.actions[operation]

    if (!action) {
      console.error(`[PluginResolver] ✗ Operation not found: ${pluginName}.${operation}`)
      console.error(`[PluginResolver]   Available operations: ${Object.keys(plugin.actions).join(', ')}`)
      return false
    }

    return true
  }

  /**
   * Get all available plugin names
   */
  getAvailablePluginNames(): string[] {
    return Object.keys(this.availablePlugins)
  }

  /**
   * Get plugin definition
   */
  getPluginDefinition(pluginName: string): PluginDefinition | undefined {
    return this.availablePlugins[pluginName]
  }
}

/**
 * Create a plugin resolver instance
 */
export function createPluginResolver(pluginManager?: PluginManagerV2): PluginResolver {
  return new PluginResolver(pluginManager)
}
