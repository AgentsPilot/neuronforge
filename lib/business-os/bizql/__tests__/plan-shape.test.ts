/**
 * Plan shape robustness — a malformed plan must be a REPAIR, never a crash.
 *
 * The planner emitted `"order_by": {"field":"amount","dir":"desc"}` — a lone
 * object where the schema declares an array. Validation iterated it, Node threw
 * `object is not iterable`, and the exception escaped the request as a 500. The
 * user would get a server error for a plan one pair of brackets away from
 * correct, and the golden-set run it happened in ABORTED, losing every result
 * after that point.
 *
 * Two independent defences, because either alone leaves a hole: normalizePlan
 * wraps the stray object (one unambiguous reading, so it belongs beside the
 * operator aliases), and validation iterates defensively so a caller that skips
 * normalisation — a cached plan, a direct API client — still gets a problem list
 * rather than an exception.
 */

import { normalizePlan, validatePlan } from '@/lib/business-os/bizql/planner/validatePlan';

describe('malformed array shapes never crash validation', () => {
  it('wraps a lone object where an array is expected', () => {
    const plan: any = {
      steps: [{ id: 's1', op: 'find', entity: 'invoices', order_by: { field: 'amount', dir: 'desc' } }],
    };
    normalizePlan(plan);
    expect(plan.steps[0].order_by).toEqual([{ field: 'amount', dir: 'desc' }]);
    expect(() => validatePlan(plan)).not.toThrow();
  });

  it('validates rather than throwing when normalization was skipped', () => {
    // The crash the eval hit: `object is not iterable` escaped as a 500.
    const plan: any = {
      steps: [{ id: 's1', op: 'find', entity: 'invoices', order_by: { field: 'nope', dir: 'desc' } }],
    };
    expect(() => validatePlan(plan)).not.toThrow();
    expect(validatePlan(plan).some((p: string) => /nope/.test(p))).toBe(true);
  });

  it('handles a lone where predicate and a lone select', () => {
    const plan: any = {
      steps: [{ id: 's1', op: 'find', entity: 'invoices', where: { field: 'amount', op: 'gt', value: 100 }, select: 'amount' }],
    };
    normalizePlan(plan);
    expect(() => validatePlan(plan)).not.toThrow();
    expect(validatePlan(plan)).toEqual([]);
  });
});

describe('a plan that lists everything is not an answer', () => {
  const unfiltered = (entities: string[]) =>
    ({
      steps: entities.map((entity, i) => ({ id: `s${i + 1}`, op: 'find', entity, where: [] })),
    }) as never;

  it('rejects three or more unfiltered reads across different entities', () => {
    // "update it" — a sentence with no subject — produced find contacts, find
    // invoices, find bookings, find tasks, all unfiltered. Read-only, so nothing
    // is damaged, but it answers nothing and fetches the user's whole business.
    const problems = validatePlan(unfiltered(['contacts', 'invoices', 'bookings']));
    expect(problems.some((p: string) => /entire tables/.test(p))).toBe(true);
    // The message must point at the alternative, or the repair pass repeats it.
    expect(problems.some((p: string) => /clarification/.test(p))).toBe(true);
  });

  it('leaves two unfiltered reads alone', () => {
    // "show me my contacts and my invoices" is a real request. A guard that
    // blocks real requests gets removed, which protects nothing.
    expect(
      validatePlan(unfiltered(['contacts', 'invoices'])).some((p: string) =>
        /entire tables/.test(p)
      )
    ).toBe(false);
  });

  it('does not count reads that carry a filter', () => {
    const filtered = {
      steps: ['contacts', 'invoices', 'bookings'].map((entity, i) => ({
        id: `s${i + 1}`,
        op: 'find',
        entity,
        where: [{ field: 'id', op: 'is_not_null' }],
      })),
    } as never;

    expect(
      validatePlan(filtered).some((p: string) => /entire tables/.test(p))
    ).toBe(false);
  });
});
