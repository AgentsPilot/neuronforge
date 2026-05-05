// lib/agentkit/v6/utils/form-field-metadata-generator.ts
// Generate form field metadata for dynamic dropdowns by matching input schema to workflow config references

import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { createLogger } from '@/lib/logger';
import { hasQueryComponents, getQueryConfig, QueryComponentsConfig } from '@/lib/plugins/query-components-config';

const logger = createLogger({ module: 'FormFieldMetadataGenerator', service: 'v6-calibration' });

export interface FormFieldMetadata {
  name: string;
  plugin: string;
  action: string;
  parameter: string;
  depends_on?: string[];
  description?: string;
  queryComponents?: QueryComponentsConfig;
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
      // Support multiple key patterns: plugin/plugin_key, action/operation
      const plugin = step.plugin || step.plugin_key;
      const action = step.action || step.operation;

      logger.debug({ stepPath, plugin, action, stepType: step.type, hasParams: !!step.params, hasConfig: !!step.config }, 'Scanning step');

      // If this step has plugin and action, scan its params/config
      // PILOT DSL uses 'params', some formats use 'config'
      const stepParams = step.params || step.config;
      if (plugin && action && stepParams) {
        logger.debug({ stepPath, plugin, action }, 'Scanning step params/config');
        scanForConfigReferences(stepParams, plugin, action, stepIndex, configUsageMap);
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

      // Scan conditional then_steps/else_steps (support both array and single step)
      const thenSteps = step.then ? (Array.isArray(step.then) ? step.then : [step.then]) : step.then_steps;
      if (thenSteps && Array.isArray(thenSteps)) {
        logger.debug({ stepPath }, 'Scanning then/then_steps');
        scanStepsRecursively(thenSteps, `${stepPath}.then`);
      }
      const elseSteps = step.else ? (Array.isArray(step.else) ? step.else : [step.else]) : step.else_steps;
      if (elseSteps && Array.isArray(elseSteps)) {
        logger.debug({ stepPath }, 'Scanning else/else_steps');
        scanStepsRecursively(elseSteps, `${stepPath}.else`);
      }

      // Scan scatter_gather loops
      if (step.scatter && step.scatter.steps && Array.isArray(step.scatter.steps)) {
        logger.debug({ stepPath }, 'Scanning scatter_gather steps');
        scanStepsRecursively(step.scatter.steps, `${stepPath}.scatter.steps`);
      }

      // Scan parallel steps
      if (step.parallel && Array.isArray(step.parallel)) {
        logger.debug({ stepPath }, 'Scanning parallel steps');
        scanStepsRecursively(step.parallel, `${stepPath}.parallel`);
      }
    }
  }

  scanStepsRecursively(workflowSteps);

  // Log at INFO level so it's visible in server console
  logger.info({
    configKeysFound: configUsageMap.size,
    configKeys: Array.from(configUsageMap.keys()),
    configUsageDetails: Array.from(configUsageMap.entries()).map(([key, usages]) => ({
      key,
      usages: usages.map(u => `${u.plugin}/${u.action}/${u.parameter}`)
    }))
  }, 'Phase 1 complete: Config references extracted');

  // Phase 2: For each config key used in input schema, check if it has dynamic options
  logger.info({
    configUsageMapSize: configUsageMap.size,
    inputSchemaKeysSize: inputSchemaKeys.size,
    inputSchemaKeys: Array.from(inputSchemaKeys)
  }, 'Starting Phase 2: checking dynamic options');

  for (const configKey of configUsageMap.keys()) {
    // Check if this config key exists in input schema (with or without step prefix)
    // Input schema may have "step2_range" while workflow uses "{{config.range}}"
    let matchedSchemaKey = configKey;
    if (!inputSchemaKeys.has(configKey)) {
      // Try to find a matching field with step prefix
      const matchingKey = Array.from(inputSchemaKeys).find(key =>
        key === configKey ||
        key.replace(/^step\d+_/, '') === configKey ||
        configKey.replace(/^step\d+_/, '') === key
      );
      if (matchingKey) {
        matchedSchemaKey = matchingKey;
        logger.debug({ configKey, matchedSchemaKey }, 'Matched config key to step-prefixed field');
      } else {
        logger.debug({ configKey, availableKeys: Array.from(inputSchemaKeys) }, 'Config key not in input schema, skipping');
        continue;
      }
    }

    const usages = configUsageMap.get(configKey)!;
    logger.debug({ configKey, usageCount: usages.length }, 'Checking config key usages');

    // Two-pass search: first look for usages with x-dynamic-options, then fallback to any valid usage
    let bestMatch: { plugin: string; action: string; parameter: string; description?: string; depends_on?: string[] } | null = null;
    let fallbackMatch: { plugin: string; action: string; parameter: string; description?: string; depends_on?: string[] } | null = null;

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

      // Get parameter description from plugin schema - this provides user-friendly help text
      const paramDescription = (paramSchema as any).description || undefined;

      // Check for x-dynamic-options metadata (for dropdown fields)
      const dynamicOptions = (paramSchema as any)['x-dynamic-options'];

      logger.info({
        configKey,
        plugin,
        action,
        parameter,
        hasDynamicOptions: !!dynamicOptions,
        description: paramDescription
      }, 'Found parameter metadata for config key');

      const match = {
        plugin,
        action,
        parameter,
        description: paramDescription,
        depends_on: dynamicOptions?.depends_on
      };

      // Prefer matches with x-dynamic-options (for dropdown support)
      if (dynamicOptions) {
        bestMatch = match;
        break; // Found a match with dynamic options, use it
      } else if (!fallbackMatch) {
        fallbackMatch = match; // Keep first valid match as fallback
      }
    }

    // Use bestMatch if found, otherwise use fallback
    const finalMatch = bestMatch || fallbackMatch;
    if (finalMatch) {
      // Check if this parameter has query components configuration
      const queryComponentsConfig = hasQueryComponents(finalMatch.plugin, finalMatch.action, finalMatch.parameter)
        ? getQueryConfig(finalMatch.plugin, finalMatch.action, finalMatch.parameter)
        : null;

      if (queryComponentsConfig) {
        logger.info({
          configKey,
          plugin: finalMatch.plugin,
          action: finalMatch.action,
          parameter: finalMatch.parameter,
          syntax: queryComponentsConfig.syntax
        }, 'Found query components config for parameter');
      }

      metadata.push({
        name: matchedSchemaKey,
        plugin: finalMatch.plugin,
        action: finalMatch.action,
        parameter: finalMatch.parameter,
        depends_on: finalMatch.depends_on,
        description: finalMatch.description,
        queryComponents: queryComponentsConfig || undefined
      });
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
      // Check if this value is a config or input reference string
      // Support both {{config.X}} and {{input.X}} patterns
      if (typeof value === 'string' && value.match(/\{\{(?:config|input)\.(\w+)\}\}/)) {
        const match = value.match(/\{\{(?:config|input)\.(\w+)\}\}/);
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
