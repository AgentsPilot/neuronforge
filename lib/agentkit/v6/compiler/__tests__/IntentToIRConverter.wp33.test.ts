/**
 * IntentToIRConverter — WP-33 (compile-time normalization of string-form expressions)
 *
 * The runtime tolerance in `evaluateExpression` (see
 * `lib/pilot/__tests__/StructuredTransforms.wp33.test.ts`) is the
 * defense-in-depth layer. The IR converter normalization is the upstream
 * fix that ensures phase4 stores the canonical structured AST form.
 *
 * This test exercises the private `normalizeExpressionRefs` method via
 * type assertion (not great practice in general, but the alternative — wiring
 * a full BoundIntentContract end-to-end — buys little additional confidence
 * for a single-method change).
 */

import { IntentToIRConverter } from '../IntentToIRConverter';

// Minimal ConversionContext shape the method touches. The string-handling
// branch doesn't dereference any field on ctx, so an empty object suffices.
const ctx: any = {
  nodeCounter: 0,
  nodes: new Map(),
  variableMap: new Map(),
  artifactMetadata: new Map(),
  startNode: null,
  errors: [],
  warnings: [],
};

function callNormalize(expr: any, inputVar: string): any {
  const converter = new IntentToIRConverter();
  return (converter as any).normalizeExpressionRefs(expr, ctx, inputVar);
}

describe('WP-33 — IntentToIRConverter.normalizeExpressionRefs string handling', () => {
  describe('Template string → structured AST', () => {
    it('"{{var.field}}" → {kind: "ref", ref: "var", field: "field"}', () => {
      expect(callNormalize('{{uploaded_file.web_view_link}}', 'some_input_var')).toEqual({
        kind: 'ref',
        ref: 'uploaded_file',
        field: 'web_view_link',
      });
    });

    it('"{{var}}" → {kind: "ref", ref: "var"} (no field)', () => {
      expect(callNormalize('{{uploaded_file}}', 'some_input_var')).toEqual({
        kind: 'ref',
        ref: 'uploaded_file',
      });
    });

    it('"{{input.K}}" → {kind: "config", key: "K"}', () => {
      expect(callNormalize('{{input.amount_threshold}}', 'irrelevant')).toEqual({
        kind: 'config',
        key: 'amount_threshold',
      });
    });

    it('rewrites ref === inputVar → "item" (per-iteration normalization)', () => {
      // Matches the canonical with_fields convention where `inputVar` is the
      // outer iteration source. `{{matching_rows.amount}}` should become
      // `{kind: "ref", ref: "item", field: "amount"}` when inputVar is "matching_rows".
      expect(callNormalize('{{matching_rows.amount}}', 'matching_rows')).toEqual({
        kind: 'ref',
        ref: 'item',
        field: 'amount',
      });
    });

    it('leaves ref !== inputVar untouched (cross-slot reference)', () => {
      // Different slot — resolved at runtime via context.
      expect(callNormalize('{{other_slot.field}}', 'matching_rows')).toEqual({
        kind: 'ref',
        ref: 'other_slot',
        field: 'field',
      });
    });

    it('supports dotted field paths', () => {
      expect(callNormalize('{{producer.meta.id}}', 'irrelevant')).toEqual({
        kind: 'ref',
        ref: 'producer',
        field: 'meta.id',
      });
    });
  });

  describe('Plain string → literal', () => {
    it('non-template string → {kind: "literal", value: <string>}', () => {
      expect(callNormalize('https://example.com/abc', 'irrelevant')).toEqual({
        kind: 'literal',
        value: 'https://example.com/abc',
      });
    });

    it('empty string → literal empty string', () => {
      expect(callNormalize('', 'irrelevant')).toEqual({ kind: 'literal', value: '' });
    });

    it('partial template (malformed) → literal', () => {
      expect(callNormalize('{{ not closed', 'irrelevant')).toEqual({
        kind: 'literal',
        value: '{{ not closed',
      });
    });
  });

  describe('Regression — structured AST inputs pass through unchanged', () => {
    it('{kind: "literal", value: "X"} → unchanged', () => {
      expect(callNormalize({ kind: 'literal', value: 'X' }, 'irrelevant')).toEqual({
        kind: 'literal',
        value: 'X',
      });
    });

    it('{kind: "ref", ref: "<inputVar>", field: "F"} → rewritten to ref: "item"', () => {
      // This is the pre-WP-33 behavior — preserved unchanged.
      expect(callNormalize({ kind: 'ref', ref: 'rows', field: 'amount' }, 'rows')).toEqual({
        kind: 'ref',
        ref: 'item',
        field: 'amount',
      });
    });

    it('{kind: "ref", ref: "<other>", field: "F"} → unchanged', () => {
      expect(callNormalize({ kind: 'ref', ref: 'other', field: 'F' }, 'rows')).toEqual({
        kind: 'ref',
        ref: 'other',
        field: 'F',
      });
    });
  });
});
