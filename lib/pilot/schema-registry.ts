/**
 * Schema Registry - Unified schema access layer
 *
 * Phase 3 Architectural Redesign:
 * This module provides centralized access to plugin action output schemas,
 * enabling the DSL compiler and executor to validate field references
 * against authoritative schema definitions.
 *
 * Phase 5 Enhancement - Schema Contract Enforcement:
 * Extended to support $ref resolution for three schema categories:
 * 1. Plugin outputs: "plugins.google-mail.search_emails.output"
 * 2. AI processing: "ai.extract_emails_summary.v1.output"
 * 3. Transform outputs: "transforms.split.by_field.output"
 *
 * REFACTORED: Now delegates to PluginManagerV2 for plugin definitions
 * instead of loading JSON files directly. This eliminates duplication
 * and ensures a single source of truth for plugin data.
 *
 * Key responsibilities:
 * - Provide output schema lookup by plugin/action (via PluginManagerV2)
 * - Support $ref resolution for schema references
 * - Register and retrieve AI processing schemas
 * - Register and retrieve transform output schemas
 * - Validate field paths against schemas
 * - Extract valid field names for error messages
 *
 * @module lib/pilot/schema-registry
 */

import { createLogger } from '@/lib/logger';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import type { ActionOutputSchema } from '@/lib/types/plugin-types';

const logger = createLogger({ module: 'SchemaRegistry', service: 'workflow-pilot' });

// ============================================================================
// TYPES
// ============================================================================

/**
 * Schema property for recursive validation
 * Extended from ActionOutputSchema for nested property access
 */
interface SchemaProperty {
  type: string;
  description?: string;
  properties?: Record<string, SchemaProperty>;
  items?: SchemaProperty;
  enum?: string[];
  format?: string;
}

/**
 * Field validation result
 */
export interface FieldValidationResult {
  valid: boolean;
  fieldPath: string;
  error?: string;
  suggestion?: string;
  availableFields?: string[];
}

/**
 * JSON Schema definition (simplified for our use case)
 */
export interface JSONSchema {
  type: string;
  description?: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  enum?: string[];
  format?: string;
  additionalProperties?: boolean;
}

/**
 * Schema reference format
 * Examples:
 *   - "plugins.google-mail.search_emails.output"
 *   - "ai.extract_emails_summary.v1.output"
 *   - "transforms.split.by_field.output"
 */
export type SchemaRef = string;

/**
 * Schema categories for $ref resolution
 */
export type SchemaCategory = 'plugins' | 'ai' | 'transforms';

/**
 * Registered schema entry
 */
export interface RegisteredSchema {
  ref: SchemaRef;
  category: SchemaCategory;
  schema: JSONSchema;
  version?: string;
  description?: string;
}

/**
 * Schema resolution result
 */
export interface SchemaResolutionResult {
  found: boolean;
  schema?: JSONSchema;
  ref: SchemaRef;
  error?: string;
}

// ============================================================================
// SCHEMA REGISTRY CLASS
// ============================================================================

export class SchemaRegistry {
  private static instance: SchemaRegistry | null = null;
  private pluginManager: PluginManagerV2 | null = null;
  private initialized: boolean = false;

  // Phase 5: Schema storage for AI processing and transform outputs
  private aiSchemas: Map<string, RegisteredSchema> = new Map();
  private transformSchemas: Map<string, RegisteredSchema> = new Map();

  private constructor() {
    // Register built-in transform output schemas
    this.registerBuiltInTransformSchemas();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): SchemaRegistry {
    if (!SchemaRegistry.instance) {
      SchemaRegistry.instance = new SchemaRegistry();
    }
    return SchemaRegistry.instance;
  }

  /**
   * Initialize schema registry by connecting to PluginManagerV2
   * Must be called before using schema validation methods
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.pluginManager = await PluginManagerV2.getInstance();
      this.initialized = true;
      logger.info('Schema registry initialized with PluginManagerV2');
    } catch (err) {
      logger.error({ err }, 'Failed to initialize schema registry with PluginManagerV2');
      throw err;
    }
  }

  /**
   * Check if registry is initialized
   */
  isInitialized(): boolean {
    return this.initialized && this.pluginManager !== null;
  }

  /**
   * Get output schema for a plugin action
   */
  getOutputSchema(pluginName: string, actionName: string): ActionOutputSchema | undefined {
    if (!this.pluginManager) {
      logger.warn('Schema registry not initialized, cannot get output schema');
      return undefined;
    }

    const action = this.pluginManager.getActionDefinition(pluginName, actionName);
    return action?.output_schema;
  }

  /**
   * Get sample output for a plugin action (useful for debugging)
   */
  getSampleOutput(pluginName: string, actionName: string): any {
    if (!this.pluginManager) return undefined;

    const guidance = this.pluginManager.getOutputGuidance(pluginName, actionName);
    return guidance?.sample_output;
  }

  /**
   * Validate a field path against an action's output schema
   */
  validateFieldPath(
    pluginName: string,
    actionName: string,
    fieldPath: string
  ): FieldValidationResult {
    const schema = this.getOutputSchema(pluginName, actionName);

    if (!schema) {
      return {
        valid: true, // Can't validate without schema, allow through
        fieldPath,
        error: `No schema found for ${pluginName}.${actionName}`,
      };
    }

    const parts = fieldPath.split('.');
    const result = this.validatePathAgainstSchema(parts, schema as SchemaProperty);

    if (!result.valid) {
      result.availableFields = this.getAvailableFields(schema as SchemaProperty);
    }

    return result;
  }

  /**
   * Get all valid top-level field names from a schema
   */
  getAvailableFields(schema: SchemaProperty): string[] {
    const fields: string[] = [];

    if (schema.properties) {
      fields.push(...Object.keys(schema.properties));
    }

    if (schema.items?.properties) {
      // For arrays, show item properties prefixed with []
      for (const key of Object.keys(schema.items.properties)) {
        fields.push(`[].${key}`);
      }
    }

    return fields;
  }

  /**
   * Get all valid field paths (recursively) from a schema
   */
  getAllFieldPaths(pluginName: string, actionName: string): string[] {
    const schema = this.getOutputSchema(pluginName, actionName);
    if (!schema) return [];

    return this.extractFieldPaths(schema as SchemaProperty, '');
  }

  /**
   * Check if a plugin is registered
   */
  hasPlugin(pluginName: string): boolean {
    if (!this.pluginManager) return false;
    return this.pluginManager.getPluginDefinition(pluginName) !== undefined;
  }

  /**
   * Get all registered plugin names
   */
  getPluginNames(): string[] {
    if (!this.pluginManager) return [];
    return this.pluginManager.getAllPluginNames();
  }

  /**
   * Get all action names for a plugin
   */
  getActionNames(pluginName: string): string[] {
    if (!this.pluginManager) return [];

    const plugin = this.pluginManager.getPluginDefinition(pluginName);
    if (!plugin) return [];

    return Object.keys(plugin.actions);
  }

  // ==========================================================================
  // PHASE 5: SCHEMA REF RESOLUTION
  // ==========================================================================

  /**
   * Register a schema with a $ref key
   *
   * @param ref - Schema reference key (e.g., "ai.extract_emails_summary.v1.output")
   * @param schema - The JSON Schema definition
   * @param options - Optional metadata (version, description)
   */
  registerSchema(
    ref: SchemaRef,
    schema: JSONSchema,
    options?: { version?: string; description?: string }
  ): void {
    const category = this.parseSchemaCategory(ref);

    if (!category) {
      logger.warn({ ref }, 'Invalid schema ref format, cannot determine category');
      return;
    }

    const entry: RegisteredSchema = {
      ref,
      category,
      schema,
      version: options?.version,
      description: options?.description,
    };

    if (category === 'ai') {
      this.aiSchemas.set(ref, entry);
      logger.debug({ ref }, 'Registered AI processing schema');
    } else if (category === 'transforms') {
      this.transformSchemas.set(ref, entry);
      logger.debug({ ref }, 'Registered transform schema');
    }
    // Plugin schemas are read-only from PluginManagerV2
  }

  /**
   * Get a registered schema by its $ref key
   *
   * @param ref - Schema reference key
   * @returns The registered schema entry, or undefined if not found
   */
  getSchema(ref: SchemaRef): RegisteredSchema | undefined {
    const category = this.parseSchemaCategory(ref);

    if (!category) return undefined;

    if (category === 'ai') {
      return this.aiSchemas.get(ref);
    } else if (category === 'transforms') {
      return this.transformSchemas.get(ref);
    } else if (category === 'plugins') {
      // Parse plugin ref: "plugins.google-mail.search_emails.output"
      const parts = ref.split('.');
      if (parts.length >= 4) {
        const pluginName = parts[1];
        const actionName = parts[2];
        const schema = this.getOutputSchema(pluginName, actionName);

        if (schema) {
          return {
            ref,
            category: 'plugins',
            schema: schema as JSONSchema,
          };
        }
      }
    }

    return undefined;
  }

  /**
   * Resolve a $ref to its JSON Schema
   *
   * Supports three reference formats:
   * - "plugins.{plugin}.{action}.output" - Plugin action output schema
   * - "ai.{name}.{version}.output" - AI processing output schema
   * - "transforms.{type}.{variant}.output" - Transform output schema
   *
   * Also supports sub-path resolution:
   * - "ai.extract_emails_summary.v1.output#/properties/rows"
   *
   * @param ref - Schema reference string
   * @returns Resolution result with schema or error
   */
  resolveSchemaRef(ref: SchemaRef): SchemaResolutionResult {
    // Handle sub-path references (e.g., "schema#/properties/rows")
    const [baseRef, subPath] = ref.split('#');

    // Get the base schema
    const registeredSchema = this.getSchema(baseRef);

    if (!registeredSchema) {
      return {
        found: false,
        ref,
        error: `Schema not found: ${baseRef}`,
      };
    }

    let schema = registeredSchema.schema;

    // If there's a sub-path, resolve it
    if (subPath) {
      const resolvedSubPath = this.resolveJsonPointer(schema, subPath);
      if (!resolvedSubPath.found) {
        return {
          found: false,
          ref,
          error: `Sub-path not found in schema: ${subPath}`,
        };
      }
      schema = resolvedSubPath.schema!;
    }

    return {
      found: true,
      schema,
      ref,
    };
  }

  /**
   * Check if a $ref exists in the registry
   */
  hasSchemaRef(ref: SchemaRef): boolean {
    const [baseRef] = ref.split('#');
    return this.getSchema(baseRef) !== undefined;
  }

  /**
   * Get all registered schema refs for a category
   */
  getSchemaRefs(category: SchemaCategory): SchemaRef[] {
    if (category === 'ai') {
      return Array.from(this.aiSchemas.keys());
    } else if (category === 'transforms') {
      return Array.from(this.transformSchemas.keys());
    } else if (category === 'plugins') {
      // Generate refs for all plugin actions
      const refs: SchemaRef[] = [];
      for (const pluginName of this.getPluginNames()) {
        for (const actionName of this.getActionNames(pluginName)) {
          refs.push(`plugins.${pluginName}.${actionName}.output`);
        }
      }
      return refs;
    }
    return [];
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Register built-in transform output schemas
   * These are deterministic and don't change based on input
   */
  private registerBuiltInTransformSchemas(): void {
    // Split transform - field-based grouping
    this.transformSchemas.set('transforms.split.by_field.output', {
      ref: 'transforms.split.by_field.output',
      category: 'transforms',
      schema: {
        type: 'object',
        description: 'Split output with dynamic bucket names based on field values',
        properties: {
          _meta: {
            type: 'object',
            properties: {
              buckets: { type: 'array', items: { type: 'string' } },
              counts: { type: 'object' },
              total: { type: 'number' },
            },
          },
        },
        additionalProperties: true, // Allows dynamic bucket keys
      },
    });

    // Split transform - size-based chunking
    this.transformSchemas.set('transforms.split.by_size.output', {
      ref: 'transforms.split.by_size.output',
      category: 'transforms',
      schema: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'array' } },
          chunks: { type: 'array', items: { type: 'array' } },
          count: { type: 'number' },
          chunkSize: { type: 'number' },
        },
      },
    });

    // Deduplicate transform
    this.transformSchemas.set('transforms.deduplicate.output', {
      ref: 'transforms.deduplicate.output',
      category: 'transforms',
      schema: {
        type: 'object',
        description: 'Deduplicated array with same item type as input',
        properties: {
          items: { type: 'array' },
          originalCount: { type: 'number' },
          deduplicatedCount: { type: 'number' },
          removedCount: { type: 'number' },
        },
      },
    });

    // Format transform - string output
    this.transformSchemas.set('transforms.format.string.output', {
      ref: 'transforms.format.string.output',
      category: 'transforms',
      schema: {
        type: 'object',
        properties: {
          result: { type: 'string' },
        },
      },
    });

    // Format transform - object output (e.g., email content)
    this.transformSchemas.set('transforms.format.object.output', {
      ref: 'transforms.format.object.output',
      category: 'transforms',
      schema: {
        type: 'object',
        additionalProperties: true, // Shape defined by step outputs
      },
    });

    logger.debug({ count: this.transformSchemas.size }, 'Registered built-in transform schemas');
  }

  /**
   * Parse schema category from $ref string
   */
  private parseSchemaCategory(ref: SchemaRef): SchemaCategory | null {
    if (ref.startsWith('plugins.')) return 'plugins';
    if (ref.startsWith('ai.')) return 'ai';
    if (ref.startsWith('transforms.')) return 'transforms';
    return null;
  }

  /**
   * Resolve a JSON Pointer path within a schema
   * e.g., "/properties/rows" navigates to schema.properties.rows
   */
  private resolveJsonPointer(
    schema: JSONSchema,
    pointer: string
  ): { found: boolean; schema?: JSONSchema } {
    if (!pointer || pointer === '/') {
      return { found: true, schema };
    }

    // Remove leading slash and split
    const parts = pointer.replace(/^\//, '').split('/');
    let current: any = schema;

    for (const part of parts) {
      if (current === undefined || current === null) {
        return { found: false };
      }

      // Handle array index
      if (/^\d+$/.test(part)) {
        if (Array.isArray(current)) {
          current = current[parseInt(part, 10)];
        } else {
          return { found: false };
        }
      } else {
        current = current[part];
      }
    }

    if (current === undefined) {
      return { found: false };
    }

    return { found: true, schema: current as JSONSchema };
  }

  /**
   * Validate path parts against a schema
   */
  private validatePathAgainstSchema(
    parts: string[],
    schema: SchemaProperty,
    depth: number = 0
  ): FieldValidationResult {
    if (parts.length === 0) {
      return { valid: true, fieldPath: '' };
    }

    const [current, ...rest] = parts;
    const fieldPath = parts.join('.');

    // Handle array index access [0], [*], etc.
    if (current.startsWith('[') && current.endsWith(']')) {
      if (schema.type === 'array' && schema.items) {
        return this.validatePathAgainstSchema(rest, schema.items, depth + 1);
      }
      return {
        valid: false,
        fieldPath,
        error: `Cannot use array access on non-array type: ${schema.type}`,
      };
    }

    // Check if current field exists in properties
    if (schema.properties) {
      const property = schema.properties[current];

      if (!property) {
        return {
          valid: false,
          fieldPath,
          error: `Field "${current}" not found in schema`,
          suggestion: `Available fields: ${Object.keys(schema.properties).join(', ')}`,
          availableFields: Object.keys(schema.properties),
        };
      }

      // If more path parts, continue validation
      if (rest.length > 0) {
        return this.validatePathAgainstSchema(rest, property, depth + 1);
      }

      return { valid: true, fieldPath };
    }

    // If schema has items (array type), validate against item schema
    if (schema.type === 'array' && schema.items) {
      // For direct field access on array items (e.g., emails.subject inside #each)
      if (schema.items.properties) {
        const property = schema.items.properties[current];
        if (!property) {
          return {
            valid: false,
            fieldPath,
            error: `Field "${current}" not found in array item schema`,
            suggestion: `Available fields: ${Object.keys(schema.items.properties).join(', ')}`,
            availableFields: Object.keys(schema.items.properties),
          };
        }

        if (rest.length > 0) {
          return this.validatePathAgainstSchema(rest, property, depth + 1);
        }

        return { valid: true, fieldPath };
      }
    }

    // Can't validate further - schema doesn't have properties
    return { valid: true, fieldPath };
  }

  /**
   * Extract all field paths from a schema recursively
   */
  private extractFieldPaths(schema: SchemaProperty, prefix: string): string[] {
    const paths: string[] = [];

    if (schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        const path = prefix ? `${prefix}.${key}` : key;
        paths.push(path);

        // Recurse into nested properties
        if (prop.properties || (prop.type === 'array' && prop.items)) {
          paths.push(...this.extractFieldPaths(prop, path));
        }
      }
    }

    if (schema.type === 'array' && schema.items) {
      const arrayPrefix = prefix ? `${prefix}[]` : '[]';
      if (schema.items.properties) {
        for (const [key, prop] of Object.entries(schema.items.properties)) {
          const path = `${arrayPrefix}.${key}`;
          paths.push(path);

          if (prop.properties || (prop.type === 'array' && prop.items)) {
            paths.push(...this.extractFieldPaths(prop, path));
          }
        }
      }
    }

    return paths;
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Get the schema registry instance
 */
export function getSchemaRegistry(): SchemaRegistry {
  return SchemaRegistry.getInstance();
}

/**
 * Initialize the schema registry (call once at startup)
 * Connects to PluginManagerV2 for plugin definitions
 */
export async function initializeSchemaRegistry(): Promise<SchemaRegistry> {
  const registry = SchemaRegistry.getInstance();
  await registry.initialize();
  return registry;
}

/**
 * Quick validation of a field path against a plugin action schema
 */
export function validateSchemaField(
  pluginName: string,
  actionName: string,
  fieldPath: string
): FieldValidationResult {
  const registry = SchemaRegistry.getInstance();
  return registry.validateFieldPath(pluginName, actionName, fieldPath);
}

// ============================================================================
// PHASE 5: SCHEMA REF CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Register a schema with a $ref key
 *
 * @example
 * registerSchema('ai.extract_emails_summary.v1.output', {
 *   type: 'object',
 *   properties: {
 *     rows: {
 *       type: 'array',
 *       items: {
 *         type: 'object',
 *         required: ['classification', 'sender', 'subject'],
 *         properties: {
 *           classification: { type: 'string', enum: ['action_required', 'fyi'] },
 *           sender: { type: 'string' },
 *           subject: { type: 'string' }
 *         }
 *       }
 *     }
 *   }
 * });
 */
export function registerSchema(
  ref: SchemaRef,
  schema: JSONSchema,
  options?: { version?: string; description?: string }
): void {
  const registry = SchemaRegistry.getInstance();
  registry.registerSchema(ref, schema, options);
}

/**
 * Resolve a $ref to its JSON Schema
 *
 * @example
 * const result = resolveSchemaRef('plugins.google-mail.search_emails.output');
 * if (result.found) {
 *   console.log(result.schema);
 * }
 *
 * // With sub-path
 * const rowsResult = resolveSchemaRef('ai.extract_emails_summary.v1.output#/properties/rows');
 */
export function resolveSchemaRef(ref: SchemaRef): SchemaResolutionResult {
  const registry = SchemaRegistry.getInstance();
  return registry.resolveSchemaRef(ref);
}

/**
 * Check if a $ref exists in the registry
 */
export function hasSchemaRef(ref: SchemaRef): boolean {
  const registry = SchemaRegistry.getInstance();
  return registry.hasSchemaRef(ref);
}

/**
 * Get all registered schema refs for a category
 */
export function getSchemaRefs(category: SchemaCategory): SchemaRef[] {
  const registry = SchemaRegistry.getInstance();
  return registry.getSchemaRefs(category);
}
