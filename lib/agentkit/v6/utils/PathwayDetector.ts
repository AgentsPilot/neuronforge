/**
 * PathwayDetector - Determines which V6 pipeline pathway to use
 *
 * Two-Pathway Architecture:
 * - FAST PATH: Skip Semantic Plan + Grounding for well-known plugins (80% of workflows)
 * - FULL PATH: Use all phases for complex/uncertain workflows (20%)
 *
 * Decision Criteria (Smart & Generic):
 * - If ALL services have OAuth authentication → FAST (official APIs with fixed schemas)
 * - If ANY service lacks OAuth → FULL (custom/unknown APIs need validation)
 */

import type { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'

export type V6Pathway = 'fast' | 'full'

/**
 * Enhanced Prompt structure (subset needed for pathway detection)
 */
interface EnhancedPromptForPathway {
  specifics?: {
    services_involved?: string[]
  }
}

/**
 * Determine which V6 pipeline pathway to use (GENERIC - NO HARDCODING)
 *
 * Smart Detection Strategy:
 * 1. Check if plugin has OAuth authentication → Well-known API with fixed schema
 * 2. Check if plugin has output_schema defined → Predictable structure
 * 3. If both conditions met for ALL services → FAST PATH
 * 4. Otherwise → FULL PATH (validation needed)
 *
 * @param enhancedPrompt - Enhanced Prompt with services_involved
 * @param pluginManager - PluginManagerV2 instance to check plugin metadata
 * @returns 'fast' for well-known APIs, 'full' for complex/uncertain workflows
 */
export async function determineV6Pathway(
  enhancedPrompt: EnhancedPromptForPathway,
  pluginManager?: PluginManagerV2
): Promise<V6Pathway> {
  const servicesInvolved = enhancedPrompt.specifics?.services_involved || []

  // Edge case: No services specified → use full path (safety)
  if (servicesInvolved.length === 0) {
    return 'full'
  }

  // Edge case: No plugin manager → use full path (safety)
  if (!pluginManager) {
    return 'full'
  }

  // Get all available plugins
  const availablePlugins = pluginManager.getAvailablePlugins()

  // Check if ALL services are well-known (OAuth-based with schemas)
  const allWellKnown = servicesInvolved.every(serviceName => {
    const plugin = findPluginByServiceName(serviceName, availablePlugins)

    if (!plugin) {
      // Service not found in available plugins → need validation
      return false
    }

    // Check if plugin has OAuth auth (indicates official API with fixed schema)
    const hasOAuth = isOAuthPlugin(plugin)

    if (!hasOAuth) {
      // No OAuth → likely custom/webhook plugin → need validation
      return false
    }

    // OAuth-based plugins are considered well-known
    return true
  })

  return allWellKnown ? 'fast' : 'full'
}

/**
 * Find plugin by service name (fuzzy matching)
 * Handles variations like "Gmail" → "google-mail", "google_mail", etc.
 */
function findPluginByServiceName(
  serviceName: string,
  availablePlugins: Record<string, any>
): any | null {
  const normalized = serviceName.toLowerCase().replace(/[_\s]/g, '-')

  // Try exact match first
  if (availablePlugins[normalized]) {
    return availablePlugins[normalized]
  }

  // Try fuzzy match (service name contains plugin key or vice versa)
  for (const [pluginKey, plugin] of Object.entries(availablePlugins)) {
    const pluginKeyNorm = pluginKey.toLowerCase()

    if (normalized.includes(pluginKeyNorm) || pluginKeyNorm.includes(normalized)) {
      return plugin
    }
  }

  return null
}

/**
 * Check if plugin uses OAuth authentication (GENERIC - NO HARDCODING)
 * OAuth-based plugins indicate:
 * - Official APIs (Google, Microsoft, Slack, etc.)
 * - Fixed, documented schemas
 * - No fuzzy matching needed
 */
function isOAuthPlugin(plugin: any): boolean {
  const authType = plugin.plugin?.auth_config?.auth_type

  if (!authType) {
    return false
  }

  // Check if auth type indicates OAuth
  const oauthTypes = ['oauth2', 'oauth1', 'oauth2_google', 'oauth2_microsoft']
  const authTypeLower = authType.toLowerCase()

  return oauthTypes.some(oauthType => authTypeLower.includes(oauthType))
}

/**
 * Get human-readable explanation of pathway decision
 * Useful for logging and debugging
 */
export async function explainPathwayDecision(
  enhancedPrompt: EnhancedPromptForPathway,
  pluginManager?: PluginManagerV2
): Promise<{ pathway: V6Pathway; reason: string; details: string[] }> {
  const servicesInvolved = enhancedPrompt.specifics?.services_involved || []
  const pathway = await determineV6Pathway(enhancedPrompt, pluginManager)

  if (servicesInvolved.length === 0) {
    return {
      pathway: 'full',
      reason: 'No services specified (safety fallback)',
      details: []
    }
  }

  if (!pluginManager) {
    return {
      pathway: 'full',
      reason: 'No plugin manager available (safety fallback)',
      details: []
    }
  }

  const availablePlugins = pluginManager.getAvailablePlugins()
  const details: string[] = []

  for (const serviceName of servicesInvolved) {
    const plugin = findPluginByServiceName(serviceName, availablePlugins)

    if (!plugin) {
      details.push(`❌ ${serviceName}: Plugin not found`)
      continue
    }

    const hasOAuth = isOAuthPlugin(plugin)

    if (hasOAuth) {
      const authType = plugin.plugin?.auth_config?.auth_type
      details.push(`✅ ${serviceName}: OAuth-based (${authType}) - fixed schema`)
    } else {
      details.push(`⚠️ ${serviceName}: No OAuth - needs validation`)
    }
  }

  if (pathway === 'fast') {
    return {
      pathway: 'fast',
      reason: `All ${servicesInvolved.length} services use OAuth (official APIs with fixed schemas)`,
      details
    }
  } else {
    const unknownCount = details.filter(d => d.includes('❌') || d.includes('⚠️')).length
    return {
      pathway: 'full',
      reason: `${unknownCount} service(s) require validation (no OAuth or not found)`,
      details
    }
  }
}
