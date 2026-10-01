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

import type { OwnerCreditChargeRow, OwnerCreditTotalsRow } from '@/lib/repositories/BusinessOsCreditOwnerReadRepository';
import { readOwnerCreditUsage, type OwnerCreditUsageDeps } from '../ownerCreditUsage';
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
  };
}

function makeDeps(ledger: Ledger, over: Partial<OwnerCreditUsageDeps> = {}) {
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
      granted: 0,
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
      granted: 0,
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
      granted: 0,
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
