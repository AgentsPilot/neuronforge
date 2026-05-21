/**
 * ConditionalEvaluator — Type Coercion Tests
 *
 * Phase 6, Tier 2 Fix #2.
 * See workplan: docs/workplans/conditional-type-coercion.md
 *
 * Verifies the conditional coercion flag toggles the right behavior:
 *   • OFF (default) → legacy JS comparison (lexical string compare for strings)
 *   • ON           → numeric / date-like strings coerced before `>`, `>=`, `<`, `<=`
 *
 * Equality (`==`, `!=`) and all other operators are unaffected.
 */

import { ConditionalEvaluator } from '../ConditionalEvaluator';
import { ExecutionContext } from '../ExecutionContext';
import type { Agent, SimpleCondition } from '../types';

const makeAgent = (): Agent => ({
  id: 'agent-test',
  user_id: 'user-test',
  agent_name: 'cond-test-agent',
  user_prompt: 'test',
  plugins_required: [],
});

function makeContext(conditionalCoercionEnabled: boolean): ExecutionContext {
  return new ExecutionContext(
    'exec-test',
    makeAgent(),
    'user-test',
    'session-test',
    {},
    false, // batchCalibrationMode
    false, // strict
    false, // loopInnerOverwriteDisabled
    conditionalCoercionEnabled,
  );
}

/**
 * Build a simple condition that compares a literal-field-resolved value to a literal value.
 * To avoid going through `context.resolveVariable`, we set the value as a context
 * variable and reference it as `{{varname}}` which is the field.
 */
function compareLiteral(
  evaluator: ConditionalEvaluator,
  ctx: ExecutionContext,
  left: any,
  operator: SimpleCondition['operator'],
  right: any,
): boolean {
  ctx.setVariable('__lhs', left);
  const cond: SimpleCondition = {
    conditionType: 'simple',
    field: '__lhs',
    operator,
    value: right,
  };
  return evaluator.evaluate(cond, ctx);
}

describe('ConditionalEvaluator — type coercion (Phase 6 Tier 2 Fix #2)', () => {
  let evaluator: ConditionalEvaluator;
  beforeEach(() => {
    evaluator = new ConditionalEvaluator();
  });

  describe('numeric coercion for ordering operators', () => {
    // C1 — the canonical bug case
    it('C1: "100" > 90 returns true when coerce is ON', () => {
      const ctx = makeContext(true);
      expect(compareLiteral(evaluator, ctx, '100', '>', 90)).toBe(true);
    });

    // C2 — string vs string is where the real legacy bug lives.
    // (JS auto-coerces string vs number for ordering, so "100" > 90 is already
    // correct today. The bug only shows when both sides are strings.)
    it('C2: "100" > "90" returns false when coerce is OFF (legacy lexical bug)', () => {
      const ctx = makeContext(false);
      // Legacy lexical: "1" < "9" → "100" < "90" → false
      expect(compareLiteral(evaluator, ctx, '100', '>', '90')).toBe(false);
    });

    // C2b — same case, coerce ON → correct numeric answer
    it('C2b: "100" > "90" returns true when coerce is ON (fix in action)', () => {
      const ctx = makeContext(true);
      expect(compareLiteral(evaluator, ctx, '100', '>', '90')).toBe(true);
    });

    // C3 — string vs string, both numeric — coerce ON gives correct answer
    it('C3: "9" > "10" returns false when coerce is ON (numeric)', () => {
      const ctx = makeContext(true);
      expect(compareLiteral(evaluator, ctx, '9', '>', '10')).toBe(false);
    });

    // C4 — same, coerce OFF gives legacy lexical answer
    it('C4: "9" > "10" returns true when coerce is OFF (legacy lexical)', () => {
      const ctx = makeContext(false);
      expect(compareLiteral(evaluator, ctx, '9', '>', '10')).toBe(true);
    });

    // C5
    it('C5: "95" >= 100 returns false when coerce is ON', () => {
      const ctx = makeContext(true);
      expect(compareLiteral(evaluator, ctx, '95', '>=', 100)).toBe(false);
    });

    // C6 — fractional numeric strings
    it('C6: "95.5" > "95.4" returns true when coerce is ON', () => {
      const ctx = makeContext(true);
      expect(compareLiteral(evaluator, ctx, '95.5', '>', '95.4')).toBe(true);
    });

    // C7 — negative numeric strings
    it('C7: "-5" < "-10" returns false when coerce is ON (numeric: -5 > -10)', () => {
      const ctx = makeContext(true);
      expect(compareLiteral(evaluator, ctx, '-5', '<', '-10')).toBe(false);
    });

    // C8 — mixed: number on one side, numeric string on the other
    it('C8: 100 > "90" returns true when coerce is ON', () => {
      const ctx = makeContext(true);
      expect(compareLiteral(evaluator, ctx, 100, '>', '90')).toBe(true);
    });
  });

  describe('non-numeric strings — no coercion', () => {
    it('C9: "foo" > "bar" uses lexical comparison regardless of flag', () => {
      const ctxOn = makeContext(true);
      const ctxOff = makeContext(false);
      // "f" > "b" lexically
      expect(compareLiteral(evaluator, ctxOn, 'foo', '>', 'bar')).toBe(true);
      expect(compareLiteral(evaluator, ctxOff, 'foo', '>', 'bar')).toBe(true);
    });

    it('C10: "95abc" is NOT coerced (not a clean numeric string)', () => {
      const ctxOn = makeContext(true);
      // Coercion declines → falls back to lexical "95abc" > "90".
      // "9" === "9", then "5" > "0" lexically → true (matches legacy behavior).
      expect(compareLiteral(evaluator, ctxOn, '95abc', '>', '90')).toBe(true);
    });
  });

  describe('date coercion for ordering operators', () => {
    it('C11: "2026-05-12" > "2026-04-01" returns true when coerce is ON', () => {
      const ctx = makeContext(true);
      expect(compareLiteral(evaluator, ctx, '2026-05-12', '>', '2026-04-01')).toBe(true);
    });

    it('C12: Date object compared to ISO string when coerce is ON', () => {
      const ctx = makeContext(true);
      const may12 = new Date('2026-05-12T00:00:00Z');
      expect(compareLiteral(evaluator, ctx, may12, '>', '2026-04-01')).toBe(true);
    });

    // Critical: bare numeric strings must NOT be misinterpreted as dates.
    it('C13: bare "95" is NEVER coerced to a date (Date footgun avoided)', () => {
      const ctx = makeContext(true);
      // If "95" were parsed as a date (1995-01-01), the result would differ from numeric.
      // Numeric path runs first: 95 < 100 → true.
      expect(compareLiteral(evaluator, ctx, '95', '<', 100)).toBe(true);
    });
  });

  describe('equality operators unaffected by coerce flag', () => {
    it('C14: "95" == 95 is true regardless of flag (JS loose equality)', () => {
      const ctxOn = makeContext(true);
      const ctxOff = makeContext(false);
      expect(compareLiteral(evaluator, ctxOn, '95', '==', 95)).toBe(true);
      expect(compareLiteral(evaluator, ctxOff, '95', '==', 95)).toBe(true);
    });

    it('C15: "95" != 95 is false regardless of flag', () => {
      const ctxOn = makeContext(true);
      const ctxOff = makeContext(false);
      expect(compareLiteral(evaluator, ctxOn, '95', '!=', 95)).toBe(false);
      expect(compareLiteral(evaluator, ctxOff, '95', '!=', 95)).toBe(false);
    });
  });

  describe('other operators unaffected', () => {
    it('C16: "contains" still does substring match', () => {
      const ctx = makeContext(true);
      expect(compareLiteral(evaluator, ctx, 'hello world', 'contains', 'world')).toBe(true);
    });

    it('C17: "exists" still works on truthy/falsy', () => {
      const ctx = makeContext(true);
      expect(compareLiteral(evaluator, ctx, 'anything', 'exists', null)).toBe(true);
    });
  });
});
