/**
 * V4 Plugin Helper Utilities (100% Generic)
 *
 * Helper functions for plugin name normalization, alias generation,
 * and capability matching. All functions are data-driven with zero hardcoding.
 */

import { IPluginContext } from '@/lib/types/plugin-definition-context';

/**
 * Generate aliases from plugin display name and key
 * Examples:
 * - "Google Mail", "google-mail" → ["google", "mail", "googlemail", "email"]
 * - "HubSpot", "hubspot" → ["hubspot", "hub", "spot", "crm"]
 */
export function generatePluginAliases(displayName: string, pluginKey: string): string[] {
  const aliases = new Set<string>();

  // Add the plugin key itself
  aliases.add(pluginKey.toLowerCase());

  // Split display name by spaces and hyphens
  const displayParts = displayName.toLowerCase().split(/[\s-]/);
  displayParts.forEach(part => {
    if (part.length > 2) { // Ignore very short words
      aliases.add(part);
    }
  });

  // Add concatenated version without spaces/hyphens
  const concatenated = displayName.toLowerCase().replace(/[\s-]/g, '');
  if (concatenated.length > 3) {
    aliases.add(concatenated);
  }

  // Split plugin key by hyphens
  const keyParts = pluginKey.toLowerCase().split('-');
  keyParts.forEach(part => {
    if (part.length > 2) {
      aliases.add(part);
    }
  });

  return Array.from(aliases);
}

/**
 * Generate aliases from capability names
 * Examples:
 * - "read_email" → ["email", "read"]
 * - "send_message" → ["message", "send"]
 */
export function generateCapabilityAliases(capability: string): string[] {
  const aliases = new Set<string>();

  // Split by underscores
  const parts = capability.toLowerCase().split('_');

  // Add significant parts (nouns, not verbs)
  const nounIndicators = ['email', 'message', 'contact', 'event', 'task', 'file', 'document', 'sheet', 'calendar', 'note', 'page'];

  parts.forEach(part => {
    // Add if it's a noun indicator or longer than 4 characters
    if (nounIndicators.includes(part) || part.length > 4) {
      aliases.add(part);
    }
  });

  return Array.from(aliases);
}

/**
 * Normalize plugin name to standard format
 * Handles various input formats and returns canonical plugin key
 */
export function normalizePluginName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Match text against plugin aliases to find plugin key
 * Returns null if no match found
 */
export function matchPluginFromText(
  text: string,
  pluginAliasMap: Map<string, string>
): string | null {
  const lowerText = text.toLowerCase();

  // Check each alias
  for (const [alias, pluginKey] of pluginAliasMap.entries()) {
    if (lowerText.includes(alias)) {
      return pluginKey;
    }
  }

  return null;
}

/**
 * Match capability against text
 * Returns array of matching capabilities
 */
export function matchCapabilitiesFromText(
  text: string,
  pluginCapabilityMap: Map<string, string[]>
): string[] {
  const lowerText = text.toLowerCase();
  const matchedCapabilities: string[] = [];

  // Check all capabilities across all plugins
  for (const capabilities of pluginCapabilityMap.values()) {
    for (const capability of capabilities) {
      // Split capability into parts (e.g., "read_email" → ["read", "email"])
      const parts = capability.split('_');

      // Check if text contains all parts
      const hasAllParts = parts.every(part => lowerText.includes(part));

      if (hasAllParts && !matchedCapabilities.includes(capability)) {
        matchedCapabilities.push(capability);
      }
    }
  }

  return matchedCapabilities;
}

/**
 * Extract keywords from text for action matching
 * Removes common stop words and extracts meaningful terms
 */
export function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this',
    'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they'
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
}

/**
 * Build plugin context string for LLM prompts
 * Creates formatted plugin information with capabilities
 */
export function buildPluginContextForLLM(plugins: IPluginContext[]): string {
  if (plugins.length === 0) {
    return 'No plugins available.';
  }

  return plugins
    .map(plugin => {
      const capabilities = plugin.capabilities?.join(', ') || 'none';
      return `- ${plugin.displayName} (${plugin.key}): ${capabilities}`;
    })
    .join('\n');
}

/**
 * Find plugin by category
 * Returns first plugin matching the category, or null if none found
 */
export function findPluginByCategory(
  category: string,
  plugins: IPluginContext[]
): IPluginContext | null {
  return plugins.find(p => p.category.toLowerCase() === category.toLowerCase()) || null;
}

/**
 * Find plugins with specific capability
 * Returns all plugins that have the given capability
 */
export function findPluginsWithCapability(
  capability: string,
  plugins: IPluginContext[]
): IPluginContext[] {
  return plugins.filter(p =>
    p.capabilities?.some(cap =>
      cap.toLowerCase().includes(capability.toLowerCase())
    )
  );
}

/**
 * Score plugin relevance to intent text
 * Higher score = more relevant
 */
export function scorePluginRelevance(
  plugin: IPluginContext,
  intentText: string
): number {
  let score = 0;
  const lowerIntent = intentText.toLowerCase();

  // Check plugin name
  if (lowerIntent.includes(plugin.key.toLowerCase())) {
    score += 10;
  }

  if (lowerIntent.includes(plugin.displayName.toLowerCase())) {
    score += 10;
  }

  // Check category
  if (lowerIntent.includes(plugin.category.toLowerCase())) {
    score += 5;
  }

  // Check capabilities
  for (const capability of plugin.capabilities || []) {
    const capParts = capability.split('_');
    if (capParts.every(part => lowerIntent.includes(part))) {
      score += 3;
    }
  }

  return score;
}
