/**
 * Re-running a stored plan with one value swapped.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS A TRUST BOUNDARY, SO MOST OF THESE TESTS ARE REFUSALS
 *
 * A tap arrives from a browser. What it may do is re-run a query this server
 * already planned, with ONE catalog-declared value substituted — and nothing
 * else. Everything the request carries is checked against the catalog before
 * anything runs: the step must exist, the field must exist on that entity, the
 * value must be one the column can actually hold, and the result must pass the
 * same validator a freshly planned turn passes.
 *
 * The refusals matter more than the happy path. A swap that slipped a mutate
 * through, or wrote an undeclared value into a filter, would be a client
 * deciding what the server executes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { applyAlternative } from '../render/applyAlternative';
import type { Alternative } from '../render/describePlan';

const cancelledBookings = [
  {
    id: 's1',
    op: 'compute',
    entity: 'bookings',
    agg: { fn: 'count' },
    where: [{ field: 'status', op: 'eq', value: 'cancelled' }],
  },
];

const swapTo = (value: string): Alternative => ({
  label: value,
  stepId: 's1',
  field: 'status',
  value,
  kind: 'enum',
});

const firstWhere = (plan: { steps: unknown[] }) =>
  (plan.steps[0] as { where: Array<{ field: string; value: unknown }> }).where[0];

describe('swapping one enum value', () => {
  it('changes the filter and nothing else', () => {
    const applied = applyAlternative(cancelledBookings, swapTo('no_show'))!;

    expect(firstWhere(applied.plan).value).toBe('no_show');
    expect((applied.plan.steps[0] as { entity: string }).entity).toBe('bookings');
    expect(applied.plan.steps).toHaveLength(1);
  });

  it('drops the sentence, which was written about the old value', () => {
    /*
     * "You have {s1.count} cancelled bookings" over a no-show count is the
     * exact confident-wrong-answer this feature exists to prevent. The
     * renderer's fallback and the understanding line carry the corrected turn.
     */
    const applied = applyAlternative(cancelledBookings, swapTo('no_show'))!;

    expect(applied.plan.answer).toBeUndefined();
  });

  it('adds the filter when the plan had none', () => {
    // The other direction of the same correction: "you counted all of them —
    // did you mean only the cancelled ones?"
    const applied = applyAlternative(
      [{ id: 's1', op: 'compute', entity: 'bookings', agg: { fn: 'count' } }],
      swapTo('cancelled')
    )!;

    expect(firstWhere(applied.plan)).toEqual({
      field: 'status',
      op: 'eq',
      value: 'cancelled',
    });
  });

  it('does not mutate the stored plan when it succeeds', () => {
    // The context is the source of truth for the NEXT tap. A swap that edited
    // it in place would make two corrections compound instead of replace.
    applyAlternative(cancelledBookings, swapTo('no_show'));

    expect(
      (cancelledBookings[0] as { where: Array<{ value: string }> }).where[0].value
    ).toBe('cancelled');
  });
});

describe('swapping the figure', () => {
  it('moves the aggregate to the sibling field the catalog nominated', () => {
    const applied = applyAlternative(
      [{ id: 's1', op: 'compute', entity: 'transactions', agg: { fn: 'sum', field: 'charged_amount' } }],
      { label: 'net', stepId: 's1', field: 'agg.field', value: 'net_amount', kind: 'aggregate_field' }
    )!;

    expect((applied.plan.steps[0] as { agg: { field: string } }).agg.field).toBe('net_amount');
  });

  it('remembers it, because gross-or-net is a standing choice', () => {
    /*
     * The same question gave 56% and 128% on consecutive runs. Asking on every
     * turn would be that ambiguity with extra steps; a status swap establishes
     * nothing of the kind and is deliberately NOT remembered.
     */
    const applied = applyAlternative(
      [{ id: 's1', op: 'compute', entity: 'transactions', agg: { fn: 'sum', field: 'charged_amount' } }],
      { label: 'net', stepId: 's1', field: 'agg.field', value: 'net_amount', kind: 'aggregate_field' }
    )!;

    expect(applied.preference).toEqual({ key: 'transactions.amount', value: 'net_amount' });
    expect(applyAlternative(cancelledBookings, swapTo('no_show'))!.preference).toBeUndefined();
  });
});

describe('what it refuses', () => {
  it('a value the column cannot hold', () => {
    // Would return a confident zero — the bug class this feature is about.
    expect(applyAlternative(cancelledBookings, swapTo('deleted_by_admin'))).toBeNull();
  });

  it('a field that is not on that entity', () => {
    expect(
      applyAlternative(cancelledBookings, {
        label: 'x',
        stepId: 's1',
        field: 'password',
        value: 'x',
        kind: 'enum',
      })
    ).toBeNull();
  });

  it('a step that is not in the stored plan', () => {
    expect(applyAlternative(cancelledBookings, { ...swapTo('no_show'), stepId: 's9' })).toBeNull();
  });

  it('a write, even if one somehow reached the store', () => {
    /*
     * Memory strips mutates on the way in; this is the second lock on the same
     * door. "Re-run this with one value changed" must never be able to mean
     * "delete these instead".
     */
    expect(
      applyAlternative(
        [{ id: 's1', op: 'mutate', entity: 'bookings', action: 'delete', target: { id: 'x' } }],
        swapTo('cancelled')
      )
    ).toBeNull();
  });

  it('an aggregate swap to a field the catalog never nominated', () => {
    // Only a field named in some `aggregateInstead` list is substitutable —
    // never an arbitrary column name arriving in a request body.
    expect(
      applyAlternative(
        [{ id: 's1', op: 'compute', entity: 'transactions', agg: { fn: 'sum', field: 'charged_amount' } }],
        { label: 'x', stepId: 's1', field: 'agg.field', value: 'contact_id', kind: 'aggregate_field' }
      )
    ).toBeNull();
  });

  it('anything at all when there is no stored plan', () => {
    // An expired conversation. The caller plans the turn normally instead.
    expect(applyAlternative(undefined, swapTo('no_show'))).toBeNull();
    expect(applyAlternative([], swapTo('no_show'))).toBeNull();
  });
});
