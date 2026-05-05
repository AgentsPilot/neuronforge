/**
 * Workflow Hash Utility - Generate stable hashes for workflow change detection
 *
 * Used by calibration system to detect when a workflow has changed,
 * invalidating previous calibration results.
 */

import { createHash } from 'crypto';

/**
 * Generate a SHA-256 hash of workflow steps
 *
 * This creates a stable hash that changes only when the workflow structure changes.
 * Fields excluded from hash:
 * - UI metadata (positions, colors, etc.)
 * - Execution state (status, timestamps, execution_ids)
 * - User-specific data
 */
export function generateWorkflowHash(workflowSteps: any[]): string {
  // Recursively extract structurally relevant fields and sort nested structures
  const extractRelevantFields = (step: any): any => ({
    id: step.id || step.step_id,
    type: step.type,
    plugin: step.plugin,
    action: step.action,
    // Include all config parameters (these affect behavior)
    ...(step.input && { input: step.input }),
    ...(step.field && { field: step.field }),
    ...(step.expression && { expression: step.expression }),
    ...(step.operation && { operation: step.operation }),
    ...(step.condition && { condition: step.condition }),
    ...(step.custom_code && { custom_code: step.custom_code }),
    ...(step.field_mapping && { field_mapping: step.field_mapping }),
    ...(step.columns && { columns: step.columns }),
    ...(step.output_schema && { output_schema: step.output_schema }),
    // Recursively process nested steps (sort by step ID for consistency)
    ...(step.steps && {
      steps: step.steps
        .map(extractRelevantFields)
        .sort((a: any, b: any) => (a.id || '').localeCompare(b.id || ''))
    }),
    // Recursively process branches (sort branch keys alphabetically)
    ...(step.branches && {
      branches: Object.keys(step.branches)
        .sort()
        .reduce((sorted: any, key) => {
          sorted[key] = step.branches[key].steps
            ? step.branches[key].steps.map(extractRelevantFields).sort((a: any, b: any) => (a.id || '').localeCompare(b.id || ''))
            : step.branches[key];
          return sorted;
        }, {})
    }),
  });

  // Extract relevant fields and sort top-level steps by ID for consistency
  const relevantFields = workflowSteps
    .map(extractRelevantFields)
    .sort((a, b) => (a.id || '').localeCompare(b.id || ''));

  // Create deterministic JSON string with sorted keys
  // Using a replacer function to ensure stable serialization
  const canonicalJSON = JSON.stringify(relevantFields, (_key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Sort object keys alphabetically for deterministic output
      return Object.keys(value)
        .sort()
        .reduce((sorted: any, k) => {
          sorted[k] = value[k];
          return sorted;
        }, {});
    }
    return value;
  });

  // Generate SHA-256 hash
  return createHash('sha256')
    .update(canonicalJSON)
    .digest('hex');
}

// Removed hasWorkflowChanged - replaced by simple is_calibrated flag

/**
 * Generate a SHA-256 hash of input schema
 *
 * This creates a stable hash that changes only when the input schema structure changes.
 * Used to detect when input requirements change, which may invalidate hardcoded values.
 *
 * Fields included:
 * - name: field identifier
 * - type: data type (string, number, etc.)
 * - required: whether field is mandatory
 * - description: field purpose
 *
 * Fields excluded:
 * - UI metadata (label, placeholder, etc.)
 * - default_value: doesn't affect validation
 */
export function generateInputSchemaHash(inputSchema: any): string {
  if (!inputSchema || (Array.isArray(inputSchema) && inputSchema.length === 0)) {
    return '';
  }

  // Normalize schema to consistent format
  const normalized = Array.isArray(inputSchema)
    ? inputSchema.map(field => ({
        name: field.name,
        type: field.type,
        required: field.required || false,
        description: field.description || ''
      }))
    : Object.keys(inputSchema).map(key => ({
        name: key,
        type: inputSchema[key].type || 'string',
        required: inputSchema[key].required || false,
        description: inputSchema[key].description || ''
      }));

  // Sort by field name for consistency
  const sorted = normalized.sort((a, b) => a.name.localeCompare(b.name));

  // Create deterministic JSON string
  const canonicalJSON = JSON.stringify(sorted);

  // Generate SHA-256 hash
  return createHash('sha256')
    .update(canonicalJSON)
    .digest('hex');
}

// Removed hasInputSchemaChanged - replaced by simple is_calibrated flag
