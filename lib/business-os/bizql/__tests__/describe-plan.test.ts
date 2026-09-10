/**
 * The sentence that says what the query actually did.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THESE TESTS ARE FOR
 *
 * This line is shown to a user as a claim about what ran, so the one thing it
 * must never do is describe something other than the plan. A wrong description
 * is worse than none: it would tell a reader their question was understood when
 * it wasn't, which is the exact failure the feature exists to catch.
 *
 * So the tests below check three things — that it names the real entity, the
 * real filter and the real figure; that it uses the reader's language and the
 * BUSINESS's own words rather than raw database tokens; and that the one-tap
 * alternatives it offers are values that actually exist in the catalog.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describePlan } from '../render/describePlan';
import type { Query } from '../types';

const countCancelledBookings = [
  {
    id: 's1',
    op: 'compute',
    entity: 'bookings',
    agg: { fn: 'count' },
    where: [{ field: 'status', op: 'eq', value: 'cancelled' }],
  },
] as unknown as Query[];

describe('describing a read', () => {
  it('names the entity, the filter and what was done to it', () => {
    const understood = describePlan(countCancelledBookings)!;

    expect(understood.text).toContain('count');
    expect(understood.text).toContain('bookings');
    expect(understood.text).toContain('cancelled');
  });

  it('says it in the reader language', () => {
    const understood = describePlan(countCancelledBookings, { language: 'he' })!;

    expect(understood.text).toContain('כך הבנתי');
    expect(understood.text).toContain('פגישות');
    // And not the raw token the database stores.
    expect(understood.text).not.toContain('bookings');
  });

  it('says a date anchor the way a person says it', () => {
    /*
     * "start_of_month" is not something anyone reads. The whole value of the
     * line is that a person can check it at a glance.
     */
    const understood = describePlan(
      [
        {
          id: 's1',
          op: 'compute',
          entity: 'bookings',
          agg: { fn: 'count' },
          where: [{ field: 'start_time', op: 'gte', value: { $date: 'start_of_month' } }],
        },
      ] as unknown as Query[],
      { language: 'en' }
    )!;

    expect(understood.text).toContain('the start of this month');
    expect(understood.text).not.toContain('start_of_month');
  });

  it('names the figure for an aggregate, not just the entity', () => {
    // "total 931.33" answers nothing; "total amount of payments" is checkable.
    const understood = describePlan([
      {
        id: 's1',
        op: 'compute',
        entity: 'transactions',
        agg: { fn: 'sum', field: 'net_amount' },
      },
    ] as unknown as Query[])!;

    expect(understood.text).toContain('total');
    expect(understood.text.toLowerCase()).toContain('net');
  });

  it("prefers the business's own word for a value", () => {
    /*
     * A studio that renamed its services sees ITS names. Keyed by source table
     * and column, the way loadUserEnumLabels keys them — getting that wrong
     * would silently fall back to a uuid.
     */
    const understood = describePlan(
      [
        {
          id: 's1',
          op: 'compute',
          entity: 'contacts',
          agg: { fn: 'count' },
          where: [{ field: 'stage', op: 'eq', value: 'family_enrolled' }],
        },
      ] as unknown as Query[],
      { enumLabels: { 'crm_pipeline_stages.stage_key': { family_enrolled: 'Enrolled family' } } }
    )!;

    expect(understood.text).toContain('Enrolled family');
    expect(understood.text).not.toContain('family_enrolled');
  });

  it('describes each step of a two-step plan', () => {
    const understood = describePlan([
      { id: 's1', op: 'compute', entity: 'refunds', agg: { fn: 'sum', field: 'amount' } },
      { id: 's2', op: 'compute', entity: 'transactions', agg: { fn: 'sum', field: 'net_amount' } },
    ] as unknown as Query[])!;

    expect(understood.text).toContain('refunds');
    expect(understood.text).toContain('payments');
  });

  it('says nothing about a write — the confirmation card already does', () => {
    const understood = describePlan([
      { id: 's1', op: 'mutate', entity: 'tasks', action: 'create', data: { title: 'x' } },
    ] as unknown as Query[]);

    expect(understood).toBeNull();
  });
});

describe('the alternatives it offers', () => {
  it('offers the sibling statuses of the one that was filtered on', () => {
    const { alternatives } = describePlan(countCancelledBookings)!;

    expect(alternatives.length).toBeGreaterThan(0);
    expect(alternatives.every((a) => a.field === 'status')).toBe(true);
    expect(alternatives.some((a) => a.value === 'cancelled')).toBe(false);
  });

  it('only ever offers values the catalog declares', () => {
    // A chip re-runs a query. Offering a value the column cannot hold would
    // produce a confident zero, which is the bug class this whole feature is
    // about.
    const { alternatives } = describePlan(countCancelledBookings)!;
    const declared = ['confirmed', 'cancelled', 'completed', 'no_show', 'pending', 'rescheduled'];

    for (const alternative of alternatives) {
      expect(declared).toContain(alternative.value);
    }
  });

  it('offers the other figure when gross and net both exist', () => {
    /*
     * B2. `transactions.amount` declares aggregateInstead: two runs of one
     * question gave 56% and 128% because nothing pinned which total was meant.
     * The plan must now name one; this offers the other.
     */
    const { alternatives } = describePlan([
      {
        id: 's1',
        op: 'compute',
        entity: 'transactions',
        agg: { fn: 'sum', field: 'charged_amount' },
      },
    ] as unknown as Query[])!;

    const swap = alternatives.find((a) => a.kind === 'aggregate_field');

    expect(swap?.value).toBe('net_amount');
    expect(swap?.stepId).toBe('s1');
  });

  it('offers nothing when there is nothing to correct', () => {
    // A plain list of contacts has no enum filter and no rival total. Chips
    // with nothing behind them are noise.
    const { alternatives } = describePlan([
      { id: 's1', op: 'find', entity: 'contacts' },
    ] as unknown as Query[])!;

    expect(alternatives).toEqual([]);
  });
});
