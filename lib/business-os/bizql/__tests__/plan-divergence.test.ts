/**
 * One question, one legal plan.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THESE PLANS ARE REAL
 *
 * All three were produced in production for three phrasings of the same
 * question — "how many proposals have I sent?" — and all three are sitting in
 * `business_chat_plan_cache`. One is right; one silently lost its predicate and
 * answers "how many proposals exist"; one counts the page instead of the rows.
 *
 * They were indistinguishable on the account they ran against, because every
 * proposal there happened to have been sent, so all three returned the same
 * number. The divergence only becomes visible once a proposal is drafted and
 * not sent — which is to say, it was shipped invisible.
 *
 * The prompt already carries a rule against this, in plain English, on every
 * turn: "a QUANTITY -> op compute with agg. A LIST -> op find." Prose did not
 * bind. These tests guard the grammar that does.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { validatePlan } from '../planner/validatePlan';
import type { Plan } from '../planner/Planner';

const ENTITY = 'proposals';

function plan(steps: unknown[], text: string): Plan {
  return { steps, answer: { text } } as unknown as Plan;
}

const countAll = (id: string) => ({
  id, op: 'compute', entity: ENTITY, agg: { fn: 'count', field: 'id' },
});

const countSent = (id: string) => ({
  id, op: 'compute', entity: ENTITY, agg: { fn: 'count', field: 'id' },
  where: [{ op: 'eq', field: 'was_sent', value: true }],
});

describe('the three plans one question produced', () => {
  it('accepts the correct one: a figure and what it is out of', () => {
    const problems = validatePlan(
      plan([countAll('s1'), countSent('s2')], 'שלחת {s2.value} מתוך {s1.value}')
    );
    expect(problems).toEqual([]);
  });

  it('rejects the one that lost its predicate', () => {
    // count(*) + count(*) — the `was_sent` filter is simply gone, so the
    // sentence reads as a comparison while both halves are the same number.
    const problems = validatePlan(
      plan([countAll('s1'), countAll('s2')], 'שלחת {s2.value} מתוך {s1.value}')
    );

    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' ')).toMatch(/identical|already asked/i);
  });
});

describe('the rule is about plan shape, not about this question', () => {
  /*
   * The point of moving a constraint out of prose is that it stops being
   * advice about proposals in Hebrew and becomes a fact about plans.
   */
  it('rejects duplicate finds on any entity', () => {
    const find = (id: string) => ({ id, op: 'find', entity: 'contacts' });
    const problems = validatePlan(plan([find('s1'), find('s2')], '{s1.rows}'));
    expect(problems.join(' ')).toMatch(/identical|already asked/i);
  });

  it('does not care what the steps are called', () => {
    const problems = validatePlan(
      plan([countAll('first'), countAll('second')], '{first.value}')
    );
    expect(problems.join(' ')).toMatch(/identical|already asked/i);
  });

  it('leaves a genuinely different predicate alone', () => {
    const other = {
      id: 's2', op: 'compute', entity: ENTITY, agg: { fn: 'count', field: 'id' },
      where: [{ op: 'eq', field: 'status', value: 'accepted' }],
    };
    expect(validatePlan(plan([countSent('s1'), other], '{s1.value} · {s2.value}'))).toEqual([]);
  });

  it('leaves a different aggregate over the same rows alone', () => {
    const sum = {
      id: 's2', op: 'compute', entity: ENTITY, agg: { fn: 'sum', field: 'total' },
      where: [{ op: 'eq', field: 'was_sent', value: true }],
    };
    expect(validatePlan(plan([countSent('s1'), sum], '{s1.value} · {s2.value}'))).toEqual([]);
  });

  it('leaves a single step alone', () => {
    expect(validatePlan(plan([countSent('s1')], '{s1.value}'))).toEqual([]);
  });
});
