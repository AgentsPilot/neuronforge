/**
 * Why bookings keep getting called off.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Two things are being tested that nothing else in this module covers:
 *
 *   the OWNER's share, which is the most actionable finding on the card and
 *   the least likely to be noticed, because every individual cancellation felt
 *   justified at the time;
 *
 *   and the rule that the two sides' reasons are never pooled. A client says
 *   "I was unwell"; an owner says "I was double-booked". Mixed into one tally
 *   they produce a top reason neither party actually gave.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { RetCancelPatternDetector } from '../RetCancelPatternDetector';

interface Fixture {
  bookings?: Record<string, unknown>[];
  bookingsError?: Error;
}

function client(fixture: Fixture) {
  const table = (rows: Record<string, unknown>[], error?: Error) => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'gte', 'lt', 'order', 'not', 'limit']) {
      chain[method] = () => chain;
    }
    chain.then = (resolve: (r: unknown) => unknown) =>
      resolve(error ? { data: null, error } : { data: rows, error: null });
    return chain;
  };

  return {
    from: (name: string) =>
      name === 'scheduling_bookings' ? table(fixture.bookings ?? [], fixture.bookingsError) : table([]),
  } as never;
}

const detectorFor = (fixture: Fixture) => {
  const detector = new RetCancelPatternDetector(client(fixture));
  jest
    .spyOn(detector as never as { isOnCooldown: () => Promise<boolean> }, 'isOnCooldown')
    .mockResolvedValue(false);
  return detector;
};

const cancelled = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  contact_id: 'c1',
  start_time: new Date(Date.now() - 10 * 86_400_000).toISOString(),
  updated_at: new Date(Date.now() - 11 * 86_400_000).toISOString(),
  cancel_reason: 'client_unwell',
  cancellation_reason: null,
  cancelled_by: 'client',
  service_id: 'svc',
  ...over,
});

/** Shorthand for n cancellations that differ only by id. */
const many = (n: number, over: Record<string, unknown> = {}) =>
  Array.from({ length: n }, (_, i) => cancelled({ id: `b${i}`, ...over }));

const U = '11111111-1111-4111-8111-111111111111';

describe('a reason the client keeps giving', () => {
  it('is reported with no spike required', async () => {
    /*
     * The whole point of this detector. A flat four-a-quarter never trips the
     * spike detector, so until now nobody was ever told.
     */
    const result = await detectorFor({ bookings: many(4) }).evaluate(U);

    expect(result).not.toBeNull();
    expect(result!.processParameters!.client_reason).toBe('client_unwell');
    expect(result!.processParameters!.client_reason_count).toBe(4);
  });

  it('stays quiet below four cancellations in the quarter', async () => {
    expect(await detectorFor({ bookings: many(3) }).evaluate(U)).toBeNull();
  });

  it('stays quiet when the reasons are all different', async () => {
    const mixed = [
      cancelled({ id: 'b1', cancel_reason: 'client_unwell' }),
      cancelled({ id: 'b2', cancel_reason: 'client_rescheduling' }),
      cancelled({ id: 'b3', cancel_reason: 'client_unavailable' }),
      cancelled({ id: 'b4', cancel_reason: 'client_no_longer_needed' }),
      cancelled({ id: 'b5', cancel_reason: 'other' }),
    ];

    expect(await detectorFor({ bookings: mixed }).evaluate(U)).toBeNull();
  });
});

describe('when the owner is the one cancelling', () => {
  it('says so, and that becomes the headline', async () => {
    /*
     * Four of six called off by the business. That is a scheduling problem,
     * not a client problem, and no other surface in the product says it.
     */
    const rows = [
      ...many(4, { cancelled_by: 'owner', cancel_reason: 'owner_unavailable' }),
      cancelled({ id: 'c1', cancelled_by: 'client' }),
      cancelled({ id: 'c2', cancelled_by: 'client' }),
    ];

    const result = await detectorFor({ bookings: rows }).evaluate(U);

    expect(result!.processParameters!.owner_is_the_story).toBe(true);
    expect(result!.processParameters!.by_owner).toBe(4);
    expect(result!.processParameters!.by_client).toBe(2);
    expect(result!.affectedCount).toBe(4);
  });

  it('keeps the two sides\' reasons apart', async () => {
    /*
     * Pooled, 'owner_unavailable' x3 and 'client_unwell' x3 would produce one
     * "top reason" that half the cancellations never gave.
     */
    const rows = [
      ...many(3, { cancelled_by: 'owner', cancel_reason: 'owner_unavailable' }),
      ...Array.from({ length: 4 }, (_, i) =>
        cancelled({ id: `c${i}`, cancelled_by: 'client', cancel_reason: 'client_unwell' })
      ),
    ];

    const result = await detectorFor({ bookings: rows }).evaluate(U);

    expect(result!.processParameters!.owner_reason).toBe('owner_unavailable');
    expect(result!.processParameters!.client_reason).toBe('client_unwell');
  });

  it('does not call a normal share of owner cancellations a story', async () => {
    // One in six is the ordinary friction of running a diary.
    const rows = [
      cancelled({ id: 'o1', cancelled_by: 'owner', cancel_reason: 'owner_unavailable' }),
      ...Array.from({ length: 5 }, (_, i) => cancelled({ id: `c${i}`, cancelled_by: 'client' })),
    ];

    const result = await detectorFor({ bookings: rows }).evaluate(U);

    expect(result!.processParameters!.owner_is_the_story).toBe(false);
  });
});

describe('rows whose party is unknown', () => {
  it('reads the legacy prefix when the column is null', async () => {
    // Every cancelled booking predating migration 20260928c looks like this.
    const rows = many(4, {
      cancelled_by: null,
      cancellation_reason: 'Cancelled by client: kids were ill',
      cancel_reason: 'client_unwell',
    });

    const result = await detectorFor({ bookings: rows }).evaluate(U);

    expect(result!.processParameters!.by_client).toBe(4);
    expect(result!.processParameters!.unknown_party).toBe(0);
  });

  it('counts an unattributable row as neither side', async () => {
    /*
     * Guessing would put real cancellations on the wrong side of the one
     * split this card exists to make.
     */
    const rows = [
      ...many(4, { cancelled_by: 'client' }),
      cancelled({ id: 'x1', cancelled_by: null, cancellation_reason: null }),
    ];

    const result = await detectorFor({ bookings: rows }).evaluate(U);

    expect(result!.processParameters!.unknown_party).toBe(1);
    expect(result!.processParameters!.attributed).toBe(4);
  });

  it('keeps unknown rows out of the owner share', async () => {
    /*
     * Including them in the denominator would understate the owner's share on
     * exactly the accounts with the most legacy rows — the ones least able to
     * see it.
     */
    const rows = [
      ...many(2, { cancelled_by: 'owner', cancel_reason: 'owner_unavailable' }),
      ...Array.from({ length: 2 }, (_, i) => cancelled({ id: `c${i}`, cancelled_by: 'client' })),
      ...Array.from({ length: 6 }, (_, i) =>
        cancelled({ id: `x${i}`, cancelled_by: null, cancellation_reason: null })
      ),
    ];

    const result = await detectorFor({ bookings: rows }).evaluate(U);

    // 2 of 4 attributed, not 2 of 10.
    expect(result!.processParameters!.owner_share).toBe(0.5);
  });

  it('treats a system cancellation as neither party', async () => {
    const rows = [
      ...many(4, { cancelled_by: 'client' }),
      cancelled({ id: 's1', cancelled_by: 'system' }),
    ];

    const result = await detectorFor({ bookings: rows }).evaluate(U);

    expect(result!.processParameters!.attributed).toBe(4);
  });
});

describe('the figures it reports', () => {
  it('puts no money on a cancellation', async () => {
    /*
     * A cancelled booking's value is not lost revenue: the slot may have been
     * refilled, the client may have rebooked, the deposit may have been kept.
     * `CashCancelledUnrefundedDetector` reports money genuinely held; this one
     * reports behaviour.
     */
    const result = await detectorFor({ bookings: many(4) }).evaluate(U);

    expect(result!.estimatedImpactUsd).toBeUndefined();
    expect(result!.impactDirection).toBeUndefined();
  });

  it('reports no percentage change, because nothing was compared', async () => {
    const result = await detectorFor({ bookings: many(4) }).evaluate(U);

    expect(result!.percentChange).toBe(0);
    expect(result!.baselineValue).toBe(0);
  });
});
