/**
 * A plan that reads two things has to say how they relate.
 *
 * The renderer falls back to labelling the primary step when there is no answer
 * sentence. For one read that is a fine answer — "invoices: 3" answers "how
 * many invoices". Across two it silently drops the question:
 *
 *   "כמה אחוז זה מההכנסות"  ->  compute refunds, compute revenue, no sentence
 *   rendered as:            ->  "סכום שחויב: 931.33 $"
 *
 * Both numbers were computed correctly. The user was shown one of them, under a
 * label for something they had not asked about, with no percentage anywhere —
 * a confident non-answer, which is worse than an error.
 *
 * `{sN.percent_of.sM}` already existed; nothing was forcing the planner to use
 * it, or to write any sentence at all.
 */

import { validatePlan } from '../planner/validatePlan';
import type { Plan } from '../planner/Planner';

const compute = (id: string, entity: string): unknown => ({
  id,
  op: 'compute',
  entity,
  agg: { fn: 'sum', field: 'amount' },
});

const planOf = (steps: unknown[], text?: string): Plan =>
  ({ steps, ...(text ? { answer: { text } } : {}) }) as Plan;

const complaint = (plan: Plan) =>
  validatePlan(plan, 'x').find((p) => p.includes('answer.text is required'));

describe('a two-step read', () => {
  it('is rejected when it says nothing about the relationship', () => {
    expect(complaint(planOf([compute('s1', 'refunds'), compute('s2', 'transactions')]))).toMatch(
      /reads 2 things/
    );
  });

  it('names the fix, so the repair round can act on it', () => {
    // A repair only helps if the message says what to do. This one carries the
    // exact shape of a working sentence.
    expect(complaint(planOf([compute('s1', 'refunds'), compute('s2', 'transactions')]))).toMatch(
      /percent_of/
    );
  });

  it('is accepted once it cites both steps', () => {
    expect(
      complaint(
        planOf(
          [compute('s1', 'refunds'), compute('s2', 'transactions')],
          '{s1.value} of {s2.value}, which is {s1.percent_of.s2}'
        )
      )
    ).toBeUndefined();
  });
});

describe('what the rule deliberately leaves alone', () => {
  it('a single read still needs no sentence — the fallback answers it', () => {
    expect(complaint(planOf([compute('s1', 'refunds')]))).toBeUndefined();
  });

  it('a write needs no sentence — the confirmation card describes it', () => {
    /*
     * Exempt on purpose. A mutate renders its own preview naming the row and
     * every field, so demanding prose for "mark it paid" would reject a plan
     * that was going to explain itself perfectly well.
     */
    const write = planOf([
      { id: 's1', op: 'mutate', entity: 'tasks', action: 'update', target: { id: 'x' }, data: {} },
      { id: 's2', op: 'mutate', entity: 'tasks', action: 'update', target: { id: 'y' }, data: {} },
    ]);

    expect(complaint(write)).toBeUndefined();
  });
});
