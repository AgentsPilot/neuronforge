/**
 * The verifier refuses the findings that are true and useless.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The model proposes a question and commits in advance to what would answer it.
 * This suite is the commitment being enforced. Most of it is about REFUSAL,
 * because a generator that confirms everything is worth less than no generator
 * at all -- and the dangerous output is not a wrong number (code computes every
 * figure) but a right number about nothing.
 *
 * The case that names the problem:
 *
 *     "Clients who book on Mondays never come back"
 *     Monday had ONE client, who did not return. 0% repeat on Mondays.
 *
 * Arithmetically perfect. No ratio check catches it, because the arithmetic is
 * not what is wrong. Only a row count per group catches it, and a grouped
 * `ComputeResult` does not carry one -- which is why `deriveDenominator`
 * exists.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ComputeQuery, ComputeResult } from '../../../bizql/types';
import {
  claimCarriesFigure,
  isTautology,
  deriveDenominator,
  evaluate,
  withEnforcedFloors,
  MIN_ROWS_FLOOR,
  type ConfirmWhen,
  type Proposal,
} from '../verify';

/** A grouped measure result. */
const measured = (
  groups: Array<{ key: string; value: number }>,
  extra: Partial<ComputeResult> = {}
): ComputeResult =>
  ({ op: 'compute', entity: 'bookings', agg: { fn: 'avg' }, value: null, groups, ...extra }) as ComputeResult;

/** The derived count result: rows behind each group. */
const counted = (groups: Array<{ key: string; value: number }>): ComputeResult =>
  ({ op: 'compute', entity: 'bookings', agg: { fn: 'count' }, value: null, groups }) as ComputeResult;

const QUERY: ComputeQuery = {
  op: 'compute',
  entity: 'bookings',
  where: [{ field: 'status', op: 'eq', value: 'completed' } as never],
  group_by: 'weekday',
  agg: { fn: 'avg', field: 'repeat_rate' },
} as ComputeQuery;

const proposal = (claim: string, confirmWhen: ConfirmWhen): Proposal => ({
  claim,
  query: QUERY,
  confirmWhen,
});

const DIFFERS: ConfirmWhen = { kind: 'group_differs', minRowsPerGroup: 5, minRatio: 2 };
const NEVER: ConfirmWhen = { kind: 'group_is_zero', minRowsPerGroup: 5, minOtherGroups: 2 };

describe('the Monday case', () => {
  it('refuses a zero group with one row behind it', () => {
    /*
     * THE TEST THIS FEATURE EXISTS TO PASS. Monday's rate is a real 0 computed
     * from real data, and it is about one person.
     */
    const verdict = evaluate(
      proposal('Clients who book on Mondays rarely come back', NEVER),
      measured([
        { key: 'Monday', value: 0 },
        { key: 'Tuesday', value: 45 },
        { key: 'Wednesday', value: 52 },
      ]),
      counted([
        { key: 'Monday', value: 1 },
        { key: 'Tuesday', value: 30 },
        { key: 'Wednesday', value: 28 },
      ])
    );

    expect(verdict.confirmed).toBe(false);
    expect(verdict.reason).toBe('condition_not_met');
    // Monday is gone before any comparison happens.
    expect(verdict.groups.map(g => g.key)).toEqual(['Tuesday', 'Wednesday']);
  });

  it('confirms the same shape once the group has evidence behind it', () => {
    // Twelve Monday clients, none of whom returned, is a finding.
    const verdict = evaluate(
      proposal('Clients who book on Mondays rarely come back', NEVER),
      measured([
        { key: 'Monday', value: 0 },
        { key: 'Tuesday', value: 45 },
        { key: 'Wednesday', value: 52 },
      ]),
      counted([
        { key: 'Monday', value: 12 },
        { key: 'Tuesday', value: 30 },
        { key: 'Wednesday', value: 28 },
      ])
    );

    expect(verdict.confirmed).toBe(true);
    expect(verdict.worst).toMatchObject({ key: 'Monday', rows: 12 });
  });
});

describe('the claim must carry no figures', () => {
  it.each([
    'Mondays convert 40% worse than Tuesdays',
    'Only 3 clients ever rebooked',
    'Your refund rate is 18.8',
  ])('rejects %p', claim => {
    /*
     * The verifier owns every figure. A number in the claim was guessed or read
     * off the profile, so it describes nothing that was computed for THIS
     * result. Rejected rather than stripped: a sentence built around a figure
     * stops meaning anything without it.
     */
    expect(claimCarriesFigure(claim)).toBe(true);
  });

  it.each([
    'Clients who book on Mondays rarely come back',
    'One source brings in clients who never rebook',
    'Your repeat rate is all-or-nothing rather than steady',
  ])('allows %p', claim => {
    expect(claimCarriesFigure(claim)).toBe(false);
  });

  it('allows a year or an ordinal, which name rather than measure', () => {
    expect(claimCarriesFigure('Clients from 2026 behave differently')).toBe(false);
    expect(claimCarriesFigure('Your 2nd service never sells')).toBe(false);
  });

  it('rejects a figure-carrying claim before running any condition', () => {
    const verdict = evaluate(
      proposal('Mondays are 40% worse', DIFFERS),
      measured([{ key: 'Monday', value: 10 }, { key: 'Tuesday', value: 90 }]),
      counted([{ key: 'Monday', value: 50 }, { key: 'Tuesday', value: 50 }])
    );

    expect(verdict.reason).toBe('claim_contains_figure');
  });
});

describe('deriveDenominator', () => {
  it('counts the same rows the measure measured', () => {
    const d = deriveDenominator(QUERY);

    expect(d.agg).toEqual({ fn: 'count' });
    expect(d.entity).toBe(QUERY.entity);
    expect(d.group_by).toBe(QUERY.group_by);
    expect(d.where).toBe(QUERY.where);
  });

  it('carries `over`, without which every relation finding would be rejected', () => {
    /*
     * A REAL BUG, found on the second live run. `over` names a relation to
     * aggregate across -- "every service, counting its bookings" -- and is the
     * only way to ask "which service sells least", because grouping bookings by
     * service_id leaves a service with no bookings out of the result entirely.
     *
     * Dropped from the denominator, the count would be of the PARENT rows: one
     * per service. Every group would show a single row, the floor would reject
     * all of them, and the guard would have looked like it was working.
     */
    const d = deriveDenominator({
      op: 'compute',
      entity: 'services',
      over: 'bookings',
      agg: { fn: 'sum', field: 'total' },
    } as ComputeQuery);

    expect(d.over).toBe('bookings');
    expect(d.entity).toBe('services');
    expect(d.agg).toEqual({ fn: 'count' });
  });

  it('is derived rather than supplied, so the model cannot get it wrong', () => {
    /*
     * The alternative was asking the model for the denominator, which makes a
     * wrong or missing one a new way to be lied to. Deriving it means the
     * numerator and denominator cannot describe different rows.
     */
    const d = deriveDenominator({ ...QUERY, agg: { fn: 'sum', field: 'total' } } as ComputeQuery);

    expect(d.agg.fn).toBe('count');
    expect(d.agg).not.toHaveProperty('field');
  });
});

describe('floors the model cannot talk its way under', () => {
  it('raises a request for one row per group to the floor', () => {
    // A proposal asking for 1 is asking to be allowed the Monday finding.
    const raised = withEnforcedFloors({ kind: 'group_differs', minRowsPerGroup: 1, minRatio: 2 });

    expect(raised.minRowsPerGroup).toBe(MIN_ROWS_FLOOR);
  });

  it('raises a ratio that would fire on noise', () => {
    const raised = withEnforcedFloors({ kind: 'group_differs', minRowsPerGroup: 9, minRatio: 1.01 });

    expect(raised).toMatchObject({ minRowsPerGroup: 9, minRatio: 1.5 });
  });

  it('leaves a stricter proposal alone', () => {
    // The model is allowed to be more careful than the floor, never less.
    expect(withEnforcedFloors({ kind: 'group_differs', minRowsPerGroup: 25, minRatio: 4 }))
      .toMatchObject({ minRowsPerGroup: 25, minRatio: 4 });
  });
});

describe('group_differs', () => {
  it('confirms a real gap between two well-evidenced groups', () => {
    const verdict = evaluate(
      proposal('One service sells far better than another', DIFFERS),
      measured([{ key: 'Consultation', value: 90 }, { key: 'Workshop', value: 30 }]),
      counted([{ key: 'Consultation', value: 40 }, { key: 'Workshop', value: 35 }])
    );

    expect(verdict.confirmed).toBe(true);
    expect(verdict.ratio).toBe(3);
    expect(verdict.best!.key).toBe('Consultation');
  });

  it('declines a gap that does not reach the committed ratio', () => {
    const verdict = evaluate(
      proposal('One service sells far better than another', DIFFERS),
      measured([{ key: 'Consultation', value: 55 }, { key: 'Workshop', value: 45 }]),
      counted([{ key: 'Consultation', value: 40 }, { key: 'Workshop', value: 35 }])
    );

    expect(verdict.confirmed).toBe(false);
    expect(verdict.reason).toBe('condition_not_met');
  });

  it('leaves a zero worst group to group_is_zero', () => {
    /*
     * A zero makes the ratio infinite, which would confirm every "never" claim
     * through the weaker condition -- one that never asked for `minOtherGroups`.
     * The two conditions must not overlap, or the model learns to use whichever
     * is easier to satisfy.
     */
    const verdict = evaluate(
      proposal('One service sells far better than another', DIFFERS),
      measured([{ key: 'Consultation', value: 90 }, { key: 'Workshop', value: 0 }]),
      counted([{ key: 'Consultation', value: 40 }, { key: 'Workshop', value: 35 }])
    );

    expect(verdict.confirmed).toBe(false);
  });

  it('declines when only one group survives the row floor', () => {
    const verdict = evaluate(
      proposal('One service sells far better than another', DIFFERS),
      measured([{ key: 'Consultation', value: 90 }, { key: 'Workshop', value: 10 }]),
      counted([{ key: 'Consultation', value: 40 }, { key: 'Workshop', value: 2 }])
    );

    expect(verdict.reason).toBe('too_few_groups_with_evidence');
  });
});

describe('group_is_zero', () => {
  it('needs enough non-zero groups for a zero to mean anything', () => {
    /*
     * "This source never rebooks", said of the only source with any evidence,
     * is a statement about the business rather than about the source.
     */
    const verdict = evaluate(
      proposal('One source brings clients who never return', NEVER),
      measured([{ key: 'Instagram', value: 0 }, { key: 'Referral', value: 40 }]),
      counted([{ key: 'Instagram', value: 20 }, { key: 'Referral', value: 20 }])
    );

    expect(verdict.confirmed).toBe(false);
    expect(verdict.reason).toBe('too_few_groups_with_evidence');
  });

  it('declines when nothing is actually zero', () => {
    const verdict = evaluate(
      proposal('One source brings clients who never return', NEVER),
      measured([{ key: 'A', value: 5 }, { key: 'B', value: 40 }, { key: 'C', value: 30 }]),
      counted([{ key: 'A', value: 20 }, { key: 'B', value: 20 }, { key: 'C', value: 20 }])
    );

    expect(verdict.reason).toBe('condition_not_met');
  });
});

describe('questions that cannot be interesting', () => {
  it('refuses an unfiltered count, whatever the ratio', () => {
    /*
     * THE LIVE FAILURE. "Some services have more bookings than others" cleared
     * the row floor on five groups with a real 2.1x ratio. Five services always
     * have five different counts; bigger things are bigger.
     */
    const verdict = evaluate(
      {
        claim: 'Some services have more bookings than others',
        query: { op: 'compute', entity: 'services', over: 'bookings', agg: { fn: 'count' } } as ComputeQuery,
        confirmWhen: DIFFERS,
      },
      measured([{ key: 'Consultation', value: 15 }, { key: 'Workshop', value: 7 }]),
      counted([{ key: 'Consultation', value: 15 }, { key: 'Workshop', value: 7 }])
    );

    expect(verdict.confirmed).toBe(false);
    expect(verdict.reason).toBe('tautology');
  });

  it('allows the same count once a filter makes it a question', () => {
    // Counting CANCELLED bookings per service asks about behaviour, not size.
    expect(isTautology({
      op: 'compute', entity: 'services', over: 'bookings',
      where: [{ field: 'status', op: 'eq', value: 'cancelled' } as never],
      agg: { fn: 'count' },
    } as ComputeQuery)).toBe(false);
  });

  it('leaves sums and averages alone', () => {
    /*
     * An average per group can legitimately come out flat, so an uneven one
     * means something. Only a bare count is guaranteed to vary.
     */
    expect(isTautology({
      op: 'compute', entity: 'services', over: 'bookings', agg: { fn: 'avg', field: 'payment_amount' },
    } as ComputeQuery)).toBe(false);
  });

  it('refuses before running anything', () => {
    // No result could rescue it, so there is no reason to pay for the query.
    expect(isTautology({ op: 'compute', entity: 'bookings', group_by: 'status', agg: { fn: 'count' } } as ComputeQuery)).toBe(true);
  });
});

describe('a finding nobody could read', () => {
  it('refuses groups named by raw id', () => {
    /*
     * FROM THE FIRST LIVE RUN. The model grouped by `service_id` and this
     * confirmed, perfectly correctly, that one uuid had 2.6x the bookings of
     * another uuid. Right arithmetic, unsayable sentence -- the Monday failure
     * in different clothes.
     */
    const verdict = evaluate(
      proposal('One service is booked far more than another', DIFFERS),
      measured([
        { key: '5be8fe70-daac-4e55-b5f3-4b017e08a240', value: 13 },
        { key: '72d698b5-b846-49a3-8e1b-fb7640ec0408', value: 5 },
      ]),
      counted([
        { key: '5be8fe70-daac-4e55-b5f3-4b017e08a240', value: 13 },
        { key: '72d698b5-b846-49a3-8e1b-fb7640ec0408', value: 5 },
      ])
    );

    expect(verdict.confirmed).toBe(false);
    expect(verdict.reason).toBe('unreadable_groups');
  });

  it('confirms the same comparison once the groups have names', () => {
    // Grouping by the relation instead resolves the labels, and the identical
    // numbers now make a sentence somebody can act on.
    const verdict = evaluate(
      proposal('One service is booked far more than another', DIFFERS),
      measured([{ key: 'ייעוץ אישי', value: 13 }, { key: 'קורס קשב', value: 5 }]),
      counted([{ key: 'ייעוץ אישי', value: 13 }, { key: 'קורס קשב', value: 5 }])
    );

    expect(verdict.confirmed).toBe(true);
    expect(verdict.ratio).toBe(2.6);
  });

  it('tolerates an id in a group that was discarded anyway', () => {
    // Checked after the row floor, so a stray unresolved id in a group too
    // small to compare does not sink an otherwise readable finding.
    const verdict = evaluate(
      proposal('One service is booked far more than another', DIFFERS),
      measured([
        { key: 'ייעוץ אישי', value: 13 },
        { key: 'קורס קשב', value: 5 },
        { key: '72d698b5-b846-49a3-8e1b-fb7640ec0408', value: 1 },
      ]),
      counted([
        { key: 'ייעוץ אישי', value: 13 },
        { key: 'קורס קשב', value: 5 },
        { key: '72d698b5-b846-49a3-8e1b-fb7640ec0408', value: 2 },
      ])
    );

    expect(verdict.confirmed).toBe(true);
  });
});

describe('what it refuses to reason about at all', () => {
  it('declines an ungrouped result', () => {
    // "This group differs" has no meaning against a single total.
    const verdict = evaluate(
      proposal('Something differs', DIFFERS),
      measured([]),
      counted([])
    );

    expect(verdict.reason).toBe('not_grouped');
  });

  it('declines a condition kind it does not know', () => {
    const verdict = evaluate(
      proposal('Something looks significant', { kind: 'vibes' } as never),
      measured([{ key: 'A', value: 1 }]),
      counted([{ key: 'A', value: 50 }])
    );

    expect(verdict.reason).toBe('unknown_confirm_kind');
  });

  it('declines money that spans currencies', () => {
    /*
     * With `currencyBreakdown` present, `value` is the LARGEST single
     * currency's total rather than the whole, so ranking groups on it compares
     * a part against a whole. There is no FX rate anywhere in this platform.
     */
    const verdict = evaluate(
      proposal('One service earns far more than another', DIFFERS),
      measured(
        [{ key: 'A', value: 900 }, { key: 'B', value: 100 }],
        { currencyBreakdown: [{ currency: 'ILS', value: 900 }, { currency: 'USD', value: 100 }] }
      ),
      counted([{ key: 'A', value: 40 }, { key: 'B', value: 40 }])
    );

    expect(verdict.confirmed).toBe(false);
    expect(verdict.reason).toBe('currency_mix');
  });
});
