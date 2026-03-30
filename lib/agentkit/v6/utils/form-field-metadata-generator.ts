// lib/agentkit/v6/utils/form-field-metadata-generator.ts
// Generate form field metadata for dynamic dropdowns by matching input schema to workflow config references

import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'FormFieldMetadataGenerator', service: 'v6-calibration' });

export interface FormFieldMetadata {
  name: string;
  plugin: string;
  action: string;
  parameter: string;
  depends_on?: string[];
  description?: string;
}

/**
 * Generates form field metadata for dynamic dropdowns.
 *
 * Algorithm:
 * 1. Scan workflow steps for {{config.X}} references
 * 2. Identify which plugin/action/parameter each config key is used in
 * 3. Check if that parameter has x-dynamic-options metadata
 * 4. Create mapping: input schema key → plugin parameter
 *
 * @param inputSchema - Array of input schema field definitions
 * @param workflowSteps - Array of workflow steps (PILOT DSL format)
 * @param pluginManager - PluginManagerV2 instance for schema lookup
 * @returns Array of field metadata for fields that support dynamic dropdowns
 */
export async function generateFormFieldMetadata(
  inputSchema: Array<{ name: string; type: string; description?: string; required?: boolean }>,
  workflowSteps: any[],
  pluginManager: PluginManagerV2
): Promise<FormFieldMetadata[]> {
  logger.info({
    inputSchemaCount: inputSchema.length,
    workflowStepCount: workflowSteps.length
  }, 'Starting form field metadata generation');

  const metadata: FormFieldMetadata[] = [];
  const inputSchemaKeys = new Set(inputSchema.map(field => field.name));

  // Build a map of config key → plugin parameter usage
  const configUsageMap = new Map<string, Array<{
    stepIndex: number;
    plugin: string;
    action: string;
    parameter: string;
  }>>();

  // Phase 1: Scan workflow steps for {{config.X}} references
  // Use a recursive function to scan all nested structures
  function scanStepsRecursively(steps: any[], parentPath: string = '') {
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      const step = steps[stepIndex];
      const stepPath = parentPath ? `${parentPath}[${stepIndex}]` : `step${stepIndex}`;

      // Extract plugin and action from step (PILOT DSL format)
      const plugin = step.plugin;
      const action = step.action || step.operation;

      // If this step has plugin and action, scan its config
      if (plugin && action && step.config) {
        logger.debug({ stepPath, plugin, action }, 'Scanning step config');
        scanForConfigReferences(step.config, plugin, action, stepIndex, configUsageMap);
      }

      // Recursively scan nested structures
      if (step.loop_steps && Array.isArray(step.loop_steps)) {
        logger.debug({ stepPath }, 'Scanning loop_steps');
        scanStepsRecursively(step.loop_steps, `${stepPath}.loop_steps`);
      }

      if (step.steps && Array.isArray(step.steps)) {
        logger.debug({ stepPath }, 'Scanning nested steps (conditional/branches)');
        scanStepsRecursively(step.steps, `${stepPath}.steps`);
      }

      // Scan scatter_gather loops
      if (step.scatter && step.scatter.steps && Array.isArray(step.scatter.steps)) {
        logger.debug({ stepPath }, 'Scanning scatter_gather steps');
        scanStepsRecursively(step.scatter.steps, `${stepPath}.scatter.steps`);
      }
    }
  }

  scanStepsRecursively(workflowSteps);

  logger.debug({
    configKeysFound: configUsageMap.size,
    configKeys: Array.from(configUsageMap.keys())
  }, 'Phase 1 complete: Config references extracted');

  // Phase 2: For each config key used in input schema, check if it has dynamic options
  logger.debug({
    configUsageMapSize: configUsageMap.size,
    inputSchemaKeysSize: inputSchemaKeys.size
  }, 'Starting Phase 2: checking dynamic options');

  for (const configKey of configUsageMap.keys()) {
    // Check if this config key exists in input schema
    if (!inputSchemaKeys.has(configKey)) {
      logger.debug({ configKey, availableKeys: Array.from(inputSchemaKeys) }, 'Config key not in input schema, skipping');
      continue;
    }

    const usages = configUsageMap.get(configKey)!;
    logger.debug({ configKey, usageCount: usages.length }, 'Checking config key usages');

    // Find the first usage that has x-dynamic-options
    for (const usage of usages) {
      const { plugin, action, parameter } = usage;
      logger.debug({ configKey, plugin, action, parameter }, 'Checking usage');

      // Get plugin action definition
      const actionDef = pluginManager.getActionDefinition(plugin, action);
      if (!actionDef || !actionDef.parameters?.properties) {
        logger.debug({ plugin, action }, 'Action definition not found or has no parameters');
        continue;
      }

      // Get parameter schema
      const paramSchema = actionDef.parameters.properties[parameter];
      if (!paramSchema) {
        logger.debug({ plugin, action, parameter, availableParams: Object.keys(actionDef.parameters.properties) }, 'Parameter not found in action schema');
        continue;
      }

      // Check for x-dynamic-options metadata
      const dynamicOptions = (paramSchema as any)['x-dynamic-options'];
      if (dynamicOptions && dynamicOptions.source) {
        // Get parameter description for user-friendly form labels
        const paramDescription = (paramSchema as any).description || undefined;

        logger.info({
          configKey,
          plugin,
          action,
          parameter,
          source: dynamicOptions.source,
          depends_on: dynamicOptions.depends_on,
          description: paramDescription
        }, 'Found dynamic options for config key');

        metadata.push({
          name: configKey,
          plugin,
          action,
          parameter,
          depends_on: dynamicOptions.depends_on,
          description: paramDescription
        });

        // Stop after finding the first dynamic option match
        break;
      } else {
        logger.debug({ configKey, plugin, action, parameter }, 'Parameter has no x-dynamic-options');
      }
    }
  }

  logger.info({
    metadataCount: metadata.length,
    fields: metadata.map(m => m.name)
  }, 'Form field metadata generation complete');

  return metadata;
}

/**
 * Recursively scan an object for {{config.X}} references
 * Extracts the config key and records which plugin parameter it's used in
 */
function scanForConfigReferences(
  obj: any,
  plugin: string,
  action: string,
  stepIndex: number,
  configUsageMap: Map<string, Array<{
    stepIndex: number;
    plugin: string;
    action: string;
    parameter: string;
  }>>,
  currentPath: string[] = []
): void {
  if (obj === null || obj === undefined) {
    return;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      scanForConfigReferences(item, plugin, action, stepIndex, configUsageMap, [...currentPath, `[${index}]`]);
    });
    return;
  }

  // Handle objects
  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      // Check if this value is a config reference string
      if (typeof value === 'string' && value.match(/\{\{config\.(\w+)\}\}/)) {
        const match = value.match(/\{\{config\.(\w+)\}\}/);
        if (match) {
          const configKey = match[1];

          // Record this usage with the parameter name (key at this level)
          if (!configUsageMap.has(configKey)) {
            configUsageMap.set(configKey, []);
          }

          // The key is the plugin parameter name
          configUsageMap.get(configKey)!.push({
            stepIndex,
            plugin,
            action,
            parameter: key
          });

          logger.debug({
            configKey,
            plugin,
            action,
            parameter: key,
            stepIndex,
            value
          }, 'Found config reference');
        }
      }

      // Recurse into nested structures (skip arrays within objects like recipients.to)
      if (typeof value === 'object' && !Array.isArray(value)) {
        scanForConfigReferences(value, plugin, action, stepIndex, configUsageMap, [...currentPath, key]);
      } else if (Array.isArray(value)) {
        // For arrays, still recurse to catch nested config refs
        scanForConfigReferences(value, plugin, action, stepIndex, configUsageMap, [...currentPath, key]);
      }
    }
  }
}
