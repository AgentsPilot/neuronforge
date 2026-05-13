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
  /**
   * WP-29: user timezone hint for locale-sensitive operations (e.g.,
   * disambiguating DD/MM/YYYY vs MM/DD/YYYY in `parseDate`). Returns the
   * user's IANA timezone (e.g., `"Asia/Jerusalem"`, `"America/New_York"`)
   * when available from user-context / workflow_config / profile, or
   * undefined when no signal is available. `parseDate` falls back to
   * DD/MM/YYYY (covers ~85% of world population) when undefined.
   */
  getUserTimezone?(): string | undefined;
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
 * WP-33: Normalize a string-form expression to the structured AST shape
 * `evaluateExpression` requires.
 *
 * Two cases:
 *   (a) Template form `"{{ref}}"` or `"{{ref.field}}"` (or `"{{input.K}}"`)
 *       → parse into the structured equivalent and let the runtime resolver
 *         pick up cross-slot / config values via `context.resolveVariable`.
 *   (b) Plain string (no `{{}}` syntax) → an already-resolved literal
 *       (typically the result of `resolveAllVariables` pre-substitution).
 *       Wrap as `{kind: "literal", value: <string>}`.
 *
 * Strings are the only non-structured form we tolerate — other primitives
 * (number, boolean, etc.) still throw, matching the original strict contract.
 *
 * Surfaces fixed: `with_fields.fields[].expression` (LLM commonly emits the
 * template-string form because every other surface — `step.input`,
 * `condition.value`, recipient lists — accepts `{{...}}`). Defense-in-depth
 * companion to the IR converter's pre-compile normalization.
 */
export function normalizeStringExpression(s: string): any {
  // Match {{<ref>}} or {{<ref>.<dotted.path>}}; whitespace tolerated.
  const m = s.match(/^\s*\{\{\s*([\w$]+)(?:\.([\w$][\w$.]*))?\s*\}\}\s*$/);
  if (m) {
    const ref = m[1];
    const fieldPath = m[2]; // may be undefined, single segment, or dotted
    if (ref === 'input' && fieldPath) {
      // `{{input.X}}` is the config-namespace convention used elsewhere.
      return { kind: 'config', key: fieldPath };
    }
    if (fieldPath) {
      return { kind: 'ref', ref, field: fieldPath };
    }
    return { kind: 'ref', ref };
  }
  // No {{}} syntax → already-resolved literal value.
  return { kind: 'literal', value: s };
}

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
  // WP-33: tolerate string-form expressions (template `"{{var.field}}"` or
  // already-resolved literal). Strings are the only non-structured shape
  // accepted; everything else still throws.
  if (typeof expr === 'string') {
    expr = normalizeStringExpression(expr);
  }

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
      // WP-30: wrap path in `{{}}` — production `resolveVariable` requires
      // template syntax. Bare paths return as literal strings, silently
      // breaking cross-slot refs. Same convention mismatch family as WP-22
      // (set_difference.reference) and the WP-30 `config` case below.
      const path = typeof expr.field === 'string' && expr.field.length > 0
        ? `${expr.ref}.${expr.field}`
        : expr.ref;
      return context.resolveVariable(`{{${path}}}`);
    }

    case 'config': {
      if (typeof expr.key !== 'string' || !expr.key) {
        throw new StructuredTransformError('config expression requires `key` string', 'INVALID_EXPRESSION');
      }
      // WP-30: wrap path in `{{}}` — production `resolveVariable` requires
      // template syntax. Without braces it returns the literal string
      // "input.<key>" instead of the config value. Likely silently broken
      // since W2 (WP-16) shipped — W2 unit tests used a permissive stub
      // context that strips `{{}}` equivalently for both forms.
      return context.resolveVariable(`{{input.${expr.key}}}`);
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

    case 'today': {
      // WP-31: `today` returns the calendar date at UTC midnight, not the
      // current moment. This way `date_diff(date_only_string, today, 'days')`
      // produces whole-day differences regardless of the time-of-day when
      // the workflow runs. Previously this returned `new Date().toISOString()`
      // and `date_diff` was floor of fractional-days arithmetic, which
      // off-by-one'd entire workflows depending on wall-clock time.
      //
      // If a user timezone is available (via WP-29's `getUserTimezone()` hook),
      // we compute today's date in that timezone, then return its UTC midnight.
      // Otherwise fall back to server UTC date.
      const tz = context.getUserTimezone?.();
      if (tz) {
        try {
          const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
          }).format(new Date()).split('-').map(s => parseInt(s, 10));
          const [y, m, d] = parts;
          if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
            return new Date(Date.UTC(y, m - 1, d)).toISOString();
          }
        } catch {
          // Invalid timezone string — fall through to server UTC
        }
      }
      const now = new Date();
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    }

    case 'date_diff': {
      const left = evaluateExpression(expr.left, currentItem, context, evaluator);
      const right = evaluateExpression(expr.right, currentItem, context, evaluator);
      const dLeft = parseDate(left, context);
      const dRight = parseDate(right, context);
      if (dLeft == null || dRight == null) return null;
      if (expr.unit === 'days') {
        // WP-31: normalize both sides to UTC midnight before computing diff
        // so we measure calendar-day differences, not time-difference-divided-by-24h.
        // Defensive — works even if one side has a non-midnight time-of-day.
        const a = Date.UTC(dLeft.getUTCFullYear(), dLeft.getUTCMonth(), dLeft.getUTCDate());
        const b = Date.UTC(dRight.getUTCFullYear(), dRight.getUTCMonth(), dRight.getUTCDate());
        // Both sides are UTC midnight ⇒ result is an integer. `round` is
        // defensive against any DST / leap-second weirdness producing a
        // tiny fractional component.
        return Math.round((a - b) / (1000 * 60 * 60 * 24));
      }
      throw new StructuredTransformError(
        `date_diff: unsupported unit "${expr.unit}"`,
        'INVALID_EXPRESSION'
      );
    }

    case 'date_add': {
      const base = parseDate(evaluateExpression(expr.date, currentItem, context, evaluator), context);
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
 *
 * WP-29: slash-format date parsing is locale-sensitive. JavaScript's `Date`
 * constructor interprets `"12/5/2026"` as MM/DD/YYYY (Dec 5) on most
 * engines, but the user's Google Sheet may store DD/MM/YYYY (May 12).
 *
 * Three-tier disambiguation:
 *
 *   1. **ISO format** — always unambiguous, used directly.
 *   2. **Slash/dash format with day or month > 12** — self-disambiguates
 *      (e.g., "13/5/2026" must be DD/MM since no month 13).
 *   3. **Slash/dash format ambiguous** — use user timezone (from optional
 *      context.getUserTimezone()) to pick locale:
 *        - America/* (excluding South America) → MM/DD/YYYY
 *        - Everywhere else (and undefined) → DD/MM/YYYY (covers ~85% of
 *          world population by default).
 *
 * Tier 3 (explicit `date_format` workflow_config hint) deferred to a
 * future WP — requires Phase 1 prompt steering.
 */
export function parseDate(value: any, context?: IExpressionContext): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  // Tier 0: ISO format (always unambiguous)
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;
  }

  // Slash/dash format: M/D/Y or D/M/Y
  const m = trimmed.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})(.*)$/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const y = parseInt(m[3], 10);
    const trailing = m[4] || '';
    const year = y < 100 ? 2000 + y : y;

    // Tier 1: unambiguous detection (one of the parts is > 12)
    if (a > 12 && b <= 12) return buildDate(year, b, a, trailing);  // DD/MM
    if (b > 12 && a <= 12) return buildDate(year, a, b, trailing);  // MM/DD

    if (a <= 12 && b <= 12) {
      // Tier 2: ambiguous — use user timezone to pick locale.
      const tz = context?.getUserTimezone?.();
      const prefersMMDD = tz != null && isUSDateFormatTimezone(tz);
      return prefersMMDD
        ? buildDate(year, a, b, trailing)    // MM/DD
        : buildDate(year, b, a, trailing);   // DD/MM (default)
    }
    // Both > 12 → genuinely invalid date components; fall through.
  }

  // Fallback: hand off to JS engine (RFC 2822, etc.)
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * WP-29 helper: build a Date from year/month/day plus optional trailing
 * time portion (e.g., "T07:30:00Z" if the slash-format input has one).
 * Falls back to local-midnight when no time is given. Returns null if the
 * resulting Date is invalid (e.g., Feb 30).
 */
function buildDate(year: number, month: number, day: number, trailing: string): Date | null {
  // If trailing has a time portion, reconstruct as ISO and let Date parse.
  const trailingTrimmed = trailing.trim();
  if (trailingTrimmed.length > 0) {
    const iso = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}${trailingTrimmed.startsWith('T') ? trailingTrimmed : 'T' + trailingTrimmed}`;
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d;
  }
  // Date-only: construct via UTC year/month/day. Month is 0-indexed in JS.
  const d = new Date(Date.UTC(year, month - 1, day));
  // Validate (e.g., new Date(2026, 1, 30) silently becomes Mar 2)
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

/**
 * WP-29 helper: does this IANA timezone correspond to a region that uses
 * MM/DD/YYYY as the typical slash-format? Mainly the US/Canada/territories.
 * Excludes South America (which uses DD/MM despite being in Americas).
 *
 * Conservative — false positives produce DD/MM (the safer default for ~85%
 * of the world's population). Returns true ONLY when we're confident the
 * user's locale prefers MM/DD.
 */
function isUSDateFormatTimezone(tz: string): boolean {
  // Match America/* but exclude common South American zones
  if (!/^America\//.test(tz)) return false;
  const SOUTH_AMERICAN = /^America\/(Argentina|Asuncion|Bogota|Buenos_Aires|Campo_Grande|Caracas|Cayenne|Cuiaba|Fortaleza|Guayaquil|Guyana|La_Paz|Lima|Maceio|Manaus|Montevideo|Paramaribo|Porto_Acre|Porto_Velho|Recife|Rio_Branco|Santarem|Santiago|Sao_Paulo)/;
  return !SOUTH_AMERICAN.test(tz);
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
