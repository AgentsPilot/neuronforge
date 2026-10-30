/**
 * QA (MX-1b / E5, 2026-10-27): the module export route and the browser seam
 * wired to EACH OTHER. `global.fetch` is bridged to the real route handlers,
 * so every verdict the seam returns comes from a Response the real route
 * built. Only the route's collaborators are mocked (session, throttle,
 * repositories, preferences, clock, transport, audit flush). No database, no
 * network, no email.
 *
 * Adds to route.test.ts:
 *   - the history read as the real route produces it (MX-3.1: no switch, so
 *     anything but a valid 200 is `error`);
 *   - every refusal mapped end to end (route code → seam verdict), incl. the
 *     daily limit with and without retryAt (CR-2);
 *   - the email sent exactly once and after the flushed audit;
 *   - a query-string userId on POST changes nothing.
 */

import { NextRequest } from 'next/server';

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.com' };
const OTHER = '99999999-9999-4999-8999-999999999999';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const REQUEST_B = '22222222-2222-4222-8222-222222222222';
const T = '2026-10-27T10:05:00.000Z';
const RETRY = '2026-10-28T09:00:00.000Z';

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
  BusinessOsExportRequestRepository: jest.fn().mockImplementation(() => {
    requestRepoCtor();
    return {
      startForOwner: (...a: unknown[]) => mockStartForOwner(...a),
      findByIdForUser: (...a: unknown[]) => mockFindById(...a),
      listRecentForUser: (...a: unknown[]) => mockListRecent(...a),
      markRequestedEmailSent: (...a: unknown[]) => mockMarkSent(...a),
    };
  }),
}));

const mockListJobs = jest.fn();
const jobRepoCtor = jest.fn();
jest.mock('@/lib/repositories/BusinessOsExportModuleJobRepository', () => ({
  BusinessOsExportModuleJobRepository: jest.fn().mockImplementation(() => {
    jobRepoCtor();
    return { listForRequestsOfUser: (...a: unknown[]) => mockListJobs(...a) };
  }),
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

import { GET, POST } from '../route';
import { MODULE_EXPORT_URL, fetchModuleExportHistory, startModuleExport } from '@/lib/client/businessOsDataExport';

/** The browser's fetch, answered by the real route handlers. */
let lastRequest: NextRequest | null = null;
const originalFetch = global.fetch;
beforeAll(() => {
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(MODULE_EXPORT_URL)) throw new Error(`unexpected fetch ${url}`);
    const request = new NextRequest(`http://localhost${url}`, {
      method: init?.method ?? 'GET',
      headers: init?.headers as HeadersInit,
      body: init?.body as BodyInit | undefined,
    });
    lastRequest = request;
    return (init?.method ?? 'GET') === 'POST' ? POST(request) : GET(request);
  }) as typeof fetch;
});
afterAll(() => {
  global.fetch = originalFetch;
});

beforeEach(() => {
  jest.clearAllMocks();
  logCalls.length = 0;
  lastRequest = null;
  mockGetUser.mockResolvedValue(USER);
  mockRateLimit.mockResolvedValue({ allowed: true, hits: 1, degraded: false });
  mockStartForOwner.mockResolvedValue({ data: { outcome: 'started', requestId: REQUEST }, error: null });
  mockFindById.mockResolvedValue({ data: { requested_at: T }, error: null });
  mockMarkSent.mockResolvedValue({ data: { updated: true }, error: null });
  mockLanguage.mockResolvedValue({ data: 'en', error: null });
  mockClock.mockResolvedValue({ timezone: 'Asia/Jerusalem', isSet: true });
  mockSendEmail.mockResolvedValue({ sent: true, provider: 'resend', providerMessageId: 're_1' });
  mockLogAndFlush.mockResolvedValue(undefined);
  mockListRecent.mockResolvedValue({ data: [], error: null });
  mockListJobs.mockResolvedValue({ data: [], error: null });
});

describe('QA 3: the history read against the real route (MX-3.1)', () => {
  it('history readable → ok', async () => {
    expect(await fetchModuleExportHistory()).toEqual({ kind: 'ok', requests: [] });
  });

  it.each([
    ['session expired (401)', () => mockGetUser.mockResolvedValue(null)],
    ['throttled (429)', () => mockRateLimit.mockResolvedValue({ allowed: false, hits: 999, degraded: false })],
    ['request read fails (500)', () => mockListRecent.mockResolvedValue({ data: null, error: new Error('db down') })],
    ['job read fails (500)', () => mockListJobs.mockResolvedValue({ data: null, error: new Error('db down') })],
    ['unexpected throw (500)', () => mockListRecent.mockRejectedValue(new Error('boom'))],
  ])('%s: our JSON error body → error', async (_label, arrange) => {
    arrange();
    expect(await fetchModuleExportHistory()).toEqual({ kind: 'error' });
  });
});

describe('QA 2: POST end to end (route → seam verdict)', () => {
  it('happy path: started, sentTo the login email, audit flushed before the one email', async () => {
    const order: string[] = [];
    mockLogAndFlush.mockImplementation(async () => void order.push('audit'));
    mockSendEmail.mockImplementation(async () => (order.push('email'), { sent: true, provider: 'resend' }));
    const verdict = await startModuleExport(['clients', 'quotes', 'website']);
    expect(verdict).toEqual({ kind: 'started', requestId: REQUEST, sentTo: USER.email, requestedEmailSent: true });
    expect(order).toEqual(['audit', 'email']);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    expect(mockMarkSent).toHaveBeenCalledTimes(1);
  });

  it('the login email is trimmed for both the recipient and sentTo', async () => {
    mockGetUser.mockResolvedValue({ ...USER, email: '  owner@example.com  ' });
    const verdict = await startModuleExport(['clients']);
    expect(verdict).toMatchObject({ kind: 'started', sentTo: 'owner@example.com' });
    expect(mockSendEmail.mock.calls[0][0].to).toEqual(['owner@example.com']);
  });

  it('a mark failure after a sent email does not send a second email', async () => {
    mockMarkSent.mockResolvedValue({ data: null, error: new Error('x') });
    expect(await startModuleExport(['clients'])).toMatchObject({ kind: 'started', requestedEmailSent: true });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('a failed email → started with requestedEmailSent false (the request stands)', async () => {
    mockSendEmail.mockResolvedValue({ sent: false, provider: 'none' });
    expect(await startModuleExport(['clients'])).toMatchObject({ kind: 'started', requestedEmailSent: false });
    expect(mockMarkSent).not.toHaveBeenCalled();
  });

  it('a query-string userId on POST is ignored: the session id is the only account id', async () => {
    const response = await POST(
      new NextRequest(`http://localhost${MODULE_EXPORT_URL}?userId=${OTHER}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modules: ['clients'] }),
      })
    );
    expect(response.status).toBe(201);
    expect(mockStartForOwner).toHaveBeenCalledWith(USER.id, ['clients']);
    expect(JSON.stringify(mockStartForOwner.mock.calls)).not.toContain(OTHER);
  });

  it.each([
    ['in progress', () => mockStartForOwner.mockResolvedValue({ data: { outcome: 'in_progress' }, error: null }), { kind: 'refused', code: 'in_progress' }],
    ['daily limit with retryAt', () => mockStartForOwner.mockResolvedValue({ data: { outcome: 'daily_limit', retryAt: RETRY }, error: null }), { kind: 'refused', code: 'daily_limit', retryAt: RETRY }],
    ['daily limit without retryAt (CR-2)', () => mockStartForOwner.mockResolvedValue({ data: { outcome: 'daily_limit' }, error: null }), { kind: 'refused', code: 'failed' }],
    ['daily limit with retryAt null (CR-2)', () => mockStartForOwner.mockResolvedValue({ data: { outcome: 'daily_limit', retryAt: null }, error: null }), { kind: 'refused', code: 'failed' }],
    ['no login email', () => mockGetUser.mockResolvedValue({ ...USER, email: null }), { kind: 'refused', code: 'no_login_email' }],
    ['a deleted.invalid login email', () => mockGetUser.mockResolvedValue({ ...USER, email: 'x@deleted.invalid' }), { kind: 'refused', code: 'no_login_email' }],
    ['signed out (401)', () => mockGetUser.mockResolvedValue(null), { kind: 'refused', code: 'unauthorized' }],
    ['throttled (429)', () => mockRateLimit.mockResolvedValue({ allowed: false, hits: 99, degraded: false }), { kind: 'refused', code: 'throttled' }],
    ['repository error (500)', () => mockStartForOwner.mockResolvedValue({ data: null, error: new Error('rpc') }), { kind: 'refused', code: 'failed' }],
  ])('%s → the mapped refusal; no audit, no email', async (_label, arrange, expected) => {
    arrange();
    expect(await startModuleExport(['clients'])).toEqual(expected);
    expect(mockLogAndFlush).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockMarkSent).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown module', ['clients', 'payroll']],
    ['a switched-off module', ['smart_links']],
    ['an empty list', []],
    ['a duplicate', ['clients', 'clients']],
  ])('%s → invalid; nothing started, throttle not consumed', async (_label, modules) => {
    expect(await startModuleExport(modules as string[])).toEqual({ kind: 'refused', code: 'invalid' });
    expect(mockStartForOwner).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(lastRequest).not.toBeNull();
  });

  it('a userId in the body → 400 invalid (strict), nothing started', async () => {
    const response = await POST(
      new NextRequest(`http://localhost${MODULE_EXPORT_URL}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modules: ['clients'], userId: OTHER }),
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, code: 'invalid_input' });
    expect(mockStartForOwner).not.toHaveBeenCalled();
  });

  it('privacy: across the whole happy path no log line holds the address or the module list', async () => {
    await startModuleExport(['clients', 'quotes']);
    const text = JSON.stringify(logCalls);
    expect(text).not.toContain(USER.email);
    expect(text).not.toMatch(/"clients"|"quotes"/);
  });
});

describe('QA 5: history through the route (tie-break, malformed, origin, empty)', () => {
  it('the repository order is kept as given (requested_at DESC, id DESC): a tie stays in id-desc order, twice', async () => {
    // Same requested_at: the repository's id DESC tie-break puts REQUEST (3333…) before REQUEST_B (2222…).
    mockListRecent.mockResolvedValue({
      data: [
        { id: REQUEST, origin: 'owner', modules: ['clients'], requestedAt: T },
        { id: REQUEST_B, origin: 'admin', modules: ['quotes'], requestedAt: T },
      ],
      error: null,
    });
    mockListJobs.mockResolvedValue({
      data: [
        { id: 'j2', requestId: REQUEST_B, module: 'quotes', status: 'sent', sentAt: T, emailCount: 1 },
        { id: 'j1', requestId: REQUEST, module: 'clients', status: 'waiting', sentAt: null, emailCount: 0 },
      ],
      error: null,
    });
    const first = await fetchModuleExportHistory();
    mockListJobs.mockResolvedValue({ data: [...(await mockListJobs.mock.results[0].value).data].reverse(), error: null });
    const second = await fetchModuleExportHistory();
    expect(first).toEqual(second);
    expect(first.kind).toBe('ok');
    if (first.kind !== 'ok') return;
    expect(first.requests.map((r) => r.requestId)).toEqual([REQUEST, REQUEST_B]);
    expect(first.requests[1].origin).toBe('admin');
  });

  it('a job row the repository dropped (malformed) leaves its line out; the rest of the history still shows', async () => {
    mockListRecent.mockResolvedValue({
      data: [
        { id: REQUEST, origin: 'owner', modules: ['clients', 'quotes'], requestedAt: T },
        { id: REQUEST_B, origin: 'owner', modules: ['bookings'], requestedAt: '2026-10-26T09:00:00.000Z' },
      ],
      error: null,
    });
    // The `quotes` job was malformed and dropped by the per-row parse.
    mockListJobs.mockResolvedValue({
      data: [
        { id: 'j1', requestId: REQUEST, module: 'clients', status: 'sent', sentAt: T, emailCount: 2 },
        { id: 'j3', requestId: REQUEST_B, module: 'bookings', status: 'waiting', sentAt: null, emailCount: 0 },
      ],
      error: null,
    });
    const verdict = await fetchModuleExportHistory();
    expect(verdict.kind).toBe('ok');
    if (verdict.kind !== 'ok') return;
    expect(verdict.requests).toHaveLength(2);
    expect(verdict.requests[0].modules.map((m) => m.module)).toEqual(['clients']);
    expect(verdict.requests[1].modules.map((m) => m.module)).toEqual(['bookings']);
  });

  it('empty history → ok with no requests, and the job read is skipped-safe ([] ids)', async () => {
    expect(await fetchModuleExportHistory()).toEqual({ kind: 'ok', requests: [] });
    expect(mockListJobs).toHaveBeenCalledWith(USER.id, []);
  });
});
