/**
 * StructuredTransforms — WP-37 (transformWithFields tolerates undefined expression)
 *
 * Background:
 *   `with_fields.fields[].expression` is meant to be a structured AST node
 *   (after WP-33). But the runtime still pre-runs `resolveAllVariables` on
 *   the whole step config. When the LLM emits a template-string like
 *   `"{{attachment_item.thread_id}}"` and that path is unresolvable, the
 *   resolver writes `undefined` back. `JSON.stringify` drops undefined,
 *   making the runtime see `{name: "thread_id"}` with no expression.
 *
 *   The upstream guard `!field.expression` then throws `INVALID_CONFIG`
 *   before WP-33's `evaluateExpression` tolerance gets a chance to handle
 *   the string form. Result: scatter-gather "all N items failed" abort.
 *
 *   Fix: treat `expression === undefined` as `{kind: "literal", value:
 *   undefined}`. The augmented row gets the field with undefined value,
 *   preserving the LLM's intent and surfacing the missing data downstream.
 *
 * Encountered as: Phase D on `po-monitor-supplier-confirmation` (2026-05-14).
 */

import {
  transformWithFields,
  type IExpressionContext,
  type IConditionEvaluator,
} from '../transforms/StructuredTransforms';

class StubContext implements IExpressionContext {
  variables: Record<string, any> = {};
  inputs: Record<string, any> = {};

  setVariable(name: string, value: any): void {
    this.variables[name] = value;
  }

  resolveVariable(reference: any): any {
    if (typeof reference !== 'string') return reference;
    if (!reference.includes('{{')) return reference;
    const path = reference.replace(/^\{\{\s*|\s*\}\}$/g, '');
    if (path.startsWith('input.')) return this.lookupPath(this.inputs, path.substring(6));
    return this.lookupPath(this.variables, path);
  }

  private lookupPath(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;
    for (const p of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, any>)[p];
    }
    return current;
  }

  clone(): StubContext {
    const c = new StubContext();
    c.variables = { ...this.variables };
    c.inputs = { ...this.inputs };
    return c;
  }
}

const noopEvaluator: IConditionEvaluator = { evaluate: () => false };

describe('WP-37 — transformWithFields tolerates undefined expression (post-resolveAllVariables mangling)', () => {
  it('augments row with field=undefined when expression is undefined (canonical po-monitor case)', () => {
    const ctx = new StubContext();
    const items = [{ filename: 'invoice.pdf', size: 1024 }];

    const config = {
      fields: [
        // Canonical failure shape: resolveAllVariables resolved
        // "{{attachment_item.thread_id}}" to undefined and wrote it back.
        { name: 'thread_id', expression: undefined },
      ],
    };

    const result = transformWithFields(items, config, ctx, noopEvaluator);

    expect(result).toEqual([
      { filename: 'invoice.pdf', size: 1024, thread_id: undefined },
    ]);
  });

  it('processes mixed valid + undefined-expression fields without crashing', () => {
    const ctx = new StubContext();
    const items = [{ id: 'a', amount: 100 }];

    const config = {
      fields: [
        { name: 'thread_id', expression: undefined }, // unresolvable upstream
        { name: 'double_amount', expression: { kind: 'ref', ref: 'item', field: 'amount' } },
        { name: 'literal_tag', expression: { kind: 'literal', value: 'urgent' } },
      ],
    };

    const result = transformWithFields(items, config, ctx, noopEvaluator);

    expect(result).toEqual([
      {
        id: 'a',
        amount: 100,
        thread_id: undefined,
        double_amount: 100,
        literal_tag: 'urgent',
      },
    ]);
  });

  it('handles multiple scatter items each with undefined expression', () => {
    const ctx = new StubContext();
    const items = [
      { id: '1' },
      { id: '2' },
      { id: '3' },
    ];

    const config = {
      fields: [
        { name: 'parent_ref', expression: undefined },
      ],
    };

    const result = transformWithFields(items, config, ctx, noopEvaluator);

    expect(result).toHaveLength(3);
    expect(result.every((r: any) => r.parent_ref === undefined)).toBe(true);
    expect(result[0].id).toBe('1');
    expect(result[2].id).toBe('3');
  });

  it('regression — field with missing `name` still throws (genuinely invalid)', () => {
    const ctx = new StubContext();
    const items = [{ id: 'a' }];

    const config = {
      fields: [
        { expression: { kind: 'literal', value: 'X' } }, // no name
      ],
    };

    expect(() =>
      transformWithFields(items, config, ctx, noopEvaluator),
    ).toThrow(/invalid field declaration/);
  });

  it('regression — structured AST expression still evaluates correctly', () => {
    const ctx = new StubContext();
    const items = [{ vendor: 'Acme' }];

    const config = {
      fields: [
        {
          name: 'vendor_upper',
          expression: { kind: 'literal', value: 'ACME' },
        },
      ],
    };

    const result = transformWithFields(items, config, ctx, noopEvaluator);

    expect(result[0].vendor_upper).toBe('ACME');
  });

  it('regression — falsy-but-defined literal values (0, "", false) still evaluate', () => {
    const ctx = new StubContext();
    const items = [{ id: 'a' }];

    const config = {
      fields: [
        { name: 'zero', expression: { kind: 'literal', value: 0 } },
        { name: 'empty', expression: { kind: 'literal', value: '' } },
        { name: 'flag', expression: { kind: 'literal', value: false } },
      ],
    };

    const result = transformWithFields(items, config, ctx, noopEvaluator);

    expect(result[0]).toEqual({
      id: 'a',
      zero: 0,
      empty: '',
      flag: false,
    });
  });

  it('regression — template-string expression (WP-33 path) still works alongside WP-37 fix', () => {
    const ctx = new StubContext();
    ctx.variables.uploaded_file = { web_view_link: 'https://example.com/file/123' };
    const items = [{ id: 'a' }];

    const config = {
      fields: [
        // WP-33 case: template string
        { name: 'link', expression: '{{uploaded_file.web_view_link}}' },
        // WP-37 case: undefined (post-resolveAllVariables of unresolvable)
        { name: 'parent_ref', expression: undefined },
      ],
    };

    const result = transformWithFields(items, config, ctx, noopEvaluator);

    expect(result[0].link).toBe('https://example.com/file/123');
    expect(result[0].parent_ref).toBeUndefined();
  });

  it('end-to-end po-monitor pattern: extracted PO row + parent thread_id (unresolvable in mock)', () => {
    const ctx = new StubContext();

    // Simulates step8 input: extracted_po_data from per-attachment extraction.
    // The LLM's intent: combine extracted fields with parent email's thread_id.
    // In Phase D mocks, the parent thread_id isn't propagated → resolves undefined.
    const items = [
      {
        order_date_and_time: '2026-05-14T10:00:00Z',
        order_ID: 'PO-001',
        Vendor: 'Acme Corp',
        QTY: 5,
        cost: '100.00',
        amount: '500.00',
        status: 'Complete',
        supplier_email: 'supplier@acme.example',
      },
    ];

    // Mirrors the actual po-monitor step8 emission after resolveAllVariables mangled
    // the template strings that didn't resolve in the scatter context.
    const config = {
      fields: [
        { name: 'thread_id', expression: undefined },         // {{attachment_item.thread_id}} unresolved
        { name: 'source_message_id', expression: undefined }, // same
        {
          name: 'has_supplier_email',
          expression: {
            kind: 'null_check',
            invert: true,
            value: { kind: 'ref', ref: 'item', field: 'supplier_email' },
          },
        },
      ],
    };

    const result = transformWithFields(items, config, ctx, noopEvaluator);

    expect(result[0]).toMatchObject({
      order_ID: 'PO-001',
      Vendor: 'Acme Corp',
      thread_id: undefined,
      source_message_id: undefined,
      has_supplier_email: true,
    });
  });
});
