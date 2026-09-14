/**
 * Removing a wrong option beats describing the right one better.
 *
 * `business_profile` is one row of configuration — a company name and a
 * vertical — with everything worth knowing exposed as actions. But it was a
 * findable entity like any other, so "how many hours are still open on
 * Wednesday?" reliably compiled to `find business_profile`: two useless columns,
 * returned confidently, reading like an answer.
 *
 * Three rounds of making the action's label more inviting moved the hit rate
 * around (0/3 to 1/3 to 2/3) and never fixed it. A plausible wrong option that
 * stays available eventually gets picked. Marking the entity non-queryable took
 * the same four questions to 12/12.
 */

import { validatePlan } from '../planner/validatePlan';
import { CATALOG } from '../../catalog';
import type { Plan } from '../planner/Planner';

const planOf = (steps: unknown[]): Plan => ({ steps }) as Plan;

const problemFor = (plan: Plan) =>
  validatePlan(plan, 'x').find((p) => p.includes('cannot be read'));

describe('an entity marked not queryable', () => {
  it('is declared that way in the catalog, not hardcoded here', () => {
    // The rule is generic; the catalog decides who it applies to.
    expect(CATALOG.entities.business_profile.queryable).toBe(false);
  });

  it('rejects a find', () => {
    expect(problemFor(planOf([{ id: 's1', op: 'find', entity: 'business_profile' }]))).toMatch(
      /one row of configuration/
    );
  });

  it('rejects a compute', () => {
    expect(
      problemFor(
        planOf([
          { id: 's1', op: 'compute', entity: 'business_profile', agg: { fn: 'count' } },
        ])
      )
    ).toBeDefined();
  });

  it('names the actions, so the repair round has something to act on', () => {
    // "No" is unactionable. "Use one of these" is a fix.
    const problem = problemFor(planOf([{ id: 's1', op: 'find', entity: 'business_profile' }]));

    expect(problem).toContain('open_time');
    expect(problem).toContain('"op":"mutate"');
  });

  it('still allows its actions', () => {
    const action = planOf([
      {
        id: 's1',
        op: 'mutate',
        entity: 'business_profile',
        action: 'open_time',
        data: { date: '2026-09-09' },
      },
    ]);

    expect(problemFor(action)).toBeUndefined();
  });
});

describe('every other entity', () => {
  it('is still readable — the flag is opt-in, not a new default', () => {
    /*
     * The failure mode worth guarding: a flag that reads as false when absent
     * would silently make the whole catalog unqueryable.
     */
    expect(problemFor(planOf([{ id: 's1', op: 'find', entity: 'contacts' }]))).toBeUndefined();
    expect(problemFor(planOf([{ id: 's1', op: 'find', entity: 'bookings' }]))).toBeUndefined();

    const queryable = Object.values(CATALOG.entities).filter((e) => e.queryable !== false);
    expect(queryable.length).toBe(Object.keys(CATALOG.entities).length - 1);
  });
});
