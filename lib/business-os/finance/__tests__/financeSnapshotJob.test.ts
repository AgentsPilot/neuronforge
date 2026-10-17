/**
 * Finance slice 8.2: the nightly job (HS-W-2, HS-W-3, HS-FR-6, HS-FR-8, HS-FR-8b;
 * E-87, E-88, E-96; AC-279, AC-281, AC-282).
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const mockPositions = jest.fn();
jest.mock('@/lib/business-os/credits/adminCreditPercent', () => ({
  ...jest.requireActual('@/lib/business-os/credits/adminCreditPercent'),
  readAdminCreditPositions: (...a: unknown[]) => mockPositions(...a),
}));

import { ADMIN_CREDITS_BUDGET_MS } from '@/lib/business-os/credits/adminCreditPercent';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { ClassifyInput } from '../planGroups';
import { FINANCE_LIMITS } from '../financeHealth';
import type { FinanceSnapshotDeps } from '../financeSnapshotDeps';
import {
  runFinanceSnapshot,
  snapshotDayOf,
  SNAPSHOT_CREDIT_BUDGET_MS,
  SNAPSHOT_LATEST_START_HOUR_UTC,
} from '../financeSnapshotJob';

/** The plan row type through the classifier's own input (RC-15: no test names the plan repository). */
type BusinessOsAccountPlan = ClassifyInput['rows'][number];
const config = getEntitlementConfig();
const A = '11111111-1111-4111-8111-111111111111';
const plan = (user_id: string) =>
  ({
    user_id, tier: null, plan_version: 1, tier_expires_at: null, cohort: null, cohort_expires_at: null,
    onboarding_started_at: null, profile_created_at: null, trial_started_at: null, trial_ends_at: null,
    grace_ends_at: null, period_anchor: '2026-09-01T00:00:00.000Z', origin: 'trigger', updated_by_admin_id: null,
    created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
  }) as BusinessOsAccountPlan;
const ok = <T>(data: T) => Promise.resolve({ data, error: null });
const fail = () => Promise.resolve({ data: null, error: new Error('read failed') });

function deps(overrides: Partial<Record<string, unknown>> = {}) {
  const base = {
    plans: { pagePlans: jest.fn(() => ok([plan(A)])) },
    finance: { listBillingStatusesAllAccounts: jest.fn(() => ok([])) },
    credits: {},
    lots: { allAccounts: jest.fn(() => ok([])) },
    config,
    writer: {
      probeTable: jest.fn(() => ok({ installed: true })),
      insertSnapshotRows: jest.fn((rows: unknown[]) => ok({ written: rows.length, alreadyThere: 0 })),
    },
  };
  return { ...base, ...overrides } as typeof base;
}
const logger = () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() });
const at = (iso: string) => new Date(iso);
const run = (d = deps(), startedAt = at('2026-10-18T00:07:00.000Z'), log = logger()) =>
  runFinanceSnapshot({ startedAt }, d as unknown as FinanceSnapshotDeps, log);

beforeEach(() => {
  mockPositions.mockReset();
  mockPositions.mockResolvedValue({ outcome: 'ok', byUserId: new Map([[A, { kind: 'position', allowance: 1000, used: 10, trial: false }]]) });
});

describe('the day and the late gate (HS-W-2, HS-W-3, AC-279)', () => {
  it.each([
    ['2026-10-18T00:07:00.000Z', '2026-10-17'],
    ['2027-01-01T00:07:00.000Z', '2026-12-31'],
    ['2026-03-01T00:07:00.000Z', '2026-02-28'],
    ['2028-03-01T01:59:59.999Z', '2028-02-29'],
  ])('a start at %s records %s', (start, day) => {
    expect(snapshotDayOf(at(start))).toBe(day);
  });

  it('01:59:59 runs; 02:00:00 is late: nothing read or written, lateRun 1', async () => {
    const onTime = deps();
    expect((await run(onTime, at('2026-10-18T01:59:59.999Z'))).kind).toBe('done');
    const late = deps();
    const result = await run(late, at('2026-10-18T02:00:00.000Z'));
    expect(result).toEqual({
      kind: 'late',
      asOfDate: '2026-10-17',
      counts: { metricsWritten: 0, metricsAlreadyThere: 0, metricsSkipped: 0, familiesSkipped: 0, accountsRead: 0, lateRun: 1 },
    });
    expect(late.writer.probeTable).not.toHaveBeenCalled();
    expect(late.plans.pagePlans).not.toHaveBeenCalled();
    expect(late.writer.insertSnapshotRows).not.toHaveBeenCalled();
    expect(SNAPSHOT_LATEST_START_HOUR_UTC).toBe(2);
  });
});

describe('E-87: the night budget', () => {
  it('the pass gets budgetMs 30 000 and the run start as now; the page keeps 2 s', async () => {
    const startedAt = at('2026-10-18T00:07:00.000Z');
    await run(deps(), startedAt);
    expect(mockPositions).toHaveBeenCalledTimes(1);
    const [ids, , , options] = mockPositions.mock.calls[0] as [string[], unknown, unknown, { now: Date; budgetMs: number }];
    expect(ids).toEqual([A]);
    expect(options).toEqual({ now: startedAt, budgetMs: 30 * 1000 });
    expect(SNAPSHOT_CREDIT_BUDGET_MS).toBeLessThan(60 * 1000);
    expect(SNAPSHOT_CREDIT_BUDGET_MS).not.toBe(ADMIN_CREDITS_BUDGET_MS);
  });

  it('a capped walk runs no pass and skips plan and credit', async () => {
    const many = Array.from({ length: FINANCE_LIMITS.PLAN_PAGE_SIZE }, (_, i) => plan(`11111111-1111-4111-8111-${String(i).padStart(12, '0')}`));
    let page = 0;
    const d = deps({ plans: { pagePlans: jest.fn(() => ok(page++ < FINANCE_LIMITS.PLAN_CEILING / FINANCE_LIMITS.PLAN_PAGE_SIZE ? many : [])) } });
    const result = await run(d);
    expect(mockPositions).not.toHaveBeenCalled();
    if (result.kind !== 'done') throw new Error('expected done');
    expect(result.counts.familiesSkipped).toBe(2);
  });
});

describe('E-96: the table probe comes first', () => {
  it('not installed: zero reads, no insert', async () => {
    const d = deps();
    d.writer.probeTable.mockImplementation(() => ok({ installed: false }));
    expect(await run(d)).toEqual({ kind: 'not_installed', asOfDate: '2026-10-17' });
    expect(d.plans.pagePlans).not.toHaveBeenCalled();
    expect(d.finance.listBillingStatusesAllAccounts).not.toHaveBeenCalled();
    expect(d.lots.allAccounts).not.toHaveBeenCalled();
    expect(mockPositions).not.toHaveBeenCalled();
    expect(d.writer.insertSnapshotRows).not.toHaveBeenCalled();
  });

  it('a probe error (or a throw) is probe_failed, with zero reads', async () => {
    const d = deps();
    d.writer.probeTable.mockImplementation(() => fail() as never);
    expect((await run(d)).kind).toBe('probe_failed');
    const t = deps();
    t.writer.probeTable.mockImplementation(() => {
      throw new Error('boom');
    });
    expect((await run(t)).kind).toBe('probe_failed');
    expect(t.plans.pagePlans).not.toHaveBeenCalled();
  });
});

describe('the insert (E-88, AC-281)', () => {
  it('one insert with exactly the builder rows; counts from the repository', async () => {
    const d = deps();
    d.writer.insertSnapshotRows.mockImplementation((rows: unknown[]) => ok({ written: rows.length - 2, alreadyThere: 2 }));
    const result = await run(d);
    expect(d.writer.insertSnapshotRows).toHaveBeenCalledTimes(1);
    const [rows] = d.writer.insertSnapshotRows.mock.calls[0] as unknown as [Array<{ as_of_date: string }>];
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) expect(row.as_of_date).toBe('2026-10-17');
    if (result.kind !== 'done') throw new Error('expected done');
    expect(result.counts).toMatchObject({ metricsWritten: rows.length - 2, metricsAlreadyThere: 2, familiesSkipped: 0, accountsRead: 1, lateRun: 0 });
  });

  it('a second run the same day writes 0 (the repository reports everything already there)', async () => {
    const d = deps();
    d.writer.insertSnapshotRows.mockImplementation((rows: unknown[]) => ok({ written: 0, alreadyThere: rows.length }));
    const result = await run(d);
    if (result.kind !== 'done') throw new Error('expected done');
    expect(result.counts.metricsWritten).toBe(0);
    expect(result.counts.metricsAlreadyThere).toBeGreaterThan(0);
  });

  it('an insert error is insert_failed', async () => {
    const d = deps();
    d.writer.insertSnapshotRows.mockImplementation(() => fail() as never);
    expect((await run(d)).kind).toBe('insert_failed');
  });
});

describe('skips, never a throw (HS-W-5, AC-282)', () => {
  it.each([
    ['the walk fails', { plans: { pagePlans: jest.fn(() => fail()) } }, 2],
    ['the walk throws', { plans: { pagePlans: jest.fn(() => { throw new Error('x'); }) } }, 2],
    ['the billing read fails', { finance: { listBillingStatusesAllAccounts: jest.fn(() => fail()) } }, 1],
    ['the lots read fails', { lots: { allAccounts: jest.fn(() => fail()) } }, 1],
  ])('%s: the run is done, %i families skipped, each read logged by name', async (_name, overrides, skippedFamilies) => {
    const log = logger();
    const result = await run(deps(overrides), at('2026-10-18T00:07:00.000Z'), log);
    if (result.kind !== 'done') throw new Error('expected done');
    expect(result.counts.familiesSkipped).toBe(skippedFamilies);
    expect(log.error).toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ families: expect.any(Array) }), 'Finance snapshot families not recorded');
  });

  it('a throwing credit pass skips credit only', async () => {
    mockPositions.mockRejectedValue(new Error('pass exploded'));
    const result = await run();
    if (result.kind !== 'done') throw new Error('expected done');
    expect(result.counts.familiesSkipped).toBe(1);
  });

  it('no log line carries a figure, an account id or a name', async () => {
    const log = logger();
    await run(deps({ finance: { listBillingStatusesAllAccounts: jest.fn(() => fail()) } }), at('2026-10-18T00:07:00.000Z'), log);
    const logged = JSON.stringify([log.error.mock.calls, log.warn.mock.calls, log.info.mock.calls]);
    expect(logged).not.toContain(A);
  });
});
