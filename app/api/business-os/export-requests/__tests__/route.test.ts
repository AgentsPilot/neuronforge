/**
 * POST / GET /api/business-os/export-requests (module export MX-1b, workplan
 * §4, §5, T-2; SA workplan review C-1, C-2, C-7).
 *
 * Every collaborator is mocked: the session, the throttle, both repositories,
 * the preferences read, the owner clock, the transport and the audit flush.
 * The module map is the real one with `smart_links` switched off, so a
 * switched-off module and an unknown one are both proved refused.
 */

import { NextRequest } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' };
const OTHER = '99999999-9999-4999-8999-999999999999';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const REQUEST_OLD = '44444444-4444-4444-8444-444444444444';
const T = '2026-10-27T10:05:00.000Z';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockRateLimit = jest.fn();
jest.mock('@/lib/security/rateLimit', () => ({
  ...jest.requireActual('@/lib/security/rateLimit'),
  rateLimit: (...a: unknown[]) => mockRateLimit(...a),
}));

jest.mock('@/lib/business-os/data-export/exportModules', () => {
  const actual = jest.requireActual('@/lib/business-os/data-export/exportModules');
  return {
    ...actual,
    EXPORT_MODULES: actual.EXPORT_MODULES.map((m: { id: string }) => (m.id === 'smart_links' ? { ...m, on: false } : m)),
  };
});

const mockStartForOwner = jest.fn();
const mockFindById = jest.fn();
const mockListRecent = jest.fn();
const mockMarkSent = jest.fn();
const requestRepoCtor = jest.fn();
jest.mock('@/lib/repositories/BusinessOsExportRequestRepository', () => ({
  BusinessOsExportRequestRepository: jest.fn().mockImplementation((...args: unknown[]) => {
    requestRepoCtor(...args);
    return {
      startForOwner: (...a: unknown[]) => mockStartForOwner(...a),
      findByIdForUser: (...a: unknown[]) => mockFindById(...a),
      listRecentForUser: (...a: unknown[]) => mockListRecent(...a),
      markRequestedEmailSent: (...a: unknown[]) => mockMarkSent(...a),
    };
  }),
}));

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
  logger.child = () => logger;
  return { createLogger: () => logger, __calls: calls };
});
const logCalls = (jest.requireMock('@/lib/logger') as { __calls: unknown[][] }).__calls;

import { GET, POST, REQUESTED_EMAIL_TIMEOUT_MS } from '../route';
import { AUDIT_EVENTS } from '@/lib/audit/events';

function post(body: unknown, raw = false): NextRequest {
  return new NextRequest('http://localhost/api/business-os/export-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}
const get = (query = '') => new NextRequest(`http://localhost/api/business-os/export-requests${query}`, { method: 'GET' });

const started = { data: { outcome: 'started', requestId: REQUEST }, error: null };

beforeEach(() => {
  jest.clearAllMocks();
  logCalls.length = 0;
  mockGetUser.mockResolvedValue(USER);
  mockRateLimit.mockResolvedValue({ allowed: true, hits: 1, degraded: false });
  mockStartForOwner.mockResolvedValue(started);
  mockFindById.mockResolvedValue({ data: { requested_at: T }, error: null });
  mockMarkSent.mockResolvedValue({ data: { updated: true }, error: null });
  mockLanguage.mockResolvedValue({ data: 'en', error: null });
  mockClock.mockResolvedValue({ timezone: 'Asia/Jerusalem', isSet: true });
  mockSendEmail.mockResolvedValue({ sent: true, provider: 'resend', providerMessageId: 're_1' });
  mockLogAndFlush.mockResolvedValue(undefined);
  mockListRecent.mockResolvedValue({ data: [], error: null });
  mockListJobs.mockResolvedValue({ data: [], error: null });
});

const allLogText = () => JSON.stringify(logCalls);

describe('POST', () => {
  it('401 without a session, nothing else runs', async () => {
    mockGetUser.mockResolvedValue(null);
    const response = await POST(post({ modules: ['clients'] }));
    expect(response.status).toBe(401);
    expect(mockStartForOwner).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it.each([
    ['a blank body', '', true],
    ['invalid JSON', '{nope', true],
    ['{}', {}, false],
    ['no modules', { modules: [] }, false],
    ['a duplicate', { modules: ['clients', 'clients'] }, false],
    ['an unknown module', { modules: ['clients', 'payroll'] }, false],
    ['a switched-off module', { modules: ['smart_links'] }, false],
    ['a userId key', { modules: ['clients'], userId: OTHER }, false],
    ['a non-array', { modules: 'clients' }, false],
  ])('400 for %s, and no start', async (_label, body, raw) => {
    const response = await POST(post(body, raw));
    expect(response.status).toBe(400);
    expect((await response.json()).success).toBe(false);
    expect(mockStartForOwner).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('happy path: 201, the session id only, one flushed audit, one email to the login address, marked', async () => {
    const response = await POST(post({ modules: ['clients', 'quotes', 'website'] }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ success: true, data: { requestId: REQUEST, sentTo: USER.email, requestedEmailSent: true } });
    expect(response.headers.get('cache-control')).toContain('no-store');

    expect(mockStartForOwner).toHaveBeenCalledWith(USER.id, ['clients', 'quotes', 'website']);
    expect(mockRateLimit).toHaveBeenCalledWith(expect.anything(), 'export-request-start', expect.objectContaining({ limit: 10 }));

    // C-2: the audit row is flushed, with ids only.
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    const [entry] = mockLogAndFlush.mock.calls[0];
    expect(entry).toMatchObject({
      action: AUDIT_EVENTS.DATA_EXPORT_REQUESTED,
      entityType: 'user',
      entityId: USER.id,
      userId: USER.id,
      details: { request_id: REQUEST, modules: ['clients', 'quotes', 'website'], origin: 'owner' },
    });
    expect(JSON.stringify(entry)).not.toContain(USER.email);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const [params] = mockSendEmail.mock.calls[0];
    expect(params).toMatchObject({ kind: 'transactional', to: [USER.email], redactRecipientInLogs: true, subject: 'Your data export has started' });
    expect(params.unsubscribeUrl).toBeUndefined();
    for (const name of ['Clients', 'Quotes', 'Website']) expect(params.text).toContain(name);
    // The database time in the owner's zone: 10:05 UTC is 12:05 in Jerusalem.
    expect(params.text).toContain('12:05');

    expect(mockFindById).toHaveBeenCalledWith(REQUEST, USER.id);
    expect(mockMarkSent).toHaveBeenCalledWith(REQUEST, USER.id);
  });

  it('the audit is flushed before the email is sent (C-2 order)', async () => {
    const order: string[] = [];
    mockLogAndFlush.mockImplementation(async () => void order.push('audit'));
    mockSendEmail.mockImplementation(async () => (order.push('email'), { sent: true, provider: 'resend' }));
    await POST(post({ modules: ['clients'] }));
    expect(order).toEqual(['audit', 'email']);
  });

  it('a slow flush (logAndFlush bounds itself and settles void, success or not) still ends in 201 with the email sent', async () => {
    jest.useFakeTimers();
    try {
      mockLogAndFlush.mockImplementation(() => new Promise<void>((resolve) => setTimeout(resolve, 3_000)));
      const pending = POST(post({ modules: ['clients'] }));
      await jest.advanceTimersByTimeAsync(3_001);
      const response = await pending;
      expect(response.status).toBe(201);
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('in_progress → 409 export_in_progress; no audit, no email', async () => {
    mockStartForOwner.mockResolvedValue({ data: { outcome: 'in_progress' }, error: null });
    const response = await POST(post({ modules: ['clients'] }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code: 'export_in_progress' });
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('daily_limit → 409 export_daily_limit with retryAt; no audit, no email', async () => {
    mockStartForOwner.mockResolvedValue({ data: { outcome: 'daily_limit', retryAt: T }, error: null });
    const response = await POST(post({ modules: ['clients'] }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code: 'export_daily_limit', retryAt: T });
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it.each([[null], [''], ['  '], ['deleted-abc@deleted.invalid']])('login email %p → 409 export_no_login_email and nothing written', async (email) => {
    mockGetUser.mockResolvedValue({ ...USER, email });
    const response = await POST(post({ modules: ['clients'] }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'export_no_login_email' });
    expect(mockStartForOwner).not.toHaveBeenCalled();
  });

  it('the email fails → 201 with requestedEmailSent false, not marked, logged as email_failed', async () => {
    mockSendEmail.mockResolvedValue({ sent: false, provider: 'none', error: 'x' });
    const response = await POST(post({ modules: ['clients'] }));
    expect(response.status).toBe(201);
    expect((await response.json()).data.requestedEmailSent).toBe(false);
    expect(mockMarkSent).not.toHaveBeenCalled();
    expect(allLogText()).toContain('email_failed');
  });

  it('the transport throws → 201, requestedEmailSent false', async () => {
    mockSendEmail.mockRejectedValue(new Error('boom'));
    const response = await POST(post({ modules: ['clients'] }));
    expect(response.status).toBe(201);
    expect((await response.json()).data.requestedEmailSent).toBe(false);
  });

  it('the email times out → 201, not marked, logged as email_timeout, not email_failed (C-7)', async () => {
    jest.useFakeTimers();
    try {
      mockSendEmail.mockImplementation(() => new Promise(() => undefined));
      const pending = POST(post({ modules: ['clients'] }));
      await jest.advanceTimersByTimeAsync(REQUESTED_EMAIL_TIMEOUT_MS + 1);
      const response = await pending;
      expect(response.status).toBe(201);
      expect((await response.json()).data.requestedEmailSent).toBe(false);
      expect(mockMarkSent).not.toHaveBeenCalled();
      expect(allLogText()).toContain('email_timeout');
      expect(allLogText()).not.toContain('email_failed');
    } finally {
      jest.useRealTimers();
    }
  });

  it('the mark fails after a sent email → still 201 with requestedEmailSent true, logged', async () => {
    mockMarkSent.mockResolvedValue({ data: null, error: new Error('x') });
    const response = await POST(post({ modules: ['clients'] }));
    expect(response.status).toBe(201);
    expect((await response.json()).data.requestedEmailSent).toBe(true);
    expect(allLogText()).toContain('mark_failed');
  });

  it('the language and the request time are unreadable → English, server time; still 201', async () => {
    mockLanguage.mockResolvedValue({ data: null, error: new Error('x') });
    mockFindById.mockResolvedValue({ data: null, error: new Error('x') });
    const response = await POST(post({ modules: ['clients'] }));
    expect(response.status).toBe(201);
    expect(mockSendEmail.mock.calls[0][0].subject).toBe('Your data export has started');
  });

  it('a Hebrew owner gets the Hebrew email', async () => {
    mockLanguage.mockResolvedValue({ data: 'he', error: null });
    await POST(post({ modules: ['clients'] }));
    expect(mockSendEmail.mock.calls[0][0].html).toMatch(/^<div dir="rtl" lang="he"/);
  });

  it('a repository error → 500 with no details in production', async () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    try {
      mockStartForOwner.mockResolvedValue({ data: null, error: Object.assign(new Error('secret db text'), { code: 'XX000' }) });
      const response = await POST(post({ modules: ['clients'] }));
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.details).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('secret db text');
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prev;
    }
  });

  it('the throttle → 429, no start', async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, hits: 11, degraded: false });
    const response = await POST(post({ modules: ['clients'] }));
    expect(response.status).toBe(429);
    expect(mockStartForOwner).not.toHaveBeenCalled();
  });

  it('privacy: no log line carries the login email or the module list', async () => {
    await POST(post({ modules: ['clients', 'quotes', 'website'] }));
    const text = allLogText();
    expect(text).not.toContain(USER.email);
    expect(text).not.toMatch(/"quotes"|"website"/);
  });
});

describe('GET', () => {
  it('401 without a session', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await GET(get())).status).toBe(401);
    expect(mockListRecent).not.toHaveBeenCalled();
  });

  it('reads requests for the session user, then jobs of exactly those requests, and assembles them', async () => {
    mockListRecent.mockResolvedValue({
      data: [
        { id: REQUEST, origin: 'owner', modules: ['quotes', 'clients'], requestedAt: T },
        { id: REQUEST_OLD, origin: 'owner', modules: ['bookings'], requestedAt: '2026-10-26T09:00:00.000Z' },
      ],
      error: null,
    });
    mockListJobs.mockResolvedValue({
      data: [
        { id: 'j1', requestId: REQUEST, module: 'clients', status: 'sent', sentAt: T, emailCount: 2 },
        { id: 'j3', requestId: REQUEST_OLD, module: 'bookings', status: 'failed', sentAt: null, emailCount: 0 },
        { id: 'j2', requestId: REQUEST, module: 'quotes', status: 'waiting', sentAt: null, emailCount: 0 },
      ],
      error: null,
    });
    const response = await GET(get(`?userId=${OTHER}`));
    expect(response.status).toBe(200);
    expect(mockListRecent).toHaveBeenCalledWith(USER.id);
    expect(mockListJobs).toHaveBeenCalledWith(USER.id, [REQUEST, REQUEST_OLD]);
    expect(mockRateLimit).toHaveBeenCalledWith(expect.anything(), 'export-request-history', expect.objectContaining({ limit: 120 }));
    expect(await response.json()).toEqual({
      success: true,
      data: {
        requests: [
          {
            requestId: REQUEST,
            requestedAt: T,
            origin: 'owner',
            modules: [
              { module: 'quotes', status: 'waiting', sentAt: null, emailCount: 0 },
              { module: 'clients', status: 'sent', sentAt: T, emailCount: 2 },
            ],
          },
          { requestId: REQUEST_OLD, requestedAt: '2026-10-26T09:00:00.000Z', origin: 'owner', modules: [{ module: 'bookings', status: 'failed', sentAt: null, emailCount: 0 }] },
        ],
      },
    });
  });

  it.each([
    ['the request read', () => mockListRecent.mockResolvedValue({ data: null, error: new Error('x') })],
    ['the job read', () => mockListJobs.mockResolvedValue({ data: null, error: new Error('x') })],
  ])('%s fails → 500', async (_label, arrange) => {
    arrange();
    expect((await GET(get())).status).toBe(500);
  });

  it('the throttle → 429', async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, hits: 121, degraded: false });
    expect((await GET(get())).status).toBe(429);
  });
});

describe('source rules', () => {
  const source = readFileSync(join(process.cwd(), 'app/api/business-os/export-requests/route.ts'), 'utf8');

  it('imports nothing from the entitlements module (XC-19) and has no console call', () => {
    // The header names the module to say it is not used; only an import counts.
    expect(source).not.toMatch(/from\s+['"][^'"]*business-os\/entitlements/);
    expect(source).not.toMatch(/require\(\s*['"][^'"]*business-os\/entitlements/);
    expect(source).not.toMatch(/console\./);
  });

  it('reads no flag and has no 404 of its own: the export switch is gone (MX-3.1)', () => {
    expect(source).not.toMatch(/featureFlags|notFound|, 404\)/);
    for (const handler of ['GET', 'POST']) {
      const body = source.split(`export async function ${handler}(request: NextRequest) {`)[1];
      expect(body).toBeDefined();
      const firstStatement = body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('//'));
      expect(firstStatement).toBe("const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();");
    }
  });
});
