/**
 * readAdminCreditsLeft — the admin Businesses list's "Credits left" pass
 * (credit deduction slice 8a; FR-48, AC-43; SA SQ-41, SQ-42, Q-4, Q-5, Q-6,
 * C-W3).
 *
 * The entitlements service is replaced by injected snapshots, and
 * `creditAllowanceForDisplay` by a stand-in that reads the allowance a test
 * put on the snapshot: what is tested here is the pass, not the resolver.
 */

jest.mock('@/lib/business-os/entitlements/EntitlementService', () => ({
  getEntitlementService: () => ({
    getSnapshots: () => {
      throw new Error('production snapshots are not used in these tests');
    },
    getSnapshot: (accountId: string) => mockOwnerSnapshot(accountId),
  }),
}));
jest.mock('@/lib/business-os/entitlements/creditAllowanceView', () => ({
  creditAllowanceForDisplay: (snapshot: { allowance?: unknown }) => snapshot.allowance ?? null,
}));

const mockOwnerSnapshot = jest.fn();

import { readAdminCreditsLeft, type AdminCreditPercentDeps, type AdminTotalsRow } from '../adminCreditPercent';
import { creditPercentLeft } from '../creditBands';
import { readOwnerCreditUsage, type OwnerCreditCardDeps } from '../ownerCreditUsage';
import type { OwnerCreditAllowance } from '../ownerCreditUsageTypes';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = uid(1);
const B = uid(2);
const C = uid(3);
const D = uid(4);

const NOW = new Date('2026-09-30T12:00:00.000Z');
const ANCHOR = '2026-09-14T09:31:07.123456+00:00';
const PERIOD = '2026-09-14T09:31:07.123456+00:00';
const PREVIOUS = '2026-08-14T09:31:07.123456+00:00';
const TRIAL_ANCHOR = '2026-09-25T08:00:00.000001+00:00';

const MONTHLY: OwnerCreditAllowance = { amount: 32250, per: 'month' };
const TRIAL: OwnerCreditAllowance = { amount: 2000, per: 'total' };

type Snapshot = { unavailable: boolean; allowance: OwnerCreditAllowance | null };

interface Fixture {
  snapshots: Record<string, Snapshot>;
  anchors: Record<string, string>;
  totals: AdminTotalsRow[];
  failAnchors?: boolean;
  failTotals?: boolean;
  ceiling?: boolean;
}

function fixtureDeps(f: Fixture) {
  const getSnapshots = jest.fn(async (ids: string[]) => {
    const out = new Map<string, unknown>();
    for (const id of ids) out.set(id, f.snapshots[id] ?? { unavailable: false, allowance: null });
    return out;
  });
  const findPeriodAnchorsBatch = jest.fn(async (ids: readonly string[]) => {
    if (f.failAnchors) return { data: null, error: new Error('anchors failed') };
    const out: Record<string, string> = {};
    for (const id of ids) if (f.anchors[id]) out[id] = f.anchors[id];
    return { data: out, error: null };
  });
  type TotalsArgs = Parameters<AdminCreditPercentDeps['listTotalsForAccountsInRange']>;
  type TotalsResult = Awaited<ReturnType<AdminCreditPercentDeps['listTotalsForAccountsInRange']>>;
  const listTotalsForAccountsInRange = jest.fn<Promise<TotalsResult>, TotalsArgs>(async (ids) => {
    if (f.failTotals) return { data: null, error: new Error('totals failed') };
    return {
      data: { rows: f.totals.filter((row) => ids.includes(row.user_id)), reachedCeiling: f.ceiling ?? false },
      error: null,
    };
  });
  const deps = {
    getSnapshots: getSnapshots as unknown as AdminCreditPercentDeps['getSnapshots'],
    findPeriodAnchorsBatch,
    listTotalsForAccountsInRange,
  } satisfies AdminCreditPercentDeps;
  return { deps, getSnapshots, findPeriodAnchorsBatch, listTotalsForAccountsInRange };
}

const log = () => ({ info: jest.fn(), warn: jest.fn() });

describe('readAdminCreditsLeft — every kind', () => {
  it('monthly, trial, no allowance, no plan row and an unavailable snapshot', async () => {
    const { deps } = fixtureDeps({
      snapshots: {
        [A]: { unavailable: false, allowance: MONTHLY },
        [B]: { unavailable: false, allowance: TRIAL },
        [C]: { unavailable: false, allowance: MONTHLY }, // stale: no plan row
        [D]: { unavailable: true, allowance: null },
      },
      anchors: { [A]: ANCHOR, [B]: TRIAL_ANCHOR, [D]: ANCHOR },
      totals: [
        // Only the CURRENT period counts for a monthly plan.
        { user_id: A, period_start: PREVIOUS, credits_total: '30000' },
        { user_id: A, period_start: PERIOD, credits_total: '11610.000000' },
        { user_id: B, period_start: TRIAL_ANCHOR, credits_total: 260 },
      ],
    });
    const logger = log();

    const pass = await readAdminCreditsLeft([A, B, C, D], deps, logger, { now: NOW });

    expect(pass.outcome).toBe('ok');
    expect(pass.byUserId.get(A)).toEqual({ kind: 'percent', value: 64, trial: false });
    expect(pass.byUserId.get(B)).toEqual({ kind: 'percent', value: 87, trial: true });
    // No plan row means no allowance, whatever the snapshot still says.
    expect(pass.byUserId.get(C)).toEqual({ kind: 'no_allowance' });
    // A failed read is not "no allowance" (SA Q-4).
    expect(pass.byUserId.get(D)).toEqual({ kind: 'unknown' });

    // Counts and timing only — never a figure per account (SA C-W3).
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [ctx] = logger.info.mock.calls[0];
    expect(ctx).toEqual(expect.objectContaining({ outcome: 'ok', accounts: 4, percent: 2, no_allowance: 1, unknown: 1 }));
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/11610|32250/);
  });

  it('no row this period: nothing used, 100%', async () => {
    const { deps } = fixtureDeps({
      snapshots: { [A]: { unavailable: false, allowance: MONTHLY } },
      anchors: { [A]: ANCHOR },
      totals: [{ user_id: A, period_start: PREVIOUS, credits_total: '10' }],
    });
    const pass = await readAdminCreditsLeft([A], deps, log(), { now: NOW });
    expect(pass.byUserId.get(A)).toEqual({ kind: 'percent', value: 100, trial: false });
  });

  it('below 1% and at / over the allowance', async () => {
    const { deps } = fixtureDeps({
      snapshots: { [A]: { unavailable: false, allowance: MONTHLY }, [B]: { unavailable: false, allowance: MONTHLY } },
      anchors: { [A]: ANCHOR, [B]: ANCHOR },
      totals: [
        { user_id: A, period_start: PERIOD, credits_total: '32200' },
        { user_id: B, period_start: PERIOD, credits_total: '33000' },
      ],
    });
    const pass = await readAdminCreditsLeft([A, B], deps, log(), { now: NOW });
    expect(pass.byUserId.get(A)).toEqual({ kind: 'less_than_one', trial: false });
    expect(pass.byUserId.get(B)).toEqual({ kind: 'percent', value: 0, trial: false });
  });

  it('a trial sums every period from its anchor, and nothing before it', async () => {
    const { deps } = fixtureDeps({
      snapshots: { [B]: { unavailable: false, allowance: TRIAL } },
      anchors: { [B]: '2026-08-20T08:00:00+00:00' },
      totals: [
        { user_id: B, period_start: '2026-07-20T08:00:00+00:00', credits_total: '999' },
        { user_id: B, period_start: '2026-08-20T08:00:00+00:00', credits_total: '100' },
        { user_id: B, period_start: '2026-09-20T08:00:00+00:00', credits_total: '100' },
      ],
    });
    const pass = await readAdminCreditsLeft([B], deps, log(), { now: NOW });
    expect(pass.byUserId.get(B)).toEqual({ kind: 'percent', value: 90, trial: true });
  });

  it('an anchor on the 31st: the clamped February period is current at the end of March', async () => {
    const anchor = '2026-01-31T08:00:00.123456+00:00';
    const { deps } = fixtureDeps({
      snapshots: { [A]: { unavailable: false, allowance: MONTHLY } },
      anchors: { [A]: anchor },
      totals: [
        { user_id: A, period_start: '2026-01-31T08:00:00.123456+00:00', credits_total: '30000' },
        { user_id: A, period_start: '2026-02-28T08:00:00.123456+00:00', credits_total: '3225' },
      ],
    });
    const pass = await readAdminCreditsLeft([A], deps, log(), { now: new Date('2026-03-30T00:00:00.000Z') });
    expect(pass.byUserId.get(A)).toEqual({ kind: 'percent', value: 90, trial: false });
  });

  it('an unreadable figure makes only that account unknown', async () => {
    const { deps } = fixtureDeps({
      snapshots: { [A]: { unavailable: false, allowance: MONTHLY }, [B]: { unavailable: false, allowance: MONTHLY } },
      anchors: { [A]: ANCHOR, [B]: ANCHOR },
      totals: [
        { user_id: A, period_start: PERIOD, credits_total: 'not-a-number' },
        { user_id: B, period_start: PERIOD, credits_total: '0.2' },
      ],
    });
    const pass = await readAdminCreditsLeft([A, B], deps, log(), { now: NOW });
    expect(pass.outcome).toBe('ok');
    expect(pass.byUserId.get(A)).toEqual({ kind: 'unknown' });
    expect(pass.byUserId.get(B)).toEqual({ kind: 'percent', value: 99, trial: false });
  });

  it('a trial anchor older than 92 days is unknown and does not widen the range (SA Q-5)', async () => {
    const { deps, listTotalsForAccountsInRange } = fixtureDeps({
      snapshots: { [A]: { unavailable: false, allowance: MONTHLY }, [B]: { unavailable: false, allowance: TRIAL } },
      anchors: { [A]: ANCHOR, [B]: '2025-01-01T00:00:00+00:00' },
      totals: [],
    });
    const pass = await readAdminCreditsLeft([A, B], deps, log(), { now: NOW });
    expect(pass.byUserId.get(B)).toEqual({ kind: 'unknown' });
    expect(pass.byUserId.get(A)).toEqual({ kind: 'percent', value: 100, trial: false });
    const [ids, range] = listTotalsForAccountsInRange.mock.calls[0];
    expect(ids).toEqual([A]);
    // now − 32 days, at the UTC day.
    expect(range.from.toISOString()).toBe('2026-08-29T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('an in-bound trial anchor extends the range back to its own day', async () => {
    const { deps, listTotalsForAccountsInRange } = fixtureDeps({
      snapshots: { [B]: { unavailable: false, allowance: TRIAL } },
      anchors: { [B]: '2026-07-15T18:00:00.5+00:00' },
      totals: [],
    });
    await readAdminCreditsLeft([B], deps, log(), { now: NOW });
    expect(listTotalsForAccountsInRange.mock.calls[0][1].from.toISOString()).toBe('2026-07-15T00:00:00.000Z');
  });

  it('nobody to read: zero reads', async () => {
    const { deps, getSnapshots, findPeriodAnchorsBatch, listTotalsForAccountsInRange } = fixtureDeps({
      snapshots: {},
      anchors: {},
      totals: [],
    });
    const pass = await readAdminCreditsLeft([], deps, log(), { now: NOW });
    expect(pass).toEqual({ outcome: 'ok', byUserId: new Map() });
    expect(getSnapshots).not.toHaveBeenCalled();
    expect(findPeriodAnchorsBatch).not.toHaveBeenCalled();
    expect(listTotalsForAccountsInRange).not.toHaveBeenCalled();
  });

  it('no account with an allowance: no totals read', async () => {
    const { deps, listTotalsForAccountsInRange } = fixtureDeps({
      snapshots: { [A]: { unavailable: false, allowance: null } },
      anchors: { [A]: ANCHOR },
      totals: [],
    });
    const pass = await readAdminCreditsLeft([A], deps, log(), { now: NOW });
    expect(pass.byUserId.get(A)).toEqual({ kind: 'no_allowance' });
    expect(listTotalsForAccountsInRange).not.toHaveBeenCalled();
  });
});

describe('readAdminCreditsLeft — failure isolation', () => {
  it.each([
    ['the anchor read fails', { failAnchors: true }],
    ['the totals read fails', { failTotals: true }],
    ['the totals read reaches its ceiling (never a partial sum)', { ceiling: true }],
  ])('%s: every account unknown, one warning, never throws', async (_name, extra) => {
    const { deps } = fixtureDeps({
      snapshots: { [A]: { unavailable: false, allowance: MONTHLY }, [B]: { unavailable: false, allowance: null } },
      anchors: { [A]: ANCHOR, [B]: ANCHOR },
      totals: [],
      ...extra,
    });
    const logger = log();
    const pass = await readAdminCreditsLeft([A, B], deps, logger, { now: NOW });
    expect(pass.outcome).toBe('failed');
    expect([...pass.byUserId.values()]).toEqual([{ kind: 'unknown' }, { kind: 'unknown' }]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toEqual(expect.objectContaining({ outcome: 'failed' }));
  });

  it('a read that throws is a failed pass, not a thrown error', async () => {
    const { deps } = fixtureDeps({ snapshots: {}, anchors: {}, totals: [] });
    deps.findPeriodAnchorsBatch.mockImplementation(async () => {
      throw new Error('boom');
    });
    const pass = await readAdminCreditsLeft([A], deps, log(), { now: NOW });
    expect(pass.outcome).toBe('failed');
    expect(pass.byUserId.get(A)).toEqual({ kind: 'unknown' });
  });

  describe('the budget', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('a hung pass times out: every account unknown, one warning, no timer left; late results change nothing (SA C-W3)', async () => {
      const { deps } = fixtureDeps({
        snapshots: { [A]: { unavailable: false, allowance: MONTHLY } },
        anchors: { [A]: ANCHOR },
        totals: [{ user_id: A, period_start: PERIOD, credits_total: '0' }],
      });
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const realAnchors = deps.findPeriodAnchorsBatch.getMockImplementation()!;
      deps.findPeriodAnchorsBatch.mockImplementation(async (ids: readonly string[]) => {
        await gate;
        return realAnchors(ids);
      });
      const logger = log();

      const pending = readAdminCreditsLeft([A], deps, logger, { now: NOW, budgetMs: 2_000 });
      await jest.advanceTimersByTimeAsync(2_000);
      const pass = await pending;

      expect(pass.outcome).toBe('timeout');
      expect(pass.byUserId.get(A)).toEqual({ kind: 'unknown' });
      expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'timeout' }), expect.any(String));
      expect(jest.getTimerCount()).toBe(0);

      // The reads finish after the budget: the answer already given is unchanged.
      release();
      await jest.advanceTimersByTimeAsync(10);
      expect(pass.byUserId.get(A)).toEqual({ kind: 'unknown' });
      expect(pass.outcome).toBe('timeout');
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('a pass inside the budget clears its timer', async () => {
      const { deps } = fixtureDeps({
        snapshots: { [A]: { unavailable: false, allowance: MONTHLY } },
        anchors: { [A]: ANCHOR },
        totals: [],
      });
      const pass = await readAdminCreditsLeft([A], deps, log(), { now: NOW });
      expect(pass.outcome).toBe('ok');
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});

describe('readAdminCreditsLeft — calls grow per chunk, never per row (SA Q-6, C-S8-8)', () => {
  it.each([
    [1, 1, 1, 1],
    [100, 1, 1, 1],
    [101, 2, 2, 1],
    [201, 3, 3, 2],
  ])('%i accounts → %i snapshot chunk(s) · %i anchor read(s) · %i totals read(s)', async (n, snapshotChunks, anchorReads, totalsReads) => {
    const ids = Array.from({ length: n }, (_, i) => uid(i + 10));
    const { deps, findPeriodAnchorsBatch, listTotalsForAccountsInRange } = fixtureDeps({
      snapshots: Object.fromEntries(ids.map((id) => [id, { unavailable: false, allowance: MONTHLY }])),
      anchors: Object.fromEntries(ids.map((id) => [id, ANCHOR])),
      totals: [],
    });
    // The production `getSnapshots` reads one chunk of 100 per repository call.
    let snapshotReads = 0;
    deps.getSnapshots = (async (accountIds: string[]) => {
      snapshotReads += Math.ceil(accountIds.length / 100);
      return new Map(accountIds.map((id) => [id, { unavailable: false, allowance: MONTHLY }]));
    }) as unknown as AdminCreditPercentDeps['getSnapshots'];

    await readAdminCreditsLeft(ids, deps, log(), { now: NOW });

    expect(snapshotReads).toBe(snapshotChunks);
    expect(findPeriodAnchorsBatch).toHaveBeenCalledTimes(anchorReads);
    expect(listTotalsForAccountsInRange).toHaveBeenCalledTimes(totalsReads);
    for (const [chunk] of findPeriodAnchorsBatch.mock.calls) expect(chunk.length).toBeLessThanOrEqual(100);
    for (const [chunk] of listTotalsForAccountsInRange.mock.calls) expect(chunk.length).toBeLessThanOrEqual(200);
  });
});

describe('the admin % equals the owner card % (R-3, AC-43)', () => {
  it.each([
    ['monthly', MONTHLY, ANCHOR, PERIOD, '20640.123456'],
    ['monthly, nothing used', MONTHLY, ANCHOR, PERIOD, null],
    ['monthly, exactly 10%', MONTHLY, ANCHOR, PERIOD, '29025'],
    ['trial', TRIAL, TRIAL_ANCHOR, TRIAL_ANCHOR, '1999.6'],
  ])('%s', async (_name, allowance, anchor, period, total) => {
    const totals: AdminTotalsRow[] = total === null ? [] : [{ user_id: A, period_start: period, credits_total: total }];

    // The owner card's own read, with the same rows.
    const ownerDeps: OwnerCreditCardDeps = {
      findPeriodAnchor: async () => ({ data: anchor, error: null }),
      periodStartFor: async () => ({ data: period, error: null }),
      readAllowance: async () => allowance,
      now: () => NOW,
      owner: {
        findTotalsForPeriod: async (_account: string, key: string) => {
          const row = totals.find((t) => t.period_start === key);
          return {
            data: row
              ? { period_start: row.period_start, credits_total: row.credits_total, credits_owner: row.credits_total, credits_scheduled: 0, credits_external: 0, credits_adjustment: 0 }
              : null,
            error: null,
          };
        },
        listTotalsFrom: async () => ({
          data: {
            rows: totals.map((row) => ({
              period_start: row.period_start,
              credits_total: row.credits_total,
              credits_owner: row.credits_total,
              credits_scheduled: 0,
              credits_external: 0,
              credits_adjustment: 0,
            })),
            reachedCeiling: false,
          },
          error: null,
        }),
        listAdjustmentsForPeriods: async () => ({ data: { rows: [], reachedCeiling: false }, error: null }),
        findChargesByActionIds: async () => ({ data: [], error: null }),
        // Slice 11d: the card also reads the owner's credit lots (none here).
        listOwnCreditLots: async () => ({ data: [], error: null }),
      } as unknown as OwnerCreditCardDeps['owner'],
    };
    const card = await readOwnerCreditUsage(A, ownerDeps, { warn: jest.fn(), error: jest.fn() });
    const cardPercent = creditPercentLeft(card.data!.used, card.data!.allowance!.amount)!;

    const { deps } = fixtureDeps({
      snapshots: { [A]: { unavailable: false, allowance } },
      anchors: { [A]: anchor },
      totals,
    });
    const pass = await readAdminCreditsLeft([A], deps, log(), { now: NOW });
    const admin = pass.byUserId.get(A)!;

    if (cardPercent.shown.kind === 'percent') {
      expect(admin).toEqual(expect.objectContaining({ kind: 'percent', value: cardPercent.shown.value }));
    } else {
      expect(admin).toEqual(expect.objectContaining({ kind: 'less_than_one' }));
    }
  });
});
