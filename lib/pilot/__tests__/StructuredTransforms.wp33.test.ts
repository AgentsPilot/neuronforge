/**
 * StructuredTransforms — WP-33 (string-form expression tolerance in with_fields)
 *
 * Background:
 *   The W2 grammar requires `with_fields.fields[].expression` to be a
 *   structured AST node (`{kind: "ref", ref: "X", field: "Y"}`). The LLM
 *   sometimes emits a template string instead (`"{{X.Y}}"`), since `{{}}`
 *   syntax works everywhere else (step.input, condition values, recipients).
 *
 *   The IR converter's `normalizeExpressionRefs` previously early-returned
 *   on non-objects, so phase4 stored the raw template string. At runtime,
 *   `resolveAllVariables` substituted `{{X.Y}}` with the resolved primitive
 *   (e.g. a URL string), then `evaluateExpression` threw `INVALID_EXPRESSION`
 *   because the expression was no longer a `{kind, ...}` AST node.
 *
 *   The fix is two-layered: (a) IR converter parses string-form expressions
 *   into structured AST at compile time; (b) `evaluateExpression` runtime
 *   tolerance handles both `{{var.field}}` templates and already-resolved
 *   literal strings via `normalizeStringExpression`.
 *
 *   This file covers the runtime layer (a). Compiler layer (b) is covered
 *   in `lib/agentkit/v6/compiler/__tests__/IntentToIRConverter.wp33.test.ts`.
 *
 * Encountered as: `vocabulary-pipeline` Phase E (2026-05-13) — step9 with_fields
 * built a drive_link from `{{uploaded_file.web_view_link}}`, scatter-gather item
 * failed, parent scatter failed as SCATTER_ALL_FAILED, downstream send_email
 * never ran, user received no email.
 */

import {
  evaluateExpression,
  normalizeStringExpression,
  transformWithFields,
  type IExpressionContext,
  type IConditionEvaluator,
} from '../transforms/StructuredTransforms';

// ─── Stub context (mirrors production ExecutionContext) ────────────────────

class StubContext implements IExpressionContext {
  variables: Record<string, any> = {};
  inputs: Record<string, any> = {};

  setVariable(name: string, value: any): void {
    this.variables[name] = value;
  }

  // Production-strict: returns literal when no {{}}.
  resolveVariable(reference: any): any {
    if (typeof reference !== 'string') return reference;
    if (!reference.includes('{{')) return reference;
    const path = reference.replace(/^\{\{\s*|\s*\}\}$/g, '');
    if (path.startsWith('input.')) {
      return this.lookupPath(this.inputs, path.substring('input.'.length));
    }
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

const noopEvaluator: IConditionEvaluator = {
  evaluate: () => false,
};

// ─── normalizeStringExpression (parsing rules) ─────────────────────────────

describe('WP-33 — normalizeStringExpression', () => {
  it('parses {{var}} → {kind: "ref", ref: "var"}', () => {
    expect(normalizeStringExpression('{{uploaded_file}}')).toEqual({
      kind: 'ref',
      ref: 'uploaded_file',
    });
  });

  it('parses {{var.field}} → {kind: "ref", ref: "var", field: "field"}', () => {
    expect(normalizeStringExpression('{{uploaded_file.web_view_link}}')).toEqual({
      kind: 'ref',
      ref: 'uploaded_file',
      field: 'web_view_link',
    });
  });

  it('parses {{var.a.b.c}} → ref with dotted field path', () => {
    expect(normalizeStringExpression('{{producer.meta.id}}')).toEqual({
      kind: 'ref',
      ref: 'producer',
      field: 'meta.id',
    });
  });

  it('parses {{input.K}} → {kind: "config", key: "K"}', () => {
    expect(normalizeStringExpression('{{input.amount_threshold}}')).toEqual({
      kind: 'config',
      key: 'amount_threshold',
    });
  });

  it('parses {{input.nested.K}} → config with dotted key (whatever convention upstream uses)', () => {
    expect(normalizeStringExpression('{{input.nested.K}}')).toEqual({
      kind: 'config',
      key: 'nested.K',
    });
  });

  it('tolerates whitespace inside braces', () => {
    expect(normalizeStringExpression('{{  var.field  }}')).toEqual({
      kind: 'ref',
      ref: 'var',
      field: 'field',
    });
  });

  it('wraps a plain non-template string as literal (already-resolved value)', () => {
    expect(normalizeStringExpression('https://drive.google.com/file/abc')).toEqual({
      kind: 'literal',
      value: 'https://drive.google.com/file/abc',
    });
  });

  it('wraps the empty string as a literal', () => {
    expect(normalizeStringExpression('')).toEqual({ kind: 'literal', value: '' });
  });

  it('wraps malformed {{ as literal (no closing braces)', () => {
    expect(normalizeStringExpression('{{ not closed')).toEqual({
      kind: 'literal',
      value: '{{ not closed',
    });
  });
});

// ─── evaluateExpression runtime tolerance ──────────────────────────────────

describe('WP-33 — evaluateExpression accepts string-form expressions', () => {
  it('resolves "{{ref.field}}" via context (post-resolveAllVariables didn\'t fire because outer context unaware)', () => {
    const ctx = new StubContext();
    ctx.variables.uploaded_file = { web_view_link: 'https://drive.google.com/file/xyz' };

    const result = evaluateExpression(
      '{{uploaded_file.web_view_link}}',
      null,
      ctx,
      noopEvaluator,
    );

    expect(result).toBe('https://drive.google.com/file/xyz');
  });

  it('resolves "{{input.K}}" via context.inputs', () => {
    const ctx = new StubContext();
    ctx.inputs.amount_threshold = 100;

    const result = evaluateExpression('{{input.amount_threshold}}', null, ctx, noopEvaluator);

    expect(result).toBe(100);
  });

  it('returns the already-resolved URL when expression is a plain string (post-resolveAllVariables case)', () => {
    const ctx = new StubContext();

    // This is the canonical vocabulary-pipeline failure case.
    // resolveAllVariables ran first and substituted {{uploaded_file.web_view_link}}
    // with the resolved URL primitive. evaluateExpression must treat it as a literal.
    const result = evaluateExpression(
      'https://drive.google.com/file/d/1rejGmG4MrjIZc0PcUV_V1KJUH4PbsDhg/view',
      null,
      ctx,
      noopEvaluator,
    );

    expect(result).toBe('https://drive.google.com/file/d/1rejGmG4MrjIZc0PcUV_V1KJUH4PbsDhg/view');
  });

  it('resolves "{{item.field}}" against the current iteration item (per-item ref)', () => {
    const ctx = new StubContext();

    const result = evaluateExpression(
      '{{item.amount}}',
      { amount: 42, currency: 'USD' },
      ctx,
      noopEvaluator,
    );

    expect(result).toBe(42);
  });

  it('still throws on non-string, non-object expressions (regression guard for original strict contract)', () => {
    const ctx = new StubContext();

    expect(() =>
      evaluateExpression(123, null, ctx, noopEvaluator),
    ).toThrow(/invalid expression/);

    expect(() =>
      evaluateExpression(true, null, ctx, noopEvaluator),
    ).toThrow(/invalid expression/);

    expect(() =>
      evaluateExpression(null, null, ctx, noopEvaluator),
    ).toThrow(/invalid expression/);
  });

  it('still works for structured AST expressions (regression guard)', () => {
    const ctx = new StubContext();
    ctx.variables.X = { Y: 'hello' };

    expect(
      evaluateExpression({ kind: 'literal', value: 'world' }, null, ctx, noopEvaluator),
    ).toBe('world');

    expect(
      evaluateExpression(
        { kind: 'ref', ref: 'X', field: 'Y' },
        null,
        ctx,
        noopEvaluator,
      ),
    ).toBe('hello');
  });
});

// ─── transformWithFields end-to-end (canonical vocabulary-pipeline failure) ────

describe('WP-33 — transformWithFields end-to-end', () => {
  it('handles the canonical "drive_link from {{uploaded_file.web_view_link}}" pattern', () => {
    const ctx = new StubContext();
    ctx.variables.uploaded_file = {
      web_view_link: 'https://drive.google.com/file/d/abc/view',
      file_id: 'abc',
    };

    const items = [{ vendor: 'Acme', amount: 42 }];

    const config = {
      fields: [
        // Template-form expression (LLM's non-canonical emission). After
        // resolveAllVariables this would be the resolved URL; the test exercises
        // the path BEFORE resolveAllVariables to confirm the tolerance.
        { name: 'drive_link', expression: '{{uploaded_file.web_view_link}}' },
      ],
    };

    const out = transformWithFields(items, config, ctx, noopEvaluator);

    expect(out).toEqual([
      {
        vendor: 'Acme',
        amount: 42,
        drive_link: 'https://drive.google.com/file/d/abc/view',
      },
    ]);
  });

  it('handles the post-resolveAllVariables shape (string already substituted)', () => {
    const ctx = new StubContext();

    const items = [{ vendor: 'Acme', amount: 42 }];

    // Exactly the runtime state that produced the vocabulary-pipeline crash.
    const config = {
      fields: [
        { name: 'drive_link', expression: 'https://drive.google.com/file/d/abc/view' },
      ],
    };

    const out = transformWithFields(items, config, ctx, noopEvaluator);

    expect(out).toEqual([
      {
        vendor: 'Acme',
        amount: 42,
        drive_link: 'https://drive.google.com/file/d/abc/view',
      },
    ]);
  });

  it('mixes string-form and structured-form expressions in one config', () => {
    const ctx = new StubContext();
    ctx.variables.uploaded_file = { web_view_link: 'https://example/abc' };
    ctx.inputs.tag = 'urgent';

    const items = [{ amount: 100 }, { amount: 200 }];

    const config = {
      fields: [
        // structured ref (canonical)
        { name: 'doubled', expression: { kind: 'literal', value: 'X' } },
        // template ref (LLM drift)
        { name: 'link', expression: '{{uploaded_file.web_view_link}}' },
        // template config (LLM drift)
        { name: 'category', expression: '{{input.tag}}' },
      ],
    };

    const out = transformWithFields(items, config, ctx, noopEvaluator);

    expect(out).toEqual([
      { amount: 100, doubled: 'X', link: 'https://example/abc', category: 'urgent' },
      { amount: 200, doubled: 'X', link: 'https://example/abc', category: 'urgent' },
    ]);
  });
});
