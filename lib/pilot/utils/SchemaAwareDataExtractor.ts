/**
 * SchemaAwareDataExtractor
 *
 * Single source of truth for extracting data arrays from plugin outputs.
 * Uses plugin output_schema to deterministically find the correct field
 * instead of guessing from hardcoded lists.
 *
 * This eliminates the duplicate logic that existed in:
 * - StepExecutor.ts (lines ~1421-1427)
 * - ParallelExecutor.ts (lines ~184-189)
 * - DeclarativeCompiler.ts (getOutputArrayFieldName)
 *
 * @module lib/pilot/utils/SchemaAwareDataExtractor
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'SchemaAwareDataExtractor', service: 'workflow-pilot' });

/**
 * Schema analysis result describing the structure of plugin output
 */
export interface SchemaAnalysis {
  /** Name of the primary array field (e.g., 'emails', 'values', 'records') */
  primaryArrayField: string | null;
  /** Whether the array contains arrays (2D array like Google Sheets) */
  is2DArray: boolean;
  /** Nested wrapper pattern if present */
  nestedWrapper: 'fields' | 'properties' | 'data' | null;
  /** Type of items in the array */
  itemType: 'object' | 'array' | 'primitive' | 'unknown';
  /** All array fields found in the schema */
  allArrayFields: string[];
}

/**
 * Metadata fields that should NOT be treated as primary data arrays.
 * These are common pagination/status fields across all APIs.
 */
const METADATA_FIELDS = new Set([
  // Pagination metadata
  'count', 'total', 'total_count', 'totalCount', 'page', 'pages', 'per_page', 'perPage',
  'offset', 'limit', 'start', 'size', 'has_more', 'hasMore', 'next_page', 'nextPage',
  'next_page_token', 'nextPageToken', 'cursor', 'next_cursor', 'nextCursor',
  'previous_page', 'previousPage', 'prev_cursor', 'prevCursor',
  // Status/meta fields
  'pagination', 'paging', 'meta', 'metadata', '_metadata', '_meta',
  'success', 'error', 'errors', 'status', 'message', 'code',
  // Transform output metadata
  'removed', 'originalCount', 'original_count', 'length',
  // Common non-data array fields
  'warnings', 'info', 'debug', 'links', '_links'
]);

/**
 * Priority patterns for identifying primary data arrays when multiple exist.
 * Order matters - first match wins.
 */
const PRIMARY_ARRAY_PATTERNS = [
  /^items$/i,
  /^results?$/i,
  /^records?$/i,
  /^entries$/i,
  /^list$/i,
  /^rows?$/i,
  /^values$/i,
  /^objects?$/i,
  /^entities$/i,
  /^resources?$/i,
  /^elements$/i,
  /^content$/i,
  /^response$/i
];

export class SchemaAwareDataExtractor {
  private static instance: SchemaAwareDataExtractor;
  private schemaCache: Map<string, SchemaAnalysis> = new Map();

  private constructor() {}

  static getInstance(): SchemaAwareDataExtractor {
    if (!SchemaAwareDataExtractor.instance) {
      SchemaAwareDataExtractor.instance = new SchemaAwareDataExtractor();
    }
    return SchemaAwareDataExtractor.instance;
  }

  /**
   * Analyze a plugin's output schema to understand its data structure
   */
  analyzeSchema(outputSchema: any): SchemaAnalysis {
    const result: SchemaAnalysis = {
      primaryArrayField: null,
      is2DArray: false,
      nestedWrapper: null,
      itemType: 'unknown',
      allArrayFields: []
    };

    if (!outputSchema || outputSchema.type !== 'object' || !outputSchema.properties) {
      return result;
    }

    // Find all array fields, excluding metadata
    for (const [fieldName, fieldDef] of Object.entries(outputSchema.properties as Record<string, any>)) {
      if (fieldDef.type === 'array' && !METADATA_FIELDS.has(fieldName) && !METADATA_FIELDS.has(fieldName.toLowerCase())) {
        result.allArrayFields.push(fieldName);
      }
    }

    // Find the primary array field
    for (const [fieldName, fieldDef] of Object.entries(outputSchema.properties as Record<string, any>)) {
      if (fieldDef.type === 'array' && !METADATA_FIELDS.has(fieldName)) {
        result.primaryArrayField = fieldName;

        // Check if 2D array (array of arrays)
        if (fieldDef.items?.type === 'array') {
          result.is2DArray = true;
          result.itemType = 'array';
        }
        // Check if array of objects with nested wrappers
        else if (fieldDef.items?.type === 'object' || fieldDef.items?.properties) {
          result.itemType = 'object';
          const itemProps = fieldDef.items?.properties || {};

          // Detect CRM-style nested wrappers
          if ('fields' in itemProps && itemProps.fields?.type === 'object') {
            result.nestedWrapper = 'fields';
          } else if ('properties' in itemProps && itemProps.properties?.type === 'object') {
            result.nestedWrapper = 'properties';
          } else if ('data' in itemProps && itemProps.data?.type === 'object') {
            result.nestedWrapper = 'data';
          }
        }
        // Primitive array
        else if (['string', 'number', 'integer', 'boolean'].includes(fieldDef.items?.type)) {
          result.itemType = 'primitive';
        }

        break; // Use first non-metadata array field
      }
    }

    return result;
  }

  /**
   * Get cached schema analysis for a plugin/action combination
   */
  async getSchemaAnalysis(pluginName: string, actionName: string): Promise<SchemaAnalysis | null> {
    const cacheKey = `${pluginName}.${actionName}`;

    if (this.schemaCache.has(cacheKey)) {
      return this.schemaCache.get(cacheKey)!;
    }

    try {
      const PluginManager = (await import('../../server/plugin-manager-v2')).PluginManagerV2;
      const pluginManager = await PluginManager.getInstance();
      const actionDef = pluginManager.getActionDefinition(pluginName, actionName);

      if (actionDef?.output_schema) {
        const analysis = this.analyzeSchema(actionDef.output_schema);
        this.schemaCache.set(cacheKey, analysis);
        logger.debug({ pluginName, actionName, analysis }, 'Cached schema analysis');
        return analysis;
      }
    } catch (error) {
      logger.warn({ pluginName, actionName, error }, 'Failed to get schema analysis');
    }

    return null;
  }

  /**
   * Extract the primary data array from plugin output.
   * This is the main method that replaces all the hardcoded field detection logic.
   *
   * @param data - The raw output from a plugin action
   * @param pluginName - Name of the plugin (for schema lookup)
   * @param actionName - Name of the action (for schema lookup)
   * @returns The extracted array, or the original data if no array found
   */
  async extractArray(data: any, pluginName?: string, actionName?: string): Promise<any[]> {
    // If already an array, return as-is
    if (Array.isArray(data)) {
      return data;
    }

    // If not an object, can't extract
    if (!data || typeof data !== 'object') {
      return [];
    }

    // Try using attached schema first (propagated from compiler - no lookup needed)
    const attachedSchema = (data as any)._outputSchema;
    if (attachedSchema) {
      const schemaAnalysis = this.analyzeSchema(attachedSchema);
      if (schemaAnalysis?.primaryArrayField && data[schemaAnalysis.primaryArrayField]) {
        logger.debug({
          field: schemaAnalysis.primaryArrayField,
          source: 'attached_schema'
        }, 'Schema-driven array extraction (from attached schema)');
        return data[schemaAnalysis.primaryArrayField];
      }
    }

    // Try schema lookup if plugin/action provided
    if (pluginName && actionName) {
      const schemaAnalysis = await this.getSchemaAnalysis(pluginName, actionName);
      if (schemaAnalysis?.primaryArrayField && data[schemaAnalysis.primaryArrayField]) {
        logger.debug({
          pluginName,
          actionName,
          field: schemaAnalysis.primaryArrayField,
          source: 'runtime_lookup'
        }, 'Schema-driven array extraction (from runtime lookup)');
        return data[schemaAnalysis.primaryArrayField];
      }
    }

    // Fallback to heuristic extraction (for backwards compatibility)
    return this.extractArrayHeuristic(data);
  }

  /**
   * Extract array using heuristics when schema is not available.
   * This preserves the existing behavior as a fallback.
   */
  extractArrayHeuristic(data: any): any[] {
    if (Array.isArray(data)) {
      return data;
    }

    if (!data || typeof data !== 'object') {
      return [];
    }

    // Step 1: Check for nested 'data' wrapper (common REST API pattern)
    if (data.data !== undefined) {
      if (Array.isArray(data.data)) {
        return data.data;
      }
      if (typeof data.data === 'object' && data.data !== null) {
        const nested = this.extractArrayHeuristic(data.data);
        if (Array.isArray(nested) && nested.length > 0) {
          return nested;
        }
      }
    }

    // Step 2: Find all array fields, excluding metadata
    const arrayFields: [string, any[]][] = [];
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value) && !METADATA_FIELDS.has(key) && !METADATA_FIELDS.has(key.toLowerCase())) {
        arrayFields.push([key, value]);
      }
    }

    // Step 3: Single array field - use it
    if (arrayFields.length === 1) {
      return arrayFields[0][1];
    }

    // Step 4: Multiple arrays - use pattern-based priority
    if (arrayFields.length > 1) {
      for (const pattern of PRIMARY_ARRAY_PATTERNS) {
        const match = arrayFields.find(([key]) => pattern.test(key));
        if (match) {
          return match[1];
        }
      }

      // Pluralized noun patterns
      const pluralFields = arrayFields.filter(([key]) =>
        /^[a-z_]+s$/i.test(key) && key.length > 3 && !key.startsWith('_')
      );
      if (pluralFields.length === 1) {
        return pluralFields[0][1];
      }
      if (pluralFields.length > 1) {
        pluralFields.sort((a, b) => b[0].length - a[0].length);
        return pluralFields[0][1];
      }

      // Largest non-empty array
      const nonEmpty = arrayFields.filter(([_, arr]) => arr.length > 0);
      if (nonEmpty.length > 0) {
        nonEmpty.sort((a, b) => b[1].length - a[1].length);
        return nonEmpty[0][1];
      }

      // First array as last resort
      return arrayFields[0][1];
    }

    // Step 5: Check for single nested object
    const objectFields = Object.entries(data).filter(([key, value]) =>
      typeof value === 'object' && value !== null && !Array.isArray(value) &&
      !METADATA_FIELDS.has(key) && !key.startsWith('_')
    );

    if (objectFields.length === 1) {
      const nested = this.extractArrayHeuristic(objectFields[0][1]);
      if (Array.isArray(nested) && nested.length > 0) {
        return nested;
      }
    }

    return [];
  }

  /**
   * Extract a value from an item, handling nested wrappers automatically.
   * Supports: direct access, fields wrapper, properties wrapper, data wrapper.
   *
   * @param item - The item to extract from (can be object with nested wrappers)
   * @param key - The key to extract
   * @param allData - Optional full dataset for 2D array header detection
   */
  extractValueFromItem(item: any, key: string | number, allData?: any[]): any {
    // Pattern 1: Array item (row in 2D array)
    if (Array.isArray(item)) {
      if (typeof key === 'number') {
        return item[key];
      }
      const numericKey = parseInt(String(key), 10);
      if (!isNaN(numericKey)) {
        return item[numericKey];
      }
      // Try to find column by header name
      if (allData && Array.isArray(allData[0])) {
        const headerRow = allData[0];
        const exactIndex = headerRow.indexOf(key);
        if (exactIndex !== -1) {
          return item[exactIndex];
        }
        const lowerKey = String(key).toLowerCase();
        const caseIndex = headerRow.findIndex((h: any) => String(h).toLowerCase() === lowerKey);
        if (caseIndex !== -1) {
          return item[caseIndex];
        }
      }
      return undefined;
    }

    // Pattern 2: Object with potential nested wrappers
    if (typeof item === 'object' && item !== null) {
      // Direct access
      if (key in item) {
        return item[key];
      }

      // Auto-detect nested wrappers (CRM patterns)
      if ('fields' in item && typeof item.fields === 'object' && item.fields !== null) {
        if (key in item.fields) {
          return item.fields[key];
        }
      }
      if ('properties' in item && typeof item.properties === 'object' && item.properties !== null) {
        if (key in item.properties) {
          return item.properties[key];
        }
      }
      if ('data' in item && typeof item.data === 'object' && item.data !== null) {
        if (key in item.data) {
          return item.data[key];
        }
      }

      // Dot notation for explicit nested access
      const keyParts = String(key).split('.');
      if (keyParts.length > 1) {
        let value = item;
        for (const part of keyParts) {
          if (value && typeof value === 'object' && part in value) {
            value = value[part];
          } else {
            return undefined;
          }
        }
        return value;
      }
    }

    // Pattern 3: Primitive - return as-is
    return item;
  }

  /**
   * Get the name of the primary array field for a plugin/action.
   * Useful when you need just the field name, not the extracted data.
   */
  async getPrimaryArrayFieldName(pluginName: string, actionName: string): Promise<string | null> {
    const analysis = await this.getSchemaAnalysis(pluginName, actionName);
    return analysis?.primaryArrayField || null;
  }

  /**
   * Check if a plugin/action returns a 2D array (like Google Sheets)
   */
  async is2DArrayOutput(pluginName: string, actionName: string): Promise<boolean> {
    const analysis = await this.getSchemaAnalysis(pluginName, actionName);
    return analysis?.is2DArray || false;
  }

  /**
   * Clear the schema cache (useful for testing or when plugins are reloaded)
   */
  clearCache(): void {
    this.schemaCache.clear();
    logger.debug('Schema cache cleared');
  }
}

// Export singleton instance for convenience
export const schemaExtractor = SchemaAwareDataExtractor.getInstance();

/**
 * Standalone synchronous schema analysis function
 * Use this in contexts where you already have the schema (like DeclarativeCompiler)
 * and don't need async lookup.
 */
export function analyzeOutputSchema(outputSchema: any): SchemaAnalysis {
  return schemaExtractor.analyzeSchema(outputSchema);
}
