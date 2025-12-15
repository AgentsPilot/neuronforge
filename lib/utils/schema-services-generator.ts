// lib/utils/schema-services-generator.ts

import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'SchemaServicesGenerator', service: 'agent-creation' });

/**
 * Schema service structure matching the v11 prompt specification.
 * This is the format expected by Phase 4 for technical workflow generation.
 */
export interface SchemaServiceAction {
  description: string;
  usage_context: string;
  parameters: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
}

export interface SchemaService {
  name: string;
  key: string;
  description: string;
  context: string;
  actions: Record<string, SchemaServiceAction>;
}

export type SchemaServices = Record<string, SchemaService>;

/**
 * Generates schema_services object for Phase 4 from a list of service keys.
 *
 * This utility filters plugin definitions to only include the services
 * specified in Phase 3's `services_involved`, then converts them to the
 * format expected by the LLM for technical workflow generation.
 *
 * @param servicesInvolved - Array of plugin keys from Phase 3's enhanced_prompt.specifics.services_involved
 * @returns SchemaServices object with full action definitions for each service
 *
 * @example
 * ```ts
 * const schemaServices = await generateSchemaServices(['google-mail', 'slack']);
 * // Returns:
 * // {
 * //   "google-mail": {
 * //     name: "google-mail",
 * //     key: "google-mail",
 * //     description: "Send, read, and manage Gmail emails",
 * //     context: "When user wants to...",
 * //     actions: {
 * //       "searchMessages": {
 * //         description: "...",
 * //         usage_context: "...",
 * //         parameters: {...},
 * //         output_schema: {...}
 * //       }
 * //     }
 * //   },
 * //   "slack": {...}
 * // }
 * ```
 */
export async function generateSchemaServices(servicesInvolved: string[]): Promise<SchemaServices> {
  logger.info({ servicesInvolved }, 'Generating schema_services for Phase 4');

  if (!servicesInvolved || servicesInvolved.length === 0) {
    logger.warn('No services_involved provided, returning empty schema_services');
    return {};
  }

  const pluginManager = await PluginManagerV2.getInstance();
  const pluginContexts = pluginManager.getPluginsDefinitionContext(servicesInvolved);

  const schemaServices: SchemaServices = {};
  const foundPlugins: string[] = [];
  const missingPlugins: string[] = [];

  // Track which plugins were found vs missing
  const pluginContextKeys = new Set(pluginContexts.map(pc => pc.key));
  for (const service of servicesInvolved) {
    if (pluginContextKeys.has(service)) {
      foundPlugins.push(service);
    } else {
      missingPlugins.push(service);
    }
  }

  // Convert each plugin context to schema_services format
  for (const pluginContext of pluginContexts) {
    const llmContext = pluginContext.toLongLLMContext();

    schemaServices[llmContext.key] = {
      name: llmContext.name,
      key: llmContext.key,
      description: llmContext.description,
      context: llmContext.context,
      actions: llmContext.actions as Record<string, SchemaServiceAction>,
    };
  }

  logger.info({
    requested: servicesInvolved.length,
    found: foundPlugins.length,
    missing: missingPlugins.length,
    missingPlugins: missingPlugins.length > 0 ? missingPlugins : undefined,
  }, 'Schema services generated');

  if (missingPlugins.length > 0) {
    logger.warn({ missingPlugins }, 'Some services_involved not found in plugin registry');
  }

  return schemaServices;
}

/**
 * Validates that all required services exist in the schema_services.
 * Useful for pre-flight checks before calling Phase 4.
 *
 * @param schemaServices - Generated schema services
 * @param requiredServices - Services that must be present
 * @returns Object with validation result and missing services
 */
export function validateSchemaServices(
  schemaServices: SchemaServices,
  requiredServices: string[]
): { valid: boolean; missingServices: string[] } {
  const availableKeys = new Set(Object.keys(schemaServices));
  const missingServices = requiredServices.filter(service => !availableKeys.has(service));

  return {
    valid: missingServices.length === 0,
    missingServices,
  };
}

/**
 * Gets a summary of actions available in schema_services.
 * Useful for logging and debugging.
 *
 * @param schemaServices - Schema services object
 * @returns Summary object with service names and action counts
 */
export function getSchemaServicesSummary(schemaServices: SchemaServices): Record<string, number> {
  const summary: Record<string, number> = {};

  for (const [key, service] of Object.entries(schemaServices)) {
    summary[key] = Object.keys(service.actions).length;
  }

  return summary;
}