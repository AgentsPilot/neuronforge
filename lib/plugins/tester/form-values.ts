// lib/plugins/tester/form-values.ts
//
// PURE helpers that turn the free-text form's nested field state into (a) the
// assembled parameters object sent to executeAction and (b) validation signals
// (missing required). NO React, NO JSON editing — unit-testable. Values mirror the
// action payload shape (nested), so assembly is prune-empties + coerce. Required-ness
// keys off the descriptors (which derive from required_params + nested `required`),
// never off templates (SA Q5).

import type { FormFieldDescriptor } from './tester-types';

export type FormValues = Record<string, unknown>;

function isEmptyScalar(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

/** Parse a scalar-array field's raw input (comma/newline separated) into typed items. */
export function parseScalarArray(raw: unknown, itemType?: string): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  const parts = raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (itemType === 'number' || itemType === 'integer') return parts.map((p) => Number(p));
  if (itemType === 'boolean') return parts.map((p) => p === 'true');
  return parts;
}

/** Read a nested value by path (string keys + numeric array indices). */
export function getByPath(values: unknown, path: (string | number)[]): unknown {
  let cur: unknown = values;
  for (const seg of path) {
    if (cur == null) return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

/** Immutably set a nested value by path, creating objects/arrays as needed. */
export function setByPath<T>(root: T, path: (string | number)[], value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path;
  const isIndex = typeof head === 'number';
  const clone: any = isIndex ? [...((root as unknown as unknown[]) || [])] : { ...((root as object) || {}) };
  clone[head] =
    rest.length === 0
      ? value
      : setByPath(clone[head] ?? (typeof rest[0] === 'number' ? [] : {}), rest, value);
  return clone;
}

// ── Coercion for a single leaf / composite field ────────────────────────────

function coerceField(field: FormFieldDescriptor, value: unknown): unknown {
  switch (field.control) {
    case 'boolean':
      return Boolean(value);
    case 'number':
      return isEmptyScalar(value) ? undefined : Number(value);
    case 'scalar-array': {
      const arr = parseScalarArray(value, field.itemType);
      return arr.length > 0 ? arr : undefined;
    }
    case 'scalar-matrix': {
      // value is an array of row strings (comma-separated); reassemble into [[...]].
      const rows = Array.isArray(value) ? (value as unknown[]) : [];
      const parsed = rows
        .map((row) => parseScalarArray(row, field.itemType))
        .filter((r) => r.length > 0);
      return parsed.length > 0 ? parsed : undefined;
    }
    case 'object': {
      const obj: Record<string, unknown> = {};
      for (const child of field.children || []) {
        const childVal = coerceField(child, (value as Record<string, unknown> | undefined)?.[child.name]);
        if (childVal !== undefined) obj[child.name] = childVal;
      }
      return Object.keys(obj).length > 0 ? obj : undefined;
    }
    case 'object-array': {
      const rows = Array.isArray(value) ? (value as unknown[]) : [];
      const booleanNames = new Set((field.itemFields || []).filter((c) => c.control === 'boolean').map((c) => c.name));
      const out = rows
        .map((row) => {
          const obj: Record<string, unknown> = {};
          for (const child of field.itemFields || []) {
            const childVal = coerceField(child, (row as Record<string, unknown> | undefined)?.[child.name]);
            if (childVal !== undefined) obj[child.name] = childVal;
          }
          return obj;
        })
        // Drop rows the user added but left blank. Booleans always coerce to a value,
        // so a row is "blank" when it has no NON-boolean content (defaults only).
        .filter((o) => Object.keys(o).some((k) => !booleanNames.has(k)));
      return out.length > 0 ? out : undefined;
    }
    case 'enum':
    case 'text':
    default:
      return isEmptyScalar(value) ? undefined : value;
  }
}

/** Assemble the final parameters object passed to executeAction (nested, pruned, coerced). */
export function assembleParameters(
  fields: FormFieldDescriptor[],
  values: FormValues
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const field of fields) {
    const coerced = coerceField(field, values[field.name]);
    if (coerced !== undefined) params[field.name] = coerced;
  }
  return params;
}

// ── Required-field validation (keyed off descriptors / required_params) ──────

function fieldIsEmpty(field: FormFieldDescriptor, value: unknown): boolean {
  switch (field.control) {
    case 'boolean':
      return false; // a boolean is always "provided"
    case 'scalar-array':
      return parseScalarArray(value, field.itemType).length === 0;
    case 'scalar-matrix':
    case 'object-array':
      return !Array.isArray(value) || (value as unknown[]).length === 0;
    case 'object': {
      // Empty if none of its children carry a value.
      return (field.children || []).every((c) =>
        fieldIsEmpty(c, (value as Record<string, unknown> | undefined)?.[c.name])
      );
    }
    default:
      return isEmptyScalar(value);
  }
}

/** Collect the paths of required fields (recursively) that are unfilled. */
export function computeMissingRequired(
  fields: FormFieldDescriptor[],
  values: FormValues
): string[] {
  const missing: string[] = [];

  const walk = (field: FormFieldDescriptor, value: unknown) => {
    if (field.required && fieldIsEmpty(field, value)) {
      missing.push(field.path.join('.'));
      return; // don't descend into a required-but-empty composite
    }
    // Descend into objects to catch required leaves inside a provided object.
    if (field.control === 'object' && value != null) {
      for (const child of field.children || []) {
        walk(child, (value as Record<string, unknown>)[child.name]);
      }
    }
    // For object-array rows, validate required item fields within each provided row.
    if (field.control === 'object-array' && Array.isArray(value)) {
      for (const row of value as unknown[]) {
        for (const child of field.itemFields || []) {
          walk(child, (row as Record<string, unknown> | undefined)?.[child.name]);
        }
      }
    }
  };

  for (const field of fields) walk(field, values[field.name]);
  return missing;
}

/** True when the form is runnable: all required fields (incl. nested) are filled. */
export function canRun(fields: FormFieldDescriptor[], values: FormValues): boolean {
  return computeMissingRequired(fields, values).length === 0;
}

// ── Seeding ─────────────────────────────────────────────────────────────────

function seedField(field: FormFieldDescriptor, templateVal: unknown): unknown {
  switch (field.control) {
    case 'boolean':
      return field.defaultValue ?? (typeof templateVal === 'boolean' ? templateVal : false);
    case 'scalar-array':
      if (Array.isArray(field.defaultValue)) return (field.defaultValue as unknown[]).join(', ');
      if (Array.isArray(templateVal)) return (templateVal as unknown[]).join(', ');
      return '';
    case 'scalar-matrix':
      // Seed rows from a template 2-D array as comma-joined row strings, else empty.
      if (Array.isArray(templateVal)) {
        return (templateVal as unknown[]).map((row) => (Array.isArray(row) ? row.join(', ') : String(row)));
      }
      return [];
    case 'object': {
      const obj: Record<string, unknown> = {};
      const tpl = (templateVal as Record<string, unknown> | undefined) || {};
      for (const child of field.children || []) obj[child.name] = seedField(child, tpl[child.name]);
      return obj;
    }
    case 'object-array': {
      // Seed one row per template entry (flattened), else start empty (user adds rows).
      if (Array.isArray(templateVal)) {
        return (templateVal as unknown[]).map((rowTpl) => seedRow(field, rowTpl));
      }
      return [];
    }
    case 'number':
    case 'enum':
    case 'text':
    default:
      if (field.defaultValue !== undefined) return field.defaultValue;
      if (templateVal !== undefined && templateVal !== null && typeof templateVal !== 'object') return templateVal;
      return '';
  }
}

/** Build one empty (or template-seeded) row object for an object-array field. */
export function seedRow(field: FormFieldDescriptor, rowTemplate?: unknown): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const tpl = (rowTemplate as Record<string, unknown> | undefined) || {};
  for (const child of field.itemFields || []) row[child.name] = seedField(child, tpl[child.name]);
  return row;
}

/**
 * Seed initial form values (nested, mirroring the payload shape).
 *
 * Seed order (SA decision 4): schema `default` → PARAMETER_TEMPLATES value (convenience
 * only) → empty scaffold. `templateForAction` is a pure convenience seed — required-
 * validation NEVER keys off it, so a missing template can never block Run.
 */
export function seedInitialValues(
  fields: FormFieldDescriptor[],
  templateForAction?: Record<string, unknown>
): FormValues {
  const values: FormValues = {};
  const tpl = templateForAction || {};
  for (const field of fields) values[field.name] = seedField(field, tpl[field.name]);
  return values;
}
