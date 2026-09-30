/**
 * GET /api/admin/business-os/credits/leak-check (credit deduction slice 4b,
 * workplan §5.4, §10.2): 401 / 403 before any read, 400 on every invalid query
 * (window > 7 days, SA N-5), 409 on a platform account, 200 with the real
 * runner over fake reads, the window sent to the check, names for display
 * only, and 500.
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

// The reads, faked at the wiring: the REAL runner runs over them.
const mockReads = {
  pagePlanAnchors: jest.fn(),
  findPlanAnchor: jest.fn(),
  listTotalsForPeriodsInRange: jest.fn(),
  listLedgerRowsForAccount: jest.fn(),
  listUsageCallsForAccount: jest.fn(),
  countPlatformCalls: jest.fn(),
};
const mockDepsFactory = jest.fn(() => ({ ...mockReads, now: () => new Date() }));
jest.mock('@/lib/business-os/credits/creditLeakCheckDeps', () => ({
  creditLeakCheckDeps: () => mockDepsFactory(),
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
const GROUP = 'aaaaaaaa-0000-4000-8000-000000000001';
const DAY = 86_400_000;

const call = (query = '') => GET(new NextRequest(`http://localhost/api/admin/business-os/credits/leak-check${query}`));

const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};

const dayOf = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

/** One plan account with one uncharged call yesterday. */
function oneLeakYesterday() {
  const yesterdayNoon = `${dayOf(-1)}T12:00:00.000Z`;
  mockReads.pagePlanAnchors.mockResolvedValue({ data: [{ user_id: ACCOUNT, period_anchor: null }], error: null });
  mockReads.findPlanAnchor.mockResolvedValue({ data: { found: true, periodAnchor: null }, error: null });
  mockReads.listTotalsForPeriodsInRange.mockResolvedValue({ data: { rows: [], reachedCeiling: false }, error: null });
  mockReads.listLedgerRowsForAccount.mockResolvedValue({ data: { rows: [], reachedCeiling: false }, error: null });
  mockReads.listUsageCallsForAccount.mockResolvedValue({
    data: {
      rows: [
        {
          id: 'u1', created_at: yesterdayNoon, feature: 'business-os-chat', component: 'planner', session_id: GROUP,
          input_tokens: 100, output_tokens: 20, cost_usd: 0.0009, success: true, error_code: null,
        },
      ],
      reachedCeiling: false,
    },
    error: null,
  });
  mockReads.countPlatformCalls.mockResolvedValue({ data: 0, error: null });
  mockFindNames.mockResolvedValue({ data: [{ user_id: ACCOUNT, company_name: 'Secret Bakery Ltd' }], error: null });
}

const noReadHappened = () => {
  for (const fn of Object.values(mockReads)) expect(fn).not.toHaveBeenCalled();
  expect(mockFindNames).not.toHaveBeenCalled();
};

beforeEach(() => {
  jest.clearAllMocks();
  oneLeakYesterday();
});

describe('authz: before anything else', () => {
  it('401 when signed out, with no read', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    noReadHappened();
  });

  it('403 for a signed-in non-admin, with no read', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await call()).status).toBe(403);
    noReadHappened();
  });

  it('401 before validation: an invalid query from a signed-out caller learns nothing', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await call('?bogus=1')).status).toBe(401);
  });

  it('requireAdmin is the first statement of the handler', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    const body = source.slice(source.indexOf('export async function GET'));
    const beforeGate = body.slice(body.indexOf('{') + 1, body.indexOf('await requireAdmin('));
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

  it('exports maxDuration 60 (the check stops starting accounts at 45 s)', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    expect(source).toMatch(/export const maxDuration = 60;/);
  });
});

describe('400: the query is validated strictly, before any read', () => {
  it.each([
    ['from without to', `?from=${dayOf(-2)}`],
    ['to without from', `?to=${dayOf(-2)}`],
    ['from after to', `?from=${dayOf(-1)}&to=${dayOf(-3)}`],
    ['8 days (SA N-5: at most 7)', `?from=${dayOf(-8)}&to=${dayOf(-1)}`],
    ['a future to', `?from=${dayOf(-1)}&to=${dayOf(2)}`],
    ['an unknown key', '?bogus=1'],
    ['a malformed accountId', '?accountId=nope'],
    ['an impossible date', '?from=2026-02-30&to=2026-03-01'],
    ['a repeated key', `?from=${dayOf(-2)}&to=${dayOf(-1)}&to=${dayOf(-1)}`],
  ])('%s', async (_name, query) => {
    asAdmin();
    const res = await call(query);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe('string');
    noReadHappened();
  });

  it('exactly 7 days is accepted', async () => {
    asAdmin();
    expect((await call(`?from=${dayOf(-7)}&to=${dayOf(-1)}`)).status).toBe(200);
  });
});

describe('409: the platform account', () => {
  it('is refused with no read', async () => {
    asAdmin();
    const res = await call(`?accountId=${PLATFORM}`);
    expect(res.status).toBe(409);
    noReadHappened();
  });
});

describe('200', () => {
  it('default window is yesterday, whole UTC day, all accounts; the leak is reported with account and period', async () => {
    asAdmin();
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.window).toEqual({ start: `${dayOf(-1)}T00:00:00.000Z`, end: `${dayOf(0)}T00:00:00.000Z` });
    expect(body.data.trigger).toBe('on_demand');
    expect(body.data.accountsWithLeak).toBe(1);
    expect(body.data.accounts[0]).toMatchObject({
      accountId: ACCOUNT,
      companyName: 'Secret Bakery Ltd',
      status: 'leak',
      periodStart: `${dayOf(-1).slice(0, 8)}01T00:00:00.000Z`,
    });
    // The walk listed plan accounts (S-1).
    expect(mockReads.pagePlanAnchors).toHaveBeenCalled();
    expect(mockReads.listTotalsForPeriodsInRange).toHaveBeenCalled();
  });

  it('one account: only that account is read, and its plan anchor', async () => {
    asAdmin();
    const res = await call(`?from=${dayOf(-2)}&to=${dayOf(-1)}&accountId=${ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(mockReads.pagePlanAnchors).not.toHaveBeenCalled();
    expect(mockReads.listTotalsForPeriodsInRange).not.toHaveBeenCalled();
    expect(mockReads.findPlanAnchor).toHaveBeenCalledWith(ACCOUNT);
    expect(mockReads.listUsageCallsForAccount.mock.calls.map((c) => c[0])).toEqual([ACCOUNT]);
    expect(mockReads.listLedgerRowsForAccount.mock.calls.map((c) => c[0])).toEqual([ACCOUNT]);
  });

  it('the business name is display-only: it is in the body, and in no log line at any level', async () => {
    asAdmin();
    await call();
    const everything = JSON.stringify([mockLog.info.mock.calls, mockLog.warn.mock.calls, mockLog.error.mock.calls, mockLog.debug.mock.calls]);
    expect(everything).not.toContain('Secret Bakery');
    // The leak itself is an error log with the account and the period (S-4, BQ-2).
    const leak = mockLog.error.mock.calls.find(([fields]) => (fields as { event?: string }).event === 'bos_credit_leak_found');
    expect(leak?.[0]).toMatchObject({ accountId: ACCOUNT, trigger: 'on_demand', groupIds: [GROUP] });
    const served = mockLog.info.mock.calls.find(([, msg]) => msg === 'Admin ran the Business OS credit leak check');
    expect(served?.[0]).toMatchObject({ accountsChecked: 1, accountsWithLeak: 1 });
  });

  it('a failed name lookup still answers, with ids', async () => {
    asAdmin();
    mockFindNames.mockRejectedValue(new Error('names down'));
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.accounts[0].companyName).toBeNull();
  });

  it('a failed token_usage read makes the account "could not check", never clean', async () => {
    asAdmin();
    mockReads.listUsageCallsForAccount.mockResolvedValue({ data: null, error: new Error('db down') });
    const body = await (await call()).json();
    expect(body.data.accounts[0]).toMatchObject({ accountId: ACCOUNT, status: 'could_not_check' });
    expect(body.data.accountsWithLeak).toBe(0);
    expect(JSON.stringify(body)).not.toContain('db down');
  });
});

describe('500', () => {
  it('an unexpected failure returns the generic body, with no detail outside development', async () => {
    asAdmin();
    mockDepsFactory.mockImplementationOnce(() => {
      throw new Error('wiring exploded');
    });
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Internal server error' });
    expect(mockLog.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), 'Business OS credit leak check failed');
  });
});
