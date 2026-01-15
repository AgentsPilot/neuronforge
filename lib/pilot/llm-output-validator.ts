/**
 * LLM Output Validator - Phase 4 Architectural Redesign
 *
 * Provides JSON schema validation for LLM responses to ensure
 * ai_processing steps return predictable, type-safe outputs.
 *
 * Key responsibilities:
 * - Define JSON Schema types for LLM output validation
 * - Provide common schema patterns (classification, extraction, list)
 * - Validate LLM responses against declared schemas
 * - Generate prompt instructions for structured output
 * - Provide retry hints when validation fails
 *
 * @module lib/pilot/llm-output-validator
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'LLMOutputValidator', service: 'workflow-pilot' });

// ============================================================================
// TYPES
// ============================================================================

/**
 * JSON Schema property definition (simplified)
 */
export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';
  description?: string;
  enum?: (string | number | boolean)[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  default?: any;
}

/**
 * JSON Schema for LLM output validation
 */
export interface LLMOutputSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  description?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  items?: JsonSchemaProperty;
  additionalProperties?: boolean;
}

/**
 * Validation result
 */
export interface LLMValidationResult {
  valid: boolean;
  data?: any;  // Parsed and validated data
  errors?: string[];
  retryHint?: string;  // Helpful hint for retry prompt
}

/**
 * Common schema patterns for quick schema generation
 */
export type SchemaPattern =
  | 'classification'      // { category: string, confidence?: number }
  | 'extraction'          // { items: { field: value }[] }
  | 'summary'             // { summary: string, key_points?: string[] }
  | 'list'                // { items: string[] }
  | 'decision'            // { decision: string, reasoning: string }
  | 'key_value'           // { [key: string]: string }
  | 'boolean_result'      // { result: boolean, reason?: string }
  | 'scored_items';       // { items: { item: any, score: number }[] }

// ============================================================================
// COMMON SCHEMA PATTERNS
// ============================================================================

/**
 * Pre-defined schema patterns for common LLM output types
 */
export const SCHEMA_PATTERNS: Record<SchemaPattern, LLMOutputSchema> = {
  classification: {
    type: 'object',
    description: 'Classification result with category and optional confidence',
    properties: {
      category: { type: 'string', description: 'The classified category' },
      confidence: { type: 'number', description: 'Confidence score 0-1', minimum: 0, maximum: 1 },
      reasoning: { type: 'string', description: 'Explanation for the classification' },
    },
    required: ['category'],
  },

  extraction: {
    type: 'object',
    description: 'Extracted items from content',
    properties: {
      items: {
        type: 'array',
        description: 'Array of extracted items',
        items: { type: 'object' },
      },
    },
    required: ['items'],
  },

  summary: {
    type: 'object',
    description: 'Summary with key points',
    properties: {
      summary: { type: 'string', description: 'The main summary text' },
      key_points: {
        type: 'array',
        description: 'List of key points',
        items: { type: 'string' },
      },
    },
    required: ['summary'],
  },

  list: {
    type: 'object',
    description: 'Simple list of items',
    properties: {
      items: {
        type: 'array',
        description: 'List of items',
        items: { type: 'string' },
      },
    },
    required: ['items'],
  },

  decision: {
    type: 'object',
    description: 'Decision with reasoning',
    properties: {
      decision: { type: 'string', description: 'The decision made' },
      reasoning: { type: 'string', description: 'Explanation for the decision' },
      alternatives: {
        type: 'array',
        description: 'Alternative options considered',
        items: { type: 'string' },
      },
    },
    required: ['decision', 'reasoning'],
  },

  key_value: {
    type: 'object',
    description: 'Key-value pairs',
    additionalProperties: true,
  },

  boolean_result: {
    type: 'object',
    description: 'Boolean result with optional reasoning',
    properties: {
      result: { type: 'boolean', description: 'The boolean result' },
      reason: { type: 'string', description: 'Explanation for the result' },
    },
    required: ['result'],
  },

  scored_items: {
    type: 'object',
    description: 'Items with scores',
    properties: {
      items: {
        type: 'array',
        description: 'Array of scored items',
        items: {
          type: 'object',
          properties: {
            item: { type: 'object', description: 'The item data' },
            score: { type: 'number', description: 'Score for the item' },
          },
          required: ['item', 'score'],
        },
      },
    },
    required: ['items'],
  },
};

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate LLM response against a JSON schema
 *
 * @param response - Raw LLM response (string or already parsed)
 * @param schema - JSON Schema to validate against
 * @returns Validation result with parsed data or errors
 */
export function validateLLMOutput(
  response: string | any,
  schema: LLMOutputSchema
): LLMValidationResult {
  // Step 1: Parse response if it's a string
  let data: any;

  if (typeof response === 'string') {
    const parseResult = parseJsonResponse(response);
    if (!parseResult.success) {
      return {
        valid: false,
        errors: [parseResult.error!],
        retryHint: buildRetryHint('parse_error', schema),
      };
    }
    data = parseResult.data;
  } else {
    data = response;
  }

  // Step 2: Validate against schema
  const errors = validateAgainstSchema(data, schema, '');

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      retryHint: buildRetryHint('validation_error', schema, errors),
    };
  }

  return {
    valid: true,
    data,
  };
}

/**
 * Parse JSON from LLM response, handling common formatting issues
 */
function parseJsonResponse(response: string): { success: boolean; data?: any; error?: string } {
  const trimmed = response.trim();

  // Try direct parse first
  try {
    return { success: true, data: JSON.parse(trimmed) };
  } catch {
    // Continue with cleanup attempts
  }

  // Try extracting JSON from markdown code blocks
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return { success: true, data: JSON.parse(codeBlockMatch[1].trim()) };
    } catch {
      // Continue
    }
  }

  // Try finding JSON object/array in response
  const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    try {
      return { success: true, data: JSON.parse(jsonMatch[1]) };
    } catch {
      // Continue
    }
  }

  // If response doesn't look like JSON at all, wrap string in expected structure
  // This is a fallback for simple responses
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return {
      success: false,
      error: `Response is not valid JSON. Expected JSON object or array, got: "${trimmed.substring(0, 100)}..."`,
    };
  }

  return {
    success: false,
    error: `Failed to parse JSON response: Invalid JSON syntax`,
  };
}

/**
 * Validate data against JSON schema (recursive)
 */
function validateAgainstSchema(
  data: any,
  schema: LLMOutputSchema | JsonSchemaProperty,
  path: string
): string[] {
  const errors: string[] = [];
  const pathPrefix = path ? `${path}: ` : '';

  // Check type
  const actualType = getJsonType(data);

  if (schema.type !== actualType) {
    // Allow null for optional fields
    if (actualType !== 'null' || schema.type === 'null') {
      errors.push(`${pathPrefix}Expected ${schema.type}, got ${actualType}`);
      return errors; // Can't validate further with wrong type
    }
  }

  // Type-specific validation
  switch (schema.type) {
    case 'object':
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        const objSchema = schema as LLMOutputSchema;

        // Check required fields
        if (objSchema.required) {
          for (const field of objSchema.required) {
            if (!(field in data)) {
              errors.push(`${pathPrefix}Missing required field "${field}"`);
            }
          }
        }

        // Validate properties
        if (objSchema.properties) {
          for (const [key, propSchema] of Object.entries(objSchema.properties)) {
            if (key in data) {
              const propErrors = validateAgainstSchema(
                data[key],
                propSchema,
                path ? `${path}.${key}` : key
              );
              errors.push(...propErrors);
            }
          }
        }
      }
      break;

    case 'array':
      if (Array.isArray(data)) {
        const arrSchema = schema as JsonSchemaProperty;

        // Check min/max items
        if (arrSchema.minItems !== undefined && data.length < arrSchema.minItems) {
          errors.push(`${pathPrefix}Array has ${data.length} items, minimum is ${arrSchema.minItems}`);
        }
        if (arrSchema.maxItems !== undefined && data.length > arrSchema.maxItems) {
          errors.push(`${pathPrefix}Array has ${data.length} items, maximum is ${arrSchema.maxItems}`);
        }

        // Validate items
        if (arrSchema.items) {
          data.forEach((item, index) => {
            const itemErrors = validateAgainstSchema(
              item,
              arrSchema.items!,
              `${path}[${index}]`
            );
            errors.push(...itemErrors);
          });
        }
      }
      break;

    case 'string':
      if (typeof data === 'string') {
        const strSchema = schema as JsonSchemaProperty;

        if (strSchema.minLength !== undefined && data.length < strSchema.minLength) {
          errors.push(`${pathPrefix}String length ${data.length} is less than minimum ${strSchema.minLength}`);
        }
        if (strSchema.maxLength !== undefined && data.length > strSchema.maxLength) {
          errors.push(`${pathPrefix}String length ${data.length} exceeds maximum ${strSchema.maxLength}`);
        }
        if (strSchema.enum && !strSchema.enum.includes(data)) {
          errors.push(`${pathPrefix}Value "${data}" is not one of allowed values: ${strSchema.enum.join(', ')}`);
        }
        if (strSchema.pattern) {
          const regex = new RegExp(strSchema.pattern);
          if (!regex.test(data)) {
            errors.push(`${pathPrefix}Value "${data}" does not match pattern ${strSchema.pattern}`);
          }
        }
      }
      break;

    case 'number':
    case 'integer':
      if (typeof data === 'number') {
        const numSchema = schema as JsonSchemaProperty;

        if (schema.type === 'integer' && !Number.isInteger(data)) {
          errors.push(`${pathPrefix}Expected integer, got float ${data}`);
        }
        if (numSchema.minimum !== undefined && data < numSchema.minimum) {
          errors.push(`${pathPrefix}Value ${data} is less than minimum ${numSchema.minimum}`);
        }
        if (numSchema.maximum !== undefined && data > numSchema.maximum) {
          errors.push(`${pathPrefix}Value ${data} exceeds maximum ${numSchema.maximum}`);
        }
        if (numSchema.enum && !numSchema.enum.includes(data)) {
          errors.push(`${pathPrefix}Value ${data} is not one of allowed values: ${numSchema.enum.join(', ')}`);
        }
      }
      break;

    case 'boolean':
      // Boolean type already validated above
      break;
  }

  return errors;
}

/**
 * Get JSON type of a value
 */
function getJsonType(value: any): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

// ============================================================================
// PROMPT GENERATION
// ============================================================================

/**
 * Build prompt instructions for structured output
 *
 * @param schema - JSON Schema the LLM should output
 * @returns Prompt instructions to append to the user prompt
 */
export function buildSchemaPromptInstructions(schema: LLMOutputSchema): string {
  const schemaJson = JSON.stringify(schema, null, 2);

  return `
## OUTPUT FORMAT REQUIREMENT

You MUST respond with valid JSON that matches this exact schema:

\`\`\`json
${schemaJson}
\`\`\`

CRITICAL RULES:
1. Your ENTIRE response must be a valid JSON object - no text before or after
2. Include ALL required fields: ${schema.required?.join(', ') || 'none'}
3. Use the exact field names shown in the schema
4. Do NOT wrap the JSON in markdown code blocks or add any explanation

Example of correct format:
${generateSchemaExample(schema)}
`.trim();
}

/**
 * Generate an example JSON for a schema
 */
function generateSchemaExample(schema: LLMOutputSchema): string {
  const example = generateExampleValue(schema);
  return JSON.stringify(example, null, 2);
}

/**
 * Generate an example value for a schema property
 */
function generateExampleValue(schema: LLMOutputSchema | JsonSchemaProperty): any {
  switch (schema.type) {
    case 'object':
      const obj: Record<string, any> = {};
      if ((schema as LLMOutputSchema).properties) {
        for (const [key, propSchema] of Object.entries((schema as LLMOutputSchema).properties!)) {
          obj[key] = generateExampleValue(propSchema);
        }
      }
      return obj;

    case 'array':
      if ((schema as JsonSchemaProperty).items) {
        return [generateExampleValue((schema as JsonSchemaProperty).items!)];
      }
      return [];

    case 'string':
      if ((schema as JsonSchemaProperty).enum) {
        return (schema as JsonSchemaProperty).enum![0];
      }
      return 'example_value';

    case 'number':
      return 0.5;

    case 'integer':
      return 1;

    case 'boolean':
      return true;

    default:
      return null;
  }
}

/**
 * Build a retry hint for when validation fails
 */
function buildRetryHint(
  errorType: 'parse_error' | 'validation_error',
  schema: LLMOutputSchema,
  errors?: string[]
): string {
  if (errorType === 'parse_error') {
    return `Your previous response was not valid JSON. Please respond with ONLY a JSON object, no additional text. Required format: ${JSON.stringify(schema, null, 2)}`;
  }

  const errorList = errors?.slice(0, 3).join('; ') || 'validation errors';
  return `Your previous response had validation errors: ${errorList}. Please fix these issues and respond with valid JSON matching the schema.`;
}

// ============================================================================
// SCHEMA UTILITIES
// ============================================================================

/**
 * Get a common schema pattern
 */
export function getSchemaPattern(pattern: SchemaPattern): LLMOutputSchema {
  return SCHEMA_PATTERNS[pattern];
}

/**
 * Create a custom extraction schema with specific fields
 *
 * @param fields - Object mapping field names to their types
 * @param required - Array of required field names
 */
export function createExtractionSchema(
  fields: Record<string, 'string' | 'number' | 'boolean' | 'array' | 'object'>,
  required?: string[]
): LLMOutputSchema {
  const itemProperties: Record<string, JsonSchemaProperty> = {};

  for (const [name, type] of Object.entries(fields)) {
    itemProperties[name] = { type };
  }

  return {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: itemProperties,
          required: required,
        },
      },
    },
    required: ['items'],
  };
}

/**
 * Create a classification schema with custom categories
 *
 * @param categories - Array of valid category values
 * @param includeConfidence - Whether to require confidence score
 */
export function createClassificationSchema(
  categories: string[],
  includeConfidence: boolean = false
): LLMOutputSchema {
  const schema: LLMOutputSchema = {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: categories,
        description: `Must be one of: ${categories.join(', ')}`,
      },
      reasoning: {
        type: 'string',
        description: 'Explanation for the classification',
      },
    },
    required: includeConfidence ? ['category', 'confidence'] : ['category'],
  };

  if (includeConfidence) {
    schema.properties!.confidence = {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Confidence score between 0 and 1',
    };
  }

  return schema;
}

// ============================================================================
// DSL OUTPUTS CONVERSION
// ============================================================================

/**
 * Convert DSL step outputs declaration to LLMOutputSchema
 *
 * This enables ai_processing steps to enforce their declared output structure
 * by passing the schema to the LLM prompt.
 *
 * @param outputs - DSL step outputs declaration (e.g., { buckets: { type: 'object', properties: {...} } })
 * @returns LLMOutputSchema for prompt injection, or undefined if conversion fails
 *
 * @example
 * // DSL outputs:
 * { "buckets": { "type": "object", "properties": { "action_required": {...}, "fyi": {...} } } }
 *
 * // Converted to LLMOutputSchema:
 * { type: 'object', properties: { buckets: {...} }, required: ['buckets'] }
 */
export function convertDslOutputsToSchema(
  outputs: Record<string, any> | undefined
): LLMOutputSchema | undefined {
  if (!outputs || typeof outputs !== 'object') {
    return undefined;
  }

  // Filter out routing keys
  const routingKeys = ['next_step', 'is_last_step', 'iteration_next_step', 'after_loop_next_step'];
  const outputKeys = Object.keys(outputs).filter(key => !routingKeys.includes(key));

  if (outputKeys.length === 0) {
    return undefined;
  }

  // Build schema properties from declared outputs
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const key of outputKeys) {
    const outputDef = outputs[key];

    if (typeof outputDef === 'string') {
      // Simple type declaration: "buckets": "object"
      properties[key] = convertTypeStringToSchema(outputDef);
      required.push(key);
    } else if (typeof outputDef === 'object' && outputDef !== null) {
      // Full schema declaration: "buckets": { "type": "object", "properties": {...} }
      properties[key] = convertOutputDefToSchema(outputDef);
      required.push(key);
    }
  }

  if (Object.keys(properties).length === 0) {
    return undefined;
  }

  const schema: LLMOutputSchema = {
    type: 'object',
    description: 'Expected output structure for this step',
    properties,
    required,
  };

  logger.debug({ outputKeys, schema }, 'Converted DSL outputs to LLMOutputSchema');

  return schema;
}

/**
 * Convert a simple type string to JsonSchemaProperty
 */
function convertTypeStringToSchema(typeStr: string): JsonSchemaProperty {
  // Handle array types like "object[]" or "string[]"
  if (typeStr.endsWith('[]')) {
    const itemType = typeStr.slice(0, -2);
    return {
      type: 'array',
      items: convertTypeStringToSchema(itemType),
    };
  }

  // Map common type strings
  const typeMap: Record<string, JsonSchemaProperty['type']> = {
    'string': 'string',
    'number': 'number',
    'integer': 'integer',
    'boolean': 'boolean',
    'object': 'object',
    'array': 'array',
  };

  return {
    type: typeMap[typeStr] || 'object',
  };
}

/**
 * Convert a DSL output definition object to JsonSchemaProperty
 */
function convertOutputDefToSchema(def: any): JsonSchemaProperty {
  const schema: JsonSchemaProperty = {
    type: def.type || 'object',
  };

  if (def.description) {
    schema.description = def.description;
  }

  if (def.properties) {
    schema.properties = {};
    for (const [propKey, propDef] of Object.entries(def.properties)) {
      if (typeof propDef === 'string') {
        schema.properties[propKey] = convertTypeStringToSchema(propDef);
      } else if (typeof propDef === 'object' && propDef !== null) {
        schema.properties[propKey] = convertOutputDefToSchema(propDef);
      }
    }
  }

  if (def.items) {
    if (typeof def.items === 'string') {
      schema.items = convertTypeStringToSchema(def.items);
    } else if (typeof def.items === 'object') {
      schema.items = convertOutputDefToSchema(def.items);
    }
  }

  if (def.required && Array.isArray(def.required)) {
    schema.required = def.required;
  }

  if (def.enum) {
    schema.enum = def.enum;
  }

  return schema;
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  validateLLMOutput as default,
};
