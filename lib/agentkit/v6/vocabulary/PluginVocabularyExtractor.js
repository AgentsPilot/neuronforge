/**
 * Plugin Vocabulary Extractor
 *
 * Extracts domains, capabilities, and action metadata from connected plugins
 * to inject into LLM prompts for accurate IntentContract generation.
 */
import { createLogger } from '@/lib/logger';
const logger = createLogger({ module: 'PluginVocabularyExtractor', service: 'V6' });
export class PluginVocabularyExtractor {
    constructor(pluginManager) {
        this.pluginManager = pluginManager;
    }
    /**
     * Extract complete vocabulary from user's connected plugins
     * Includes both user-connected plugins AND system plugins (isSystem: true)
     */
    async extract(userId, options) {
        logger.info({ userId, servicesInvolved: options?.servicesInvolved }, '[PluginVocabularyExtractor] Extracting vocabulary from connected plugins');
        const connectedPlugins = await this.pluginManager.getExecutablePlugins(userId);
        // Also get system plugins that are always available
        const allPlugins = this.pluginManager.getAvailablePlugins();
        const systemPlugins = Object.entries(allPlugins)
            .filter(([_, plugin]) => plugin.plugin.isSystem === true)
            .filter(([key, _]) => !connectedPlugins[key]); // Don't duplicate
        // Merge system plugins into connectedPlugins
        for (const [key, definition] of systemPlugins) {
            connectedPlugins[key] = {
                definition,
                connection: {
                    userId,
                    pluginKey: key,
                    username: 'system',
                    status: 'active',
                    accessToken: 'system',
                    refreshToken: null,
                    expiresAt: null,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                }
            };
        }
        // Filter by services_involved if specified
        // ALWAYS include system plugins (they're available for all use cases)
        let filteredPlugins = connectedPlugins;
        if (options?.servicesInvolved && options.servicesInvolved.length > 0) {
            const serviceKeys = new Set(options.servicesInvolved);
            const systemPluginKeys = new Set(systemPlugins.map(([key, _]) => key));
            filteredPlugins = Object.fromEntries(Object.entries(connectedPlugins).filter(([key, _]) => serviceKeys.has(key) || systemPluginKeys.has(key) // Include if in services_involved OR is system plugin
            ));
            logger.info({
                requested: options.servicesInvolved.length,
                systemPlugins: systemPluginKeys.size,
                totalInVocabulary: Object.keys(filteredPlugins).length,
                plugins: Object.keys(filteredPlugins)
            }, '[PluginVocabularyExtractor] Filtered to services_involved + system plugins');
        }
        logger.info({
            userConnected: Object.keys(await this.pluginManager.getExecutablePlugins(userId)).length,
            systemAdded: systemPlugins.length,
            totalAvailable: Object.keys(connectedPlugins).length,
            vocabularyPlugins: Object.keys(filteredPlugins).length
        }, '[PluginVocabularyExtractor] Plugins loaded');
        const allDomains = new Set();
        const allCapabilities = new Set();
        const pluginInfos = [];
        for (const [pluginKey, actionablePlugin] of Object.entries(filteredPlugins)) {
            const plugin = actionablePlugin.definition;
            const pluginDomains = new Set();
            const pluginCapabilities = new Set();
            const actions = [];
            // Extract from each action
            for (const [actionName, action] of Object.entries(plugin.actions)) {
                if (action.domain) {
                    allDomains.add(action.domain);
                    pluginDomains.add(action.domain);
                }
                if (action.capability) {
                    allCapabilities.add(action.capability);
                    pluginCapabilities.add(action.capability);
                }
                if (action.domain && action.capability) {
                    actions.push({
                        plugin_key: pluginKey,
                        plugin_name: plugin.plugin.name,
                        action_name: actionName,
                        domain: action.domain,
                        capability: action.capability,
                        description: action.description,
                    });
                }
            }
            pluginInfos.push({
                key: pluginKey,
                name: plugin.plugin.name,
                provider_family: plugin.plugin.provider_family,
                domains: Array.from(pluginDomains).sort(),
                capabilities: Array.from(pluginCapabilities).sort(),
                actions,
            });
        }
        const vocabulary = {
            domains: Array.from(allDomains).sort(),
            capabilities: Array.from(allCapabilities).sort(),
            plugins: pluginInfos.sort((a, b) => a.name.localeCompare(b.name)),
        };
        logger.info({
            domainCount: vocabulary.domains.length,
            capabilityCount: vocabulary.capabilities.length,
            pluginCount: vocabulary.plugins.length,
        }, '[PluginVocabularyExtractor] Vocabulary extraction complete');
        return vocabulary;
    }
    /**
     * Format vocabulary as text for LLM prompt injection
     */
    formatForPrompt(vocabulary) {
        const sections = [];
        // Domains section
        sections.push('AVAILABLE DOMAINS (use these exact strings):');
        sections.push(vocabulary.domains.join(', '));
        sections.push('');
        // Capabilities section
        sections.push('AVAILABLE CAPABILITIES (use these exact strings):');
        sections.push(vocabulary.capabilities.join(', '));
        sections.push('');
        // Connected plugins section
        sections.push('CONNECTED PLUGINS:');
        for (const plugin of vocabulary.plugins) {
            sections.push(`\n- ${plugin.name} (${plugin.key})${plugin.provider_family ? ` [${plugin.provider_family}]` : ''}`);
            sections.push(`  Domains: ${plugin.domains.join(', ')}`);
            sections.push(`  Capabilities: ${plugin.capabilities.join(', ')}`);
            // Show a few example actions
            const exampleActions = plugin.actions.slice(0, 3);
            if (exampleActions.length > 0) {
                sections.push(`  Example actions:`);
                for (const action of exampleActions) {
                    sections.push(`    - ${action.action_name}: ${action.domain}/${action.capability}`);
                }
            }
        }
        return sections.join('\n');
    }
    /**
     * Get usage guidance text for LLM
     */
    getUsageGuidance() {
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
`.trim();
    }
}
