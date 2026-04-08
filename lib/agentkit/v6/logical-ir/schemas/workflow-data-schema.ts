/**
 * Workflow Data Schema — Centralized field-level type declarations
 *
 * Defines the shape of data flowing between workflow steps.
 * Constructed deterministically in Phase 2 (CapabilityBinderV2) from:
 * - Plugin output_schema for bound steps (source: "plugin")
 * - LLM-declared output_schema for shape-changing transforms (source: "ai_declared")
 * - LLM-declared fields[]/outputs[] for extract/generate steps (source: "ai_declared")
 * - Derived schemas for shape-preserving transforms, loops, aggregates (source: "inferred")
 *
 * Design doc: docs/v6/V6_WORKFLOW_DATA_SCHEMA_DESIGN.md
 * Workplan: docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md
 */

import type { ActionOutputSchema, ActionOutputSchemaProperty, ActionParameterSchema } from '@/lib/types/plugin-types'

// ============================================================================
// Core Types
// ============================================================================

export type SchemaFieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any'

/**
 * Describes the shape of a single field or value.
 * Recursive: objects have properties, arrays have items.
 */
export interface SchemaField {
  type: SchemaFieldType
  description?: string
  required?: boolean

  /** For objects: nested field definitions */
  properties?: Record<string, SchemaField>

  /** For arrays: schema of each element */
  items?: SchemaField

  /** For unions: alternative schemas */
  oneOf?: SchemaField[]

  /** Where this schema came from */
  source?: 'plugin' | 'ai_declared' | 'inferred'

  /**
   * Direction #3: Semantic type annotation for input-type compatibility checking.
   * Propagated from plugin output_schema `x-semantic-type` annotations.
   * Used by InputTypeChecker to validate from_type/to_type compatibility at bind time.
   */
  semantic_type?: string
}

/**
 * A named data slot in the workflow — represents one step's output.
 * Each slot has a schema describing its shape, scope, and lineage.
 */
export interface DataSlot {
  /** The shape of data in this slot */
  schema: SchemaField

  /** Visibility scope */
  scope: 'global' | 'loop' | 'branch'

  /** Which step produces this slot */
  produced_by: string

  /** Which steps consume this slot */
  consumed_by?: string[]
}

/**
 * The complete data schema for a workflow.
 * Maps RefName → DataSlot for every named output in the workflow.
 */
export interface WorkflowDataSchema {
  slots: Record<string, DataSlot>
}

// ============================================================================
// Conversion Utilities
// ============================================================================

/**
 * Convert a plugin ActionOutputSchema (JSON Schema) to a SchemaField.
 *
 * Plugin output schemas use JSON Schema conventions (type, properties, items, required).
 * This converts them to the internal SchemaField format used by data_schema.
 *
 * @example
 * // Plugin output_schema for google-sheets read_range:
 * { type: "object", properties: { values: { type: "array", items: { type: "array" } } } }
 * // Converts to SchemaField:
 * { type: "object", source: "plugin", properties: { values: { type: "array", items: { type: "array" } } } }
 */
export function convertActionOutputSchemaToSchemaField(
  outputSchema: ActionOutputSchema
): SchemaField {
  return convertJsonSchemaToSchemaField(outputSchema, 'plugin')
}

/**
 * Convert a plugin ActionParameterSchema (input JSON Schema) to a SchemaField.
 *
 * Used for consumer-side validation: checking that a consuming step's
 * required input parameters match the producing step's output schema.
 */
export function convertActionInputSchemaToSchemaField(
  paramSchema: ActionParameterSchema
): SchemaField {
  return convertJsonSchemaToSchemaField(paramSchema, 'plugin')
}

/**
 * Internal: recursively converts a JSON Schema object to SchemaField.
 */
function convertJsonSchemaToSchemaField(
  schema: Record<string, any>,
  source: SchemaField['source']
): SchemaField {
  const type = normalizeType(schema.type)

  const field: SchemaField = {
    type,
    source,
  }

  if (schema.description) {
    field.description = schema.description
  }

  // Direction #3: Propagate x-semantic-type annotation from plugin output schemas
  if (schema['x-semantic-type']) {
    field.semantic_type = schema['x-semantic-type']
  }

  // Convert nested properties for objects
  if (type === 'object' && schema.properties) {
    field.properties = {}
    const requiredFields = schema.required || []

    for (const [key, prop] of Object.entries(schema.properties)) {
      const propSchema = prop as Record<string, any>
      const childField = convertJsonSchemaToSchemaField(propSchema, source)

      if (requiredFields.includes(key)) {
        childField.required = true
      }

      field.properties[key] = childField
    }
  }

  // Convert array items
  if (type === 'array' && schema.items) {
    field.items = convertJsonSchemaToSchemaField(schema.items as Record<string, any>, source)
  }

  // Convert oneOf/anyOf
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    field.oneOf = schema.oneOf.map((s: Record<string, any>) =>
      convertJsonSchemaToSchemaField(s, source)
    )
  }

  return field
}

/**
 * Normalize JSON Schema type strings to SchemaFieldType.
 * JSON Schema uses "integer" while we use "number".
 */
function normalizeType(type: string | undefined): SchemaFieldType {
  if (!type) return 'any'

  switch (type) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'object':
      return 'object'
    case 'array':
      return 'array'
    default:
      return 'any'
  }
}
