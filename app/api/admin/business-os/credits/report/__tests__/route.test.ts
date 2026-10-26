/**
 * GET /api/admin/business-os/credits/report (credit deduction slice 4a,
 * workplan §4.5, §10.1): 401 / 403 before any read, 400 on every invalid
 * query, 409 on a platform account, 200, 500.
 *
 * Money MK-2 (ruled updates RU-6, RU-7): the no-dates default is This month
 * (was the last 30 days); the ledger mock gains R-a / R-a′ (the window's
 * charged AI cost, `chargedInWindow`), and every refusal proves neither ran.
 */

import * as fs from 'fs';
import * as path from 'path';
import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: (...a: unknown[]) => mockLog.info(...a),
      warn: (...a: unknown[]) => mockLog.warn(...a),
      error: (...a: unknown[]) => mockLog.error(...a),
      debug: (...a: unknown[]) => mockLog.debug(...a),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

const mockLedger = {
  listTotalsForPeriodsInRange: jest.fn(),
  listTotalsForAccountInRange: jest.fn(),
  listRowsForAccountPeriods: jest.fn(),
  findChargesByActionIds: jest.fn(),
  // MK-2: Finance's ledger read, for `chargedInWindow`.
  listRowsOfAllAccountsCreatedInRange: jest.fn(),
  listRowsForAccountCreatedInRange: jest.fn(),
};
// MK-2: the route now also loads `aiActivity` (through Finance's shared read), which needs
// the repository module's real constants; only the singleton is replaced.
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/repositories/BusinessOsCreditLedgerReadRepository', () => ({
  ...jest.requireActual('@/lib/repositories/BusinessOsCreditLedgerReadRepository'),
  businessOsCreditLedgerReadRepository: mockLedger,
}));

const mockFindNames = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findAdminIdentitiesByUserIds: (...a: unknown[]) => mockFindNames(...a) },
}));

import { GET } from '../route';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const OWNER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };
const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const PLATFORM = '00000000-0000-0000-0000-000000000000';
const PERIOD = '2026-09-05T00:00:00+00:00';

const call = (query = '') => GET(new NextRequest(`http://localhost/api/admin/business-os/credits/report${query}`));

const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};

const todayUtc = () => new Date().toISOString().slice(0, 10);
const daysFromToday = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function ledgerWithOnePeriod() {
  const totals = {
    data: {
      rows: [
        {
          user_id: ACCOUNT, period_start: PERIOD, credits_total: '2.000000', credits_owner: '2.000000',
          credits_scheduled: '0', credits_external: '0', credits_adjustment: '0', cost_usd_total: '0.0020000000',
          charge_count: 1, fallback_priced_count: 0, updated_at: PERIOD,
        },
      ],
      reachedCeiling: false,
    },
    error: null,
  };
  mockLedger.listTotalsForPeriodsInRange.mockResolvedValue(totals);
  mockLedger.listTotalsForAccountInRange.mockResolvedValue(totals);
  mockLedger.listRowsForAccountPeriods.mockResolvedValue({
    data: {
      rows: [
        {
          id: 'r1', kind: 'charge', action_id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', adjusts_action_id: null,
          reason_code: null, user_id: ACCOUNT, period_start: PERIOD, group_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          credits: '2.000000', cost_usd: '0.0020000000', credit_value_version: 0, is_fallback_priced: false,
          service: 'ai', action_type: 'chat_turn', triggered_by: 'owner', outcome: 'succeeded', created_at: PERIOD,
        },
      ],
      reachedCeiling: false,
    },
    error: null,
  });
  mockFindNames.mockResolvedValue({ data: [{ user_id: ACCOUNT, company_name: 'Alpha Studio' }], error: null });
  // MK-2: charges CREATED in the window: one of the account, one of a deleted account.
  const created = (user_id: string | null, cost: string) => ({
    id: `c-${cost}`, kind: 'charge', action_id: null, adjusts_action_id: null, reason_code: null, user_id,
    period_start: PERIOD, group_id: null, credits: '1.000000', cost_usd: cost, credit_value_version: 0,
    is_fallback_priced: false, service: 'ai', action_type: 'chat_turn', triggered_by: 'owner', outcome: 'succeeded',
    created_at: '2026-09-06T00:00:00+00:00',
  });
  mockLedger.listRowsOfAllAccountsCreatedInRange.mockResolvedValue({
    data: { rows: [created(ACCOUNT, '0.0010000000'), created(null, '0.0003000000')], reachedCeiling: false },
    error: null,
  });
  mockLedger.listRowsForAccountCreatedInRange.mockResolvedValue({
    data: { rows: [created(ACCOUNT, '0.0010000000')], reachedCeiling: false },
    error: null,
  });
}

const noReadHappened = () => {
  expect(mockLedger.listTotalsForPeriodsInRange).not.toHaveBeenCalled();
  expect(mockLedger.listTotalsForAccountInRange).not.toHaveBeenCalled();
  expect(mockLedger.listRowsForAccountPeriods).not.toHaveBeenCalled();
  expect(mockLedger.findChargesByActionIds).not.toHaveBeenCalled();
  expect(mockLedger.listRowsOfAllAccountsCreatedInRange).not.toHaveBeenCalled();
  expect(mockLedger.listRowsForAccountCreatedInRange).not.toHaveBeenCalled();
  expect(mockFindNames).not.toHaveBeenCalled();
};

beforeEach(() => {
  jest.clearAllMocks();
  ledgerWithOnePeriod();
});

describe('authz: before anything else', () => {
  it('401 when signed out, with no read', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call('?from=2026-09-01&to=2026-09-10');
    expect(res.status).toBe(401);
    noReadHappened();
  });

  it('403 for a signed-in non-admin, with no read', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    const res = await call('?from=2026-09-01&to=2026-09-10');
    expect(res.status).toBe(403);
    noReadHappened();
  });

  it('401 before validation: an invalid query from a signed-out caller learns nothing', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call('?bogus=1');
    expect(res.status).toBe(401);
  });

  it('requireAdmin is the first statement of the handler', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    const body = source.slice(source.indexOf('export async function GET'));
    const beforeGate = body.slice(body.indexOf('{') + 1, body.indexOf('await requireAdmin('));
    // Only the correlation id and the request logger are created before the gate.
    const statements = beforeGate
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//'));
    expect(statements).toEqual([
      "const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();",
      'const baseLogger = logger.child({ correlationId });',
      'const gate =',
    ]);
  });
});

describe('400: the query is validated strictly', () => {
  beforeEach(asAdmin);

  it.each([
    ['only from', '?from=2026-09-01'],
    ['only to', '?to=2026-09-10'],
    ['from after to', '?from=2026-09-10&to=2026-09-01'],
    ['a span over 92 days', '?from=2026-05-01&to=2026-08-01'],
    ['a to in the future', `?from=${todayUtc()}&to=${daysFromToday(3)}`],
    ['an unknown key', '?from=2026-09-01&to=2026-09-10&userId=99999999-9999-4999-8999-999999999999'],
    ['a malformed accountId', '?accountId=not-a-uuid'],
    ['a malformed date', '?from=2026-9-1&to=2026-09-10'],
    ['an impossible date', '?from=2026-02-30&to=2026-03-10'],
    ['a repeated key', `?accountId=${ACCOUNT}&accountId=${ACCOUNT}`],
  ])('%s → 400, with no read', async (_name, query) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe('string');
    noReadHappened();
  });

  it('accepts exactly 92 days', async () => {
    const res = await call('?from=2026-05-01&to=2026-07-31');
    expect(res.status).toBe(200);
  });

  it('accepts today plus one day (an admin east of UTC)', async () => {
    const res = await call(`?from=${todayUtc()}&to=${daysFromToday(1)}`);
    expect(res.status).toBe(200);
  });
});

describe('409: a platform account is refused before any read', () => {
  it('refuses the platform account', async () => {
    asAdmin();
    const res = await call(`?accountId=${PLATFORM}`);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('platform_account');
    noReadHappened();
  });
});

describe('200: the report', () => {
  beforeEach(asAdmin);

  // MK-2 (RU-6, ruled): was "the last 30 days", from today minus 29.
  it('defaults to This month (UTC) across all accounts', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.window.to).toBe(todayUtc());
    expect(body.data.window.from).toBe(`${todayUtc().slice(0, 7)}-01`);
    expect(daysFromToday(0)).toBe(todayUtc());
    expect(body.data.accountFilter).toBeNull();
    expect(mockLedger.listTotalsForPeriodsInRange).toHaveBeenCalledTimes(1);
    expect(body.data.periods).toHaveLength(1);
    expect(body.data.periods[0]).toMatchObject({ companyName: 'Alpha Studio', matches: true });
  });

  it('narrows to one account through the account-scoped read', async () => {
    const res = await call(`?from=2026-09-01&to=2026-09-10&accountId=${ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(mockLedger.listTotalsForPeriodsInRange).not.toHaveBeenCalled();
    expect(mockLedger.listTotalsForAccountInRange.mock.calls[0][0]).toBe(ACCOUNT);
    expect((await res.json()).data.accountFilter).toBe(ACCOUNT);
  });

  it('logs one info line with the window, filter, counts and incomplete — and no business name', async () => {
    await call('?from=2026-09-01&to=2026-09-10');
    const lines = mockLog.info.mock.calls.filter(([, msg]) => msg === 'Admin read the Business OS credit cost report');
    expect(lines).toHaveLength(1);
    expect(lines[0][0]).toMatchObject({
      window: { from: '2026-09-01', to: '2026-09-10' },
      accountId: null,
      periods: 1,
      rowsRead: 1,
      incomplete: false,
      unreadableAmounts: 0,
    });
    expect(JSON.stringify(mockLog.info.mock.calls)).not.toContain('Alpha Studio');
  });

  it('MK-2: chargedInWindow is Finance\'s read over the window instants, deleted accounts included', async () => {
    const res = await call('?from=2026-10-01&to=2026-10-10');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockLedger.listRowsOfAllAccountsCreatedInRange).toHaveBeenCalledTimes(1);
    expect(mockLedger.listRowsForAccountCreatedInRange).not.toHaveBeenCalled();
    const [range, opts] = mockLedger.listRowsOfAllAccountsCreatedInRange.mock.calls[0];
    // Half-open: the window's first instant to the day after its last date.
    expect(range.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-10-11T00:00:00.000Z');
    expect(opts).toEqual({ pageSize: 1000, ceiling: 20000 });
    expect(body.data.chargedInWindow).toMatchObject({
      status: 'ok',
      costUsd: 0.0013,
      charges: 2,
      rows: 2,
      deleted: { costUsd: 0.0003, credits: 1, rows: 1 },
    });
  });

  it('MK-2: a window entirely before the charging cut-over reads nothing and is an exact 0', async () => {
    const res = await call('?from=2026-09-01&to=2026-09-10');
    expect(mockLedger.listRowsOfAllAccountsCreatedInRange).not.toHaveBeenCalled();
    expect((await res.json()).data.chargedInWindow).toMatchObject({ status: 'ok', coverage: 'entirely_before_cutover', costUsd: 0 });
  });

  it('MK-2: with an account only R-a\u2032 runs, with exactly that id', async () => {
    const res = await call(`?from=2026-10-01&to=2026-10-10&accountId=${ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(mockLedger.listRowsOfAllAccountsCreatedInRange).not.toHaveBeenCalled();
    expect(mockLedger.listRowsForAccountCreatedInRange).toHaveBeenCalledTimes(1);
    expect(mockLedger.listRowsForAccountCreatedInRange.mock.calls[0][0]).toBe(ACCOUNT);
    const body = await res.json();
    expect(body.data.chargedInWindow).toMatchObject({ status: 'ok', costUsd: 0.001, deleted: { rows: 0 } });
  });

  it('MK-2: a failed charged read leaves the report 200 and chargedInWindow unknown', async () => {
    mockLedger.listRowsOfAllAccountsCreatedInRange.mockResolvedValue({ data: null, error: new Error('secret internal detail') });
    const res = await call('?from=2026-10-01&to=2026-10-10');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.periods).toHaveLength(1);
    expect(body.data.chargedInWindow).toMatchObject({ status: 'unknown', costUsd: null, deleted: null });
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
  });

  it('a failed read fails its section, not the request', async () => {
    mockLedger.listRowsForAccountPeriods.mockResolvedValue({ data: null, error: new Error('down') });
    const res = await call('?from=2026-09-01&to=2026-09-10');
    expect(res.status).toBe(200);
    expect((await res.json()).data.sections.rows).toBe('failed');
  });
});

describe('500', () => {
  it('a synchronous throw from the name lookup fails only the names section (QA edge 7), not the request', async () => {
    asAdmin();
    mockFindNames.mockImplementation(() => {
      throw new Error('secret internal detail');
    });
    const res = await call('?from=2026-09-01&to=2026-09-10');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.sections).toMatchObject({ totals: 'ok', rows: 'ok', names: 'failed' });
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
  });

  it('returns a generic message when the builder throws', async () => {
    asAdmin();
    // A malformed repository result that throws on access: an unexpected
    // failure outside every read's own guard.
    mockLedger.listTotalsForPeriodsInRange.mockResolvedValue({
      data: {
        get rows(): never {
          throw new Error('secret internal detail');
        },
        reachedCeiling: false,
      },
      error: null,
    });
    const res = await call('?from=2026-09-01&to=2026-09-10');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: 'Internal server error' });
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
  });
});
