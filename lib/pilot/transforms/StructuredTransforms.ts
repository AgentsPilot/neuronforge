/**
 * StructuredTransforms — W2/WP-16 transform primitives
 *
 * Pure-function implementations of the three new structured transform ops
 * introduced in W2 to replace `generate/internal` fallbacks for deterministic
 * data operations:
 *
 *   - `with_fields`     — augment items with computed fields (10-op closed expression vocab)
 *   - `project_column`  — extract a single column/field from each row
 *   - `set_difference`  — anti-join: keep items whose key is NOT in a reference array
 *
 * These functions are deliberately decoupled from `StepExecutor` so they
 * (a) can be unit-tested without dragging in OpenAI/uuid/runAgentKit, and
 * (b) form a stable, focused module for the W2 closed-vocabulary contract.
 *
 * The `ConditionalEvaluator` is injected via parameter (used only by `if`
 * expressions inside `with_fields`).
 *
 * See: docs/v6/V6_WP16_INVENTORY.md, docs/v6/V6_WORKFLOW_DATA_SCHEMA_WORKPLAN_INTENT_CONTRACT.md
 */

/**
 * Minimal context shape this module needs. Both the production
 * `ExecutionContext` and a test stub satisfy this — keeps the module
 * decoupled from the heavy ExecutionContext import chain.
 */
export interface IExpressionContext {
  variables: Record<string, any>;
  setVariable(name: string, value: any): void;
  resolveVariable(reference: string): any;
  clone(): IExpressionContext;
}

/**
 * Minimal evaluator shape used for `if` expressions inside `with_fields`.
 * Production wires in the real `ConditionalEvaluator` from StepExecutor.
 */
export interface IConditionEvaluator {
  evaluate(condition: any, context: IExpressionContext): boolean;
}

/**
 * Typed error thrown for invalid expressions, configs, or input shapes.
 * StepExecutor catches and re-wraps as `ExecutionError` for the runtime.
 */
export class StructuredTransformError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'StructuredTransformError';
    this.code = code;
  }
}

// ============================================================
// transformWithFields
// ============================================================

/**
 * `with_fields` — augment each input item with computed fields.
 * Existing input fields are preserved; new fields are spread on top.
 *
 * Config shape (set by IR converter from IntentContract):
 *   { fields: [{ name: string; expression: Expression }, ...] }
 */
export function transformWithFields(
  data: any,
  config: any,
  context: IExpressionContext,
  evaluator: IConditionEvaluator
): any {
  const fields = config?.fields;
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new StructuredTransformError(
      'with_fields requires a non-empty `fields` array in config',
      'INVALID_CONFIG'
    );
  }

  // Coerce non-array input to single-item processing (e.g., when input is one object).
  const items = Array.isArray(data) ? data : (data == null ? [] : [data]);

  const result = items.map(item => {
    const augmented: Record<string, any> = {
      ...(item && typeof item === 'object' && !Array.isArray(item) ? item : { value: item }),
    };
    for (const field of fields) {
      if (typeof field?.name !== 'string' || !field.expression) {
        throw new StructuredTransformError(
          `with_fields: invalid field declaration (expected {name, expression}): ${JSON.stringify(field)}`,
          'INVALID_CONFIG'
        );
      }
      augmented[field.name] = evaluateExpression(field.expression, item, context, evaluator);
    }
    return augmented;
  });

  return Array.isArray(data) ? result : (result[0] ?? null);
}

// ============================================================
// transformProjectColumn
// ============================================================

/**
 * `project_column` — extract a single column/field from each row of an array.
 * Returns a flat array of the extracted values (no wrapper objects).
 *
 * Config shape (set by IR converter from IntentContract):
 *   { column: { kind: "by_index", index: number }
 *           | { kind: "by_field", field: string }
 *           | { kind: "by_field_path", path: string } }
 */
export function transformProjectColumn(data: any, config: any): any[] {
  if (!Array.isArray(data)) {
    throw new StructuredTransformError(
      `project_column requires an array input; received ${data === null ? 'null' : typeof data}`,
      'INVALID_INPUT_TYPE'
    );
  }

  const column = config?.column;
  if (!column || typeof column.kind !== 'string') {
    throw new StructuredTransformError(
      'project_column requires a `column` config with kind "by_index" | "by_field" | "by_field_path"',
      'INVALID_CONFIG'
    );
  }

  return data.map((row, idx) => {
    switch (column.kind) {
      case 'by_index': {
        if (Array.isArray(row)) {
          return row[column.index];
        }
        // WP-20: post-WP-SR tolerance. The compiler's `rows_to_objects`
        // auto-inject (with `preserve_case: true`) converts Sheets-derived
        // 2D rows to objects with header keys before this transform runs.
        // The LLM may still emit `by_index: N` based on the column position
        // it saw in the user's prompt ("column E"). Fall back to positional
        // access via `Object.values` — safe because `rows_to_objects` preserves
        // key insertion order matching column order. Sister tolerance to the
        // `column_N` fallback in `transformMap` Mode 0 (WP-SR).
        if (row && typeof row === 'object') {
          return Object.values(row)[column.index];
        }
        throw new StructuredTransformError(
          `project_column.by_index requires array or object rows; row ${idx} is ${typeof row}`,
          'INVALID_INPUT_TYPE'
        );
      }
      case 'by_field': {
        if (row == null || typeof row !== 'object') {
          return undefined;
        }
        return (row as Record<string, any>)[column.field];
      }
      case 'by_field_path': {
        return resolveFieldPath(row, column.path);
      }
      default:
        throw new StructuredTransformError(
          `project_column: unknown column.kind "${column.kind}"`,
          'INVALID_CONFIG'
        );
    }
  });
}

// ============================================================
// transformSetDifference
// ============================================================

/**
 * `set_difference` — anti-join. Keep items from input array whose
 * `key_field` value is NOT present in the reference array's `reference_key_field`.
 *
 * Config shape (set by IR converter from IntentContract):
 *   { reference: any[] | string; key_field: string; reference_key_field?: string }
 *
 * The IR converter resolves `reference: RefName` to the actual variable
 * path; if a string slips through, this function resolves it via context.
 */
export function transformSetDifference(
  data: any,
  config: any,
  context: IExpressionContext,
  logger?: { warn(meta: any, msg: string): void }
): any[] {
  if (!Array.isArray(data)) {
    throw new StructuredTransformError(
      `set_difference requires an array input; received ${data === null ? 'null' : typeof data}`,
      'INVALID_INPUT_TYPE'
    );
  }

  const keyField = config?.key_field;
  if (typeof keyField !== 'string' || !keyField) {
    throw new StructuredTransformError(
      'set_difference requires a `key_field` (field name to compare on)',
      'INVALID_CONFIG'
    );
  }

  let referenceArray: any[] = [];
  if (Array.isArray(config?.reference)) {
    referenceArray = config.reference;
  } else if (typeof config?.reference === 'string') {
    // WP-22: defensively wrap bare RefNames in `{{}}` before calling
    // resolveVariable, which requires template syntax. The IR converter
    // now emits `{{varname}}` (post-WP-22 fix), but older phase4 files
    // and any non-standard emission paths may still pass bare names.
    // Without this, resolveVariable returns the bare string as a literal
    // and the next branch throws "got string" — masking the real intent.
    const ref = config.reference.startsWith('{{')
      ? config.reference
      : `{{${config.reference}}}`;
    const resolved = context.resolveVariable(ref);
    if (Array.isArray(resolved)) {
      referenceArray = resolved;
    } else if (resolved == null) {
      logger?.warn(
        { ref: config.reference },
        'set_difference: reference resolved to null/undefined, returning input unchanged'
      );
      return [...data];
    } else {
      throw new StructuredTransformError(
        `set_difference.reference must resolve to an array; got ${typeof resolved}`,
        'INVALID_INPUT_TYPE'
      );
    }
  } else {
    throw new StructuredTransformError(
      'set_difference requires a `reference` (array or RefName)',
      'INVALID_CONFIG'
    );
  }

  const referenceKeyField = config?.reference_key_field || keyField;

  const excluded = new Set<any>();
  for (const refItem of referenceArray) {
    if (refItem == null) continue;
    const key = typeof refItem === 'object'
      ? (refItem as Record<string, any>)[referenceKeyField]
      : refItem;
    if (key !== undefined && key !== null) {
      excluded.add(key);
    }
  }

  return data.filter(item => {
    if (item == null || typeof item !== 'object') return true;
    const key = (item as Record<string, any>)[keyField];
    return !excluded.has(key);
  });
}

// ============================================================
// Expression evaluation (closed 10-op vocabulary, W2 / WP-16)
// ============================================================

/**
 * Evaluate an `Expression` AST against a current item + execution context.
 * Closed vocabulary (10 op kinds). Any unknown kind is a hard failure.
 *
 * Reference resolution convention (matches StepExecutor.transformFilter):
 *   - `ref: "item", field: X`     → currentItem[X]
 *   - `ref: <other_slot>, field`  → variable lookup via context
 *   - `config: { key }`           → input/config lookup
 */
export function evaluateExpression(
  expr: any,
  currentItem: any,
  context: IExpressionContext,
  evaluator: IConditionEvaluator
): any {
  if (expr == null || typeof expr !== 'object' || typeof expr.kind !== 'string') {
    throw new StructuredTransformError(
      `evaluateExpression: invalid expression (must be {kind, ...}): ${JSON.stringify(expr)?.slice(0, 200)}`,
      'INVALID_EXPRESSION'
    );
  }

  switch (expr.kind) {
    case 'literal':
      return expr.value;

    case 'ref': {
      // Magic ref name "item" → current item being processed.
      if (expr.ref === 'item' || expr.ref === '__item__') {
        if (typeof expr.field === 'string' && expr.field.length > 0) {
          if (currentItem == null || typeof currentItem !== 'object') return undefined;
          return (currentItem as Record<string, any>)[expr.field];
        }
        return currentItem;
      }
      // Otherwise resolve from execution context (other slots).
      const path = typeof expr.field === 'string' && expr.field.length > 0
        ? `${expr.ref}.${expr.field}`
        : expr.ref;
      return context.resolveVariable(path);
    }

    case 'config': {
      if (typeof expr.key !== 'string' || !expr.key) {
        throw new StructuredTransformError('config expression requires `key` string', 'INVALID_EXPRESSION');
      }
      return context.resolveVariable(`input.${expr.key}`);
    }

    case 'concat': {
      if (!Array.isArray(expr.args)) {
        throw new StructuredTransformError('concat expression requires `args` array', 'INVALID_EXPRESSION');
      }
      return expr.args
        .map((a: any) => evaluateExpression(a, currentItem, context, evaluator))
        .map((v: any) => v == null ? '' : String(v))
        .join('');
    }

    case 'if': {
      const tempContext = context.clone();
      tempContext.setVariable('item', currentItem);
      const ok = evaluator.evaluate(expr.condition, tempContext);
      return ok
        ? evaluateExpression(expr.then, currentItem, context, evaluator)
        : evaluateExpression(expr.else, currentItem, context, evaluator);
    }

    case 'today':
      return new Date().toISOString();

    case 'date_diff': {
      const left = evaluateExpression(expr.left, currentItem, context, evaluator);
      const right = evaluateExpression(expr.right, currentItem, context, evaluator);
      const dLeft = parseDate(left);
      const dRight = parseDate(right);
      if (dLeft == null || dRight == null) return null;
      const ms = dLeft.getTime() - dRight.getTime();
      if (expr.unit === 'days') return Math.floor(ms / (1000 * 60 * 60 * 24));
      throw new StructuredTransformError(
        `date_diff: unsupported unit "${expr.unit}"`,
        'INVALID_EXPRESSION'
      );
    }

    case 'date_add': {
      const base = parseDate(evaluateExpression(expr.date, currentItem, context, evaluator));
      const days = Number(evaluateExpression(expr.days, currentItem, context, evaluator));
      if (base == null || !Number.isFinite(days)) return null;
      const result = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
      return result.toISOString();
    }

    case 'null_check': {
      const value = evaluateExpression(expr.value, currentItem, context, evaluator);
      const isNull = value === null || value === undefined;
      return expr.invert === true ? !isNull : isNull;
    }

    case 'all_not_null': {
      if (!Array.isArray(expr.refs)) {
        throw new StructuredTransformError('all_not_null expression requires `refs` array', 'INVALID_EXPRESSION');
      }
      for (const ref of expr.refs) {
        if (typeof ref !== 'string') return false;
        // ref is a field name on the current item OR a slot path
        let value: any;
        if (currentItem != null && typeof currentItem === 'object' && ref in (currentItem as Record<string, any>)) {
          value = (currentItem as Record<string, any>)[ref];
        } else {
          value = context.resolveVariable(ref);
        }
        if (value === null || value === undefined || value === '') return false;
      }
      return true;
    }

    default:
      throw new StructuredTransformError(
        `evaluateExpression: unknown expression kind "${expr.kind}". W2 supports: literal, ref, config, concat, if, today, date_diff, date_add, null_check, all_not_null.`,
        'INVALID_EXPRESSION'
      );
  }
}

// ============================================================
// Helpers
// ============================================================

/**
 * Parse a date value (string, number, or Date) into a Date object.
 * Returns null if the value cannot be parsed.
 */
export function parseDate(value: any): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Resolve a dot-notation field path on an object. Returns undefined if any
 * intermediate value is null/undefined/non-object.
 */
export function resolveFieldPath(obj: any, path: string): any {
  if (obj == null || typeof path !== 'string' || path.length === 0) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, any>)[part];
  }
  return current;
}
