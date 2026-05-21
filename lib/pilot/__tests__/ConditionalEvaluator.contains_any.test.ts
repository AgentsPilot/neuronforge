/**
 * ConditionalEvaluator — `contains_any` operator (W2 / WP-16 task 0.8 item 4)
 *
 * The `contains_any` operator was added in W2 to replace verbose OR-of-contains
 * trees for the keyword-filter pattern (e.g., "subject contains any of
 * [complaint, refund, angry, not working]"). Tests cover:
 *
 *   - String left + array right (substring match against any keyword)
 *   - Array left + array right (element matches any keyword)
 *   - Case-insensitivity (matches existing `contains` behavior)
 *   - Null-handling (null/undefined left → false)
 *   - Type validation (right MUST be array; throws otherwise)
 */

import { ConditionalEvaluator } from '../ConditionalEvaluator';
import type { ExecutionContext } from '../ExecutionContext';

// Minimal ExecutionContext stub — ConditionalEvaluator only calls resolveVariable.
class StubContext {
  variables: Record<string, any> = {};

  setVariable(name: string, value: any): void {
    this.variables[name] = value;
  }

  resolveVariable(reference: any): any {
    if (typeof reference !== 'string') return undefined;
    const path = reference.replace(/^\{\{/, '').replace(/\}\}$/, '');
    const parts = path.split('.');
    let current: any = this.variables;
    for (const p of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = current[p];
    }
    return current;
  }
}

function makeCtx(vars: Record<string, any> = {}): ExecutionContext {
  const ctx = new StubContext();
  ctx.variables = { ...vars };
  return ctx as unknown as ExecutionContext;
}

describe('ConditionalEvaluator.contains_any', () => {
  let evaluator: ConditionalEvaluator;

  beforeEach(() => {
    evaluator = new ConditionalEvaluator();
  });

  // The `evaluate()` API takes a Condition object. The simplest path through
  // ConditionalEvaluator's internals is via `evaluateSimpleCondition` — it
  // does field resolution + then calls `compareValues(left, right, operator)`.
  // We test through the public `evaluate()` API.

  describe('string left, array right (keyword filter pattern)', () => {
    it('returns true when string contains any of the keywords', () => {
      const ctx = makeCtx({ item: { subject: 'I want a refund please' } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.subject',
        operator: 'contains_any',
        value: ['complaint', 'refund', 'angry', 'not working'],
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(true);
    });

    it('returns true when string contains the FIRST keyword', () => {
      const ctx = makeCtx({ item: { subject: 'I have a complaint' } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.subject',
        operator: 'contains_any',
        value: ['complaint', 'refund'],
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(true);
    });

    it('returns false when string contains none of the keywords', () => {
      const ctx = makeCtx({ item: { subject: 'Hello, just checking in' } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.subject',
        operator: 'contains_any',
        value: ['complaint', 'refund', 'angry'],
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(false);
    });

    it('is case-insensitive (matches uppercase keyword in mixed-case text)', () => {
      const ctx = makeCtx({ item: { subject: 'My ANGRY review' } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.subject',
        operator: 'contains_any',
        value: ['angry', 'refund'],
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(true);
    });

    it('is case-insensitive (matches lowercase value in uppercase text)', () => {
      const ctx = makeCtx({ item: { subject: 'COMPLAINT received' } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.subject',
        operator: 'contains_any',
        value: ['complaint'],
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(true);
    });

    it('handles multi-word keywords as substring match', () => {
      const ctx = makeCtx({ item: { subject: 'It is not working at all' } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.subject',
        operator: 'contains_any',
        value: ['not working', 'broken'],
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(true);
    });
  });

  describe('array left, array right', () => {
    it('returns true when any array element matches any keyword', () => {
      const ctx = makeCtx({ item: { tags: ['urgent', 'review'] } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.tags',
        operator: 'contains_any',
        value: ['priority', 'urgent', 'critical'],
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(true);
    });

    it('returns false when no array element matches any keyword', () => {
      const ctx = makeCtx({ item: { tags: ['hello', 'world'] } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.tags',
        operator: 'contains_any',
        value: ['priority', 'urgent'],
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(false);
    });

    it('matches array elements case-insensitively', () => {
      const ctx = makeCtx({ item: { tags: ['URGENT'] } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.tags',
        operator: 'contains_any',
        value: ['urgent'],
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(true);
    });
  });

  describe('null/empty handling', () => {
    it('returns false for null left value', () => {
      const ctx = makeCtx({ item: { subject: null } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.subject',
        operator: 'contains_any',
        value: ['anything'],
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(false);
    });

    it('returns false for undefined (missing) left value', () => {
      const ctx = makeCtx({ item: {} });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.subject',
        operator: 'contains_any',
        value: ['anything'],
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(false);
    });

    it('returns false for empty right array (nothing to match against)', () => {
      const ctx = makeCtx({ item: { subject: 'anything goes here' } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.subject',
        operator: 'contains_any',
        value: [],
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(false);
    });
  });

  describe('error handling', () => {
    it('comma-separated string RHS is now accepted (WP-21 was: threw)', () => {
      // BEFORE WP-21: a string RHS hard-threw. After WP-21, the runtime
      // splits on comma + trims, so this evaluates as if RHS were
      // ['not-an-array']. "not-an-array" doesn't match "hello" → false.
      const ctx = makeCtx({ item: { subject: 'hello' } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.subject',
        operator: 'contains_any',
        value: 'not-an-array',
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(false);
    });

    it('throws when right side is neither array nor string (number)', () => {
      const ctx = makeCtx({ item: { subject: 'hello' } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.subject',
        operator: 'contains_any',
        value: 42,
      };
      expect(() => evaluator.evaluate(condition, ctx))
        .toThrow(/contains_any requires an array or comma-separated string/);
    });
  });

  // WP-21: runtime tolerance for comma-separated string RHS
  describe('WP-21 — comma-separated string RHS tolerance', () => {
    it('canonical complaint-email-logger pattern: matches keyword in body', () => {
      // The exact failure mode from Phase D rerun on complaint-email-logger.
      // workflow_config emits "complaint, refund, angry, not working" — a
      // single string. Before WP-21 this threw; after WP-21 it splits on
      // comma + trims and behaves like the array form.
      const ctx = makeCtx({
        item: { body: 'I have a complaint about my recent order' },
      });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.body',
        operator: 'contains_any',
        value: 'complaint, refund, angry, not working',
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(true);
    });

    it('whitespace around commas is trimmed', () => {
      const ctx = makeCtx({ item: { body: 'we need a refund please' } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.body',
        operator: 'contains_any',
        value: 'complaint  ,    refund  ,angry,    not working',
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(true);
    });

    it('case-insensitive after splitting (consistent with array RHS)', () => {
      const ctx = makeCtx({ item: { body: 'I am ANGRY about this' } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.body',
        operator: 'contains_any',
        value: 'complaint, refund, angry',
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(true);
    });

    it('no match → false (mirrors array behavior)', () => {
      const ctx = makeCtx({ item: { body: 'just a friendly hello' } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.body',
        operator: 'contains_any',
        value: 'complaint, refund, angry',
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(false);
    });

    it('empty string RHS → no match (no keywords to test)', () => {
      const ctx = makeCtx({ item: { body: 'anything' } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.body',
        operator: 'contains_any',
        value: '',
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(false);
    });

    it('single-value string RHS (no commas) → treated as 1-element array', () => {
      const ctx = makeCtx({ item: { body: 'this is a complaint' } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.body',
        operator: 'contains_any',
        value: 'complaint',
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(true);
    });

    it('array RHS still works (regression guard for WP-21)', () => {
      const ctx = makeCtx({ item: { body: 'I want a refund' } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.body',
        operator: 'contains_any',
        value: ['complaint', 'refund', 'angry'],
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(true);
    });
  });

  // WP-21 also extends `in` and `not_in` operators with the same tolerance
  describe('WP-21 — `in` / `not_in` accept comma-separated string RHS', () => {
    it('`in` matches when value is in comma-separated list', () => {
      const ctx = makeCtx({ item: { stage: '4' } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.stage',
        operator: 'in',
        value: '1, 2, 3, 4',
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(true);
    });

    it('`in` returns false when value is not in list', () => {
      const ctx = makeCtx({ item: { stage: '7' } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.stage',
        operator: 'in',
        value: '1, 2, 3, 4',
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(false);
    });

    it('`not_in` returns true when value is not in list', () => {
      const ctx = makeCtx({ item: { stage: '7' } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.stage',
        operator: 'not_in',
        value: '1, 2, 3, 4',
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(true);
    });

    it('`in` still works with array RHS (regression guard)', () => {
      const ctx = makeCtx({ item: { stage: '4' } });
      const condition: any = {
        conditionType: 'simple',
        field: 'item.stage',
        operator: 'in',
        value: ['1', '2', '3', '4'],
      };
      expect(evaluator.evaluate(condition, ctx)).toBe(true);
    });
  });
});
