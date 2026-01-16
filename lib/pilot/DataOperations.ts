/**
 * DataOperations - Utility functions for data manipulation
 *
 * Responsibilities:
 * - Data enrichment (merge, join multiple sources)
 * - Data validation (schema and rule-based)
 * - Data comparison (equality, diff, contains)
 *
 * Phase 4: Data Operations
 *
 * @module lib/pilot/DataOperations
 */

import type { Condition, EnrichmentStep, ValidationStep, ComparisonStep } from './types';
import { ExecutionError } from './types';

export class DataOperations {
  /**
   * Enrich data by merging multiple sources
   */
  static enrich(
    sources: Record<string, any>,
    strategy: 'merge' | 'deep_merge' | 'join',
    options?: {
      joinOn?: string;
      mergeArrays?: boolean;
    }
  ): any {
    console.log(`📊 [DataOperations] Enriching data with strategy: ${strategy}`);

    switch (strategy) {
      case 'merge':
        return this.shallowMerge(sources, options?.mergeArrays);

      case 'deep_merge':
        return this.deepMerge(sources, options?.mergeArrays);

      case 'join':
        if (!options?.joinOn) {
          throw new ExecutionError(
            'Join strategy requires joinOn field',
            'MISSING_JOIN_FIELD'
          );
        }
        return this.joinSources(sources, options.joinOn);

      default:
        throw new ExecutionError(
          `Unknown enrichment strategy: ${strategy}`,
          'UNKNOWN_STRATEGY'
        );
    }
  }

  /**
   * Shallow merge: Simple object spread
   */
  private static shallowMerge(sources: Record<string, any>, mergeArrays: boolean = false): any {
    const result: any = {};

    for (const [key, value] of Object.entries(sources)) {
      if (mergeArrays && Array.isArray(value) && Array.isArray(result[key])) {
        result[key] = [...result[key], ...value];
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Deep merge: Recursively merge nested objects
   */
  private static deepMerge(sources: Record<string, any>, mergeArrays: boolean = false): any {
    const result: any = {};

    const merge = (target: any, source: any): any => {
      for (const [key, value] of Object.entries(source)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          // Nested object - recurse
          target[key] = merge(target[key] || {}, value);
        } else if (mergeArrays && Array.isArray(value) && Array.isArray(target[key])) {
          // Merge arrays
          target[key] = [...target[key], ...value];
        } else {
          // Primitive or replace
          target[key] = value;
        }
      }
      return target;
    };

    for (const [_, value] of Object.entries(sources)) {
      merge(result, value);
    }

    return result;
  }

  /**
   * Join sources on a common field
   */
  private static joinSources(sources: Record<string, any>, joinOn: string): any[] {
    const sourceArrays = Object.entries(sources).map(([key, value]) => ({
      key,
      data: Array.isArray(value) ? value : [value],
    }));

    if (sourceArrays.length === 0) {
      return [];
    }

    // Use first source as base
    const [base, ...others] = sourceArrays;
    const result: any[] = [];

    for (const baseItem of base.data) {
      const joinValue = baseItem[joinOn];
      if (joinValue === undefined) continue;

      const merged: any = { ...baseItem };

      // Join with other sources
      for (const other of others) {
        const match = other.data.find((item: any) => item[joinOn] === joinValue);
        if (match) {
          Object.assign(merged, match);
        }
      }

      result.push(merged);
    }

    return result;
  }

  /**
   * Validate data against schema
   */
  static validate(
    data: any,
    schema?: ValidationStep['schema'],
    rules?: ValidationStep['rules']
  ): { valid: boolean; errors: string[] } {
    console.log(`✅ [DataOperations] Validating data`);

    const errors: string[] = [];

    // Schema validation
    if (schema) {
      const schemaErrors = this.validateSchema(data, schema);
      errors.push(...schemaErrors);
    }

    // Rule-based validation
    if (rules) {
      const ruleErrors = this.validateRules(data, rules);
      errors.push(...ruleErrors);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate against schema
   */
  private static validateSchema(data: any, schema: ValidationStep['schema']): string[] {
    const errors: string[] = [];

    if (!schema) return errors;

    // Type validation
    const actualType = Array.isArray(data) ? 'array' : typeof data;
    if (schema.type && actualType !== schema.type) {
      errors.push(`Expected type ${schema.type}, got ${actualType}`);
      return errors; // Don't continue if type is wrong
    }

    // Object validation
    if (schema.type === 'object' && typeof data === 'object' && !Array.isArray(data)) {
      // Required fields
      if (schema.required) {
        for (const field of schema.required) {
          if (!(field in data)) {
            errors.push(`Missing required field: ${field}`);
          }
        }
      }

      // Property validation
      if (schema.properties) {
        for (const [field, fieldSchema] of Object.entries(schema.properties)) {
          if (field in data) {
            const fieldErrors = this.validateSchema(data[field], fieldSchema);
            errors.push(...fieldErrors.map(err => `${field}: ${err}`));
          }
        }
      }
    }

    // String validation
    if (schema.type === 'string' && typeof data === 'string') {
      if (schema.minLength && data.length < schema.minLength) {
        errors.push(`String length ${data.length} < minimum ${schema.minLength}`);
      }
      if (schema.maxLength && data.length > schema.maxLength) {
        errors.push(`String length ${data.length} > maximum ${schema.maxLength}`);
      }
      if (schema.pattern) {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(data)) {
          errors.push(`String does not match pattern: ${schema.pattern}`);
        }
      }
    }

    // Number validation
    if (schema.type === 'number' && typeof data === 'number') {
      if (schema.min !== undefined && data < schema.min) {
        errors.push(`Number ${data} < minimum ${schema.min}`);
      }
      if (schema.max !== undefined && data > schema.max) {
        errors.push(`Number ${data} > maximum ${schema.max}`);
      }
    }

    // Array validation
    if (schema.type === 'array' && Array.isArray(data)) {
      if (schema.minLength && data.length < schema.minLength) {
        errors.push(`Array length ${data.length} < minimum ${schema.minLength}`);
      }
      if (schema.maxLength && data.length > schema.maxLength) {
        errors.push(`Array length ${data.length} > maximum ${schema.maxLength}`);
      }
    }

    return errors;
  }

  /**
   * Validate against custom rules
   */
  private static validateRules(
    data: any,
    rules: Array<{ field: string; condition: Condition; message?: string }>
  ): string[] {
    const errors: string[] = [];

    for (const rule of rules) {
      const fieldValue = this.getNestedField(data, rule.field);

      // Evaluate condition (simplified - would use ConditionalEvaluator in real implementation)
      const conditionMet = this.evaluateSimpleCondition(fieldValue, rule.condition);

      if (!conditionMet) {
        const message = rule.message || `Validation failed for field: ${rule.field}`;
        errors.push(message);
      }
    }

    return errors;
  }

  /**
   * Get nested field value from object
   */
  private static getNestedField(obj: any, path: string): any {
    const keys = path.split('.');
    let value = obj;

    for (const key of keys) {
      if (value === null || value === undefined) return undefined;
      value = value[key];
    }

    return value;
  }

  /**
   * Simple condition evaluation (for validation rules)
   */
  private static evaluateSimpleCondition(value: any, condition: Condition): boolean {
    // Simplified implementation - would integrate with ConditionalEvaluator
    if (typeof condition === 'object' && 'operator' in condition) {
      const { operator, value: expectedValue } = condition as any;

      switch (operator) {
        case 'equals':
        case '==':
          return value === expectedValue;
        case 'not_equals':
        case '!=':
          return value !== expectedValue;
        case 'greater_than':
        case '>':
          return value > expectedValue;
        case 'less_than':
        case '<':
          return value < expectedValue;
        case 'contains':
          // Case-insensitive contains check
          return String(value).toLowerCase().includes(String(expectedValue).toLowerCase());
        default:
          return false;
      }
    }

    return false;
  }

  /**
   * Compare two data sources
   */
  static compare(
    left: any,
    right: any,
    operation: 'equals' | 'deep_equals' | 'diff' | 'contains' | 'subset',
    outputFormat: 'boolean' | 'diff' | 'detailed' = 'boolean'
  ): any {
    console.log(`🔍 [DataOperations] Comparing data with operation: ${operation}`);

    let result: any;

    switch (operation) {
      case 'equals':
        result = left === right;
        break;

      case 'deep_equals':
        result = this.deepEquals(left, right);
        break;

      case 'diff':
        result = this.generateDiff(left, right);
        break;

      case 'contains':
        result = this.contains(left, right);
        break;

      case 'subset':
        result = this.isSubset(left, right);
        break;

      default:
        throw new ExecutionError(
          `Unknown comparison operation: ${operation}`,
          'UNKNOWN_COMPARISON_OPERATION'
        );
    }

    // Format output
    if (outputFormat === 'boolean') {
      return typeof result === 'boolean' ? result : result.equal !== false;
    } else if (outputFormat === 'diff') {
      return typeof result === 'object' && 'diff' in result ? result.diff : result;
    } else {
      // detailed
      return {
        operation,
        left,
        right,
        result,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Deep equality check
   */
  private static deepEquals(a: any, b: any): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((item, index) => this.deepEquals(item, b[index]));
    }

    if (typeof a === 'object' && typeof b === 'object') {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);

      if (keysA.length !== keysB.length) return false;

      return keysA.every(key => this.deepEquals(a[key], b[key]));
    }

    return false;
  }

  /**
   * Generate diff between two objects
   */
  private static generateDiff(left: any, right: any): any {
    const diff: any = {
      added: {},
      removed: {},
      modified: {},
      unchanged: {},
    };

    if (typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
      const allKeys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);

      for (const key of allKeys) {
        const leftValue = left?.[key];
        const rightValue = right?.[key];

        if (!(key in left)) {
          diff.added[key] = rightValue;
        } else if (!(key in right)) {
          diff.removed[key] = leftValue;
        } else if (!this.deepEquals(leftValue, rightValue)) {
          diff.modified[key] = { from: leftValue, to: rightValue };
        } else {
          diff.unchanged[key] = leftValue;
        }
      }
    }

    return diff;
  }

  /**
   * Check if left contains right
   */
  private static contains(left: any, right: any): boolean {
    if (typeof left === 'string' && typeof right === 'string') {
      return left.includes(right);
    }

    if (Array.isArray(left)) {
      return left.some(item => this.deepEquals(item, right));
    }

    if (typeof left === 'object' && typeof right === 'object') {
      // Check if all keys in right exist in left with same values
      return Object.keys(right).every(key =>
        key in left && this.deepEquals(left[key], right[key])
      );
    }

    return false;
  }

  /**
   * Check if left is subset of right
   */
  private static isSubset(left: any, right: any): boolean {
    if (Array.isArray(left) && Array.isArray(right)) {
      return left.every(item => right.some(rightItem => this.deepEquals(item, rightItem)));
    }

    if (typeof left === 'object' && typeof right === 'object') {
      // Check if all keys in left exist in right
      return Object.keys(left).every(key =>
        key in right && this.deepEquals(left[key], right[key])
      );
    }

    return false;
  }
}
