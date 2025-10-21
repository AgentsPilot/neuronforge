// /lib/audit/diff.ts
// Smart change detection utility for audit trail
// Generates before/after diffs with special handling for arrays and objects

import { ChangeSet, FieldChange, ArrayChange, DiffOptions } from './types';

/**
 * Deep equality check
 */
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, idx) => deepEqual(val, b[idx]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => deepEqual(a[key], b[key]));
  }

  return false;
}

/**
 * Compare two arrays and return what was added/removed
 */
function diffArrays<T = any>(
  oldArray: T[],
  newArray: T[],
  useDeepCompare = false
): ArrayChange<T> {
  const compareFn = useDeepCompare ? deepEqual : (a: T, b: T) => a === b;

  const added = newArray.filter(
    (newItem) => !oldArray.some((oldItem) => compareFn(oldItem, newItem))
  );

  const removed = oldArray.filter(
    (oldItem) => !newArray.some((newItem) => compareFn(oldItem, newItem))
  );

  const unchanged = oldArray.filter((oldItem) =>
    newArray.some((newItem) => compareFn(oldItem, newItem))
  );

  return {
    ...(added.length > 0 && { added }),
    ...(removed.length > 0 && { removed }),
    ...(unchanged.length > 0 && { unchanged }),
  };
}

/**
 * Generate a clean diff between two objects
 * Only includes fields that actually changed
 */
export function generateDiff<T extends Record<string, any>>(
  before: T | null | undefined,
  after: T | null | undefined,
  options: DiffOptions = {}
): ChangeSet | null {
  const {
    ignoreFields = [],
    deepCompare = true,
    arrayStrategy = 'diff',
  } = options;

  // Handle null/undefined cases
  if (!before && !after) return null;
  if (!before) return { _created: after };
  if (!after) return { _deleted: before };

  const changes: ChangeSet = {};

  // Get all unique keys from both objects
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    // Skip ignored fields
    if (ignoreFields.includes(key)) continue;

    const oldValue = before[key];
    const newValue = after[key];

    // Skip if values are identical
    if (deepCompare ? deepEqual(oldValue, newValue) : oldValue === newValue) {
      continue;
    }

    // Handle arrays specially
    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      if (arrayStrategy === 'diff') {
        const arrayDiff = diffArrays(oldValue, newValue, deepCompare);
        // Only include if there are actual changes
        if (arrayDiff.added || arrayDiff.removed) {
          changes[key] = arrayDiff;
        }
      } else {
        // Full array replacement
        changes[key] = {
          from: oldValue,
          to: newValue,
          field: key,
        };
      }
      continue;
    }

    // Handle nested objects (optional deep diff)
    if (
      deepCompare &&
      typeof oldValue === 'object' &&
      oldValue !== null &&
      typeof newValue === 'object' &&
      newValue !== null &&
      !Array.isArray(oldValue) &&
      !Array.isArray(newValue)
    ) {
      const nestedDiff = generateDiff(oldValue, newValue, options);
      if (nestedDiff && Object.keys(nestedDiff).length > 0) {
        changes[key] = nestedDiff;
      }
      continue;
    }

    // Simple field change
    changes[key] = {
      from: oldValue,
      to: newValue,
      field: key,
    } as FieldChange;
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * Generate a human-readable summary of changes
 * Example: "Changed status from 'draft' to 'active', added 2 plugins"
 */
export function summarizeChanges(changes: ChangeSet | null | undefined): string {
  if (!changes) return 'No changes';

  const summaries: string[] = [];

  for (const [key, change] of Object.entries(changes)) {
    if ('added' in change && 'removed' in change) {
      // Array change
      const arrayChange = change as ArrayChange;
      if (arrayChange.added && arrayChange.added.length > 0) {
        summaries.push(`added ${arrayChange.added.length} ${key}`);
      }
      if (arrayChange.removed && arrayChange.removed.length > 0) {
        summaries.push(`removed ${arrayChange.removed.length} ${key}`);
      }
    } else if ('from' in change && 'to' in change) {
      // Field change
      const fieldChange = change as FieldChange;
      const fromStr = formatValue(fieldChange.from);
      const toStr = formatValue(fieldChange.to);
      summaries.push(`changed ${key} from ${fromStr} to ${toStr}`);
    } else if (key === '_created') {
      return 'Created new record';
    } else if (key === '_deleted') {
      return 'Deleted record';
    }
  }

  return summaries.join(', ') || 'Updated';
}

/**
 * Format a value for display in summary
 */
function formatValue(value: any): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'boolean') return value.toString();
  if (typeof value === 'number') return value.toString();
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') return '[object]';
  return String(value);
}

/**
 * Count total number of changes in a ChangeSet
 */
export function countChanges(changes: ChangeSet | null | undefined): number {
  if (!changes) return 0;

  let count = 0;

  for (const change of Object.values(changes)) {
    if ('added' in change && 'removed' in change) {
      const arrayChange = change as ArrayChange;
      count += (arrayChange.added?.length || 0) + (arrayChange.removed?.length || 0);
    } else if ('from' in change && 'to' in change) {
      count += 1;
    } else if (typeof change === 'object' && change !== null) {
      // Nested object, count recursively
      count += countChanges(change as ChangeSet);
    }
  }

  return count;
}

/**
 * Check if a specific field was changed
 */
export function hasFieldChanged(
  changes: ChangeSet | null | undefined,
  fieldName: string
): boolean {
  if (!changes) return false;
  return fieldName in changes;
}

/**
 * Get the new value of a specific field from changes
 */
export function getNewValue<T = any>(
  changes: ChangeSet | null | undefined,
  fieldName: string
): T | undefined {
  if (!changes || !(fieldName in changes)) return undefined;

  const change = changes[fieldName];

  if ('to' in change) {
    return (change as FieldChange).to;
  }

  return undefined;
}

/**
 * Get the old value of a specific field from changes
 */
export function getOldValue<T = any>(
  changes: ChangeSet | null | undefined,
  fieldName: string
): T | undefined {
  if (!changes || !(fieldName in changes)) return undefined;

  const change = changes[fieldName];

  if ('from' in change) {
    return (change as FieldChange).from;
  }

  return undefined;
}

/**
 * Sanitize sensitive data from changes
 * Replaces sensitive field values with placeholders
 */
export function sanitizeChanges(
  changes: ChangeSet | null | undefined,
  sensitiveFields: string[] = ['password', 'token', 'secret', 'apiKey', 'api_key']
): ChangeSet | null {
  if (!changes) return null;

  const sanitized: ChangeSet = {};

  for (const [key, change] of Object.entries(changes)) {
    // Check if this is a sensitive field
    const isSensitive = sensitiveFields.some((field) =>
      key.toLowerCase().includes(field.toLowerCase())
    );

    if (isSensitive) {
      if ('from' in change && 'to' in change) {
        sanitized[key] = {
          from: '***REDACTED***',
          to: '***REDACTED***',
          field: key,
        };
      } else {
        sanitized[key] = '***REDACTED***';
      }
    } else {
      sanitized[key] = change;
    }
  }

  return sanitized;
}
