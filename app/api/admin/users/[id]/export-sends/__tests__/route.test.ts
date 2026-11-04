/**
 * POST / GET /api/admin/users/<uuid>/export-sends ("Send export to owner",
 * export redesign MX-5; workplan §7.1 T-G1 … T-H6 and §7.2 T-W1; SA M-1, Q1,
 * Q4, Q9, S-1, S-2).
 *
 * Every collaborator is mocked: the admin gate, the throttle, the identity
 * read, both export repositories, the preferences read, the owner clock, the
 * transport and the audit flush. No network (tests/jest-no-network.ts).
 * `closedAccount.ts` is NOT mocked: DELETE's real helper decides on fixture
 * emails, so a loosened check would show here.
 *
 * The gate's own fail-closed behaviour (an admin check that throws is a 403)
 * is proved per handler by app/api/admin/__tests__/adminGate.writes.test.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

const ADMIN = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@example.com' };
const OWNER = '11111111-1111-4111-8111-111111111111';
const OWNER_EMAIL = 'owner@example.com';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const T = '2026-10-27T10:05:00.000Z';
const CLOSED_EMAIL = 'deleted-0123456789ab@deleted.invalid';

const mockGate = jest.fn();
jest.mock('@/lib/admin/requireAdminRoute', () => ({ requireAdmin: (...a: unknown[]) => mockGate(...a) }));

const mockRateLimit = jest.fn();
jest.mock('@/lib/security/rateLimit', () => ({
  ...jest.requireActual('@/lib/security/rateLimit'),
  rateLimit: (...a: unknown[]) => mockRateLimit(...a),
}));

jest.mock('@/lib/business-os/data-export/exportModules', () => {
  const actual = jest.requireActual('@/lib/business-os/data-export/exportModules');
  return {
    ...actual,
    // All on but smart_links: independent of the product switches in exportModules.ts.
    EXPORT_MODULES: actual.EXPORT_MODULES.map((m: { id: string }) => ({ ...m, on: m.id !== 'smart_links' })),
    enabledModules: () => actual.EXPORT_MODULES.filter((m: { id: string }) => m.id !== 'smart_links'),
  };
});

const mockIdentity = jest.fn();
jest.mock('@/lib/repositories/AuthAccountRepository', () => ({
  authAccountRepository: { findUserIdentity: (...a: unknown[]) => mockIdentity(...a) },
}));

const mockStartForAdmin = jest.fn();
const mockStartForOwner = jest.fn();
const mockFindById = jest.fn();
const mockListRecent = jest.fn();
const mockMarkSent = jest.fn();
const mockAdminAnchor = jest.fn();
const mockOwnerAnchor = jest.fn();
jest.mock('@/lib/repositories/BusinessOsExportRequestRepository', () => ({
  ...jest.requireActual('@/lib/repositories/BusinessOsExportRequestRepository'),
  BusinessOsExportRequestRepository: jest.fn().mockImplementation(() => ({
    startForAdmin: (...a: unknown[]) => mockStartForAdmin(...a),
    startForOwner: (...a: unknown[]) => mockStartForOwner(...a),
    findByIdForUser: (...a: unknown[]) => mockFindById(...a),
    listRecentForUser: (...a: unknown[]) => mockListRecent(...a),
    markRequestedEmailSent: (...a: unknown[]) => mockMarkSent(...a),
    findAdminLimitAnchor: (...a: unknown[]) => mockAdminAnchor(...a),
    findOwnerLimitAnchor: (...a: unknown[]) => mockOwnerAnchor(...a),
  })),
}));

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const mockListJobs = jest.fn();
jest.mock('@/lib/repositories/BusinessOsExportModuleJobRepository', () => ({
  BusinessOsExportModuleJobRepository: jest.fn().mockImplementation(() => ({
    listForRequestsOfUser: (...a: unknown[]) => mockListJobs(...a),
  })),
}));

const mockLanguage = jest.fn();
jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({
  userPreferencesRepository: { findPreferredLanguage: (...a: unknown[]) => mockLanguage(...a) },
}));

const mockClock = jest.fn();
jest.mock('@/lib/business-os/data-export/ownerClock', () => ({ ownerClock: (...a: unknown[]) => mockClock(...a) }));

const mockSendEmail = jest.fn();
jest.mock('@/lib/notifications/emailTransport', () => ({
  ...jest.requireActual('@/lib/notifications/emailTransport'),
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
  platformSenderAddress: () => 'notifications@agentspilot.ai',
}));

const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({ logAndFlush: (...a: unknown[]) => mockLogAndFlush(...a) }));

jest.mock('@/lib/logger', () => {
  const calls: unknown[][] = [];
  const logger: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = (...args: unknown[]) => calls.push(args);
  logger.child = (...args: unknown[]) => (calls.push(['child', ...args]), logger);
  return { createLogger: () => logger, __calls: calls };
});
const logCalls = (jest.requireMock('@/lib/logger') as { __calls: unknown[][] }).__calls;

import { GET, POST, ADMIN_SEND_HISTORY_LIMIT } from '../route';
import { AUDIT_EVENTS } from '@/lib/audit/events';

const ROUTE_FILE = join(process.cwd(), 'app', 'api', 'admin', 'users', '[id]', 'export-sends', 'route.ts');

function post(body: unknown, raw = false, id = OWNER) {
  const request = new NextRequest(`http://localhost/api/admin/users/${id}/export-sends`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  });
  return POST(request, { params: { id } });
}
function get(id = OWNER, query = '') {
  return GET(new NextRequest(`http://localhost/api/admin/users/${id}/export-sends${query}`, { method: 'GET' }), { params: { id } });
}

const identity = (email: string | null) => ({ data: { id: OWNER, email, createdAt: T }, error: null });
const started = { data: { outcome: 'started', requestId: REQUEST }, error: null };

beforeEach(() => {
  jest.clearAllMocks();
  logCalls.length = 0;
  mockGate.mockResolvedValue({ user: ADMIN });
  mockRateLimit.mockResolvedValue({ allowed: true, hits: 1, degraded: false });
  mockIdentity.mockResolvedValue(identity(OWNER_EMAIL));
  mockStartForAdmin.mockResolvedValue(started);
  mockFindById.mockResolvedValue({ data: { requested_at: T }, error: null });
  mockMarkSent.mockResolvedValue({ data: { updated: true }, error: null });
  mockLanguage.mockResolvedValue({ data: 'en', error: null });
  mockClock.mockResolvedValue({ timezone: 'Asia/Jerusalem', isSet: true });
  mockSendEmail.mockResolvedValue({ sent: true, provider: 'resend', providerMessageId: 're_1' });
  mockLogAndFlush.mockResolvedValue(undefined);
  mockListRecent.mockResolvedValue({ data: [], error: null });
  mockListJobs.mockResolvedValue({ data: [], error: null });
  mockAdminAnchor.mockResolvedValue({ data: { requestedAt: null }, error: null });
});

const allLogText = () => JSON.stringify(logCalls);
const nothingWritten = () => {
  expect(mockStartForAdmin).not.toHaveBeenCalled();
  expect(mockLogAndFlush).not.toHaveBeenCalled();
  expect(mockSendEmail).not.toHaveBeenCalled();
  expect(mockMarkSent).not.toHaveBeenCalled();
};

/** Source with comments removed, so prose about a rule cannot satisfy or break it. */
const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The statements of a handler body, in order, comments removed. */
function handlerBody(source: string, name: 'GET' | 'POST'): string {
  const code = codeOf(source);
  const start = code.indexOf(`export async function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const open = code.indexOf('{', code.indexOf(')', start));
  return code.slice(open + 1).trim();
}

describe('the gate (T-G1 … T-G4)', () => {
  it.each(['POST', 'GET'] as const)('T-G1 %s signed out: 401, and nothing else runs', async (method) => {
    mockGate.mockResolvedValue(NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }));
    const response = method === 'POST' ? await post({ modules: ['clients'] }) : await get();
    expect(response.status).toBe(401);
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockIdentity).not.toHaveBeenCalled();
    expect(mockListRecent).not.toHaveBeenCalled();
    nothingWritten();
  });

  it.each(['POST', 'GET'] as const)('T-G2 / T-G3 %s not an admin (or the check failed closed): 403, and nothing else runs', async (method) => {
    mockGate.mockResolvedValue(NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }));
    const response = method === 'POST' ? await post({ modules: ['clients'] }) : await get();
    expect(response.status).toBe(403);
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockIdentity).not.toHaveBeenCalled();
    nothingWritten();
  });

  it.each(['POST', 'GET'] as const)('T-G4 / M-1: requireAdmin is literally the first statement of %s, then the gate return', (method) => {
    const body = handlerBody(readFileSync(ROUTE_FILE, 'utf8'), method);
    const lines = body.split(String.fromCharCode(10)).map((line) => line.trim()).filter(Boolean);
    expect(lines[0]).toBe(`const gate = await requireAdmin(logger.child({ route: 'admin-export-sends', method: '${method}' }));`);
    expect(lines[1]).toBe('if (gate instanceof NextResponse) return gate;');
  });

  it('the gate gets its own logger child, and the request logger carries the correlation id and the admin id', async () => {
    await post({ modules: ['clients'] });
    const children = logCalls.filter((call) => call[0] === 'child').map((call) => call[1] as Record<string, unknown>);
    expect(children[0]).toEqual({ route: 'admin-export-sends', method: 'POST' });
    expect(children[1]).toEqual({ correlationId: expect.any(String), adminId: ADMIN.id });
  });
});

describe('POST (T-P1 … T-P16)', () => {
  it('T-P1: a live account → 201; startForAdmin(path id, admin id, modules); the email goes to the owner; the body carries no address', async () => {
    const response = await post({ modules: ['clients', 'quotes'] });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ success: true, data: { requestId: REQUEST, requestedEmailSent: true } });
    expect(JSON.stringify(body)).not.toContain('@');
    expect(mockStartForAdmin).toHaveBeenCalledWith(OWNER, ADMIN.id, ['clients', 'quotes']);
    expect(mockStartForOwner).not.toHaveBeenCalled();
    expect(mockIdentity).toHaveBeenCalledWith(OWNER);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0].to).toEqual([OWNER_EMAIL]);
    expect(mockSendEmail.mock.calls[0][0].to).not.toContain(ADMIN.email);
    expect(mockMarkSent).toHaveBeenCalledWith(REQUEST, OWNER);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(allLogText()).not.toContain(OWNER_EMAIL);
  });

  it('T-P2: a banned live account (normal email; the route never reads a ban) → 201, as T-P1', async () => {
    mockIdentity.mockResolvedValue({ data: { id: OWNER, email: OWNER_EMAIL, createdAt: T, banned_until: '2036-01-01T00:00:00Z' }, error: null });
    const response = await post({ modules: ['clients'] });
    expect(response.status).toBe(201);
    expect(mockStartForAdmin).toHaveBeenCalledTimes(1);
    expect(codeOf(readFileSync(ROUTE_FILE, 'utf8'))).not.toMatch(/banned_until|bannedUntil/);
  });

  it('T-P3: a closed login → 409 account_closed; nothing started, audited, emailed or marked; the log holds no email', async () => {
    mockIdentity.mockResolvedValue(identity(CLOSED_EMAIL));
    const response = await post({ modules: ['clients'] });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({ success: false, code: 'account_closed', error: 'This account is closed. Nothing can be sent.' });
    nothingWritten();
    expect(allLogText()).toContain('account_closed');
    expect(allLogText()).not.toContain(CLOSED_EMAIL);
    expect(JSON.stringify(body)).not.toContain(CLOSED_EMAIL);
  });

  it.each([
    ['upper-case hex', 'deleted-0123456789AB@deleted.invalid', 409, 'export_no_login_email'],
    ['11 hex', 'deleted-0123456789a@deleted.invalid', 409, 'export_no_login_email'],
    ['13 hex', 'deleted-0123456789abc@deleted.invalid', 409, 'export_no_login_email'],
    ['a longer domain after .invalid', 'deleted-0123456789ab@deleted.invalid.example.com', 201, undefined],
  ])('T-P4: a near miss (%s) is not account_closed: the helper decides exactly', async (_label, email, status, code) => {
    mockIdentity.mockResolvedValue(identity(email));
    const response = await post({ modules: ['clients'] });
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.code).not.toBe('account_closed');
    if (code) {
      expect(body.code).toBe(code);
      nothingWritten();
    }
  });

  it("T-P5: the route imports DELETE's helper and holds no copy of its pattern", () => {
    const source = readFileSync(ROUTE_FILE, 'utf8');
    expect(source).toContain("import { isClosedAccountEmail } from '@/lib/business-os/account-deletion/closedAccount';");
    expect(source).not.toContain('deleted.invalid');
    expect(source).not.toContain('deleted-');
  });

  it('T-P6: unknown account → 404 account_not_found; no start', async () => {
    mockIdentity.mockResolvedValue({ data: null, error: null });
    const response = await post({ modules: ['clients'] });
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('account_not_found');
    nothingWritten();
  });

  it('T-P7: the identity read fails → 500; no start', async () => {
    mockIdentity.mockResolvedValue({ data: null, error: new Error('auth down') });
    const response = await post({ modules: ['clients'] });
    expect(response.status).toBe(500);
    nothingWritten();
  });

  it.each([
    ['no email', null],
    ['a blank email', '   '],
    ['another .invalid address', 'someone@example.invalid'],
  ])('T-P8: %s → 409 export_no_login_email; no start', async (_label, email) => {
    mockIdentity.mockResolvedValue(identity(email));
    const response = await post({ modules: ['clients'] });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('export_no_login_email');
    nothingWritten();
  });

  it('T-P9: in_progress → 409 export_in_progress; no audit, no email', async () => {
    mockStartForAdmin.mockResolvedValue({ data: { outcome: 'in_progress' }, error: null });
    const response = await post({ modules: ['clients'] });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('export_in_progress');
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('T-P10: daily_limit → 409 export_daily_limit with retryAt; no audit, no email', async () => {
    mockStartForAdmin.mockResolvedValue({ data: { outcome: 'daily_limit', retryAt: '2026-10-28T10:05:00+00:00' }, error: null });
    const response = await post({ modules: ['clients'] });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ success: false, code: 'export_daily_limit', retryAt: '2026-10-28T10:05:00+00:00' });
    expect(body.details).toBeUndefined();
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('the start fails: unknown_account → 404; anything else → 500, nothing audited or emailed', async () => {
    mockStartForAdmin.mockResolvedValue({ data: null, error: Object.assign(new Error('x'), { code: 'unknown_account' }) });
    expect((await post({ modules: ['clients'] })).status).toBe(404);
    mockStartForAdmin.mockResolvedValue({ data: null, error: Object.assign(new Error('x'), { code: 'invalid_arguments' }) });
    expect((await post({ modules: ['clients'] })).status).toBe(500);
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it.each([['userId'], ['email'], ['to'], ['origin']])('T-P11: a body with %s next to modules is a 400 (strict); no start', async (key) => {
    const response = await post({ modules: ['clients'], [key]: key === 'origin' ? 'owner' : 'x@example.com' });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_input');
    expect(mockIdentity).not.toHaveBeenCalled();
    nothingWritten();
  });

  it.each([
    ['a blank body', '', true],
    ['invalid JSON', '{nope', true],
    ['{}', {}, false],
    ['an empty list', { modules: [] }, false],
    ['a switched-off module', { modules: ['smart_links'] }, false],
    ['an unknown module', { modules: ['nope'] }, false],
    ['a duplicate', { modules: ['clients', 'clients'] }, false],
  ])('T-P12: %s → 400; no start', async (_label, body, raw) => {
    const response = await post(body, raw as boolean);
    expect(response.status).toBe(400);
    nothingWritten();
  });

  it('T-P13: a path id that is not a uuid → 400 before any read; an upper-case uuid is lower-cased before every call', async () => {
    expect((await post({ modules: ['clients'] }, false, 'not-a-uuid')).status).toBe(400);
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockIdentity).not.toHaveBeenCalled();

    const lettered = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const response = await post({ modules: ['clients'] }, false, lettered.toUpperCase());
    expect(response.status).toBe(201);
    expect(mockIdentity).toHaveBeenCalledWith(lettered);
    expect(mockStartForAdmin).toHaveBeenCalledWith(lettered, ADMIN.id, ['clients']);
    expect(mockMarkSent).toHaveBeenCalledWith(REQUEST, lettered);
    expect(mockLogAndFlush.mock.calls[0][0]).toMatchObject({ userId: lettered, entityId: lettered });
  });

  it('T-P14: the admin sending to their own account (any case) → 409 admin_self_send, before the identity read', async () => {
    const response = await post({ modules: ['clients'] }, false, ADMIN.id.toUpperCase());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('admin_self_send');
    expect(mockIdentity).not.toHaveBeenCalled();
    nothingWritten();
  });

  it("T-P15: one audit row on the owner's account, the admin as actor, details exactly request_id, modules and origin admin", async () => {
    await post({ modules: ['clients', 'quotes'] });
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    const entry = mockLogAndFlush.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: AUDIT_EVENTS.DATA_EXPORT_REQUESTED,
      entityType: 'user',
      entityId: OWNER,
      userId: OWNER,
      actorId: ADMIN.id,
    });
    expect(entry.details).toEqual({ request_id: REQUEST, modules: ['clients', 'quotes'], origin: 'admin' });
    expect(JSON.stringify(entry)).not.toContain('@');
  });

  it("T-P16: the email fails → 201 with requestedEmailSent false, not marked; it was built in support's voice", async () => {
    mockSendEmail.mockResolvedValue({ sent: false, provider: 'none' });
    const response = await post({ modules: ['clients'] });
    expect(response.status).toBe(201);
    expect((await response.json()).data.requestedEmailSent).toBe(false);
    expect(mockMarkSent).not.toHaveBeenCalled();
    const sent = mockSendEmail.mock.calls[0][0];
    expect(sent.subject).toBe('AgentPilot support has started an export of your data');
    expect(sent.text).toContain('AgentPilot support started an export');
    expect(sent.text).not.toMatch(/You asked|you chose|did not ask/);
    expect(allLogText()).toContain('email_failed');
  });

  it('T-P16: the email times out → 201, the request stands', async () => {
    jest.useFakeTimers();
    try {
      mockSendEmail.mockReturnValue(new Promise(() => undefined));
      const pending = post({ modules: ['clients'] });
      await jest.advanceTimersByTimeAsync(10_001);
      const response = await pending;
      expect(response.status).toBe(201);
      expect((await response.json()).data.requestedEmailSent).toBe(false);
      // QA (2026-11-04): a timed-out send is not marked as sent.
      expect(mockMarkSent).not.toHaveBeenCalled();
      expect(allLogText()).toContain('email_timeout');
    } finally {
      jest.useRealTimers();
    }
  });

  it('429 from the throttle, after the body and before the identity read', async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, hits: 99, degraded: false });
    const response = await post({ modules: ['clients'] });
    expect(response.status).toBe(429);
    expect(mockRateLimit.mock.calls[0][1]).toBe('admin-export-send');
    expect(mockIdentity).not.toHaveBeenCalled();
    nothingWritten();
  });
});

describe('GET (T-H1 … T-H6, S-1, S-2)', () => {
  const ROW = { id: REQUEST, origin: 'admin', modules: ['clients'], requestedAt: T };
  const JOB = { id: '55555555-5555-4555-8555-555555555555', requestId: REQUEST, module: 'clients', status: 'sent', sentAt: T, emailCount: 1 };

  it("T-H1: ready → support's sends only (origin admin, last 10), jobs keyed on the owner, nextSendAt from the admin anchor", async () => {
    mockListRecent.mockResolvedValue({ data: [ROW], error: null });
    mockListJobs.mockResolvedValue({ data: [JOB], error: null });
    mockAdminAnchor.mockResolvedValue({ data: { requestedAt: '2026-10-27T10:05:00.000Z' }, error: null });
    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.state).toBe('ready');
    expect(mockListRecent).toHaveBeenCalledWith(OWNER, { limit: ADMIN_SEND_HISTORY_LIMIT, origin: 'admin' });
    expect(ADMIN_SEND_HISTORY_LIMIT).toBe(10);
    expect(mockListJobs).toHaveBeenCalledWith(OWNER, [REQUEST]);
    expect(mockAdminAnchor).toHaveBeenCalledWith(OWNER, expect.any(String));
    expect(mockOwnerAnchor).not.toHaveBeenCalled();
    expect(body.data.nextSendAt).toBe('2026-10-28T10:05:00.000Z');
    expect(body.data.sends).toEqual([
      { requestId: REQUEST, requestedAt: T, modules: [{ module: 'clients', name: 'Clients', status: 'sent', sentAt: T, emailCount: 1 }] },
    ]);
    expect(body.data.modules.map((m: { id: string }) => m.id)).not.toContain('smart_links');
    expect(body.data.modules[0]).toEqual({ id: expect.any(String), name: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain('@');
    expect(mockRateLimit.mock.calls[0][1]).toBe('admin-export-sends-read');
  });

  it('T-H2: closed → state closed, no email in the body, no history read', async () => {
    mockIdentity.mockResolvedValue(identity(CLOSED_EMAIL));
    const body = await (await get()).json();
    expect(body.data).toMatchObject({ state: 'closed', sends: [], nextSendAt: null });
    expect(JSON.stringify(body)).not.toContain('@');
    expect(mockListRecent).not.toHaveBeenCalled();
  });

  it('T-H3: no usable email → no_login_email; no account → not_found', async () => {
    mockIdentity.mockResolvedValue(identity(null));
    expect((await (await get()).json()).data.state).toBe('no_login_email');
    mockIdentity.mockResolvedValue({ data: null, error: null });
    const body = await (await get()).json();
    expect(body.data.state).toBe('not_found');
    expect(body.data.sends).toEqual([]);
  });

  it("S-1: the admin's own account → state self, before the identity read", async () => {
    const body = await (await get(ADMIN.id)).json();
    expect(body.data.state).toBe('self');
    expect(mockIdentity).not.toHaveBeenCalled();
  });

  it('T-H4: the hint read fails → 200 with nextSendAt null and a warn', async () => {
    mockAdminAnchor.mockResolvedValue({ data: null, error: Object.assign(new Error('x'), { code: 'XX000' }) });
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).data.nextSendAt).toBeNull();
    expect(allLogText()).toContain('limit_anchor_unreadable');
  });

  it('T-H5: the history read fails → 500, never an empty list', async () => {
    mockListRecent.mockResolvedValue({ data: null, error: new Error('x') });
    const first = await get();
    expect(first.status).toBe(500);
    expect((await first.json()).data).toBeUndefined();
    mockListRecent.mockResolvedValue({ data: [ROW], error: null });
    mockListJobs.mockResolvedValue({ data: null, error: new Error('y') });
    expect((await get()).status).toBe(500);
  });

  it('the identity read fails → 500', async () => {
    mockIdentity.mockResolvedValue({ data: null, error: new Error('auth down') });
    expect((await get()).status).toBe(500);
  });

  it.each(['?userId=x', '?before=2026-10-27', '?a=1&a=2'])('T-H6: any query (%s) → 400', async (query) => {
    expect((await get(OWNER, query)).status).toBe(400);
    expect(mockIdentity).not.toHaveBeenCalled();
  });

  it('a path id that is not a uuid → 400', async () => {
    expect((await get('nope')).status).toBe(400);
  });

  // QA (2026-11-04): the GET's throttle refusal and its lower-casing were not pinned.
  it('QA: 429 from the read throttle, before the identity read', async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, hits: 99, degraded: false });
    const response = await get();
    expect(response.status).toBe(429);
    expect(mockRateLimit.mock.calls[0][1]).toBe('admin-export-sends-read');
    expect(mockIdentity).not.toHaveBeenCalled();
    expect(mockListRecent).not.toHaveBeenCalled();
  });

  it('QA: an upper-case uuid is lower-cased before every GET read', async () => {
    const lettered = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    mockListRecent.mockResolvedValue({ data: [{ id: REQUEST, origin: 'admin', modules: ['clients'], requestedAt: T }], error: null });
    const response = await get(lettered.toUpperCase());
    expect(response.status).toBe(200);
    expect(mockIdentity).toHaveBeenCalledWith(lettered);
    expect(mockListRecent).toHaveBeenCalledWith(lettered, { limit: ADMIN_SEND_HISTORY_LIMIT, origin: 'admin' });
    expect(mockListJobs).toHaveBeenCalledWith(lettered, [REQUEST]);
    expect(mockAdminAnchor).toHaveBeenCalledWith(lettered, expect.any(String));
  });

  it("QA: the admin's own account in upper case is still 'self'", async () => {
    const body = await (await get(ADMIN.id.toUpperCase())).json();
    expect(body.data.state).toBe('self');
    expect(mockIdentity).not.toHaveBeenCalled();
  });
});

describe('T-W1: the worker sends to the owner, never to the admin', () => {
  it("the worker files never read the request's admin_actor_id; the recipient is findIdentity(job.user_id)", () => {
    const dir = join(process.cwd(), 'lib', 'business-os', 'data-export');
    for (const file of ['moduleExportWorker.ts', 'moduleExportWorkerDeps.ts']) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect({ file, readsAdminActor: /admin_actor|adminActor/.test(source) }).toEqual({ file, readsAdminActor: false });
    }
    expect(readFileSync(join(dir, 'moduleExportWorker.ts'), 'utf8')).toContain('findIdentity(job.user_id)');
  });
});
