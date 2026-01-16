/**
 * SchemaMapper
 *
 * Maps extracted fields to the output_schema defined in the workflow.
 * Handles field name normalization, type conversion, and validation.
 */

import { createLogger } from '@/lib/logger';
import type {
  ExtractedField,
  OutputSchema,
  OutputSchemaField,
  SchemaMappingResult,
} from './types';

const logger = createLogger({ module: 'SchemaMapper', service: 'extraction' });

export class SchemaMapper {
  /**
   * Map extracted fields to output schema
   */
  mapToSchema(
    extractedFields: Record<string, ExtractedField>,
    outputSchema: OutputSchema
  ): SchemaMappingResult {
    const data: Record<string, any> = {};
    const unmappedFields: string[] = [];
    const missingRequiredFields: string[] = [];
    let totalConfidence = 0;
    let mappedCount = 0;

    // Track which extracted fields were used
    const usedFields = new Set<string>();

    // Map each schema field
    for (const schemaField of outputSchema.fields) {
      const extractedField = this.findMatchingField(schemaField.name, extractedFields);

      if (extractedField) {
        // Convert value to expected type
        const convertedValue = this.convertToType(extractedField.value, schemaField.type);
        data[schemaField.name] = convertedValue;
        usedFields.add(extractedField.name);
        totalConfidence += extractedField.confidence;
        mappedCount++;
      } else if (schemaField.required) {
        missingRequiredFields.push(schemaField.name);
      } else {
        // Optional field not found - set to null
        data[schemaField.name] = null;
      }
    }

    // Find unmapped extracted fields
    for (const fieldName of Object.keys(extractedFields)) {
      if (!usedFields.has(fieldName)) {
        unmappedFields.push(fieldName);
      }
    }

    const confidence = mappedCount > 0 ? totalConfidence / mappedCount : 0;

    logger.info({
      schemaFieldCount: outputSchema.fields.length,
      mappedCount,
      unmappedCount: unmappedFields.length,
      missingRequiredCount: missingRequiredFields.length,
      confidence,
    }, 'SchemaMapper: Mapping complete');

    return {
      data,
      unmappedFields,
      missingRequiredFields,
      confidence,
    };
  }

  /**
   * Find an extracted field that matches the schema field name
   */
  private findMatchingField(
    schemaFieldName: string,
    extractedFields: Record<string, ExtractedField>
  ): ExtractedField | null {
    // Direct match
    if (extractedFields[schemaFieldName]) {
      return extractedFields[schemaFieldName];
    }

    // Generate variations and try to match
    const variations = this.getFieldNameVariations(schemaFieldName);

    for (const variation of variations) {
      // Check each extracted field against variation
      for (const [extractedName, field] of Object.entries(extractedFields)) {
        if (this.fieldsMatch(extractedName, variation)) {
          return field;
        }
      }
    }

    return null;
  }

  /**
   * Check if two field names match (case-insensitive, normalized)
   */
  private fieldsMatch(name1: string, name2: string): boolean {
    const normalize = (s: string) => s.toLowerCase().replace(/[_\s-]/g, '');
    return normalize(name1) === normalize(name2);
  }

  /**
   * Generate variations of a field name for matching
   */
  private getFieldNameVariations(fieldName: string): string[] {
    const variations = new Set<string>();

    // Original
    variations.add(fieldName);

    // Lowercase
    variations.add(fieldName.toLowerCase());

    // camelCase to snake_case
    variations.add(
      fieldName.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
    );

    // snake_case to camelCase
    variations.add(
      fieldName.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    );

    // With spaces
    variations.add(fieldName.replace(/([A-Z])/g, ' $1').trim().toLowerCase());
    variations.add(fieldName.replace(/_/g, ' '));

    // Without common suffixes/prefixes
    variations.add(fieldName.replace(/^(the|a|an)_?/i, ''));
    variations.add(fieldName.replace(/_?(number|date|amount|name|value)$/i, ''));

    return Array.from(variations);
  }

  /**
   * Convert a value to the expected schema type
   */
  private convertToType(
    value: string | number | boolean | any[] | Record<string, any> | null,
    targetType: string
  ): any {
    if (value === null || value === undefined) {
      return null;
    }

    switch (targetType) {
      case 'string':
        return String(value);

      case 'number':
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
          // Remove currency symbols and commas
          const cleaned = value.replace(/[$€£¥,\s]/g, '');
          const num = parseFloat(cleaned);
          return isNaN(num) ? value : num;
        }
        return value;

      case 'boolean':
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
          const lower = value.toLowerCase();
          if (['true', 'yes', '1', 'x', 'checked'].includes(lower)) return true;
          if (['false', 'no', '0', '', 'unchecked'].includes(lower)) return false;
        }
        return Boolean(value);

      case 'date':
        // Keep as string but validate format
        if (typeof value === 'string') {
          return this.normalizeDate(value);
        }
        return value;

      case 'array':
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
          // Try to parse as JSON array or comma-separated
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return parsed;
          } catch {
            // Try comma-separated
            return value.split(',').map(s => s.trim());
          }
        }
        return [value];

      case 'object':
        if (typeof value === 'object') return value;
        if (typeof value === 'string') {
          try {
            return JSON.parse(value);
          } catch {
            return { value };
          }
        }
        return { value };

      default:
        return value;
    }
  }

  /**
   * Normalize date string to ISO format if possible
   */
  private normalizeDate(dateStr: string): string {
    // Common date patterns
    const patterns: Array<{ regex: RegExp; parser: (m: RegExpMatchArray) => string | null }> = [
      // ISO: YYYY-MM-DD
      {
        regex: /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
        parser: (m) => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`,
      },
      // US: MM/DD/YYYY
      {
        regex: /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/,
        parser: (m) => `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`,
      },
      // US short: MM/DD/YY
      {
        regex: /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/,
        parser: (m) => {
          const year = parseInt(m[3]) + 2000;
          return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
        },
      },
      // Written: Month DD, YYYY
      {
        regex: /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/,
        parser: (m) => {
          const month = this.monthToNumber(m[1]);
          if (month === 0) return null;
          return `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
        },
      },
    ];

    for (const { regex, parser } of patterns) {
      const match = dateStr.trim().match(regex);
      if (match) {
        const result = parser(match);
        if (result) return result;
      }
    }

    // Return original if no pattern matches
    return dateStr;
  }

  /**
   * Convert month name to number
   */
  private monthToNumber(month: string): number {
    const months: Record<string, number> = {
      january: 1, jan: 1,
      february: 2, feb: 2,
      march: 3, mar: 3,
      april: 4, apr: 4,
      may: 5,
      june: 6, jun: 6,
      july: 7, jul: 7,
      august: 8, aug: 8,
      september: 9, sep: 9, sept: 9,
      october: 10, oct: 10,
      november: 11, nov: 11,
      december: 12, dec: 12,
    };
    return months[month.toLowerCase()] || 0;
  }
}
