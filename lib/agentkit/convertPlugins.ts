// lib/agentkit/convertPlugins.ts

import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { PluginDefinitionContext } from '@/lib/types/plugin-definition-context';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';

/**
 * Converts V2 plugin definitions to OpenAI function tools
 *
 * Uses PluginManagerV2.getExecutablePlugins() to get CONNECTED plugins with VALID TOKENS.
 * Each action in the plugin definition becomes a separate OpenAI function.
 *
 * This function is used for EXECUTION, so tokens are validated/refreshed before returning.
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
  const userPlugins = await pluginManager.getExecutablePlugins(userId);
  const allPlugins = pluginManager.getAvailablePlugins();

  const tools: ChatCompletionTool[] = [];
  const skippedPlugins: string[] = [];

  for (const pluginKey of pluginKeys) {
    let actionablePlugin = userPlugins[pluginKey];

    // If plugin not connected, check if it's a platform plugin (doesn't need user connection)
    if (!actionablePlugin) {
      const pluginDef = allPlugins[pluginKey];
      if (pluginDef && pluginDef.plugin.auth_config.auth_type === 'platform_key') {
        console.log(`✅ AgentKit: Auto-including platform plugin "${pluginKey}" (no connection required)`);
        actionablePlugin = {
          definition: pluginDef,
          connection: { access_token: 'platform-key' } as any
        };
      } else {
        console.warn(`⚠️ AgentKit: Plugin "${pluginKey}" not connected for user ${userId}`);
        skippedPlugins.push(pluginKey);
        continue;
      }
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
 * This function is used for CONTEXT GENERATION only, so it uses getConnectedPlugins()
 * for fast status checks without token refresh operations.
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
  const userPlugins = await pluginManager.getConnectedPlugins(userId);

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

      // Include required parameters so AI knows exactly what's needed
      if (actionInfo.parameters?.required?.length > 0) {
        contextLines.push(`    REQUIRED params: ${actionInfo.parameters.required.join(', ')}`);
      }

      // Include parameter structure for complex/nested schemas
      if (actionInfo.parameters?.properties) {
        const props = actionInfo.parameters.properties;
        const paramDetails: string[] = [];

        Object.entries(props).forEach(([paramName, paramDef]: [string, any]) => {
          if (paramDef.type === 'object' && paramDef.properties) {
            // Nested object - show structure
            const nestedProps = Object.keys(paramDef.properties).join(', ');
            const nestedRequired = paramDef.required?.join(', ') || 'none';
            paramDetails.push(`      "${paramName}": { type: object, properties: [${nestedProps}], required: [${nestedRequired}] }`);
          } else if (paramDef.type === 'array') {
            paramDetails.push(`      "${paramName}": { type: array of ${paramDef.items?.type || 'any'} }`);
          } else {
            // Simple type
            paramDetails.push(`      "${paramName}": { type: ${paramDef.type}${paramDef.description ? `, desc: "${paramDef.description}"` : ''} }`);
          }
        });

        if (paramDetails.length > 0) {
          contextLines.push(`    Parameter structure:`);
          paramDetails.forEach(detail => contextLines.push(detail));
        }
      }

      // Include output schema so AI knows what data the action returns
      if (actionInfo.output_schema?.properties) {
        const outputProps = actionInfo.output_schema.properties;
        const outputDetails: string[] = [];

        Object.entries(outputProps).forEach(([propName, propDef]: [string, any]) => {
          if (propDef.type === 'object' && propDef.properties) {
            // Nested object - show structure
            const nestedProps = Object.keys(propDef.properties).join(', ');
            outputDetails.push(`      "${propName}": { type: object, properties: [${nestedProps}] }`);
          } else if (propDef.type === 'array') {
            const itemType = propDef.items?.type || 'any';
            // If array items are objects, show their properties
            if (propDef.items?.properties) {
              const itemProps = Object.keys(propDef.items.properties).join(', ');
              outputDetails.push(`      "${propName}": { type: array of object, item_properties: [${itemProps}] }`);
            } else {
              outputDetails.push(`      "${propName}": { type: array of ${itemType} }`);
            }
          } else {
            // Simple type with description
            outputDetails.push(`      "${propName}": { type: ${propDef.type}${propDef.description ? `, desc: "${propDef.description}"` : ''} }`);
          }
        });

        if (outputDetails.length > 0) {
          contextLines.push(`    OUTPUT returns:`);
          outputDetails.forEach(detail => contextLines.push(detail));
        }
      }
    });

    contextLines.push('');
  }

  contextLines.push(`Connected: ${connectedCount}/${pluginKeys.length} plugins`);

  return contextLines.join('\n');
}
