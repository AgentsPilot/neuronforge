/**
 * GET /api/admin/business-os/finance (finance & business health slice 1a):
 * the REAL `requireAdmin` (401 / 403 before any read, including a user whose
 * `profiles.role` says admin, SA-WR-6), 400 on every invalid query (AC-4,
 * AC-33, AC-34), 404 for a platform account or a business with no plan row
 * (AC-5), 200 with the window from the server clock (AC-25), the account
 * scope through the route (AC-42), one accountability log line with no name
 * (AC-30), 500 without internals (AC-36) and `no-store` on every status
 * (AC-35).
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

const mockRecordRefused = jest.fn(async () => undefined);
jest.mock('@/lib/audit/recordRefusedAccess', () => ({
  recordRefusedAccess: (...a: unknown[]) => (mockRecordRefused as (...b: unknown[]) => Promise<void>)(...a),
}));

// A user-writable profile that claims admin (SA-WR-6): the gate must not read it.
const mockProfileFind = jest.fn(async () => ({ data: { id: 'x', role: 'admin' }, error: null }));
jest.mock('@/lib/repositories/UserProfileRepository', () => ({
  UserProfileRepository: jest.fn().mockImplementation(() => ({ findById: mockProfileFind })),
  userProfileRepository: { findById: mockProfileFind },
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

const mockDeps = {
  plans: { pagePlans: jest.fn() },
  findPlanForAccount: jest.fn(),
  ledger: {
    listRowsOfAllAccountsCreatedInRange: jest.fn(),
    listRowsForAccountCreatedInRange: jest.fn(),
    findChargesByActionIds: jest.fn(),
  },
  finance: {
    listLiveBillingStatusesAllAccounts: jest.fn(),
    findLiveBillingStatusForAccount: jest.fn(),
    countLiveRevenueRows: jest.fn(),
  },
};
jest.mock('@/lib/business-os/finance/financeHealthDeps', () => {
  const { getEntitlementConfig } = jest.requireActual('@/lib/business-os/entitlements/source');
  return {
    financeHealthDeps: () => ({
      ...mockDeps,
      config: getEntitlementConfig(),
      isPlatformAccount: (id: string) => id === '00000000-0000-0000-0000-000000000000',
    }),
  };
});

const mockFindNames = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findAdminIdentitiesByUserIds: (...a: unknown[]) => mockFindNames(...a) },
}));

import { GET } from '../route';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const OWNER = {
  id: '2f734ed5-3681-4049-880d-3de7b096bea3',
  email: 'owner@example.com',
  // Self-promotion signals the platform must ignore.
  app_metadata: { role: 'admin' },
  user_metadata: { role: 'admin' },
  role: 'admin',
};
const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const PLATFORM = '00000000-0000-0000-0000-000000000000';
const NAME = 'Alpha Studio Secret Name';
const INVALID_QUERY = 'The filters are not valid. Check the dates, the window and the business.';

const call = (query = '') => GET(new NextRequest(`http://localhost/api/admin/business-os/finance${query}`));
const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};
const todayUtc = () => new Date().toISOString().slice(0, 10);
const daysFromToday = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function plan(user_id: string) {
  return {
    user_id, tier: null, plan_version: 1, tier_expires_at: null, cohort: null, cohort_expires_at: null,
    onboarding_started_at: null, profile_created_at: null, trial_started_at: null, trial_ends_at: null,
    grace_ends_at: null, period_anchor: '2026-09-01T00:00:00Z', origin: 'trigger', updated_by_admin_id: null,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  };
}

function chargeRow(user_id: string) {
  return {
    id: 'r1', kind: 'charge', action_id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', adjusts_action_id: null,
    reason_code: null, user_id, period_start: '2026-10-01T00:00:00+00:00', group_id: null,
    credits: '2.000000', cost_usd: '1.2345000000', credit_value_version: 0, is_fallback_priced: false,
    service: 'ai', action_type: 'chat_turn', triggered_by: 'owner', outcome: 'succeeded', created_at: '2026-10-01T10:00:00+00:00',
  };
}

function seed() {
  const ledger = { data: { rows: [chargeRow(ACCOUNT)], reachedCeiling: false }, error: null };
  mockDeps.plans.pagePlans.mockResolvedValue({ data: [plan(ACCOUNT)], error: null });
  mockDeps.findPlanForAccount.mockResolvedValue({ data: { plan: plan(ACCOUNT) }, error: null });
  mockDeps.ledger.listRowsOfAllAccountsCreatedInRange.mockResolvedValue(ledger);
  mockDeps.ledger.listRowsForAccountCreatedInRange.mockResolvedValue(ledger);
  mockDeps.ledger.findChargesByActionIds.mockResolvedValue({ data: [], error: null });
  mockDeps.finance.listLiveBillingStatusesAllAccounts.mockResolvedValue({ data: [], error: null });
  mockDeps.finance.findLiveBillingStatusForAccount.mockResolvedValue({ data: null, error: null });
  mockDeps.finance.countLiveRevenueRows.mockResolvedValue({ data: { planInvoicesPaid: 0, boostsPaid: 0 }, error: null });
  mockFindNames.mockResolvedValue({ data: [{ user_id: ACCOUNT, company_name: NAME }], error: null });
}

const allReads = () => [
  mockDeps.plans.pagePlans,
  mockDeps.findPlanForAccount,
  ...Object.values(mockDeps.ledger),
  ...Object.values(mockDeps.finance),
  mockFindNames,
];
const noReadHappened = () => {
  for (const fn of allReads()) expect(fn).not.toHaveBeenCalled();
};
const expectNoStore = (res: Response) => expect(res.headers.get('cache-control')).toBe('no-store');

beforeEach(() => {
  jest.clearAllMocks();
  seed();
});

describe('authz: the real requireAdmin, before anything else', () => {
  it('AC-1: 401 when signed out, no data, no-store', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expectNoStore(res);
    expect((await res.json()).data).toBeUndefined();
    noReadHappened();
  });

  it('AC-2: 403 for a signed-in non-admin, no-store, no read', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    const res = await call();
    expect(res.status).toBe(403);
    expectNoStore(res);
    noReadHappened();
  });

  it('SA-WR-6: 403 for a user whose profiles.role (and metadata) say admin, when admin_users says no', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    const res = await call(`?accountId=${ACCOUNT}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: 'Forbidden' });
    // The only admin signal asked is the admin_users check.
    expect(mockIsAdmin).toHaveBeenCalledWith({ id: OWNER.id, email: OWNER.email });
    expect(mockProfileFind).not.toHaveBeenCalled();
    noReadHappened();
  });

  it('403, not 400, for a non-admin with an invalid query: validation never runs first', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    expect((await call('?preset=nope&preset=x')).status).toBe(403);
  });
});

describe('validation (AC-4, AC-33, AC-34)', () => {
  beforeEach(asAdmin);

  it.each([
    ['an unknown preset', '?preset=year'],
    ['custom without dates', '?preset=custom'],
    ['custom with to before from', '?preset=custom&from=2026-10-05&to=2026-10-01'],
    ['a malformed account id', '?accountId=acme'],
    ['an unknown key', '?preset=today&name=Acme'],
    ['a malformed from on a preset (format-checked even when ignored)', '?preset=7d&from=2026-1-1'],
  ])('%s → 400, standard body, no details outside development, no-store, no read', async (_name, query) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    expectNoStore(res);
    const body = await res.json();
    // QA-3: a short message for the admin; Zod's detail never outside development.
    expect(body).toEqual({ success: false, error: INVALID_QUERY });
    noReadHappened();
  });

  it('QA-3: in development, the 400 carries Zod\u2019s detail under details', async () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = 'development';
    try {
      const body = await (await call('?preset=custom&from=2026-10-05&to=2026-10-01')).json();
      expect(body.error).toBe(INVALID_QUERY);
      expect(body.details.issue).toBe('The start date must not be after the end date');
      expect(body.details.formErrors).toBeDefined();
    } finally {
      env.NODE_ENV = previous;
    }
  });

  it('AC-33: a repeated key → 400 before Zod', async () => {
    const res = await call('?preset=today&preset=today');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Each query parameter may appear once');
  });

  it('AC-34: to = tomorrow → 400 (no tolerance)', async () => {
    const res = await call(`?preset=custom&from=${todayUtc()}&to=${daysFromToday(1)}`);
    expect(res.status).toBe(400);
  });

  it('AC-34: 92 inclusive days → 200; 93 → 400', async () => {
    expect((await call(`?preset=custom&from=${daysFromToday(-91)}&to=${todayUtc()}`)).status).toBe(200);
    expect((await call(`?preset=custom&from=${daysFromToday(-92)}&to=${todayUtc()}`)).status).toBe(400);
  });
});

describe('not found (AC-5, SA-F14)', () => {
  beforeEach(asAdmin);

  it('404 "Business not found" for a platform account id, before any read', async () => {
    const res = await call(`?accountId=${PLATFORM}`);
    expect(res.status).toBe(404);
    expectNoStore(res);
    expect(await res.json()).toEqual({ success: false, error: 'Business not found' });
    noReadHappened();
  });

  it('404 for a well-formed id with no plan row, and no further read', async () => {
    mockDeps.findPlanForAccount.mockResolvedValue({ data: { plan: null }, error: null });
    const res = await call(`?accountId=${ACCOUNT}`);
    expect(res.status).toBe(404);
    expectNoStore(res);
    expect(await res.json()).toEqual({ success: false, error: 'Business not found' });
    expect(mockDeps.ledger.listRowsForAccountCreatedInRange).not.toHaveBeenCalled();
  });

  it('500 "Could not check this business" when the check fails', async () => {
    mockDeps.findPlanForAccount.mockResolvedValue({ data: null, error: new Error('down') });
    const res = await call(`?accountId=${ACCOUNT}`);
    expect(res.status).toBe(500);
    expectNoStore(res);
    expect((await res.json()).error).toBe('Could not check this business. Try again.');
  });
});

describe('200', () => {
  beforeEach(asAdmin);

  it('returns every section with no-store; the default preset is this month', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expectNoStore(res);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.window.preset).toBe('this_month');
    expect(body.data.window.to).toBe(todayUtc());
    expect(Object.keys(body.data).sort()).toEqual(['accountId', 'accounts', 'aiCost', 'generatedAt', 'revenue', 'tiles', 'window']);
  });

  it('AC-25: a preset with client from / to → the window comes from the server clock', async () => {
    const res = await call('?preset=7d&from=2020-01-01&to=2020-01-02');
    const body = await res.json();
    expect(body.data.window.from).toBe(daysFromToday(-6));
    expect(body.data.window.to).toBe(todayUtc());
  });

  it('AC-27: a failed section is 200 with that section unknown', async () => {
    mockDeps.ledger.listRowsOfAllAccountsCreatedInRange.mockResolvedValue({ data: null, error: new Error('x') });
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data.aiCost.status).toBe('unknown');
  });

  it('AC-42 through the route: with accountId, no all-accounts read, every scoped read gets exactly the id', async () => {
    const res = await call(`?accountId=${ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(mockDeps.plans.pagePlans).not.toHaveBeenCalled();
    expect(mockDeps.ledger.listRowsOfAllAccountsCreatedInRange).not.toHaveBeenCalled();
    expect(mockDeps.finance.listLiveBillingStatusesAllAccounts).not.toHaveBeenCalled();
    expect(mockDeps.findPlanForAccount).toHaveBeenCalledWith(ACCOUNT);
    expect(mockDeps.finance.findLiveBillingStatusForAccount).toHaveBeenCalledWith(ACCOUNT);
    for (const [id] of mockDeps.ledger.listRowsForAccountCreatedInRange.mock.calls) expect(id).toBe(ACCOUNT);
    expect(mockDeps.finance.countLiveRevenueRows).toHaveBeenCalledWith();
    expect(mockFindNames).toHaveBeenCalledWith([ACCOUNT]);
  });

  it('AC-30: one info line with the admin id, filters, statuses and counts; no name, email or figure', async () => {
    await call(`?accountId=${ACCOUNT}`);
    const lines = mockLog.info.mock.calls.filter((c) => c[1] === 'Admin read the Business OS finance page');
    expect(lines).toHaveLength(1);
    const [ctx] = lines[0];
    expect(ctx).toMatchObject({
      accountId: ACCOUNT,
      sections: { revenue: 'ok', accounts: 'ok', aiCost: 'ok' },
      counts: { ledgerRows: 1, topAccounts: 1, namesFound: 1 },
    });
    const logged = JSON.stringify([mockLog.info.mock.calls, mockLog.warn.mock.calls, mockLog.error.mock.calls]);
    expect(logged).not.toContain(NAME);
    expect(logged).not.toContain(ADMIN.email);
    expect(logged).not.toContain('1.2345');
  });
});

describe('500 (AC-36)', () => {
  beforeEach(asAdmin);

  it('an unexpected throw → 500 standard body, details only in development, no-store', async () => {
    // settle() absorbs a throwing READ, so the throw is forced past it: a
    // malformed page makes the builder itself throw.
    mockDeps.ledger.listRowsOfAllAccountsCreatedInRange.mockResolvedValue({ data: { rows: null, reachedCeiling: false }, error: null });
    const res = await call();
    expect(res.status).toBe(500);
    expectNoStore(res);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'Internal server error' });
    expect(mockLog.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), 'Business OS finance read failed');
  });

  it('in development, details carry the message', async () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = 'development';
    try {
      mockDeps.ledger.listRowsOfAllAccountsCreatedInRange.mockResolvedValue({ data: { rows: null, reachedCeiling: false }, error: null });
      const body = await (await call()).json();
      expect(typeof body.details).toBe('string');
    } finally {
      env.NODE_ENV = previous;
    }
  });
});

describe('source', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');

  it('names no write verb and no audit call (AC-28, SEC-10)', () => {
    expect(code).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
    expect(code).not.toMatch(/AuditTrailService|auditTrail/);
  });

  it('requireAdmin is the first statement after the logger set-up, and every response passes no-store', () => {
    const body = code.slice(code.indexOf('export async function GET'));
    expect(body.indexOf('requireAdmin(')).toBeLessThan(body.indexOf('searchParams'));
    expect(code).not.toMatch(/profiles\.role|app_metadata|AdminAccessService/);
    // Every NextResponse.json carries the header constant.
    const jsonCalls = code.match(/NextResponse\.json\(/g) ?? [];
    const withHeader = code.match(/headers: NO_STORE/g) ?? [];
    expect(jsonCalls.length).toBe(withHeader.length);
  });
});
