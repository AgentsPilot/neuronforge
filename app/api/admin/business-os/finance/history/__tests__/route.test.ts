/**
 * Finance slice 8.3: the History route (HS-FR-9, HS-FR-10, HS-FR-16; E-98 to
 * E-100; 8.3-R2; AC-287). The real `requireAdmin` runs; the reads are faked
 * at the wiring.
 */

import { NextRequest } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));
const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: { getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }) },
}));
jest.mock('@/lib/audit/recordRefusedAccess', () => ({ recordRefusedAccess: jest.fn(async () => undefined) }));
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
const mockFirst = jest.fn();
const mockRange = jest.fn();
jest.mock('@/lib/business-os/finance/financeHistoryDeps', () => {
  const { getEntitlementConfig } = jest.requireActual('@/lib/business-os/entitlements/source');
  return {
    financeHistoryDeps: () => ({
      config: getEntitlementConfig(),
      snapshots: { findFirstSnapshotDate: () => mockFirst(), listSnapshotsInRange: (...a: unknown[]) => mockRange(...a) },
    }),
  };
});

import { GET } from '../route';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const INVALID = 'The filters are not valid. Check the dates and the window.';
const call = (query = '') => GET(new NextRequest(`http://localhost/api/admin/business-os/finance/history${query}`));
const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};
const todayUtc = () => new Date().toISOString().slice(0, 10);
const daysFromToday = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const noRead = () => {
  expect(mockFirst).not.toHaveBeenCalled();
  expect(mockRange).not.toHaveBeenCalled();
};
const noStore = (res: Response) => expect(res.headers.get('cache-control')).toBe('no-store');

beforeEach(() => {
  jest.clearAllMocks();
  mockFirst.mockResolvedValue({ data: { state: 'ready', firstDate: daysFromToday(-3) }, error: null });
  mockRange.mockResolvedValue({
    data: {
      state: 'ready',
      rows: [
        { as_of_date: daysFromToday(-1), metric: 'accounts_total', dimension: 'all', unit: 'accounts', value: 4 },
        { as_of_date: daysFromToday(-1), metric: 'credit_used', dimension: 'all', unit: 'credits', value: '12.500000' },
      ],
    },
    error: null,
  });
});

describe('AC-287 / 8.3-R2: requireAdmin first, before any read', () => {
  it('no session: 401, no-store, no read', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    noStore(res);
    noRead();
  });

  it('a non-admin (even one whose profile claims admin): 403, no read', async () => {
    mockGetUser.mockResolvedValue({ id: ACCOUNT, email: 'owner@example.com' });
    mockIsAdmin.mockResolvedValue(false);
    const res = await call();
    expect(res.status).toBe(403);
    noStore(res);
    noRead();
  });

  it('source: requireAdmin precedes searchParams, every JSON response carries no-store, no write or audit', () => {
    const code = readFileSync(join(process.cwd(), 'app', 'api', 'admin', 'business-os', 'finance', 'history', 'route.ts'), 'utf8');
    const body = code.slice(code.indexOf('export async function GET'));
    expect(body.indexOf('requireAdmin(')).toBeLessThan(body.indexOf('searchParams'));
    expect((code.match(/NextResponse\.json\(/g) ?? []).length).toBe((code.match(/headers: NO_STORE/g) ?? []).length);
    expect(code).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(|AuditTrailService|profiles\.role/);
  });
});

describe('AC-287: strict input', () => {
  beforeEach(asAdmin);
  it.each([
    ['a business (all businesses only)', `?accountId=${ACCOUNT}`],
    ['since_start (it needs a business)', '?preset=since_start'],
    ['an unknown key', '?preset=today&name=x'],
    ['custom without dates', '?preset=custom'],
    ['a 93-day custom window', `?preset=custom&from=${daysFromToday(-92)}&to=${todayUtc()}`],
    ['a malformed date on a preset', '?preset=7d&from=2026-1-1'],
  ])('%s: 400, no read', async (_name, query) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    noStore(res);
    expect((await res.json()).error).toBe(INVALID);
    noRead();
  });

  it('a repeated key: 400 before Zod', async () => {
    expect((await call('?preset=today&preset=7d')).status).toBe(400);
    noRead();
  });
});

describe('200: the server-built view (E-99)', () => {
  beforeEach(asAdmin);

  it('a preset with client dates is re-resolved on the server; the range read ends at yesterday UTC', async () => {
    const res = await call('?preset=7d&from=2020-01-01&to=2020-01-02');
    expect(res.status).toBe(200);
    noStore(res);
    const { data } = await res.json();
    expect(data.window).toEqual({ from: daysFromToday(-6), to: todayUtc() });
    expect(mockRange).toHaveBeenCalledWith(daysFromToday(-6), daysFromToday(-1));
  });

  it('returns the view and never the raw rows', async () => {
    const { data } = await (await call()).json();
    expect(data.state).toBe('ready');
    expect(Object.keys(data).sort()).toEqual(['credits', 'firstSnapshotDate', 'planMix', 'state', 'weekly', 'window']);
    expect(JSON.stringify(data)).not.toMatch(/as_of_date|"metric"|"rows"/);
  });

  it('Today: nothing can be recorded yet, so no range read and "none_in_window"', async () => {
    const { data } = await (await call('?preset=today')).json();
    expect(mockRange).not.toHaveBeenCalled();
    expect(data.state).toBe('none_in_window');
  });

  it('the info line carries no value', async () => {
    await call();
    const line = mockLog.info.mock.calls.find((c) => c[1] === 'Admin read the Finance history');
    expect(line?.[0]).toMatchObject({ state: 'ready', rows: 2 });
    expect(JSON.stringify(mockLog.info.mock.calls)).not.toContain('12.5');
  });
});

describe('E-100 and HS-FR-16: not installed and failures', () => {
  beforeEach(asAdmin);

  it('not installed: 200 with state not_installed and a warn, never an error', async () => {
    mockFirst.mockResolvedValue({ data: { state: 'not_installed' }, error: null });
    const res = await call();
    expect(res.status).toBe(200);
    noStore(res);
    expect((await res.json()).data).toMatchObject({ state: 'not_installed', firstSnapshotDate: null });
    expect(mockLog.warn).toHaveBeenCalledWith(expect.objectContaining({ tableMissing: true }), expect.any(String));
    expect(mockLog.error).not.toHaveBeenCalled();
  });

  it('a read error (the ceiling included): 500, the fixed message, details only in development', async () => {
    mockRange.mockResolvedValue({ data: null, error: new Error('Finance snapshot read reached its ceiling') });
    const res = await call();
    expect(res.status).toBe(500);
    noStore(res);
    expect(await res.json()).toEqual({ success: false, error: 'Could not read the finance history.' });
  });
});
