/**
 * Workflow Config Extractor
 *
 * Generically extracts workflow configuration from enhanced prompts.
 * Designed to scale to any enhanced prompt structure without hardcoded field names.
 */

/**
 * Extract workflow configuration from enhanced prompt
 *
 * This function uses a generic approach that works with any enhanced prompt structure:
 * 1. Extracts all key-value pairs from resolved_user_inputs
 * 2. Can be extended to extract from other standard locations
 *
 * @param enhancedPrompt - Enhanced prompt object (can be any structure)
 * @returns Workflow configuration as key-value pairs
 */
export function extractWorkflowConfig(enhancedPrompt: any): Record<string, any> {
  const config: Record<string, any> = {}

  // Extract from resolved_user_inputs (standard location for user configuration)
  const resolvedInputs = enhancedPrompt?.specifics?.resolved_user_inputs || []
  for (const input of resolvedInputs) {
    if (input.key && input.value !== undefined) {
      config[input.key] = input.value
    }
  }

  // Extract services list if available (useful for capability detection)
  if (enhancedPrompt?.specifics?.services_involved) {
    config.services = enhancedPrompt.specifics.services_involved
  }

  // Extract plan metadata (useful for runtime context)
  if (enhancedPrompt?.plan_title) {
    config.workflow_name = enhancedPrompt.plan_title
  }

  if (enhancedPrompt?.plan_description) {
    config.workflow_description = enhancedPrompt.plan_description
  }

  return config
}

/**
 * Get config value with fallback support
 *
 * Useful for getting config values with alternative key names or defaults.
 *
 * @param config - Workflow configuration
 * @param primaryKey - Primary key to look for
 * @param alternativeKeys - Alternative keys to try if primary not found
 * @param defaultValue - Default value if none found
 * @returns Config value or default
 */
export function getConfigValue(
  config: Record<string, any>,
  primaryKey: string,
  alternativeKeys: string[] = [],
  defaultValue?: any
): any {
  // Try primary key
  if (config[primaryKey] !== undefined) {
    return config[primaryKey]
  }

  // Try alternative keys
  for (const altKey of alternativeKeys) {
    if (config[altKey] !== undefined) {
      return config[altKey]
    }
  }

  // Return default
  return defaultValue
}
