/**
 * The admin AI Activity view's builder (Gap B slice B1a): one row per charge,
 * corrections netted in by id, the cut-over clamp, the area filter, the honest
 * count and cap, names, the deleted-account bucket, and that the list never
 * reaches `token_usage`. Workplan
 * docs/workplans/BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_B1_WORKPLAN.md § D and
 * the Test Plan (AC-B1, B3, B5, B7, B9, B11, B19, B20).
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  AI_ACTIVITY_LIMITS,
  AiActivityListReadError,
  aiActivityAreaOptions,
  buildAiActivity,
  CHARGING_CUTOVER_FLOOR_MS,
  CHARGING_CUTOVER_ISO,
  type AiActivityDeps,
  type BuildAiActivityInput,
} from '../aiActivity';
import { areaFor } from '../effectiveFields';
import { AI_CHARGE_SERVICE } from '@/lib/business-os/llm/aiChargeRecorder';
import type {
  ChargeListPage,
  CreditLedgerPagedResult,
  CreditLedgerRow,
} from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const GROUP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = new Date('2026-10-02T12:00:00.000Z');

const id = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

let seq = 0;
function charge(user: string | null, cost: string, credits: string, extra: Partial<CreditLedgerRow> = {}): CreditLedgerRow {
  seq += 1;
  return {
    id: `row-${seq}`,
    kind: 'charge',
    action_id: id(seq),
    adjusts_action_id: null,
    reason_code: null,
    user_id: user,
    period_start: '2026-09-29T00:00:00+00:00',
    group_id: GROUP,
    credits,
    cost_usd: cost,
    credit_value_version: 0,
    is_fallback_priced: false,
    service: 'ai',
    action_type: 'chat_turn',
    triggered_by: 'owner',
    outcome: 'succeeded',
    created_at: '2026-10-01T10:00:00+00:00',
    ...extra,
  };
}

function adjustment(user: string | null, adjusts: string, cost: string, credits: string, extra: Partial<CreditLedgerRow> = {}): CreditLedgerRow {
  seq += 1;
  return {
    id: `row-${seq}`,
    kind: 'adjustment',
    action_id: null,
    adjusts_action_id: adjusts,
    reason_code: 'fallback_price_reconciled',
    user_id: user,
    period_start: '2026-09-29T00:00:00+00:00',
    group_id: null,
    credits,
    cost_usd: cost,
    credit_value_version: 0,
    is_fallback_priced: false,
    service: null,
    action_type: null,
    triggered_by: null,
    outcome: null,
    created_at: '2026-10-01T11:00:00+00:00',
    ...extra,
  };
}

const log = { error: jest.fn(), warn: jest.fn() };

interface Seed {
  page?: CreditLedgerRow[];
  total?: number | null;
  adjustments?: CreditLedgerRow[];
  deleted?: CreditLedgerRow[];
  deletedTotal?: number | null;
  deletedReachedCeiling?: boolean;
  names?: { user_id: string; company_name: string | null }[];
}

/**
 * Typed against the REAL dependency signatures (SA-CR-1): each fake is a
 * `jest.Mock` of the member's own return and parameter types, so a change to
 * the repository's signature or result shape fails `typecheck:bos-llm` here
 * instead of passing silently through a cast.
 */
type Ledger = AiActivityDeps['ledger'];
type FakeOf<F extends (...args: never[]) => unknown> = jest.Mock<ReturnType<F>, Parameters<F>>;
type FakeLedger = { [K in keyof Ledger]: FakeOf<Ledger[K]> };
type DeletedPage = CreditLedgerPagedResult<CreditLedgerRow> & { total: number | null };

/** A jest.fn whose call and return types ARE the member's: `jest.fn` alone infers them from the implementation. */
function fake<F extends (...args: never[]) => unknown>(impl: (...args: Parameters<F>) => ReturnType<F>): FakeOf<F> {
  return jest.fn<ReturnType<F>, Parameters<F>>(impl);
}

function makeDeps(seed: Seed = {}) {
  const page: ChargeListPage = {
    rows: seed.page ?? [],
    total: seed.total === undefined ? (seed.page ?? []).length : seed.total,
  };
  const deleted: DeletedPage = {
    rows: seed.deleted ?? [],
    reachedCeiling: seed.deletedReachedCeiling ?? false,
    total: seed.deletedTotal === undefined ? (seed.deleted ?? []).length : seed.deletedTotal,
  };
  const adjustmentsFor = (ids: readonly string[]): CreditLedgerPagedResult<CreditLedgerRow> => ({
    rows: (seed.adjustments ?? []).filter((a) => a.adjusts_action_id !== null && ids.includes(a.adjusts_action_id)),
    reachedCeiling: false,
  });
  const ledger: FakeLedger = {
    listChargesAllAccountsInWindow: fake<Ledger['listChargesAllAccountsInWindow']>(async () => ({ data: page, error: null })),
    listChargesForAccountInWindow: fake<Ledger['listChargesForAccountInWindow']>(async () => ({ data: page, error: null })),
    listAdjustmentsForActionIds: fake<Ledger['listAdjustmentsForActionIds']>(async (ids) => ({
      data: adjustmentsFor(ids),
      error: null,
    })),
    listChargesOfDeletedAccountsInWindow: fake<Ledger['listChargesOfDeletedAccountsInWindow']>(async () => ({
      data: deleted,
      error: null,
    })),
  };
  const findNames = fake<AiActivityDeps['findNames']>(async () => ({
    data: seed.names ?? [
      { user_id: A, company_name: 'Alpha Studio' },
      { user_id: B, company_name: 'Beta Bakery' },
    ],
    error: null,
  }));
  const deps: AiActivityDeps = { ledger, findNames, now: () => NOW };
  return { deps, ledger, findNames };
}

const input = (over: Partial<BuildAiActivityInput> = {}): BuildAiActivityInput => ({
  window: { from: '2026-10-01', to: '2026-10-02' },
  accountId: null,
  area: null,
  outcome: null,
  trigger: null,
  minCostUsd: null,
  sort: 'time',
  limit: 100,
  ...over,
});

/** The arguments of a fake's first call, typed as the real member's parameters. */
const firstCall = <R, P extends unknown[]>(mock: jest.Mock<R, P>): P => mock.mock.calls[0];

beforeEach(() => {
  jest.clearAllMocks();
  seq = 0;
});

describe('AC-B1 / AC-B19: one row per charge, corrections netted in', () => {
  it('two charges and one correction give two rows, the correction netted into its own charge', async () => {
    const c1 = charge(A, '0.0040000000', '4.000000');
    const c2 = charge(A, '0.0010000000', '1.000000', { is_fallback_priced: true });
    const adj = adjustment(A, c2.action_id as string, '-0.0004000000', '-0.400000');
    const { deps } = makeDeps({ page: [c1, c2], adjustments: [adj] });

    const payload = await buildAiActivity(input(), log, deps);

    expect(payload.rows).toHaveLength(2);
    expect(payload.rows[0]).toMatchObject({
      actionId: c1.action_id,
      accountId: A,
      companyName: 'Alpha Studio',
      area: 'chat',
      actionType: 'chat_turn',
      trigger: 'owner',
      outcome: 'succeeded',
      groupId: GROUP,
      costUsd: { gross: 0.004, net: 0.004 },
      credits: { gross: 4, net: 4 },
      corrected: false,
      adjustmentCount: 0,
      reasonCodes: [],
      isFallbackPriced: false,
    });
    expect(payload.rows[1]).toMatchObject({
      actionId: c2.action_id,
      costUsd: { gross: 0.001, net: 0.0006 },
      credits: { gross: 1, net: 0.6 },
      corrected: true,
      adjustmentCount: 1,
      reasonCodes: ['fallback_price_reconciled'],
      isFallbackPriced: true,
    });
    expect(payload.adjustments).toBe('ok');
    expect(payload.unresolvedAdjustments).toBe(0);
  });

  it('looks corrections up by the page\'s own action ids, unwindowed: a later-period correction still nets', async () => {
    const c1 = charge(A, '0.0020000000', '2.000000');
    const late = adjustment(A, c1.action_id as string, '-0.0020000000', '-2.000000', {
      created_at: '2026-12-15T00:00:00+00:00',
      period_start: '2026-12-01T00:00:00+00:00',
    });
    const { deps, ledger } = makeDeps({ page: [c1], adjustments: [late] });
    const payload = await buildAiActivity(input(), log, deps);

    expect(ledger.listAdjustmentsForActionIds).toHaveBeenCalledWith([c1.action_id]);
    expect(payload.rows[0]).toMatchObject({ costUsd: { gross: 0.002, net: 0 }, credits: { gross: 2, net: 0 }, corrected: true });
    // Never its own row.
    expect(payload.rows).toHaveLength(1);
  });

  it('a correction on ANOTHER account is not netted, only counted, and none of its data is sent', async () => {
    const c1 = charge(A, '0.0020000000', '2.000000');
    const foreign = adjustment(B, c1.action_id as string, '-0.0019999999', '-1.999999', { reason_code: 'marker_foreign_reason' });
    const { deps } = makeDeps({ page: [c1], adjustments: [foreign] });
    const payload = await buildAiActivity(input(), log, deps);

    expect(payload.rows[0]).toMatchObject({ costUsd: { gross: 0.002, net: 0.002 }, corrected: false });
    expect(payload.unresolvedAdjustments).toBe(1);
    const json = JSON.stringify(payload);
    expect(json).not.toContain('marker_foreign_reason');
    expect(json).not.toContain(foreign.id);
    expect(json).not.toContain('1.999999');
  });

  it('when corrections cannot be read, no row shows a net figure: a gross figure is never shown as net', async () => {
    const c1 = charge(A, '0.0020000000', '2.000000');
    const { deps, ledger } = makeDeps({ page: [c1] });
    ledger.listAdjustmentsForActionIds.mockResolvedValueOnce({ data: null, error: new Error('down') });
    const payload = await buildAiActivity(input(), log, deps);

    expect(payload.adjustments).toBe('failed');
    expect(payload.rows[0].costUsd).toEqual({ gross: 0.002, net: null });
    expect(payload.rows[0].credits).toEqual({ gross: 2, net: null });
    expect(log.error).toHaveBeenCalled();
  });

  it('a correction read cut at its ceiling counts as unread', async () => {
    const c1 = charge(A, '0.0020000000', '2.000000');
    const { deps, ledger } = makeDeps({ page: [c1] });
    ledger.listAdjustmentsForActionIds.mockResolvedValueOnce({ data: { rows: [], reachedCeiling: true }, error: null });
    const payload = await buildAiActivity(input(), log, deps);
    expect(payload.adjustments).toBe('failed');
    expect(payload.rows[0].costUsd.net).toBeNull();
  });

  it('an unreadable amount counts as 0 and is counted, never silent', async () => {
    const { deps } = makeDeps({ page: [charge(A, 'not-a-number', '1.000000')] });
    const payload = await buildAiActivity(input(), log, deps);
    expect(payload.unreadableAmounts).toBe(1);
    expect(payload.rows[0].costUsd.gross).toBe(0);
  });
});

describe('AC-B5 (list half): accounts sharing a grouping id', () => {
  it('all-accounts mode gives each charge its own account', async () => {
    const a = charge(A, '0.0010000000', '1.000000');
    const b = charge(B, '0.0020000000', '2.000000');
    const { deps } = makeDeps({ page: [a, b] });
    const payload = await buildAiActivity(input(), log, deps);
    expect(payload.rows.map((r) => [r.accountId, r.companyName, r.groupId])).toEqual([
      [A, 'Alpha Studio', GROUP],
      [B, 'Beta Bakery', GROUP],
    ]);
  });

  it('choosing an account uses the account-scoped read with that account, and no deleted bucket', async () => {
    const { deps, ledger } = makeDeps({ page: [charge(A, '0.0010000000', '1.000000')] });
    const payload = await buildAiActivity(input({ accountId: A }), log, deps);
    expect(ledger.listChargesAllAccountsInWindow).not.toHaveBeenCalled();
    expect(ledger.listChargesForAccountInWindow.mock.calls[0][0]).toBe(A);
    expect(ledger.listChargesOfDeletedAccountsInWindow).not.toHaveBeenCalled();
    expect(payload.deletedAccounts).toBeNull();
    expect(payload.filters.accountId).toBe(A);
  });
});

describe('AC-B3: filters and sort reach the repository', () => {
  it('passes outcome, trigger and the cost floor, and maps the cost sort to the GROSS column', async () => {
    const { deps, ledger } = makeDeps();
    await buildAiActivity(input({ outcome: 'failed', trigger: 'scheduled', minCostUsd: '0.01', sort: 'cost', limit: 25 }), log, deps);
    const [filter, opts] = firstCall(ledger.listChargesAllAccountsInWindow);
    expect(filter).toMatchObject({ outcome: 'failed', triggeredBy: 'scheduled', minCostUsd: '0.01' });
    expect(filter.actionTypes).toBeUndefined();
    expect(opts).toEqual({ sort: 'cost_usd', limit: 25 });
  });

  it('time sort maps to created_at', async () => {
    const { deps, ledger } = makeDeps();
    await buildAiActivity(input(), log, deps);
    expect(firstCall(ledger.listChargesAllAccountsInWindow)[1]).toEqual({ sort: 'created_at', limit: 100 });
  });

  it('an area resolves to its action types through areaFor(AI_CHARGE_SERVICE, ...) (SA-B1-9)', async () => {
    const { deps, ledger } = makeDeps();
    await buildAiActivity(input({ area: 'website' }), log, deps);
    const [filter] = firstCall(ledger.listChargesAllAccountsInWindow);
    const types = filter.actionTypes ?? [];
    expect(types.length).toBeGreaterThan(1);
    for (const type of types) expect(areaFor(AI_CHARGE_SERVICE, type)).toBe('website');
    expect(types).toContain('website_full_site');
  });

  it('an area with no declared action type makes no query at all', async () => {
    const { deps, ledger } = makeDeps();
    const payload = await buildAiActivity(input({ area: 'no_such_area' }), log, deps);
    expect(ledger.listChargesAllAccountsInWindow).not.toHaveBeenCalled();
    expect(ledger.listChargesOfDeletedAccountsInWindow).not.toHaveBeenCalled();
    expect(payload.rows).toEqual([]);
    expect(payload.total).toBe(0);
  });

  it('every area offered carries its action types as plain data', () => {
    const areas = aiActivityAreaOptions();
    expect(areas.length).toBeGreaterThan(0);
    for (const a of areas) {
      expect(a.actionTypes.length).toBeGreaterThan(0);
      for (const t of a.actionTypes) expect(areaFor(AI_CHARGE_SERVICE, t)).toBe(a.area);
    }
  });
});

describe('AC-B11: the cap and the honest count', () => {
  it('passes the FILTERED count through and says when more match than are shown', async () => {
    // The repository's count is for the filtered query; a fake unfiltered
    // figure elsewhere must not leak in.
    const rows = [charge(A, '0.0010000000', '1.000000'), charge(A, '0.0010000000', '1.000000')];
    const { deps } = makeDeps({ page: rows, total: 250 });
    const payload = await buildAiActivity(input({ limit: 2 }), log, deps);
    expect(payload.total).toBe(250);
    expect(payload.capped).toBe(true);
    expect(payload.limit).toBe(2);
  });

  it('not capped when the count equals the rows shown', async () => {
    const { deps } = makeDeps({ page: [charge(A, '0.0010000000', '1.000000')], total: 1 });
    expect((await buildAiActivity(input(), log, deps)).capped).toBe(false);
  });

  it('a missing count is sent as null, never 0; a full page then reads as possibly capped', async () => {
    const { deps } = makeDeps({ page: [charge(A, '0.0010000000', '1.000000')], total: null });
    const payload = await buildAiActivity(input({ limit: 1 }), log, deps);
    expect(payload.total).toBeNull();
    expect(payload.capped).toBe(true);
  });

  it('the row limit is the repository cap', () => {
    expect(AI_ACTIVITY_LIMITS.MAX_ROWS).toBe(100);
    expect(AI_ACTIVITY_LIMITS.MAX_WINDOW_DAYS).toBe(92);
  });
});

describe('AC-B20: the cut-over', () => {
  it('is the live first-charge instant (F-21), floored to the millisecond, never rounded up', () => {
    expect(CHARGING_CUTOVER_ISO).toBe('2026-09-29T16:50:53.914167Z');
    expect(new Date(CHARGING_CUTOVER_FLOOR_MS).toISOString()).toBe('2026-09-29T16:50:53.914Z');
    // The floor is at or below the microsecond value: 914 ms <= 914.167 ms.
    expect(CHARGING_CUTOVER_FLOOR_MS).toBeLessThanOrEqual(Date.parse('2026-09-29T16:50:53.914Z'));
    expect(CHARGING_CUTOVER_FLOOR_MS).toBeGreaterThan(Date.parse('2026-09-29T16:50:53.913Z'));
  });

  it('a window entirely before it reads nothing and says so', async () => {
    const { deps, ledger, findNames } = makeDeps({ page: [charge(A, '0.0010000000', '1.000000')] });
    const payload = await buildAiActivity(input({ window: { from: '2026-09-01', to: '2026-09-28' } }), log, deps);
    expect(payload.cutover).toEqual({ at: CHARGING_CUTOVER_ISO, coverage: 'entirely_before_cutover' });
    expect(payload.rows).toEqual([]);
    expect(payload.deletedAccounts).toBeNull();
    for (const fn of Object.values(ledger)) expect(fn).not.toHaveBeenCalled();
    expect(findNames).not.toHaveBeenCalled();
  });

  it('a window straddling it is clamped to the floor', async () => {
    const { deps, ledger } = makeDeps();
    const payload = await buildAiActivity(input({ window: { from: '2026-09-15', to: '2026-10-01' } }), log, deps);
    expect(payload.cutover.coverage).toBe('starts_before_cutover');
    const [filter] = firstCall(ledger.listChargesAllAccountsInWindow);
    expect(filter.range.from.toISOString()).toBe('2026-09-29T16:50:53.914Z');
    expect(filter.range.to.toISOString()).toBe('2026-10-02T00:00:00.000Z');
    // The payload's own window is the one asked for, not the clamp.
    expect(payload.window).toEqual({
      from: '2026-09-15',
      to: '2026-10-01',
      start: '2026-09-15T00:00:00.000Z',
      end: '2026-10-02T00:00:00.000Z',
    });
  });

  it('a window wholly after it is read as asked', async () => {
    const { deps, ledger } = makeDeps();
    const payload = await buildAiActivity(input(), log, deps);
    expect(payload.cutover.coverage).toBe('after_cutover');
    expect(firstCall(ledger.listChargesAllAccountsInWindow)[0].range.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('the 29th itself straddles it', async () => {
    const { deps } = makeDeps();
    const payload = await buildAiActivity(input({ window: { from: '2026-09-29', to: '2026-09-29' } }), log, deps);
    expect(payload.cutover.coverage).toBe('starts_before_cutover');
  });
});

describe('names', () => {
  it('a failed lookup keeps the list and marks names failed', async () => {
    const { deps, findNames } = makeDeps({ page: [charge(A, '0.0010000000', '1.000000')] });
    findNames.mockResolvedValueOnce({ data: null, error: new Error('down') });
    const payload = await buildAiActivity(input(), log, deps);
    expect(payload.names).toBe('failed');
    expect(payload.rows[0].companyName).toBeNull();
    expect(payload.rows).toHaveLength(1);
  });

  it('a synchronous throw from the lookup fails only the names', async () => {
    const { deps, findNames } = makeDeps({ page: [charge(A, '0.0010000000', '1.000000')] });
    findNames.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const payload = await buildAiActivity(input(), log, deps);
    expect(payload.names).toBe('failed');
  });

  it('is asked only for the accounts on the page, once each', async () => {
    const { deps, findNames } = makeDeps({
      page: [charge(A, '0.0010000000', '1.000000'), charge(A, '0.0010000000', '1.000000'), charge(B, '0.0010000000', '1.000000')],
    });
    await buildAiActivity(input(), log, deps);
    expect(findNames).toHaveBeenCalledWith([A, B]);
  });
});

describe('the list read itself', () => {
  it('a failed page is an error, never an empty list', async () => {
    const { deps, ledger } = makeDeps();
    ledger.listChargesAllAccountsInWindow.mockResolvedValueOnce({ data: null, error: new Error('down') });
    await expect(buildAiActivity(input(), log, deps)).rejects.toBeInstanceOf(AiActivityListReadError);
  });

  it('a row that is not a live charge is logged and never shown', async () => {
    const stray = charge(null, '0.0010000000', '1.000000');
    const { deps } = makeDeps({ page: [stray, charge(A, '0.0010000000', '1.000000')] });
    const payload = await buildAiActivity(input(), log, deps);
    expect(payload.rows.map((r) => r.accountId)).toEqual([A]);
    expect(log.warn).toHaveBeenCalled();
  });
});

describe('AC-B9 (deleted-account part): the bucket', () => {
  it('counts exactly, nets corrections, and is never merged into a row', async () => {
    const d1 = charge(null, '0.0030000000', '3.000000');
    const d2 = charge(null, '0.0010000000', '1.000000');
    const adj = adjustment(null, d1.action_id as string, '-0.0010000000', '-1.000000');
    const { deps, ledger } = makeDeps({ page: [charge(A, '0.0010000000', '1.000000')], deleted: [d1, d2], deletedTotal: 2, adjustments: [adj] });
    const payload = await buildAiActivity(input({ outcome: 'succeeded' }), log, deps);

    expect(payload.deletedAccounts).toEqual({ status: 'ok', count: 2, costUsd: 0.003, credits: 3, atLeast: false });
    expect(payload.rows.every((r) => r.accountId === A)).toBe(true);
    // Same filters as the list.
    expect(firstCall(ledger.listChargesOfDeletedAccountsInWindow)[0]).toMatchObject({ outcome: 'succeeded' });
    expect(firstCall(ledger.listChargesOfDeletedAccountsInWindow)[1]).toEqual({
      pageSize: AI_ACTIVITY_LIMITS.DELETED_BUCKET_PAGE_SIZE,
      ceiling: AI_ACTIVITY_LIMITS.DELETED_BUCKET_CEILING,
    });
  });

  it('says "at least" when the read stopped at its ceiling', async () => {
    const { deps } = makeDeps({ deleted: [charge(null, '0.0010000000', '1.000000')], deletedTotal: 5000, deletedReachedCeiling: true });
    const payload = await buildAiActivity(input(), log, deps);
    expect(payload.deletedAccounts).toMatchObject({ status: 'ok', count: 5000, atLeast: true });
  });

  it('a failed bucket read fails the bucket only', async () => {
    const { deps, ledger } = makeDeps({ page: [charge(A, '0.0010000000', '1.000000')] });
    ledger.listChargesOfDeletedAccountsInWindow.mockResolvedValueOnce({ data: null, error: new Error('down') });
    const payload = await buildAiActivity(input(), log, deps);
    expect(payload.deletedAccounts).toEqual({ status: 'failed', count: null, costUsd: null, credits: null, atLeast: false });
    expect(payload.rows).toHaveLength(1);
  });
});

describe('AC-B7 (list half) and SA-B1-9, by source', () => {
  const codeOf = (rel: string) =>
    fs
      .readFileSync(path.join(process.cwd(), rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const FILES = [
    'lib/business-os/credits/aiActivity.ts',
    'lib/business-os/credits/aiActivityDeps.ts',
    'app/api/admin/business-os/ai-activity/route.ts',
  ];

  it('the rule matches a planted violation, so a clean file means something', () => {
    expect(/TokenUsageRepository|token_usage/.test(`import { tokenUsageRepository } from '@/lib/repositories/TokenUsageRepository';`)).toBe(true);
  });

  it.each(FILES)('%s names neither TokenUsageRepository nor token_usage', (rel) => {
    expect(codeOf(rel)).not.toMatch(/TokenUsageRepository|token_usage/);
  });

  it('the deps type has no usage member', () => {
    expect(codeOf('lib/business-os/credits/aiActivity.ts')).not.toMatch(/usage/i);
  });

  it('resolves areas with the AI service constant, not a literal', () => {
    const code = codeOf('lib/business-os/credits/aiActivity.ts');
    expect(code).toContain('areaFor(AI_CHARGE_SERVICE,');
    expect(code).not.toMatch(/areaFor\(\s*['"]/);
  });
});
