/**
 * readAdminCreditPositions — the second projection of the admin credit pass
 * (finance & business health slice 1b, SA-Q7, SA-WR-12, AC-43).
 *
 * The existing `adminCreditPercent.test.ts` is deliberately NOT edited: it
 * proves the Businesses list is unchanged. This file proves the finance
 * projection carries the same core, and that the two projections agree. The
 * parity check goes through the PUBLIC `creditPercentLeft`, never a copy of
 * the percentage formula (SA-WR-12).
 *
 * As in the list's test, the entitlements service is replaced by injected
 * snapshots and the allowance view by a stand-in that reads the allowance the
 * test put on the snapshot: what is tested here is the pass, not the resolver.
 */

jest.mock('@/lib/business-os/entitlements/EntitlementService', () => ({
  getEntitlementService: () => ({
    getSnapshots: () => {
      throw new Error('production snapshots are not used in these tests');
    },
  }),
}));
jest.mock('@/lib/business-os/entitlements/creditAllowanceView', () => ({
  creditAllowanceForDisplay: (snapshot: { allowance?: unknown }) => snapshot.allowance ?? null,
}));

import {
  readAdminCreditPositions,
  readAdminCreditsLeft,
  type AdminCreditPercentDeps,
  type AdminTotalsRow,
} from '../adminCreditPercent';
import { creditPercentLeft } from '../creditBands';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const NOW = new Date('2026-09-30T12:00:00.000Z');
const ANCHOR = '2026-09-14T09:31:07.123456+00:00';
const PERIOD = '2026-09-14T09:31:07.123456+00:00';
const PREVIOUS = '2026-08-14T09:31:07.123456+00:00';
const TRIAL_ANCHOR = '2026-09-25T08:00:00.000001+00:00';
const OLD_TRIAL_ANCHOR = '2026-05-01T08:00:00.000000+00:00';
const ANCHOR_31 = '2026-08-31T08:00:00.123456+00:00';

// Test figures, not the price list.
const MONTHLY = { amount: 500, per: 'month' };
const TRIAL = { amount: 100, per: 'total' };

type Snapshot = { unavailable: boolean; allowance: { amount: number; per: string } | null };

interface Fixture {
  snapshots: Record<string, Snapshot>;
  anchors: Record<string, string>;
  totals: AdminTotalsRow[];
  failTotals?: boolean;
  hang?: boolean;
}

function fixtureDeps(f: Fixture) {
  const getSnapshots = jest.fn(async (ids: string[]) => {
    const out = new Map<string, unknown>();
    for (const id of ids) out.set(id, f.snapshots[id] ?? { unavailable: false, allowance: null });
    return out;
  });
  const findPeriodAnchorsBatch = jest.fn(async (ids: readonly string[]) => {
    if (f.hang) await new Promise(() => undefined);
    const out: Record<string, string> = {};
    for (const id of ids) if (f.anchors[id]) out[id] = f.anchors[id];
    return { data: out, error: null };
  });
  type TotalsArgs = Parameters<AdminCreditPercentDeps['listTotalsForAccountsInRange']>;
  type TotalsResult = Awaited<ReturnType<AdminCreditPercentDeps['listTotalsForAccountsInRange']>>;
  const listTotalsForAccountsInRange = jest.fn<Promise<TotalsResult>, TotalsArgs>(async (ids) => {
    if (f.failTotals) return { data: null, error: new Error('totals failed') };
    return { data: { rows: f.totals.filter((row) => ids.includes(row.user_id)), reachedCeiling: false }, error: null };
  });
  const deps = {
    getSnapshots: getSnapshots as unknown as AdminCreditPercentDeps['getSnapshots'],
    findPeriodAnchorsBatch,
    listTotalsForAccountsInRange,
  } satisfies AdminCreditPercentDeps;
  return { deps, getSnapshots, findPeriodAnchorsBatch, listTotalsForAccountsInRange };
}

const log = () => ({ info: jest.fn(), warn: jest.fn() });

/** Twelve accounts, one per case the list distinguishes (and the edges between them). */
const IDS = Array.from({ length: 12 }, (_v, i) => uid(i + 1));
const [MONTHLY_ID, TRIAL_ID, NO_ALLOWANCE, NO_PLAN_ROW, UNAVAILABLE, UNREADABLE, BELOW_ONE, AT_100, OVER_100, ON_31ST, OLD_TRIAL, FRACTION] = IDS;

const TWELVE: Fixture = {
  snapshots: {
    [MONTHLY_ID]: { unavailable: false, allowance: MONTHLY },
    [TRIAL_ID]: { unavailable: false, allowance: TRIAL },
    [NO_ALLOWANCE]: { unavailable: false, allowance: null },
    [NO_PLAN_ROW]: { unavailable: false, allowance: MONTHLY },
    [UNAVAILABLE]: { unavailable: true, allowance: null },
    [UNREADABLE]: { unavailable: false, allowance: MONTHLY },
    [BELOW_ONE]: { unavailable: false, allowance: MONTHLY },
    [AT_100]: { unavailable: false, allowance: MONTHLY },
    [OVER_100]: { unavailable: false, allowance: MONTHLY },
    [ON_31ST]: { unavailable: false, allowance: MONTHLY },
    [OLD_TRIAL]: { unavailable: false, allowance: TRIAL },
    [FRACTION]: { unavailable: false, allowance: MONTHLY },
  },
  anchors: {
    [MONTHLY_ID]: ANCHOR,
    [TRIAL_ID]: TRIAL_ANCHOR,
    [NO_ALLOWANCE]: ANCHOR,
    [UNAVAILABLE]: ANCHOR,
    [UNREADABLE]: ANCHOR,
    [BELOW_ONE]: ANCHOR,
    [AT_100]: ANCHOR,
    [OVER_100]: ANCHOR,
    [ON_31ST]: ANCHOR_31,
    [OLD_TRIAL]: OLD_TRIAL_ANCHOR,
    [FRACTION]: ANCHOR,
  },
  totals: [
    { user_id: MONTHLY_ID, period_start: PREVIOUS, credits_total: '400' },
    { user_id: MONTHLY_ID, period_start: PERIOD, credits_total: '180.123456' },
    { user_id: TRIAL_ID, period_start: TRIAL_ANCHOR, credits_total: 13 },
    { user_id: UNREADABLE, period_start: PERIOD, credits_total: 'not-a-number' },
    { user_id: BELOW_ONE, period_start: PERIOD, credits_total: '499.5' },
    { user_id: AT_100, period_start: PERIOD, credits_total: '500' },
    { user_id: OVER_100, period_start: PERIOD, credits_total: '750' },
    { user_id: ON_31ST, period_start: '2026-08-31T08:00:00.123456+00:00', credits_total: '120' },
    { user_id: ON_31ST, period_start: '2026-09-30T08:00:00.123456+00:00', credits_total: '35' },
    { user_id: FRACTION, period_start: PERIOD, credits_total: '0.1' },
    { user_id: FRACTION, period_start: PERIOD, credits_total: '0.2' },
  ],
};

describe('readAdminCreditPositions — the second projection (SA-Q7)', () => {
  it('projection parity: for every id, the list equals the public creditPercentLeft of the position (SA-WR-12)', async () => {
    const list = await readAdminCreditsLeft(IDS, fixtureDeps(TWELVE).deps, log(), { now: NOW });
    const positions = await readAdminCreditPositions(IDS, fixtureDeps(TWELVE).deps, log(), { now: NOW });

    expect(list.outcome).toBe('ok');
    expect(positions.outcome).toBe('ok');
    expect([...positions.byUserId.keys()]).toEqual(IDS);

    const kinds = new Set<string>();
    for (const id of IDS) {
      const position = positions.byUserId.get(id);
      const shown = list.byUserId.get(id);
      if (!position || !shown) throw new Error(`missing ${id}`);
      kinds.add(`${position.kind}/${shown.kind}`);
      if (position.kind !== 'position') {
        // no_allowance and unknown pass through unchanged.
        expect(shown).toEqual(position);
        continue;
      }
      const percent = creditPercentLeft(position.used, position.allowance);
      if (percent === null) {
        expect(shown).toEqual({ kind: 'unknown' });
      } else if (percent.shown.kind === 'less_than_one') {
        expect(shown).toEqual({ kind: 'less_than_one', trial: position.trial });
      } else {
        expect(shown).toEqual({ kind: 'percent', value: percent.shown.value, trial: position.trial });
      }
    }
    // Non-vacuity: the fixture reaches every kind on both sides.
    expect([...kinds].sort()).toEqual(['no_allowance/no_allowance', 'position/less_than_one', 'position/percent', 'unknown/unknown']);
  });

  it('positions carry the allowance and the credits used exactly, at 6 dp', async () => {
    const { byUserId } = await readAdminCreditPositions(IDS, fixtureDeps(TWELVE).deps, log(), { now: NOW });
    // Only the current period counts for a monthly plan.
    expect(byUserId.get(MONTHLY_ID)).toEqual({ kind: 'position', allowance: 500, used: 180.123456, trial: false });
    expect(byUserId.get(AT_100)).toEqual({ kind: 'position', allowance: 500, used: 500, trial: false });
    expect(byUserId.get(OVER_100)).toEqual({ kind: 'position', allowance: 500, used: 750, trial: false });
    // 0.1 + 0.2 is 0.3 at the ledger's 6 dp, not 0.30000000000000004.
    expect(byUserId.get(FRACTION)).toEqual({ kind: 'position', allowance: 500, used: 0.3, trial: false });
    expect(byUserId.get(NO_ALLOWANCE)).toEqual({ kind: 'no_allowance' });
    expect(byUserId.get(NO_PLAN_ROW)).toEqual({ kind: 'no_allowance' });
    expect(byUserId.get(UNAVAILABLE)).toEqual({ kind: 'unknown' });
    expect(byUserId.get(UNREADABLE)).toEqual({ kind: 'unknown' });
    expect(byUserId.get(OLD_TRIAL)).toEqual({ kind: 'unknown' });
  });

  it('a trial sums every period from its anchor, and nothing before it', async () => {
    const { deps } = fixtureDeps({
      snapshots: { [TRIAL_ID]: { unavailable: false, allowance: TRIAL } },
      anchors: { [TRIAL_ID]: TRIAL_ANCHOR },
      totals: [
        { user_id: TRIAL_ID, period_start: '2026-09-20T00:00:00+00:00', credits_total: '50' },
        { user_id: TRIAL_ID, period_start: TRIAL_ANCHOR, credits_total: '10' },
        { user_id: TRIAL_ID, period_start: '2026-09-28T00:00:00+00:00', credits_total: '5.5' },
      ],
    });
    const { byUserId } = await readAdminCreditPositions([TRIAL_ID], deps, log(), { now: NOW });
    expect(byUserId.get(TRIAL_ID)).toEqual({ kind: 'position', allowance: 100, used: 15.5, trial: true });
  });

  it('logs one info line with counts by kind and timing only, never a figure', async () => {
    const logger = log();
    await readAdminCreditPositions(IDS, fixtureDeps(TWELVE).deps, logger, { now: NOW });
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [ctx, msg] = logger.info.mock.calls[0];
    expect(msg).toBe('Admin credit positions pass served');
    expect(ctx).toEqual({ outcome: 'ok', accounts: 12, ms: expect.any(Number), position: 7, no_allowance: 2, unknown: 3 });
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/180\.123456|750|499\.5|500/);
  });

  it('a failed totals read → every id unknown, one warning, no figure in any log call', async () => {
    const logger = log();
    const pass = await readAdminCreditPositions(IDS, fixtureDeps({ ...TWELVE, failTotals: true }).deps, logger, { now: NOW });
    expect(pass.outcome).toBe('failed');
    expect(new Set([...pass.byUserId.values()].map((v) => v.kind))).toEqual(new Set(['unknown']));
    expect(pass.byUserId.size).toBe(12);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][1]).toBe('Admin credit positions pass failed; every row shows unknown');
    expect(logger.info).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(/180\.123456|750|499\.5/);
  });

  it('a hung pass times out → every id unknown, one warning', async () => {
    const logger = log();
    const pass = await readAdminCreditPositions(IDS, fixtureDeps({ ...TWELVE, hang: true }).deps, logger, { now: NOW, budgetMs: 20 });
    expect(pass.outcome).toBe('timeout');
    expect(new Set([...pass.byUserId.values()].map((v) => v.kind))).toEqual(new Set(['unknown']));
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]).toEqual([
      { outcome: 'timeout', accounts: 12, ms: expect.any(Number) },
      'Admin credit positions pass timed out; every row shows unknown',
    ]);
  });

  it('makes exactly the same read calls as the list for the same ids', async () => {
    const list = fixtureDeps(TWELVE);
    const finance = fixtureDeps(TWELVE);
    await readAdminCreditsLeft(IDS, list.deps, log(), { now: NOW });
    await readAdminCreditPositions(IDS, finance.deps, log(), { now: NOW });
    expect(finance.getSnapshots.mock.calls).toEqual(list.getSnapshots.mock.calls);
    expect(finance.findPeriodAnchorsBatch.mock.calls).toEqual(list.findPeriodAnchorsBatch.mock.calls);
    expect(finance.listTotalsForAccountsInRange.mock.calls).toEqual(list.listTotalsForAccountsInRange.mock.calls);
    expect(finance.listTotalsForAccountsInRange).toHaveBeenCalledTimes(1);
  });

  it('a restarted period (re-anchor fix): finance agrees with the list, and the account is not over its allowance', async () => {
    // Test figure: below the old period's usage, so counting the old row would read "over".
    const allowance = { amount: 400, per: 'month' };
    const fixture: Fixture = {
      snapshots: { [MONTHLY_ID]: { unavailable: false, allowance } },
      anchors: { [MONTHLY_ID]: '2026-10-12T18:21:50Z' },
      totals: [{ user_id: MONTHLY_ID, period_start: '2026-10-04 15:15:01+00', credits_total: '20276' }],
    };
    const now = new Date('2026-10-12T19:00:00Z');
    const positions = await readAdminCreditPositions([MONTHLY_ID], fixtureDeps(fixture).deps, log(), { now });
    const list = await readAdminCreditsLeft([MONTHLY_ID], fixtureDeps(fixture).deps, log(), { now });

    const position = positions.byUserId.get(MONTHLY_ID);
    expect(position).toEqual({ kind: 'position', allowance: 400, used: 0, trial: false });
    if (position?.kind !== 'position') throw new Error('expected a position');
    expect(position.used).toBeLessThanOrEqual(position.allowance);
    const percent = creditPercentLeft(position.used, position.allowance);
    expect(list.byUserId.get(MONTHLY_ID)).toEqual({ kind: 'percent', value: percent?.shown.kind === 'percent' ? percent.shown.value : -1, trial: false });
    expect(list.byUserId.get(MONTHLY_ID)).toEqual({ kind: 'percent', value: 100, trial: false });
  });

  it('nobody to read: zero reads, an empty ok pass', async () => {
    const { deps, getSnapshots, findPeriodAnchorsBatch } = fixtureDeps(TWELVE);
    const pass = await readAdminCreditPositions([], deps, log(), { now: NOW });
    expect(pass).toEqual({ outcome: 'ok', byUserId: new Map() });
    expect(getSnapshots).not.toHaveBeenCalled();
    expect(findPeriodAnchorsBatch).not.toHaveBeenCalled();
  });
});
