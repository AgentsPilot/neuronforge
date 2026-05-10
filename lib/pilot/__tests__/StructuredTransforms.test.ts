/**
 * StructuredTransforms — W2/WP-16 transform primitives
 *
 * Unit tests for the three new structured transform operations introduced in W2:
 *   - `with_fields`: augment items with computed fields (10-op closed expression vocabulary)
 *   - `project_column`: extract a single column/field from each row
 *   - `set_difference`: anti-join — keep items whose key is NOT in a reference array
 *
 * Plus the recursive `evaluateExpression()` walker that powers `with_fields`.
 *
 * The implementations are pure functions in `lib/pilot/transforms/StructuredTransforms.ts`
 * (deliberately decoupled from StepExecutor so they can be tested without dragging
 * in the heavy import chain). The actual StepExecutor switch cases delegate to
 * these functions.
 */

import {
  evaluateExpression,
  transformWithFields,
  transformProjectColumn,
  transformSetDifference,
  IExpressionContext,
  IConditionEvaluator,
} from '../transforms/StructuredTransforms';

// ─── Test stubs ─────────────────────────────────────────────────────────────

/**
 * Minimal context stub satisfying IExpressionContext.
 */
class StubContext implements IExpressionContext {
  variables: Record<string, any> = {};
  inputValues: Record<string, any> = {};

  setVariable(name: string, value: any): void {
    this.variables[name] = value;
  }

  resolveVariable(reference: any): any {
    if (typeof reference !== 'string') return undefined;
    const path = reference.replace(/^\{\{/, '').replace(/\}\}$/, '');
    if (path.startsWith('input.')) {
      return this.lookupPath(this.inputValues, path.substring('input.'.length));
    }
    return this.lookupPath(this.variables, path);
  }

  private lookupPath(obj: any, path: string): any {
    if (obj == null) return undefined;
    const parts = path.split('.');
    let current = obj;
    for (const p of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = current[p];
    }
    return current;
  }

  clone(): StubContext {
    const copy = new StubContext();
    copy.variables = { ...this.variables };
    copy.inputValues = { ...this.inputValues };
    return copy;
  }
}

/**
 * Minimal condition evaluator stub.
 *
 * Production wires in the real ConditionalEvaluator. For these tests we only
 * need to evaluate the simplest case (`{type: 'simple', field, operator, value}`
 * comparing against the current item's field) since the closed Expression
 * vocabulary's `if` is the only place conditions appear.
 */
class StubEvaluator implements IConditionEvaluator {
  evaluate(condition: any, context: IExpressionContext): boolean {
    if (!condition) return true;
    if (condition.type !== 'simple') {
      throw new Error(`StubEvaluator: only "simple" conditions supported in tests, got ${condition.type}`);
    }
    const fieldRef = condition.field as string;
    let actual: any;
    // Try item-prefix first (matches StepExecutor.transformFilter convention).
    if (fieldRef.startsWith('item.')) {
      const item = context.variables['item'];
      const field = fieldRef.substring('item.'.length);
      actual = item != null && typeof item === 'object' ? item[field] : undefined;
    } else {
      actual = context.resolveVariable(fieldRef);
    }
    const expected = condition.value;
    switch (condition.operator) {
      case 'eq': return actual === expected;
      case 'ne': return actual !== expected;
      case 'gt': return actual > expected;
      case 'gte': return actual >= expected;
      case 'lt': return actual < expected;
      case 'lte': return actual <= expected;
      default:
        throw new Error(`StubEvaluator: unsupported operator "${condition.operator}"`);
    }
  }
}

function makeCtx(vars: Record<string, any> = {}, inputs: Record<string, any> = {}): StubContext {
  const ctx = new StubContext();
  ctx.variables = { ...vars };
  ctx.inputValues = { ...inputs };
  return ctx;
}

function makeEval(): StubEvaluator {
  return new StubEvaluator();
}

// ============================================================
// evaluateExpression
// ============================================================

describe('evaluateExpression', () => {
  const evalExpr = (expr: any, item: any = null, ctx: StubContext = makeCtx()): any => {
    return evaluateExpression(expr, item, ctx, makeEval());
  };

  describe('atoms', () => {
    it('literal returns its value', () => {
      expect(evalExpr({ kind: 'literal', value: 42 })).toBe(42);
      expect(evalExpr({ kind: 'literal', value: 'hello' })).toBe('hello');
      expect(evalExpr({ kind: 'literal', value: null })).toBe(null);
      expect(evalExpr({ kind: 'literal', value: true })).toBe(true);
    });

    it('ref with magic name "item" reads from current item', () => {
      const item = { name: 'Alice', age: 30 };
      expect(evalExpr({ kind: 'ref', ref: 'item', field: 'name' }, item)).toBe('Alice');
      expect(evalExpr({ kind: 'ref', ref: 'item', field: 'age' }, item)).toBe(30);
    });

    it('ref with no field returns the entire current item', () => {
      const item = { name: 'Alice' };
      expect(evalExpr({ kind: 'ref', ref: 'item' }, item)).toEqual({ name: 'Alice' });
    });

    it('ref to other slot resolves via context', () => {
      const ctx = makeCtx({ user_profile: { email: 'a@b.com' } });
      expect(evalExpr({ kind: 'ref', ref: 'user_profile', field: 'email' }, null, ctx)).toBe('a@b.com');
    });

    it('ref returns undefined when current item is null', () => {
      expect(evalExpr({ kind: 'ref', ref: 'item', field: 'x' }, null)).toBeUndefined();
    });

    it('config resolves from input values', () => {
      const ctx = makeCtx({}, { stage_filter_value: 4 });
      expect(evalExpr({ kind: 'config', key: 'stage_filter_value' }, null, ctx)).toBe(4);
    });

    it('config throws on missing key', () => {
      expect(() => evalExpr({ kind: 'config' })).toThrow(/requires `key`/);
    });
  });

  describe('concat', () => {
    it('joins literal and ref values as strings', () => {
      const item = { id: 'A123' };
      const expr = {
        kind: 'concat',
        args: [
          { kind: 'literal', value: 'https://example.com/' },
          { kind: 'ref', ref: 'item', field: 'id' },
          { kind: 'literal', value: '/edit' },
        ],
      };
      expect(evalExpr(expr, item)).toBe('https://example.com/A123/edit');
    });

    it('treats null/undefined arg values as empty strings', () => {
      const expr = {
        kind: 'concat',
        args: [
          { kind: 'literal', value: 'a-' },
          { kind: 'ref', ref: 'item', field: 'missing' },
          { kind: 'literal', value: '-b' },
        ],
      };
      expect(evalExpr(expr, {})).toBe('a--b');
    });

    it('throws on missing args array', () => {
      expect(() => evalExpr({ kind: 'concat' })).toThrow(/requires `args`/);
    });
  });

  describe('if', () => {
    it('returns then branch when condition is true', () => {
      const item = { amount: 100 };
      const expr = {
        kind: 'if',
        condition: { type: 'simple', field: 'item.amount', operator: 'gt', value: 50 },
        then: { kind: 'literal', value: 'high' },
        else: { kind: 'literal', value: 'low' },
      };
      expect(evalExpr(expr, item)).toBe('high');
    });

    it('returns else branch when condition is false', () => {
      const item = { amount: 10 };
      const expr = {
        kind: 'if',
        condition: { type: 'simple', field: 'item.amount', operator: 'gt', value: 50 },
        then: { kind: 'literal', value: 'high' },
        else: { kind: 'literal', value: 'low' },
      };
      expect(evalExpr(expr, item)).toBe('low');
    });
  });

  describe('today', () => {
    it('returns ISO 8601 string for current time', () => {
      const result = evalExpr({ kind: 'today' });
      expect(typeof result).toBe('string');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(new Date(result).toString()).not.toBe('Invalid Date');
    });
  });

  describe('date_diff', () => {
    it('computes day difference between two dates', () => {
      const expr = {
        kind: 'date_diff',
        unit: 'days',
        left: { kind: 'literal', value: '2026-01-15' },
        right: { kind: 'literal', value: '2026-01-10' },
      };
      expect(evalExpr(expr)).toBe(5);
    });

    it('returns negative for past-relative dates', () => {
      const expr = {
        kind: 'date_diff',
        unit: 'days',
        left: { kind: 'literal', value: '2026-01-10' },
        right: { kind: 'literal', value: '2026-01-15' },
      };
      expect(evalExpr(expr)).toBe(-5);
    });

    it('returns null when either side is null', () => {
      const expr = {
        kind: 'date_diff',
        unit: 'days',
        left: { kind: 'literal', value: null },
        right: { kind: 'today' },
      };
      expect(evalExpr(expr)).toBe(null);
    });

    it('throws on unsupported unit', () => {
      const expr = {
        kind: 'date_diff',
        unit: 'hours',
        left: { kind: 'literal', value: '2026-01-15' },
        right: { kind: 'literal', value: '2026-01-10' },
      };
      expect(() => evalExpr(expr)).toThrow(/unsupported unit/);
    });
  });

  describe('date_add', () => {
    it('adds days to a date', () => {
      const expr = {
        kind: 'date_add',
        date: { kind: 'literal', value: '2026-01-10T00:00:00.000Z' },
        days: { kind: 'literal', value: 3 },
      };
      const result = evalExpr(expr);
      expect(typeof result).toBe('string');
      expect(new Date(result).toISOString().substring(0, 10)).toBe('2026-01-13');
    });

    it('returns null when date is invalid', () => {
      const expr = {
        kind: 'date_add',
        date: { kind: 'literal', value: 'not-a-date' },
        days: { kind: 'literal', value: 3 },
      };
      expect(evalExpr(expr)).toBe(null);
    });
  });

  describe('null_check', () => {
    it('returns true when value is null (default)', () => {
      const item = { amount: null };
      const expr = {
        kind: 'null_check',
        value: { kind: 'ref', ref: 'item', field: 'amount' },
      };
      expect(evalExpr(expr, item)).toBe(true);
    });

    it('returns false when value is non-null (default)', () => {
      const item = { amount: 42 };
      const expr = {
        kind: 'null_check',
        value: { kind: 'ref', ref: 'item', field: 'amount' },
      };
      expect(evalExpr(expr, item)).toBe(false);
    });

    it('with invert: true returns true when value is non-null', () => {
      const item = { amount: 42 };
      const expr = {
        kind: 'null_check',
        invert: true,
        value: { kind: 'ref', ref: 'item', field: 'amount' },
      };
      expect(evalExpr(expr, item)).toBe(true);
    });

    it('with invert: true returns false when value is null', () => {
      const item = { amount: null };
      const expr = {
        kind: 'null_check',
        invert: true,
        value: { kind: 'ref', ref: 'item', field: 'amount' },
      };
      expect(evalExpr(expr, item)).toBe(false);
    });
  });

  describe('all_not_null', () => {
    it('returns true when all referenced fields are non-null on the current item', () => {
      const item = { name: 'Alice', email: 'a@b.com', age: 30 };
      const expr = { kind: 'all_not_null', refs: ['name', 'email', 'age'] };
      expect(evalExpr(expr, item)).toBe(true);
    });

    it('returns false when any field is null', () => {
      const item = { name: 'Alice', email: null, age: 30 };
      const expr = { kind: 'all_not_null', refs: ['name', 'email', 'age'] };
      expect(evalExpr(expr, item)).toBe(false);
    });

    it('returns false when any field is missing', () => {
      const item = { name: 'Alice' };
      const expr = { kind: 'all_not_null', refs: ['name', 'email'] };
      expect(evalExpr(expr, item)).toBe(false);
    });

    it('returns false when any field is empty string', () => {
      const item = { name: 'Alice', email: '' };
      const expr = { kind: 'all_not_null', refs: ['name', 'email'] };
      expect(evalExpr(expr, item)).toBe(false);
    });
  });

  describe('error handling', () => {
    it('throws on unknown expression kind', () => {
      expect(() => evalExpr({ kind: 'unknown_op' })).toThrow(/unknown expression kind/);
    });

    it('throws on null expression', () => {
      expect(() => evalExpr(null)).toThrow(/invalid expression/);
    });

    it('throws on expression without kind', () => {
      expect(() => evalExpr({ value: 1 })).toThrow(/invalid expression/);
    });
  });
});

// ============================================================
// transformWithFields
// ============================================================

describe('transformWithFields', () => {
  const withFields = (data: any, config: any, ctx: StubContext = makeCtx()): any => {
    return transformWithFields(data, config, ctx, makeEval());
  };

  it('augments each item with a computed field, preserving input fields', () => {
    const data = [
      { vendor: 'Acme', amount: 100 },
      { vendor: 'Beta', amount: null },
    ];
    const config = {
      fields: [
        {
          name: 'has_valid_amount',
          expression: {
            kind: 'null_check',
            invert: true,
            value: { kind: 'ref', ref: 'item', field: 'amount' },
          },
        },
      ],
    };
    expect(withFields(data, config)).toEqual([
      { vendor: 'Acme', amount: 100, has_valid_amount: true },
      { vendor: 'Beta', amount: null, has_valid_amount: false },
    ]);
  });

  it('supports multiple fields evaluated independently', () => {
    const data = [{ first: 'Alice', last: 'Smith' }];
    const config = {
      fields: [
        {
          name: 'full_name',
          expression: {
            kind: 'concat',
            args: [
              { kind: 'ref', ref: 'item', field: 'first' },
              { kind: 'literal', value: ' ' },
              { kind: 'ref', ref: 'item', field: 'last' },
            ],
          },
        },
        {
          name: 'is_complete',
          expression: { kind: 'all_not_null', refs: ['first', 'last'] },
        },
      ],
    };
    expect(withFields(data, config)).toEqual([
      { first: 'Alice', last: 'Smith', full_name: 'Alice Smith', is_complete: true },
    ]);
  });

  it('uses if/literal for status reasoning (orders-po pattern)', () => {
    const data = [
      { order_id: 'A1', vendor: 'Acme', qty: 10, _all_present: true },
      { order_id: 'B2', vendor: null, qty: 5, _all_present: false },
    ];
    const config = {
      fields: [
        {
          name: 'status',
          expression: {
            kind: 'if',
            condition: { type: 'simple', field: 'item._all_present', operator: 'eq', value: true },
            then: { kind: 'literal', value: 'Complete' },
            else: { kind: 'literal', value: 'Needs review' },
          },
        },
      ],
    };
    const result = withFields(data, config);
    expect(result[0].status).toBe('Complete');
    expect(result[1].status).toBe('Needs review');
  });

  it('throws on missing fields config', () => {
    expect(() => withFields([], {})).toThrow(/non-empty `fields`/);
    expect(() => withFields([], { fields: [] })).toThrow(/non-empty `fields`/);
  });

  it('throws on malformed field declaration', () => {
    expect(() => withFields([{}], { fields: [{ name: 'x' }] })).toThrow(/invalid field declaration/);
    expect(() => withFields([{}], { fields: [{ expression: {} }] })).toThrow(/invalid field declaration/);
  });

  it('handles non-array input by wrapping single item', () => {
    const data = { vendor: 'Acme', amount: 100 };
    const config = {
      fields: [{ name: 'tagged', expression: { kind: 'literal', value: 'yes' } }],
    };
    const result = withFields(data, config);
    expect(result).toEqual({ vendor: 'Acme', amount: 100, tagged: 'yes' });
  });

  it('handles empty array input', () => {
    const config = { fields: [{ name: 'x', expression: { kind: 'literal', value: 1 } }] };
    expect(withFields([], config)).toEqual([]);
  });

  it('handles primitive (non-object) items by wrapping under "value"', () => {
    const data = ['a', 'b'];
    const config = {
      fields: [{ name: 'tagged', expression: { kind: 'literal', value: true } }],
    };
    expect(withFields(data, config)).toEqual([
      { value: 'a', tagged: true },
      { value: 'b', tagged: true },
    ]);
  });
});

// ============================================================
// transformProjectColumn
// ============================================================

describe('transformProjectColumn', () => {
  describe('by_index', () => {
    it('extracts column N from each row of a 2D array', () => {
      const data = [
        ['a', 'b', 'c', 'd', 'e1'],
        ['a', 'b', 'c', 'd', 'e2'],
        ['a', 'b', 'c', 'd', 'e3'],
      ];
      expect(transformProjectColumn(data, { column: { kind: 'by_index', index: 4 } })).toEqual(['e1', 'e2', 'e3']);
    });

    it('returns undefined for out-of-bounds index', () => {
      expect(transformProjectColumn([['a', 'b']], { column: { kind: 'by_index', index: 10 } })).toEqual([undefined]);
    });

    // WP-20: post-WP-SR tolerance for object rows.
    it('falls back to Object.values(row)[N] when rows are objects (WP-20)', () => {
      // Mirrors the canonical complaint-email-logger Phase D failure: after
      // the auto-inject of rows_to_objects(preserve_case=true), Sheets-derived
      // rows are objects with header keys (insertion order matches column order).
      const data = [
        { Date: '14/12/2025', 'Lead Name': 'Lead 1', Stage: '4', Email: 'a@x.com', 'Gmail Link': 'msg-001' },
        { Date: '12/12/2025', 'Lead Name': 'Lead 2', Stage: '3', Email: 'b@x.com', 'Gmail Link': 'msg-002' },
      ];
      // index 4 = the 5th column = "Gmail Link"
      expect(transformProjectColumn(data, { column: { kind: 'by_index', index: 4 } })).toEqual(['msg-001', 'msg-002']);
      // index 0 = first column = "Date"
      expect(transformProjectColumn(data, { column: { kind: 'by_index', index: 0 } })).toEqual(['14/12/2025', '12/12/2025']);
    });

    it('returns undefined for out-of-bounds index on object rows (WP-20)', () => {
      const data = [{ a: 1, b: 2 }];
      expect(transformProjectColumn(data, { column: { kind: 'by_index', index: 99 } })).toEqual([undefined]);
    });

    it('throws when row is neither array nor object', () => {
      expect(() => transformProjectColumn(['plain string'], { column: { kind: 'by_index', index: 0 } }))
        .toThrow(/requires array or object rows/);
    });
  });

  describe('by_field', () => {
    it('extracts top-level field from each object', () => {
      const data = [
        { id: 'A', name: 'Alice' },
        { id: 'B', name: 'Bob' },
      ];
      expect(transformProjectColumn(data, { column: { kind: 'by_field', field: 'id' } })).toEqual(['A', 'B']);
    });

    it('returns undefined for missing fields', () => {
      const data = [{ id: 'A' }, { name: 'Bob' }];
      expect(transformProjectColumn(data, { column: { kind: 'by_field', field: 'id' } })).toEqual(['A', undefined]);
    });

    it('returns undefined for non-object rows', () => {
      const data = ['string', null, { id: 'A' }];
      expect(transformProjectColumn(data, { column: { kind: 'by_field', field: 'id' } })).toEqual([undefined, undefined, 'A']);
    });
  });

  describe('by_field_path', () => {
    it('navigates dot-notation paths', () => {
      const data = [
        { user: { profile: { email: 'a@b.com' } } },
        { user: { profile: { email: 'c@d.com' } } },
      ];
      expect(transformProjectColumn(data, { column: { kind: 'by_field_path', path: 'user.profile.email' } })).toEqual([
        'a@b.com',
        'c@d.com',
      ]);
    });

    it('returns undefined when intermediate is null', () => {
      const data = [{ user: null }];
      expect(transformProjectColumn(data, { column: { kind: 'by_field_path', path: 'user.profile.email' } })).toEqual([undefined]);
    });
  });

  describe('error handling', () => {
    it('throws on non-array input', () => {
      const config = { column: { kind: 'by_field', field: 'id' } };
      expect(() => transformProjectColumn({ id: 'A' } as any, config)).toThrow(/array input/);
      expect(() => transformProjectColumn(null as any, config)).toThrow(/array input/);
    });

    it('throws on missing column config', () => {
      expect(() => transformProjectColumn([], {})).toThrow(/requires a `column`/);
    });

    it('throws on unknown column.kind', () => {
      const config = { column: { kind: 'mystery', index: 0 } };
      expect(() => transformProjectColumn([['a']], config)).toThrow(/unknown column.kind/);
    });
  });
});

// ============================================================
// transformSetDifference
// ============================================================

describe('transformSetDifference', () => {
  const setDiff = (data: any, config: any, ctx: StubContext = makeCtx()): any => {
    return transformSetDifference(data, config, ctx);
  };

  it('keeps items whose key is NOT in the reference array (pre-resolved)', () => {
    const data = [
      { id: 'A', name: 'Apple' },
      { id: 'B', name: 'Banana' },
      { id: 'C', name: 'Cherry' },
    ];
    const reference = [{ id: 'A' }, { id: 'C' }];
    expect(setDiff(data, { reference, key_field: 'id' })).toEqual([{ id: 'B', name: 'Banana' }]);
  });

  it('keeps items NOT in reference (string-key reference resolved via context)', () => {
    const data = [
      { id: 'A', name: 'Apple' },
      { id: 'B', name: 'Banana' },
    ];
    const ctx = makeCtx({ existing_ids: [{ id: 'A' }] });
    expect(setDiff(data, { reference: 'existing_ids', key_field: 'id' }, ctx)).toEqual([{ id: 'B', name: 'Banana' }]);
  });

  // WP-22: production-like resolveVariable requires {{...}} syntax. The
  // StubContext above is permissive (strips both forms equivalently), so we
  // use a stricter stub here that mirrors the production contract.
  describe('WP-22 — bare RefName tolerance with strict resolveVariable', () => {
    class StrictContext implements IExpressionContext {
      variables: Record<string, any> = {};
      inputValues: Record<string, any> = {};

      setVariable(name: string, value: any): void {
        this.variables[name] = value;
      }

      // Mirrors lib/pilot/ExecutionContext.resolveVariable:
      //   "If it's not a string, return as-is. If no '{{', return as literal."
      resolveVariable(reference: any): any {
        if (typeof reference !== 'string') return reference;
        if (!reference.includes('{{')) return reference; // ← the strict check
        const path = reference.replace(/^\{\{\s*|\s*\}\}$/g, '');
        const parts = path.split('.');
        let current: any = this.variables;
        for (const p of parts) {
          if (current == null || typeof current !== 'object') return undefined;
          current = current[p];
        }
        return current;
      }

      clone(): StrictContext {
        const copy = new StrictContext();
        copy.variables = { ...this.variables };
        copy.inputValues = { ...this.inputValues };
        return copy;
      }
    }

    function makeStrictCtx(vars: Record<string, any> = {}): StrictContext {
      const ctx = new StrictContext();
      ctx.variables = { ...vars };
      return ctx;
    }

    it('bare RefName ("existing_ids") resolves correctly via auto-wrap', () => {
      // The exact failure mode from Phase D rerun on complaint-email-logger:
      // IR converter emitted `reference: "existing_message_ids"` (bare),
      // production resolveVariable returned the literal string, runtime
      // threw "got string". Post-WP-22, the runtime auto-wraps before
      // resolving, so this works.
      const data = [{ id: 'A' }, { id: 'B' }];
      const ctx = makeStrictCtx({ existing_ids: [{ id: 'A' }] });
      expect(transformSetDifference(data, { reference: 'existing_ids', key_field: 'id' }, ctx))
        .toEqual([{ id: 'B' }]);
    });

    it('templated `{{existing_ids}}` (post-WP-22-fix IR shape) also resolves correctly', () => {
      // Post-WP-22 IR converter fix: emits `reference: "{{existing_ids}}"`.
      // Runtime should accept this form too (it does — startsWith('{{') skips
      // the wrap step).
      const data = [{ id: 'A' }, { id: 'B' }];
      const ctx = makeStrictCtx({ existing_ids: [{ id: 'A' }] });
      expect(transformSetDifference(data, { reference: '{{existing_ids}}', key_field: 'id' }, ctx))
        .toEqual([{ id: 'B' }]);
    });

    it('regression demo: WITHOUT auto-wrap the bare RefName would resolve to a literal string', () => {
      // Sanity-check the strict stub behaves like production.
      const ctx = makeStrictCtx({ existing_ids: [{ id: 'A' }] });
      expect(ctx.resolveVariable('existing_ids')).toBe('existing_ids'); // literal, not the array
      expect(ctx.resolveVariable('{{existing_ids}}')).toEqual([{ id: 'A' }]); // resolved
    });
  });

  it('uses reference_key_field when reference items use a different field', () => {
    const data = [{ message_id: 'A1' }, { message_id: 'B2' }];
    const reference = [{ url: 'A1' }, { url: 'C3' }];
    expect(setDiff(data, { reference, key_field: 'message_id', reference_key_field: 'url' })).toEqual([
      { message_id: 'B2' },
    ]);
  });

  it('handles primitive reference values (Set of scalars)', () => {
    const data = [{ id: 'A' }, { id: 'B' }];
    expect(setDiff(data, { reference: ['A'], key_field: 'id' })).toEqual([{ id: 'B' }]);
  });

  it('returns input unchanged when reference resolves to null/undefined', () => {
    const data = [{ id: 'A' }, { id: 'B' }];
    const ctx = makeCtx({});
    expect(setDiff(data, { reference: 'nonexistent_slot', key_field: 'id' }, ctx)).toEqual(data);
  });

  it('returns all input when reference is empty', () => {
    const data = [{ id: 'A' }, { id: 'B' }];
    expect(setDiff(data, { reference: [], key_field: 'id' })).toEqual(data);
  });

  it('keeps non-object items unfiltered', () => {
    const data = ['raw', { id: 'A' }, { id: 'B' }];
    expect(setDiff(data, { reference: [{ id: 'A' }], key_field: 'id' })).toEqual(['raw', { id: 'B' }]);
  });

  it('throws on non-array input', () => {
    expect(() => setDiff({ id: 'A' }, { reference: [], key_field: 'id' })).toThrow(/array input/);
  });

  it('throws on missing key_field', () => {
    expect(() => setDiff([], { reference: [] })).toThrow(/`key_field`/);
  });

  it('throws on missing reference config', () => {
    expect(() => setDiff([], { key_field: 'id' })).toThrow(/requires a `reference`/);
  });

  it('throws when reference resolves to a non-array', () => {
    const ctx = makeCtx({ existing_ids: 'not-an-array' });
    expect(() => setDiff([{ id: 'A' }], { reference: 'existing_ids', key_field: 'id' }, ctx)).toThrow(/must resolve to an array/);
  });
});
