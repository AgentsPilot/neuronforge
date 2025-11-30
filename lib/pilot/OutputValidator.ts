/**
 * OutputValidator - Validate workflow output against output_schema
 *
 * Responsibilities:
 * - Validate final output structure
 * - Check required fields
 * - Validate data types
 * - Apply transformation rules
 *
 * @module lib/orchestrator/OutputValidator
 */

import type {
  OutputSchema,
  ValidationResult,
} from './types';

export class OutputValidator {
  /**
   * Validate output against schema
   */
  async validate(
    output: any,
    schema: OutputSchema[] | undefined
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!schema || schema.length === 0) {
      // No schema defined - accept any output
      return { valid: true, errors: [], warnings: ['No output schema defined'] };
    }

    // Validate each field in schema
    for (const field of schema) {
      const fieldErrors = this.validateField(field, output);
      errors.push(...fieldErrors);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate single field
   */
  private validateField(field: OutputSchema, output: any): string[] {
    const errors: string[] = [];
    const value = output[field.name];

    // Check if value exists
    if (value === undefined || value === null) {
      errors.push(`Missing output field: ${field.name}`);
      return errors;
    }

    // Validate type
    const typeError = this.validateType(field.name, value, field.type);
    if (typeError) {
      errors.push(typeError);
    }

    // Validate format if specified
    if (field.format) {
      const formatError = this.validateFormat(field.name, value, field.format);
      if (formatError) {
        errors.push(formatError);
      }
    }

    return errors;
  }

  /**
   * Validate type
   */
  private validateType(fieldName: string, value: any, expectedType: string): string | null {
    const actualType = this.getType(value);

    // Handle special types
    if (expectedType === 'array' && !Array.isArray(value)) {
      return `Field ${fieldName} should be array, got ${actualType}`;
    }

    if (expectedType === 'object' && actualType !== 'object') {
      return `Field ${fieldName} should be object, got ${actualType}`;
    }

    // Handle PluginAction type - plugin actions return objects with result data
    if (expectedType === 'PluginAction' && actualType !== 'object') {
      return `Field ${fieldName} should be PluginAction (object), got ${actualType}`;
    }

    if (expectedType === 'PluginAction' && actualType === 'object') {
      // PluginAction results are objects - validation passes
      return null;
    }

    // Handle primitive types
    const typeMap: Record<string, string[]> = {
      'string': ['string'],
      'number': ['number'],
      'integer': ['number'],
      'boolean': ['boolean'],
      'array': ['array'],
      'object': ['object'],
      'PluginAction': ['object'], // PluginAction results are objects
    };

    const allowedTypes = typeMap[expectedType.toLowerCase()] || typeMap[expectedType] || [expectedType.toLowerCase()];

    if (!allowedTypes.includes(actualType)) {
      return `Field ${fieldName} should be ${expectedType}, got ${actualType}`;
    }

    // Additional validation for integer
    if (expectedType === 'integer' && !Number.isInteger(value)) {
      return `Field ${fieldName} should be integer, got ${value}`;
    }

    return null;
  }

  /**
   * Validate format
   */
  private validateFormat(fieldName: string, value: any, format: string): string | null {
    switch (format.toLowerCase()) {
      case 'email':
        return this.validateEmail(fieldName, value);

      case 'url':
        return this.validateUrl(fieldName, value);

      case 'date':
      case 'date-time':
        return this.validateDate(fieldName, value);

      case 'uuid':
        return this.validateUuid(fieldName, value);

      case 'json':
        return this.validateJson(fieldName, value);

      case 'table':
        return this.validateTable(fieldName, value);

      default:
        // Unknown format - skip validation
        return null;
    }
  }

  /**
   * Validate email format
   */
  private validateEmail(fieldName: string, value: any): string | null {
    if (typeof value !== 'string') {
      return `Field ${fieldName} should be string for email format`;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return `Field ${fieldName} is not a valid email`;
    }

    return null;
  }

  /**
   * Validate URL format
   */
  private validateUrl(fieldName: string, value: any): string | null {
    if (typeof value !== 'string') {
      return `Field ${fieldName} should be string for URL format`;
    }

    try {
      new URL(value);
      return null;
    } catch {
      return `Field ${fieldName} is not a valid URL`;
    }
  }

  /**
   * Validate date format
   */
  private validateDate(fieldName: string, value: any): string | null {
    if (typeof value !== 'string') {
      return `Field ${fieldName} should be string for date format`;
    }

    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return `Field ${fieldName} is not a valid date`;
    }

    return null;
  }

  /**
   * Validate UUID format
   */
  private validateUuid(fieldName: string, value: any): string | null {
    if (typeof value !== 'string') {
      return `Field ${fieldName} should be string for UUID format`;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(value)) {
      return `Field ${fieldName} is not a valid UUID`;
    }

    return null;
  }

  /**
   * Validate JSON format
   */
  private validateJson(fieldName: string, value: any): string | null {
    if (typeof value !== 'string') {
      return `Field ${fieldName} should be string for JSON format`;
    }

    try {
      JSON.parse(value);
      return null;
    } catch {
      return `Field ${fieldName} is not valid JSON`;
    }
  }

  /**
   * Validate table format (array of objects with consistent keys)
   */
  private validateTable(fieldName: string, value: any): string | null {
    if (!Array.isArray(value)) {
      return `Field ${fieldName} should be array for table format`;
    }

    if (value.length === 0) {
      return null; // Empty table is valid
    }

    // Check all items are objects
    if (!value.every(item => typeof item === 'object' && item !== null)) {
      return `Field ${fieldName} table should contain only objects`;
    }

    // Check all objects have same keys (consistent columns)
    const firstKeys = Object.keys(value[0]).sort();
    for (let i = 1; i < value.length; i++) {
      const keys = Object.keys(value[i]).sort();
      if (JSON.stringify(keys) !== JSON.stringify(firstKeys)) {
        return `Field ${fieldName} table has inconsistent columns`;
      }
    }

    return null;
  }

  /**
   * Get type of value
   */
  private getType(value: any): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  /**
   * Transform output to match schema (best effort)
   */
  transformOutput(output: any, schema: OutputSchema[]): any {
    if (!schema || schema.length === 0) {
      return output;
    }

    const transformed: any = {};

    schema.forEach(field => {
      let value = output[field.name];

      if (value === undefined || value === null) {
        // Skip missing values
        return;
      }

      // Apply type coercion
      value = this.coerceType(value, field.type);

      // Apply format transformation
      if (field.format) {
        value = this.transformFormat(value, field.format);
      }

      transformed[field.name] = value;
    });

    return transformed;
  }

  /**
   * Coerce value to expected type
   */
  private coerceType(value: any, type: string): any {
    switch (type.toLowerCase()) {
      case 'string':
        return String(value);

      case 'number':
      case 'integer':
        const num = Number(value);
        return type === 'integer' ? Math.floor(num) : num;

      case 'boolean':
        if (typeof value === 'string') {
          return value.toLowerCase() === 'true';
        }
        return Boolean(value);

      case 'array':
        if (Array.isArray(value)) return value;
        return [value];

      case 'object':
        if (typeof value === 'object') return value;
        try {
          return JSON.parse(String(value));
        } catch {
          return {};
        }

      default:
        return value;
    }
  }

  /**
   * Transform value to match format
   */
  private transformFormat(value: any, format: string): any {
    switch (format.toLowerCase()) {
      case 'uppercase':
        return String(value).toUpperCase();

      case 'lowercase':
        return String(value).toLowerCase();

      case 'trim':
        return String(value).trim();

      case 'date':
        return new Date(value).toISOString().split('T')[0];

      case 'date-time':
        return new Date(value).toISOString();

      case 'json':
        if (typeof value === 'string') return value;
        return JSON.stringify(value);

      default:
        return value;
    }
  }

  /**
   * Get missing required fields
   */
  getMissingFields(output: any, schema: OutputSchema[]): string[] {
    if (!schema) return [];

    return schema
      .filter(field => {
        const value = output[field.name];
        return value === undefined || value === null;
      })
      .map(field => field.name);
  }

  /**
   * Get extra fields not in schema
   */
  getExtraFields(output: any, schema: OutputSchema[]): string[] {
    if (!schema) return [];

    const schemaFields = new Set(schema.map(f => f.name));
    const outputFields = Object.keys(output);

    return outputFields.filter(field => !schemaFields.has(field));
  }

  /**
   * Create validation report
   */
  createValidationReport(output: any, schema: OutputSchema[]): {
    valid: boolean;
    missingFields: string[];
    extraFields: string[];
    typeErrors: string[];
    formatErrors: string[];
  } {
    const validation = this.validate(output, schema);

    return {
      valid: validation.valid,
      missingFields: this.getMissingFields(output, schema),
      extraFields: this.getExtraFields(output, schema),
      typeErrors: validation.errors.filter(e => e.includes('should be')),
      formatErrors: validation.errors.filter(e => e.includes('not a valid') || e.includes('not valid')),
    };
  }
}
