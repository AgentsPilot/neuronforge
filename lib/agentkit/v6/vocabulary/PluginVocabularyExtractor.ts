/**
 * Plugin Vocabulary Extractor
 *
 * Extracts domains, capabilities, and action metadata from connected plugins
 * to inject into LLM prompts for accurate IntentContract generation.
 */

import type { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'
import type { PluginDefinition, ActionDefinition } from '@/lib/types/plugin-types'
import { createLogger } from '@/lib/logger'
import { summarizeOutputSchema, formatSummaryForPrompt } from './outputSchemaSummarizer'

const logger = createLogger({ module: 'PluginVocabularyExtractor', service: 'V6' })

export interface ActionParamInfo {
  name: string
  type: string
  required: boolean
  description?: string
  format?: string       // e.g., "email", "Gmail search syntax"
  enum?: string[]       // allowed values
  default?: any
}

/**
 * Describes a condition under which certain output fields are unpopulated.
 * Declared on plugin action definitions as `output_dependencies`.
 * Surfaced in the LLM prompt as ⚠ coupling hints.
 *
 * Design doc: docs/v6/V6_WORKFLOW_DATA_SCHEMA_DESIGN_REBASE.md (Deep Dive A, §A.4 B.3)
 */
export interface OutputDependency {
  when_param: Record<string, any>   // e.g. { "content_level": "metadata" }
  unpopulated_fields: string[]      // e.g. ["body", "snippet"]
  message: string                   // human-readable warning for the LLM
}

export interface PluginActionInfo {
  plugin_key: string
  plugin_name: string
  action_name: string
  domain: string
  capability: string
  description: string
  input_params?: ActionParamInfo[]
  /** Compact summary of the action's output schema (field names + types) */
  output_summary?: string
  /** Coupling hints: fields that are empty unless a specific param is set */
  output_dependencies?: OutputDependency[]
}

export interface PluginVocabulary {
  domains: string[]
  capabilities: string[]
  plugins: {
    key: string
    name: string
    provider_family?: string
    domains: string[]
    capabilities: string[]
    actions: PluginActionInfo[]
  }[]
  userContext?: Array<{ key: string; value: string }>  // Optional: resolved user inputs from enhanced prompt
}

export class PluginVocabularyExtractor {
  constructor(private pluginManager: PluginManagerV2) {}

  /**
   * Extract complete vocabulary from user's connected plugins
   * Includes both user-connected plugins AND system plugins (isSystem: true)
   */
  async extract(userId: string, options?: { servicesInvolved?: string[] }): Promise<PluginVocabulary> {
    logger.info({ userId, servicesInvolved: options?.servicesInvolved }, '[PluginVocabularyExtractor] Extracting vocabulary from connected plugins')

    const connectedPlugins = await this.pluginManager.getExecutablePlugins(userId)

    // Also get system plugins that are always available
    const allPlugins = this.pluginManager.getAvailablePlugins()
    const systemPlugins = Object.entries(allPlugins)
      .filter(([_, plugin]) => plugin.plugin.isSystem === true)
      .filter(([key, _]) => !connectedPlugins[key]) // Don't duplicate

    // Merge system plugins into connectedPlugins
    for (const [key, definition] of systemPlugins) {
      connectedPlugins[key] = {
        definition,
        connection: {
          user_id: userId,
          plugin_key: key,
          plugin_name: key,
          username: 'system',
          status: 'active',
          access_token: 'system',
          refresh_token: null,
          expires_at: null,
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      }
    }

    // Filter by services_involved if specified
    // ALWAYS include system plugins (they're available for all use cases)
    let filteredPlugins = connectedPlugins
    if (options?.servicesInvolved && options.servicesInvolved.length > 0) {
      const serviceKeys = new Set(options.servicesInvolved)
      const systemPluginKeys = new Set(systemPlugins.map(([key, _]) => key))

      filteredPlugins = Object.fromEntries(
        Object.entries(connectedPlugins).filter(([key, _]) =>
          serviceKeys.has(key) || systemPluginKeys.has(key) // Include if in services_involved OR is system plugin
        )
      )

      logger.info(
        {
          requested: options.servicesInvolved.length,
          systemPlugins: systemPluginKeys.size,
          totalInVocabulary: Object.keys(filteredPlugins).length,
          plugins: Object.keys(filteredPlugins)
        },
        '[PluginVocabularyExtractor] Filtered to services_involved + system plugins'
      )
    }

    logger.info(
      {
        userConnected: Object.keys(await this.pluginManager.getExecutablePlugins(userId)).length,
        systemAdded: systemPlugins.length,
        totalAvailable: Object.keys(connectedPlugins).length,
        vocabularyPlugins: Object.keys(filteredPlugins).length
      },
      '[PluginVocabularyExtractor] Plugins loaded'
    )

    const allDomains = new Set<string>()
    const allCapabilities = new Set<string>()
    const pluginInfos: PluginVocabulary['plugins'] = []

    for (const [pluginKey, actionablePlugin] of Object.entries(filteredPlugins)) {
      const plugin = actionablePlugin.definition
      const pluginDomains = new Set<string>()
      const pluginCapabilities = new Set<string>()
      const actions: PluginActionInfo[] = []

      // Extract from each action
      for (const [actionName, action] of Object.entries(plugin.actions)) {
        if (action.domain) {
          allDomains.add(action.domain)
          pluginDomains.add(action.domain)
        }

        if (action.capability) {
          allCapabilities.add(action.capability)
          pluginCapabilities.add(action.capability)
        }

        if (action.domain && action.capability) {
          const actionInfo: PluginActionInfo = {
            plugin_key: pluginKey,
            plugin_name: plugin.plugin.name,
            action_name: actionName,
            domain: action.domain,
            capability: action.capability,
            description: action.description,
          }

          // Extract input parameters from action schema
          if (action.parameters?.properties) {
            actionInfo.input_params = this.extractParamInfo(action)
          }

          // Extract output schema summary (Direction #1 — Deep Dive A)
          if (action.output_schema) {
            const summary = summarizeOutputSchema(action.output_schema)
            if (summary) {
              actionInfo.output_summary = formatSummaryForPrompt(summary)
            }
          }

          // Extract output dependencies / coupling hints
          if ((action as any).output_dependencies) {
            actionInfo.output_dependencies = (action as any).output_dependencies
          }

          actions.push(actionInfo)
        }
      }

      pluginInfos.push({
        key: pluginKey,
        name: plugin.plugin.name,
        provider_family: plugin.plugin.provider_family,
        domains: Array.from(pluginDomains).sort(),
        capabilities: Array.from(pluginCapabilities).sort(),
        actions,
      })
    }

    const vocabulary: PluginVocabulary = {
      domains: Array.from(allDomains).sort(),
      capabilities: Array.from(allCapabilities).sort(),
      plugins: pluginInfos.sort((a, b) => a.name.localeCompare(b.name)),
    }

    logger.info(
      {
        domainCount: vocabulary.domains.length,
        capabilityCount: vocabulary.capabilities.length,
        pluginCount: vocabulary.plugins.length,
      },
      '[PluginVocabularyExtractor] Vocabulary extraction complete'
    )

    return vocabulary
  }

  /**
   * Format vocabulary as text for LLM prompt injection
   */
  formatForPrompt(vocabulary: PluginVocabulary): string {
    const sections: string[] = []

    // Domains section
    sections.push('AVAILABLE DOMAINS (use these exact strings):')
    sections.push(vocabulary.domains.join(', '))
    sections.push('')

    // Capabilities section
    sections.push('AVAILABLE CAPABILITIES (use these exact strings):')
    sections.push(vocabulary.capabilities.join(', '))
    sections.push('')

    // Connected plugins section
    sections.push('CONNECTED PLUGINS:')
    for (const plugin of vocabulary.plugins) {
      sections.push(`\n- ${plugin.name} (${plugin.key})${plugin.provider_family ? ` [${plugin.provider_family}]` : ''}`)
      sections.push(`  Domains: ${plugin.domains.join(', ')}`)
      sections.push(`  Capabilities: ${plugin.capabilities.join(', ')}`)

      // Show all actions with input parameters
      sections.push(`  Actions:`)
      for (const action of plugin.actions) {
        sections.push(`    - ${action.action_name} (${action.domain}/${action.capability}): ${action.description}`)
        if (action.input_params && action.input_params.length > 0) {
          for (const param of action.input_params) {
            let line = `        ${param.required ? '*' : ' '} ${param.name}: ${param.type}`
            if (param.enum) line += ` [${param.enum.join(' | ')}]`
            if (param.default !== undefined) line += ` (default: ${JSON.stringify(param.default)})`
            if (param.description) line += ` — ${param.description}`
            sections.push(line)
          }
        }
      }
    }
    sections.push('\n(* = required parameter)')

    return sections.join('\n')
  }

  /**
   * Get usage guidance text for LLM
   */
  getUsageGuidance(): string {
    return `
IMPORTANT: When specifying "uses" fields in IntentSteps, you MUST use domains and
capabilities from the lists above. Do NOT invent new domain names.

Guidelines:
- Match the exact domain string (e.g., "email" not "messaging")
- Match the exact capability string (e.g., "search" not "find")
- Prefer provider_family that matches the user's connected plugins
- Use must_support for specific feature requirements

Examples:
- For Gmail search: domain="email", capability="search", provider_family="google"
- For Drive upload: domain="storage", capability="upload", provider_family="google"
- For Sheets append: domain="table", capability="create", provider_family="google"
- For AI extraction: domain="internal", capability="generate"
`.trim()
  }

  /**
   * Extract flattened parameter info from an action's parameter schema.
   * Handles nested objects by flattening to dot-notation (e.g., recipients.to).
   * Keeps descriptions concise — truncates at 120 chars.
   */
  private extractParamInfo(action: ActionDefinition): ActionParamInfo[] {
    const params: ActionParamInfo[] = []
    const requiredSet = new Set(action.parameters?.required || [])

    const flattenProps = (
      properties: Record<string, any>,
      parentRequired: Set<string>,
      prefix: string = ''
    ) => {
      for (const [name, prop] of Object.entries(properties)) {
        const fullName = prefix ? `${prefix}.${name}` : name
        const isRequired = parentRequired.has(name)

        // If it's a nested object with properties, flatten recursively
        if (prop.type === 'object' && prop.properties && !prop['x-variable-mapping'] && !prop['x-input-mapping']) {
          const nestedRequired = new Set<string>(prop.required || [])
          flattenProps(prop.properties, nestedRequired, fullName)
          continue
        }

        const paramInfo: ActionParamInfo = {
          name: fullName,
          type: prop.type || 'string',
          required: isRequired,
        }

        // Add description (truncated)
        if (prop.description) {
          paramInfo.description = prop.description.length > 120
            ? prop.description.slice(0, 117) + '...'
            : prop.description
        }

        // Add format hint (from JSON Schema format or enum)
        if (prop.format) {
          paramInfo.format = prop.format
        }
        if (prop.enum && prop.enum.length <= 8) {
          paramInfo.enum = prop.enum
        }
        if (prop.default !== undefined) {
          paramInfo.default = prop.default
        }

        params.push(paramInfo)
      }
    }

    if (action.parameters?.properties) {
      flattenProps(action.parameters.properties, requiredSet)
    }

    return params
  }
}
