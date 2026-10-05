/**
 * readOwnerCreditUsage — the owner card's figures (credit deduction slice 6a,
 * workplan §4.4; SA SQ-20, SQ-22, SQ-27, W6-4, W6-5, W6-6).
 *
 * The ledger here is an EXACT-STRING fake: it finds a totals row only when the
 * period key it is asked for is character-for-character the stored one. A
 * module that re-serialised the key through a `Date` (microseconds cut to
 * milliseconds) would find nothing and report zero — so these tests would fail.
 */

const mockSnapshot = jest.fn();
jest.mock('@/lib/business-os/entitlements/EntitlementService', () => ({
  getEntitlementService: () => ({ getSnapshot: (accountId: string) => mockSnapshot(accountId) }),
}));

import type {
  OwnerCreditChargeRow,
  OwnerCreditLotRow,
  OwnerCreditTotalsRow,
} from '@/lib/repositories/BusinessOsCreditOwnerReadRepository';
import { extraCreditsAt } from '../creditLots';
import { readOwnerCreditUsage, type OwnerCreditCardDeps } from '../ownerCreditUsage';
import type { OwnerCreditAllowance } from '../ownerCreditUsageTypes';

const USER = '11111111-1111-4111-8111-111111111111';
// Microsecond keys, as PostgREST returns them.
const ANCHOR = '2026-09-14T09:31:07.123456+00:00';
const PERIOD = '2026-09-14T09:31:07.123456+00:00';
const TRUNCATED = '2026-09-14T09:31:07.123Z';
const NEXT_PERIOD = '2026-10-14T09:31:07.123456+00:00';
const NOW = new Date('2026-09-30T12:00:00.000Z');

const MONTHLY: OwnerCreditAllowance = { amount: 32250, per: 'month' };
const TRIAL: OwnerCreditAllowance = { amount: 2000, per: 'total' };

const aid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

function totalsRow(periodStart: string, f: Partial<Record<'total' | 'owner' | 'scheduled' | 'external' | 'adjustment', number | string>>): OwnerCreditTotalsRow {
  const owner = f.owner ?? 0;
  const scheduled = f.scheduled ?? 0;
  const external = f.external ?? 0;
  const adjustment = f.adjustment ?? 0;
  return {
    period_start: periodStart,
    credits_total: f.total ?? String(Number(owner) + Number(scheduled) + Number(external) + Number(adjustment)),
    credits_owner: owner,
    credits_scheduled: scheduled,
    credits_external: external,
    credits_adjustment: adjustment,
  };
}

function charge(n: number, trigger: string, credits: number): OwnerCreditChargeRow {
  return {
    kind: 'charge',
    action_id: aid(n),
    adjusts_action_id: null,
    credits,
    triggered_by: trigger,
    period_start: PERIOD,
    user_id: USER,
    service: 'ai',
    action_type: 'chat_turn',
  };
}

function adjustment(corrects: number, credits: number, user: string = USER): OwnerCreditChargeRow {
  return {
    kind: 'adjustment',
    action_id: null,
    adjusts_action_id: aid(corrects),
    credits,
    triggered_by: null,
    period_start: PERIOD,
    user_id: user,
    service: null,
    action_type: null,
  };
}

interface Ledger {
  totals: OwnerCreditTotalsRow[];
  adjustments?: OwnerCreditChargeRow[];
  charges?: OwnerCreditChargeRow[];
  failTotals?: boolean;
  failAdjustments?: boolean;
  totalsCeiling?: boolean;
  /** Slice 11d: the owner's credit lots (none by default). */
  lots?: OwnerCreditLotRow[];
  failLots?: boolean;
}

/** An exact-string fake of the owner repository. */
function fakeOwner(ledger: Ledger) {
  return {
    findTotalsForPeriod: jest.fn(async (accountId: string, periodStart: string) => {
      if (ledger.failTotals) return { data: null, error: new Error('totals read failed') };
      const row = ledger.totals.find((t) => t.period_start === periodStart) ?? null;
      return { data: accountId === USER ? row : null, error: null };
    }),
    listTotalsFrom: jest.fn(async (_accountId: string, from: string) => {
      if (ledger.failTotals) return { data: null, error: new Error('totals read failed') };
      // String comparison is exact for these same-format keys.
      return { data: { rows: ledger.totals.filter((t) => t.period_start >= from), reachedCeiling: !!ledger.totalsCeiling }, error: null };
    }),
    listAdjustmentsForPeriods: jest.fn(async (_accountId: string, periods: readonly string[]) => {
      if (ledger.failAdjustments) return { data: null, error: new Error('adjustments read failed') };
      return {
        data: { rows: (ledger.adjustments ?? []).filter((a) => periods.includes(a.period_start)), reachedCeiling: false },
        error: null,
      };
    }),
    findChargesByActionIds: jest.fn(async (_accountId: string, ids: readonly string[]) => ({
      data: (ledger.charges ?? []).filter((c) => c.action_id !== null && ids.includes(c.action_id)),
      error: null,
    })),
    listOwnCreditLots: jest.fn(async (accountId: string) => {
      if (ledger.failLots) return { data: null, error: new Error('too_many_lots') };
      return { data: accountId === USER ? (ledger.lots ?? []) : [], error: null };
    }),
  };
}

function makeDeps(ledger: Ledger, over: Partial<OwnerCreditCardDeps> = {}) {
  const owner = fakeOwner(ledger);
  const deps = {
    findPeriodAnchor: jest.fn(async () => ({ data: ANCHOR as string | null, error: null as Error | null })),
    periodStartFor: jest.fn(async () => ({ data: PERIOD as string | null, error: null as Error | null })),
    owner,
    now: () => NOW,
    readAllowance: jest.fn(async () => MONTHLY as OwnerCreditAllowance | null),
    ...over,
  };
  return { deps, owner };
}

function makeLog() {
  return { warn: jest.fn(), error: jest.fn() };
}

beforeEach(() => mockSnapshot.mockReset());

describe('a monthly plan (Founding Partner)', () => {
  it('reads the period by its exact key and splits used from the totals row', async () => {
    const { deps, owner } = makeDeps({ totals: [totalsRow(PERIOD, { owner: '41.000000', scheduled: '20.000000', external: '2.000000' })] });
    const log = makeLog();

    const result = await readOwnerCreditUsage(USER, deps, log);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      period: { kind: 'monthly', resetsOn: '2026-10-14T09:31:07.123Z' },
      allowance: { amount: 32250, per: 'month' },
      used: 63,
      usedByOwner: 41,
      usedAutomatic: 22,
      extraCredits: 0,
      remaining: 32187,
    });
    expect(owner.findTotalsForPeriod).toHaveBeenCalledWith(USER, PERIOD);
    // No corrections in the period: the ledger rows are never read.
    expect(owner.listAdjustmentsForPeriods).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('the fake is strict: a millisecond-truncated key finds nothing (so the test above proves the key was passed verbatim)', async () => {
    const owner = fakeOwner({ totals: [totalsRow(PERIOD, { owner: 1 })] });
    expect((await owner.findTotalsForPeriod(USER, TRUNCATED)).data).toBeNull();
    expect((await owner.findTotalsForPeriod(USER, PERIOD)).data).not.toBeNull();
  });

  it('the first day of a period (no totals row yet): nothing used, the whole allowance left', async () => {
    const { deps } = makeDeps({ totals: [] });
    const result = await readOwnerCreditUsage(USER, deps, makeLog());
    expect(result.data).toMatchObject({ used: 0, usedByOwner: 0, usedAutomatic: 0, remaining: 32250 });
  });

  it('over the allowance: remaining clamps at 0, used is the true figure', async () => {
    const { deps } = makeDeps({ totals: [totalsRow(PERIOD, { owner: 32000, scheduled: 260 })] });
    const result = await readOwnerCreditUsage(USER, deps, makeLog());
    expect(result.data).toMatchObject({ used: 32260, remaining: 0 });
  });

  it('only the session account is ever read (tenant isolation)', async () => {
    const { deps, owner } = makeDeps({ totals: [] });
    await readOwnerCreditUsage(USER, deps, makeLog());
    expect(deps.findPeriodAnchor).toHaveBeenCalledWith(USER);
    expect(deps.readAllowance).toHaveBeenCalledWith(USER, expect.anything());
    for (const call of owner.findTotalsForPeriod.mock.calls) expect(call[0]).toBe(USER);
  });
});

describe('no allowance', () => {
  it('no plan row: the calendar month, usage only, no reset date — even if a cached snapshot still has an allowance', async () => {
    const { deps, owner } = makeDeps(
      { totals: [totalsRow('2026-09-01T00:00:00+00:00', { owner: 3 })] },
      { findPeriodAnchor: jest.fn(async () => ({ data: null, error: null })) }
    );
    // The recorder writes '…+00:00'; PostgREST normalises the filter value, the fake does not.
    owner.findTotalsForPeriod.mockImplementation(async (_a: string, key: string) => ({
      data: key === '2026-09-01T00:00:00.000Z' ? totalsRow(key, { owner: 3 }) : null,
      error: null,
    }));

    const result = await readOwnerCreditUsage(USER, deps, makeLog());

    expect(result.data).toEqual({
      period: { kind: 'calendar_month', resetsOn: null },
      allowance: null,
      used: 3,
      usedByOwner: 3,
      usedAutomatic: 0,
      extraCredits: 0,
      remaining: null,
    });
    expect(deps.periodStartFor).not.toHaveBeenCalled();
  });

  it('a plan with no resolvable allowance (paused, unreadable): its monthly period, NO reset date (W6-5)', async () => {
    const { deps } = makeDeps(
      { totals: [totalsRow(PERIOD, { scheduled: 5 })] },
      { readAllowance: jest.fn(async () => null) }
    );
    const result = await readOwnerCreditUsage(USER, deps, makeLog());
    expect(result.data).toMatchObject({
      period: { kind: 'monthly', resetsOn: null },
      allowance: null,
      used: 5,
      usedAutomatic: 5,
      remaining: null,
    });
  });

  it('an unavailable entitlement snapshot: a warning, usage with no gauge — never an error line or "0 left"', async () => {
    mockSnapshot.mockResolvedValue({ resolution: null, unavailable: true, stale: false });
    const { deps } = makeDeps({ totals: [totalsRow(PERIOD, { owner: 2 })] }, { readAllowance: undefined });
    const log = makeLog();

    const result = await readOwnerCreditUsage(USER, deps, log);

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ allowance: null, remaining: null, used: 2 });
    expect(mockSnapshot).toHaveBeenCalledWith(USER);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ accountId: USER }), expect.stringMatching(/unavailable/));
  });
});

describe('a trial (a one-off total)', () => {
  const EARLIER = '2026-09-14T09:31:07.123455+00:00'; // one microsecond before the anchor

  it('sums every period from the anchor string on; no reset date', async () => {
    const { deps, owner } = makeDeps(
      {
        totals: [
          totalsRow(EARLIER, { owner: 999 }),
          totalsRow(PERIOD, { owner: 100, scheduled: 48 }),
          totalsRow(NEXT_PERIOD, { owner: 200 }),
        ],
      },
      { readAllowance: jest.fn(async () => TRIAL) }
    );

    const result = await readOwnerCreditUsage(USER, deps, makeLog());

    expect(owner.listTotalsFrom).toHaveBeenCalledWith(USER, ANCHOR);
    expect(owner.findTotalsForPeriod).not.toHaveBeenCalled();
    expect(result.data).toEqual({
      period: { kind: 'trial_total', resetsOn: null },
      allowance: { amount: 2000, per: 'total' },
      used: 348,
      usedByOwner: 300,
      usedAutomatic: 48,
      extraCredits: 0,
      remaining: 1652,
    });
  });

  it('a read that reaches the ceiling is an error, never a partial total (W6-6)', async () => {
    const { deps } = makeDeps({ totals: [totalsRow(PERIOD, { owner: 1 })], totalsCeiling: true }, { readAllowance: jest.fn(async () => TRIAL) });
    const log = makeLog();
    const result = await readOwnerCreditUsage(USER, deps, log);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ accountId: USER }), expect.stringMatching(/ceiling/));
  });
});

describe('corrections (SQ-22)', () => {
  it('are read only when the period carries any, and counted under the corrected charge\'s trigger', async () => {
    const { deps, owner } = makeDeps({
      totals: [totalsRow(PERIOD, { owner: 10, scheduled: 5, adjustment: -1.5 })],
      adjustments: [adjustment(1, -1), adjustment(2, -0.5)],
      charges: [charge(1, 'owner', 2), charge(2, 'scheduled', 1)],
    });
    const log = makeLog();

    const result = await readOwnerCreditUsage(USER, deps, log);

    expect(owner.listAdjustmentsForPeriods).toHaveBeenCalledWith(USER, [PERIOD]);
    expect(owner.findChargesByActionIds).toHaveBeenCalledWith(USER, [aid(1), aid(2)]);
    expect(result.data).toMatchObject({ used: 13.5, usedByOwner: 9, usedAutomatic: 4.5 });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('an unresolvable correction counts in used, in neither part, with a warning', async () => {
    const { deps } = makeDeps({
      totals: [totalsRow(PERIOD, { owner: 10, adjustment: -2 })],
      // Its original is missing; another points at a charge of another account.
      adjustments: [adjustment(7, -1), adjustment(1, -1)],
      charges: [{ ...charge(1, 'owner', 2), user_id: '99999999-9999-4999-8999-999999999999' }],
    });
    const log = makeLog();

    const result = await readOwnerCreditUsage(USER, deps, log);

    expect(result.data).toMatchObject({ used: 8, usedByOwner: 10, usedAutomatic: 0 });
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ unresolved: 2 }), expect.any(String));
  });

  it('a failed corrections read is an error, never an unadjusted split', async () => {
    const { deps } = makeDeps({ totals: [totalsRow(PERIOD, { owner: 10, adjustment: -1 })], failAdjustments: true });
    const result = await readOwnerCreditUsage(USER, deps, makeLog());
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe('failures are errors, never zero', () => {
  it('a totals read error', async () => {
    const { deps } = makeDeps({ totals: [], failTotals: true });
    const log = makeLog();
    const result = await readOwnerCreditUsage(USER, deps, log);
    expect(result.data).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'totals_read_failed' }), expect.any(String));
  });

  it('an anchor read error', async () => {
    const { deps } = makeDeps({ totals: [] }, { findPeriodAnchor: jest.fn(async () => ({ data: null, error: new Error('x') })) });
    expect((await readOwnerCreditUsage(USER, deps, makeLog())).data).toBeNull();
  });

  it('a period function error', async () => {
    const { deps } = makeDeps({ totals: [] }, { periodStartFor: jest.fn(async () => ({ data: null, error: new Error('x') })) });
    expect((await readOwnerCreditUsage(USER, deps, makeLog())).data).toBeNull();
  });

  it('numeric strings are parsed (W6-4)', async () => {
    const { deps } = makeDeps({ totals: [totalsRow(PERIOD, { total: '0.415000', owner: '0.415000' })] });
    const result = await readOwnerCreditUsage(USER, deps, makeLog());
    expect(result.data).toMatchObject({ used: 0.415, usedByOwner: 0.415, remaining: 32249.585 });
  });

  it.each([
    ['garbage', 'abc'],
    ['an empty string', ''],
    ['Infinity', 'Infinity'],
  ])('%s in a credits column is a read error, never 0 (W6-4)', async (_name, value) => {
    const { deps } = makeDeps({ totals: [totalsRow(PERIOD, { total: 5, owner: value, scheduled: 5 })] });
    const log = makeLog();
    const result = await readOwnerCreditUsage(USER, deps, log);
    expect(result.data).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'unreadable_figure' }), expect.any(String));
  });

  it('never throws, even when a dependency does', async () => {
    const { deps } = makeDeps({ totals: [] }, { readAllowance: jest.fn(async () => { throw new Error('boom'); }) });
    const result = await readOwnerCreditUsage(USER, deps, makeLog());
    expect(result.error?.message).toBe('boom');
  });
});

/**
 * Credit deduction slice 11d (workplan §11d.6.2; SA W11d-2, W11d-6; G11d-1,
 * G11d-5, G11d-6): the owner's "Extra credits" figure.
 */
describe('extra credits (slice 11d)', () => {
  const lotId = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`;
  const lot = (n: number, over: Partial<OwnerCreditLotRow> = {}): OwnerCreditLotRow => ({
    id: lotId(n),
    creditsGranted: 200,
    expiresAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    draws: [],
    ...over,
  });
  const reversal = (credits: number, createdAt = '2026-09-20T00:00:00.000Z') => ({ kind: 'reversal' as const, credits, createdAt });

  it('no lots: 0, and remaining as before', async () => {
    const { deps, owner } = makeDeps({ totals: [totalsRow(PERIOD, { owner: 63 })] });
    const result = await readOwnerCreditUsage(USER, deps, makeLog());
    expect(result.data).toMatchObject({ extraCredits: 0, remaining: 32187 });
    expect(owner.listOwnCreditLots).toHaveBeenCalledWith(USER);
  });

  it.each([
    ['one 200-credit lot, no expiry', [lot(1)], 200],
    ['a lot added mid-period counts at once', [lot(1, { createdAt: '2026-09-29T23:59:00.000Z' })], 200],
    ['a lot expiring exactly now is expired (<=)', [lot(1, { expiresAt: NOW.toISOString() })], 0],
    ['a lot expiring one millisecond later still counts', [lot(1, { expiresAt: '2026-09-30T12:00:00.001Z' })], 200],
    ['a reversal of 50 leaves 150', [lot(1, { draws: [reversal(50)] })], 150],
    ['a fractional remainder is kept exact (6 dp)', [lot(1, { creditsGranted: 100, draws: [reversal(33.333333)] })], 66.666667],
    ['a lot created after now is ignored', [lot(1), lot(2, { createdAt: '2026-10-01T00:00:00.000Z' })], 200],
    ['two lots add up', [lot(1), lot(2, { creditsGranted: 50.5 })], 250.5],
  ])('%s', async (_name, lots, expected) => {
    const { deps } = makeDeps({ totals: [], lots });
    const result = await readOwnerCreditUsage(USER, deps, makeLog());
    expect(result.error).toBeNull();
    expect(result.data!.extraCredits).toBe(expected);
  });

  it.each([
    ['monthly', MONTHLY, [totalsRow(PERIOD, { owner: 63 })]],
    ['trial', TRIAL, [totalsRow(PERIOD, { owner: 300 })]],
    ['over the allowance', MONTHLY, [totalsRow(PERIOD, { owner: 32260 })]],
  ])('remaining is the PLAN only: identical with and without lots (%s, G11d-1)', async (_name, allowance, totals) => {
    const without = makeDeps({ totals }, { readAllowance: jest.fn(async () => allowance as OwnerCreditAllowance | null) });
    const withLots = makeDeps(
      { totals, lots: [lot(1, { creditsGranted: 5000 })] },
      { readAllowance: jest.fn(async () => allowance as OwnerCreditAllowance | null) }
    );
    const a = await readOwnerCreditUsage(USER, without.deps, makeLog());
    const b = await readOwnerCreditUsage(USER, withLots.deps, makeLog());
    expect(b.data!.extraCredits).toBe(5000);
    expect(b.data!.remaining).toBe(a.data!.remaining);
    expect({ ...b.data, extraCredits: 0 }).toEqual(a.data);
  });

  it('no plan row and 200 extra: no allowance, no remaining, the extra figure', async () => {
    const { deps } = makeDeps(
      { totals: [], lots: [lot(1)] },
      { findPeriodAnchor: jest.fn(async () => ({ data: null, error: null })), readAllowance: jest.fn(async () => null) }
    );
    const result = await readOwnerCreditUsage(USER, deps, makeLog());
    expect(result.data).toMatchObject({ allowance: null, remaining: null, extraCredits: 200 });
  });

  it('a lot read error (or its ceiling) is an error with lots_read_failed, never 0 (OP-38)', async () => {
    const { deps } = makeDeps({ totals: [], failLots: true });
    const log = makeLog();
    const result = await readOwnerCreditUsage(USER, deps, log);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'lots_read_failed', accountId: USER }), expect.any(String));
  });

  it('a lot read that rejects is still an error result: the builder never throws', async () => {
    const { deps, owner } = makeDeps({ totals: [] });
    owner.listOwnCreditLots.mockImplementation(async () => {
      throw new Error('boom');
    });
    const result = await readOwnerCreditUsage(USER, deps, makeLog());
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('an unreadable lot (the core answers null) is an error with lots_unreadable', async () => {
    const { deps } = makeDeps({ totals: [], lots: [lot(1, { creditsGranted: Number.NaN })] });
    const log = makeLog();
    const result = await readOwnerCreditUsage(USER, deps, log);
    expect(result.data).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'lots_unreadable' }), expect.any(String));
  });

  it('an inconsistent lot: the clamped figure and one warn with the account and a count, never a figure', async () => {
    const { deps } = makeDeps({ totals: [], lots: [lot(1, { creditsGranted: 10, draws: [reversal(15)] }), lot(2)] });
    const log = makeLog();
    const result = await readOwnerCreditUsage(USER, deps, log);
    expect(result.data!.extraCredits).toBe(200);
    expect(log.warn).toHaveBeenCalledTimes(1);
    const [ctx] = log.warn.mock.calls[0];
    expect(ctx).toEqual({ accountId: USER, lots: 2 });
  });

  it('one now for both reads: the clock is called once', async () => {
    const clock = jest
      .fn()
      .mockReturnValueOnce(NOW)
      // A second call would land after the lot's expiry and change the answer.
      .mockReturnValue(new Date('2026-12-31T00:00:00.000Z'));
    const { deps } = makeDeps({ totals: [], lots: [lot(1, { expiresAt: '2026-10-15T00:00:00.000Z' })] }, { now: clock });
    const result = await readOwnerCreditUsage(USER, deps, makeLog());
    expect(clock).toHaveBeenCalledTimes(1);
    expect(result.data!.extraCredits).toBe(200);
  });

  it('the two reads run in parallel: the lots are asked for before the plan read finishes', async () => {
    let releaseAnchor: (v: { data: string | null; error: Error | null }) => void = () => {};
    const heldAnchor = new Promise<{ data: string | null; error: Error | null }>((resolve) => {
      releaseAnchor = resolve;
    });
    const { deps, owner } = makeDeps({ totals: [], lots: [lot(1)] }, { findPeriodAnchor: jest.fn(() => heldAnchor) });
    const pending = readOwnerCreditUsage(USER, deps, makeLog());
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.findPeriodAnchor).toHaveBeenCalled();
    expect(owner.listOwnCreditLots).toHaveBeenCalledWith(USER);
    releaseAnchor({ data: ANCHOR, error: null });
    expect((await pending).data!.extraCredits).toBe(200);
  });

  it('one definition (G11d-5): the payload figure equals extraCreditsAt on the same lots', async () => {
    const lots = [
      lot(1, { creditsGranted: 120.25, draws: [reversal(20.125)] }),
      lot(2, { creditsGranted: 80, expiresAt: '2026-09-15T00:00:00.000Z' }),
      lot(3, { creditsGranted: 9.999999 }),
    ];
    const { deps } = makeDeps({ totals: [], lots });
    const result = await readOwnerCreditUsage(USER, deps, makeLog());
    expect(result.data!.extraCredits).toBe(extraCreditsAt(lots, NOW)!.extraCredits);
    // Non-vacuity: the expired lot and the reversal both moved the figure.
    expect(result.data!.extraCredits).toBeCloseTo(100.125 + 9.999999, 6);
  });
});
