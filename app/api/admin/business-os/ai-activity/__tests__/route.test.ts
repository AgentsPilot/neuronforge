/**
 * GET /api/admin/business-os/ai-activity (Gap B slice B1a, workplan § E,
 * AC-B8, AC-B11, AC-B14): 401 / 403 before any read, 400 on every invalid
 * query (a missing window, a span over 92 days, a limit over 100, an unknown
 * key including `actionId`, a repeated key), 409 on a platform account, 200
 * with the filters reaching the reads, one accountability log line with no
 * business name, and 500 without internals. Slice B1b: the audit join is
 * read with the admin's context and the page's own grouping ids, another
 * account's entry never reaches the response (AC-B5), and the log line
 * carries the audit counts.
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
  listChargesAllAccountsInWindow: jest.fn(),
  listChargesForAccountInWindow: jest.fn(),
  listAdjustmentsForActionIds: jest.fn(),
  listChargesOfDeletedAccountsInWindow: jest.fn(),
};
const mockArchive = { getLatestCutoff: jest.fn(), listRuns: jest.fn() };
jest.mock('@/lib/business-os/credits/aiActivityDeps', () => ({
  aiActivityLedger: () => mockLedger,
  aiActivityArchive: () => mockArchive,
}));

const mockListEntries = jest.fn();
jest.mock('@/lib/repositories/AuditTrailRepository', () => ({
  auditTrailRepository: { listAiActionEntriesAllAccountsByGroupIds: (...a: unknown[]) => mockListEntries(...a) },
}));

const mockFindNames = jest.fn();
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: { findAdminIdentitiesByUserIds: (...a: unknown[]) => mockFindNames(...a) },
}));

import { GET } from '../route';

/** The exact words the Activity tab shows (QA E-2), as written in route.ts. */
const MIN_COST_MESSAGES = {
  format: 'Minimum cost must be a dollar amount written in digits, for example 0.05',
  tooLarge: 'Minimum cost must be less than $1,000,000',
  tooPrecise: 'Minimum cost can have at most 10 decimal places',
};

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
const OWNER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'owner@example.com' };
const ACCOUNT = '99999999-9999-4999-8999-999999999999';
const PLATFORM = '00000000-0000-0000-0000-000000000000';
const WINDOW = '?from=2026-10-01&to=2026-10-02';

const call = (query = '') => GET(new NextRequest(`http://localhost/api/admin/business-os/ai-activity${query}`));

const asAdmin = () => {
  mockGetUser.mockResolvedValue(ADMIN);
  mockIsAdmin.mockResolvedValue(true);
};

const todayUtc = () => new Date().toISOString().slice(0, 10);
const daysFromToday = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function chargeRow() {
  return {
    id: 'r1', kind: 'charge', action_id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', adjusts_action_id: null,
    reason_code: null, user_id: ACCOUNT, period_start: '2026-09-29T00:00:00+00:00', group_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    credits: '2.000000', cost_usd: '0.0020000000', credit_value_version: 0, is_fallback_priced: false,
    service: 'ai', action_type: 'chat_turn', triggered_by: 'owner', outcome: 'succeeded', created_at: '2026-10-01T10:00:00+00:00',
  };
}

function seedLedger() {
  const page = { data: { rows: [chargeRow()], total: 1 }, error: null };
  mockLedger.listChargesAllAccountsInWindow.mockResolvedValue(page);
  mockLedger.listChargesForAccountInWindow.mockResolvedValue(page);
  mockLedger.listAdjustmentsForActionIds.mockResolvedValue({ data: { rows: [], reachedCeiling: false }, error: null });
  mockLedger.listChargesOfDeletedAccountsInWindow.mockResolvedValue({
    data: { rows: [], reachedCeiling: false, total: 0 },
    error: null,
  });
  mockFindNames.mockResolvedValue({ data: [{ user_id: ACCOUNT, company_name: 'Alpha Studio' }], error: null });
  mockListEntries.mockResolvedValue({ data: { rows: [], reachedLimit: false }, error: null });
  mockArchive.getLatestCutoff.mockResolvedValue({ data: null, error: null });
  mockArchive.listRuns.mockResolvedValue({ data: [], error: null });
}

const noReadHappened = () => {
  for (const fn of Object.values(mockLedger)) expect(fn).not.toHaveBeenCalled();
  expect(mockFindNames).not.toHaveBeenCalled();
  expect(mockListEntries).not.toHaveBeenCalled();
  for (const fn of Object.values(mockArchive)) expect(fn).not.toHaveBeenCalled();
};

beforeEach(() => {
  jest.clearAllMocks();
  seedLedger();
});

describe('authz: before anything else', () => {
  it('401 when signed out, with no read', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await call(WINDOW);
    expect(res.status).toBe(401);
    noReadHappened();
  });

  it('403 for a signed-in non-admin, with no read', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    const res = await call(WINDOW);
    expect(res.status).toBe(403);
    noReadHappened();
  });

  it('403, not 400, for a non-admin with an invalid query: validation never runs first', async () => {
    mockGetUser.mockResolvedValue(OWNER);
    mockIsAdmin.mockResolvedValue(false);
    const res = await call('?bogus=1&limit=500');
    expect(res.status).toBe(403);
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
});

describe('400: the query is validated strictly', () => {
  beforeEach(asAdmin);

  it.each([
    ['no window at all (D-3: the window is required)', ''],
    ['only from', '?from=2026-10-01'],
    ['only to', '?to=2026-10-02'],
    ['from after to', '?from=2026-10-02&to=2026-10-01'],
    ['a span over 92 days', '?from=2026-05-01&to=2026-08-01'],
    ['a to in the future', `?from=${todayUtc()}&to=${daysFromToday(3)}`],
    ['a limit over 100', `${WINDOW}&limit=101`],
    ['a limit of 0', `${WINDOW}&limit=0`],
    ['a non-numeric limit', `${WINDOW}&limit=ten`],
    ['an unknown key', `${WINDOW}&userId=${ACCOUNT}`],
    ['actionId, which B1 does not accept (the deep link is B3)', `${WINDOW}&actionId=aaaaaaaa-aaaa-4aaa-8aaa-000000000001`],
    ['a malformed accountId', `${WINDOW}&accountId=not-a-uuid`],
    ['an unknown area', `${WINDOW}&area=everything`],
    ['an unknown outcome', `${WINDOW}&outcome=maybe`],
    ['an unknown trigger', `${WINDOW}&trigger=cron`],
    ['an unknown sort', `${WINDOW}&sort=service`],
    ['a cost floor in scientific notation', `${WINDOW}&minCostUsd=1e3`],
    ['a negative cost floor', `${WINDOW}&minCostUsd=-1`],
    ['a malformed date', '?from=2026-10-1&to=2026-10-02'],
    ['an impossible date', '?from=2026-02-30&to=2026-03-10'],
    ['a repeated key', `${WINDOW}&sort=time&sort=cost`],
  ])('%s → 400, with no read', async (_name, query) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe('string');
    noReadHappened();
  });

  it.each([
    ['scientific notation', '1e3', MIN_COST_MESSAGES.format],
    ['a dollar sign', '$5', MIN_COST_MESSAGES.format],
    ['a negative amount', '-1', MIN_COST_MESSAGES.format],
    ['a comma', '0,05', MIN_COST_MESSAGES.format],
    ['one million', '1000000', MIN_COST_MESSAGES.tooLarge],
    ['more than 10 decimals', '0.00000000001', MIN_COST_MESSAGES.tooPrecise],
  ])('QA E-2: a minimum cost with %s gets a plain-language reason', async (_name, value, message) => {
    const res = await call(`${WINDOW}&minCostUsd=${encodeURIComponent(value)}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(message);
    expect(body.error).not.toMatch(/minCostUsd/);
    noReadHappened();
  });

  it.each(['0', '0.05', '999999.9999999999', '12'])('accepts the minimum cost %s', async (value) => {
    const res = await call(`${WINDOW}&minCostUsd=${value}`);
    expect(res.status).toBe(200);
    expect(mockLedger.listChargesAllAccountsInWindow.mock.calls[0][0]).toMatchObject({ minCostUsd: value });
  });

  it('accepts exactly 92 days, called directly', async () => {
    const res = await call('?from=2026-07-03&to=2026-10-02');
    expect(res.status).toBe(200);
  });

  it('accepts today plus one day (an admin east of UTC)', async () => {
    const res = await call(`?from=${todayUtc()}&to=${daysFromToday(1)}`);
    expect(res.status).toBe(200);
  });
});

describe('409: a platform account is refused before any read', () => {
  it('refuses the platform account with the code the tab explains', async () => {
    asAdmin();
    const res = await call(`${WINDOW}&accountId=${PLATFORM}`);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('platform_account');
    noReadHappened();
  });
});

describe('200: the list', () => {
  beforeEach(asAdmin);

  it('defaults to newest first, 100 rows, all accounts', async () => {
    const res = await call(WINDOW);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ sort: 'time', limit: 100, total: 1, capped: false });
    expect(body.data.rows[0]).toMatchObject({ accountId: ACCOUNT, companyName: 'Alpha Studio', costUsd: { gross: 0.002, net: 0.002 } });
    expect(mockLedger.listChargesAllAccountsInWindow.mock.calls[0][1]).toEqual({ sort: 'created_at', limit: 100 });
    expect(mockLedger.listChargesOfDeletedAccountsInWindow).toHaveBeenCalledTimes(1);
  });

  it('sort=cost reads by gross cost, descending; the limit reaches the read', async () => {
    await call(`${WINDOW}&sort=cost&limit=10`);
    expect(mockLedger.listChargesAllAccountsInWindow.mock.calls[0][1]).toEqual({ sort: 'cost_usd', limit: 10 });
  });

  it('every filter reaches the read', async () => {
    await call(`${WINDOW}&area=chat&outcome=failed&trigger=external&minCostUsd=0.5`);
    expect(mockLedger.listChargesAllAccountsInWindow.mock.calls[0][0]).toMatchObject({
      actionTypes: expect.arrayContaining(['chat_turn']),
      outcome: 'failed',
      triggeredBy: 'external',
      minCostUsd: '0.5',
    });
  });

  it('narrows to one account through the account-scoped read', async () => {
    const res = await call(`${WINDOW}&accountId=${ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(mockLedger.listChargesAllAccountsInWindow).not.toHaveBeenCalled();
    expect(mockLedger.listChargesForAccountInWindow.mock.calls[0][0]).toBe(ACCOUNT);
    expect((await res.json()).data.deletedAccounts).toBeNull();
  });

  it('logs one info line with the admin, the filters and the counts — and no business name', async () => {
    await call(`${WINDOW}&outcome=succeeded`);
    const lines = mockLog.info.mock.calls.filter(([, msg]) => msg === 'Admin read the Business OS AI activity');
    expect(lines).toHaveLength(1);
    expect(lines[0][0]).toMatchObject({
      window: { from: '2026-10-01', to: '2026-10-02' },
      accountId: null,
      area: null,
      outcome: 'succeeded',
      trigger: null,
      minCostUsd: null,
      sort: 'time',
      limit: 100,
      rows: 1,
      total: 1,
      capped: false,
      coverage: 'after_cutover',
      deletedAccounts: { status: 'ok', count: 0, atLeast: false },
    });
    expect(typeof lines[0][0].durationMs).toBe('number');
    expect(JSON.stringify(mockLog.info.mock.calls)).not.toContain('Alpha Studio');
    expect(JSON.stringify(mockLog.warn.mock.calls)).not.toContain('Alpha Studio');
  });

  it('a window entirely before charging went live reads nothing', async () => {
    const res = await call('?from=2026-09-01&to=2026-09-28');
    expect(res.status).toBe(200);
    expect((await res.json()).data.cutover.coverage).toBe('entirely_before_cutover');
    noReadHappened();
  });

  it('a failed name lookup fails only the names', async () => {
    mockFindNames.mockResolvedValue({ data: null, error: new Error('down') });
    const res = await call(WINDOW);
    expect(res.status).toBe(200);
    expect((await res.json()).data.names).toBe('failed');
  });
});

describe('200: the audit join (B1b)', () => {
  beforeEach(asAdmin);

  const ACTION = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
  const OTHER = '88888888-8888-4888-8888-888888888888';
  const entryRow = (user: string, details: Record<string, unknown>) => ({
    id: `e-${user}`,
    user_id: user,
    created_at: '2026-10-01T09:59:59+00:00',
    entity_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    details: { schema: 2, actionId: ACTION, callCount: 2, failedCallCount: 0, inputTokens: 10, outputTokens: 5, totalTokens: 15, models: ['model-alpha'], ...details },
  });

  it('reads the entries with the admin context and the page grouping ids, never request values', async () => {
    const res = await call(`${WINDOW}&accountId=${ACCOUNT}`);
    expect(res.status).toBe(200);
    expect(mockListEntries).toHaveBeenCalledTimes(1);
    const [context, groupIds, window] = mockListEntries.mock.calls[0];
    expect(context).toEqual({ correlationId: expect.any(String), adminId: ADMIN.id });
    expect(groupIds).toEqual(['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
    expect(window).toEqual({ start: '2026-10-01T09:00:00.000Z', end: '2026-10-01T11:00:00.000Z' });
    expect(mockArchive.getLatestCutoff).toHaveBeenCalledWith('audit_trail');
  });

  it('AC-B5: an entry of the right account is shown; another account entry with the same action id never reaches the response', async () => {
    mockListEntries.mockResolvedValue({
      data: {
        rows: [entryRow(OTHER, { callCount: 987654, models: ['marker-other-account-model'] }), entryRow(ACCOUNT, {})],
        reachedLimit: false,
      },
      error: null,
    });
    const res = await call(WINDOW);
    const body = await res.json();
    expect(body.data.rows[0].entry).toEqual({
      state: 'found',
      callCount: 2,
      failedCallCount: 0,
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      models: ['model-alpha'],
      errorCode: null,
    });
    expect(body.data.audit.noEntry.accountMismatch).toBe(1);
    const json = JSON.stringify(body);
    expect(json).not.toContain('987654');
    expect(json).not.toContain('marker-other-account-model');
    expect(json).not.toContain(OTHER);
  });

  it('a failed audit read keeps the list (200) and marks the entry unknown, never lost', async () => {
    mockListEntries.mockResolvedValue({ data: null, error: new Error('secret internal detail') });
    const res = await call(WINDOW);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.rows[0].entry).toEqual({ state: 'unknown', reason: 'audit_read_failed' });
    expect(body.data.audit.status).toBe('failed');
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
  });

  it('the log line carries the audit status and counts, never an entry', async () => {
    mockListEntries.mockResolvedValue({ data: { rows: [entryRow(ACCOUNT, { models: ['marker-logged-model'] })], reachedLimit: false }, error: null });
    await call(WINDOW);
    const lines = mockLog.info.mock.calls.filter(([, msg]) => msg === 'Admin read the Business OS AI activity');
    expect(lines).toHaveLength(1);
    expect(lines[0][0].audit).toEqual({
      status: 'ok',
      archive: 'ok',
      noEntry: { tooRecent: 0, mayBeArchived: 0, lost: 0, unknown: 0, accountMismatch: 0 },
    });
    const logged = JSON.stringify([mockLog.info.mock.calls, mockLog.warn.mock.calls, mockLog.error.mock.calls]);
    expect(logged).not.toContain('marker-logged-model');
    expect(logged).not.toContain('Alpha Studio');
  });

  it('the route source wires the admin-pinned read with its context (adminReadMethods caller pin)', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'route.ts'), 'utf8');
    expect(source).toContain('auditTrailRepository.listAiActionEntriesAllAccountsByGroupIds(');
    expect(source).toContain('{ correlationId, adminId: gate.user.id }');
  });
});

describe('500', () => {
  beforeEach(asAdmin);

  it('a failed list read answers with an error, not an empty list', async () => {
    mockLedger.listChargesAllAccountsInWindow.mockResolvedValue({ data: null, error: new Error('secret internal detail') });
    const res = await call(WINDOW);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).not.toContain('secret internal detail');
  });

  it('returns a generic message, without details outside development, when something unexpected throws', async () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      mockLedger.listChargesAllAccountsInWindow.mockResolvedValue({
        data: {
          get rows(): never {
            throw new Error('secret internal detail');
          },
          total: 1,
        },
        error: null,
      });
      const res = await call(WINDOW);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({ success: false, error: 'Internal server error' });
    } finally {
      env.NODE_ENV = previous;
    }
  });
});
