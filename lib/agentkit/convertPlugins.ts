// lib/agentkit/convertPlugins.ts

import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { PluginDefinitionContext } from '@/lib/types/plugin-definition-context';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';

/**
 * Converts V2 plugin definitions to OpenAI function tools
 *
 * Uses PluginManagerV2.getUserActionablePlugins() to get only CONNECTED plugins with valid tokens.
 * Each action in the plugin definition becomes a separate OpenAI function.
 *
 * @param userId - The user ID to get connected plugins for
 * @param pluginKeys - Array of plugin keys from agent.plugins_required
 * @returns Array of OpenAI ChatCompletionTool objects
 *
 * @example
 * Input: userId="123", pluginKeys=['google-mail', 'google-drive']
 * Output: [
 *   {
 *     type: "function",
 *     function: {
 *       name: "google-mail__send_email",
 *       description: "Send, read, and manage Gmail emails: When user wants to send a new message...",
 *       parameters: { ... JSON Schema from V2 definition ... }
 *     }
 *   },
 *   {
 *     type: "function",
 *     function: {
 *       name: "google-mail__search_emails",
 *       ...
 *     }
 *   },
 *   ...
 * ]
 */
export async function convertPluginsToTools(
  userId: string,
  pluginKeys: string[]
): Promise<ChatCompletionTool[]> {
  const pluginManager = await PluginManagerV2.getInstance();
  const userPlugins = await pluginManager.getUserActionablePlugins(userId);

  const tools: ChatCompletionTool[] = [];
  const skippedPlugins: string[] = [];

  for (const pluginKey of pluginKeys) {
    const actionablePlugin = userPlugins[pluginKey];

    if (!actionablePlugin) {
      console.warn(`⚠️ AgentKit: Plugin "${pluginKey}" not connected for user ${userId}`);
      skippedPlugins.push(pluginKey);
      continue;
    }

    const { definition } = actionablePlugin;

    // Convert each action to an OpenAI function
    for (const [actionName, actionDef] of Object.entries(definition.actions)) {
      // Build enhanced description that emphasizes required parameters
      let enhancedDescription = `[${definition.plugin.description}] ${actionDef.usage_context}`;

      // Add required parameters hint to description for better OpenAI compliance
      if (actionDef.parameters?.required && actionDef.parameters.required.length > 0) {
        enhancedDescription += ` REQUIRED PARAMETERS: ${actionDef.parameters.required.join(', ')}`;
      }

      tools.push({
        type: "function",
        function: {
          // Namespace function name with plugin key to avoid collisions
          // e.g., "google-mail__send_email", "google-drive__upload_file"
          name: `${pluginKey}__${actionName}`,

          // Enhanced description with required parameters hint
          description: enhancedDescription,

          // Use JSON Schema parameters directly from V2 definition - they're already in the correct format!
          parameters: actionDef.parameters,
        }
      });
    }
  }

  if (skippedPlugins.length > 0) {
    console.warn(`⚠️ AgentKit: Skipped ${skippedPlugins.length} plugins: ${skippedPlugins.join(', ')}`);
  }

  console.log(`🔧 AgentKit: Converted ${tools.length} actions from ${pluginKeys.length - skippedPlugins.length}/${pluginKeys.length} plugins to OpenAI tools`);
  return tools;
}

/**
 * Get plugin context description for the system prompt
 *
 * Uses PluginDefinitionContext.toLongLLMContext() to generate rich context
 * about available plugins and their capabilities.
 *
 * @param userId - The user ID to get connected plugins for
 * @param pluginKeys - Array of plugin keys from agent.plugins_required
 * @returns Formatted string describing available plugins and actions
 */
export async function getPluginContextPrompt(
  userId: string,
  pluginKeys: string[]
): Promise<string> {
  const pluginManager = await PluginManagerV2.getInstance();
  const userPlugins = await pluginManager.getUserActionablePlugins(userId);

  const contextLines: string[] = [
    "# Connected Services",
    "You have access to the following integrated services and their actions:",
    ""
  ];

  let connectedCount = 0;

  for (const pluginKey of pluginKeys) {
    const actionablePlugin = userPlugins[pluginKey];

    if (!actionablePlugin) {
      contextLines.push(`⚠️ ${pluginKey}: Not connected`);
      continue;
    }

    connectedCount++;
    const { definition } = actionablePlugin;
    const pluginContext = new PluginDefinitionContext(definition);

    // Use toLongLLMContext() from PluginDefinitionContext for rich information
    const llmContext = pluginContext.toLongLLMContext();

    contextLines.push(`## ${llmContext.description} (${pluginKey})`);
    contextLines.push(`Context: ${llmContext.context}`);
    contextLines.push(`Available actions:`);

    Object.entries(llmContext.actions).forEach(([actionName, actionInfo]) => {
      contextLines.push(`  - **${actionName}**: ${actionInfo.usage_context}`);
    });

    contextLines.push('');
  }

  contextLines.push(`Connected: ${connectedCount}/${pluginKeys.length} plugins`);

  return contextLines.join('\n');
}
