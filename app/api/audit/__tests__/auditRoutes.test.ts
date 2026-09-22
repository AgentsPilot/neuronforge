/**
 * The audit trail's browser-facing routes (Layer 3 step 0, FR-21 to FR-26,
 * AC-21 to AC-24): GET /api/audit/query, POST /api/audit/log, POST /api/audit-trail.
 *
 * The session, the repository and the audit service are mocked; what is
 * asserted is who the routes read and write as, and what they refuse.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockLog = jest.fn();
const mockFlush = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: {
    log: (...args: unknown[]) => mockLog(...args),
    flush: (...args: unknown[]) => mockFlush(...args),
  },
}));

const mockListOwnerEntries = jest.fn();
jest.mock('@/lib/repositories/AuditTrailRepository', () => ({
  auditTrailRepository: { listOwnerEntries: (...args: unknown[]) => mockListOwnerEntries(...args) },
}));

const mockLogged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        const fields =
          typeof first === 'object' && first !== null
            ? JSON.parse(JSON.stringify(first, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message } : v)))
            : {};
        mockLogged.push({ level, fields, msg: typeof first === 'string' ? first : String(second ?? '') });
      };
    }
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { GET as queryGET } from '../query/route';
import { POST as logPOST } from '../log/route';
import * as auditTrailRoute from '../../audit-trail/route';
import { CLIENT_WRITABLE_ENTITY_TYPES, CLIENT_WRITABLE_EVENTS } from '@/lib/audit/requestSchemas';
import { AUDIT_EVENTS } from '@/lib/audit/events';

const OWNER_A = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'a@example.com' };
const OWNER_B_ID = '99999999-9999-4999-8999-999999999999';

const PAGE = { logs: [{ id: 'row-1', action: 'USER_LOGIN' }], total: 1, page: 1, limit: 1000, hasMore: false };

function get(query: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/audit/query${query}`, { headers });
}

function post(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const WRITE_URLS = ['http://localhost/api/audit/log', 'http://localhost/api/audit-trail'] as const;
const writeHandler = (url: (typeof WRITE_URLS)[number]) => (url.endsWith('/api/audit/log') ? logPOST : auditTrailRoute.POST);

beforeEach(() => {
  mockGetUser.mockReset();
  mockLog.mockReset();
  mockLog.mockResolvedValue(undefined);
  mockFlush.mockReset();
  mockFlush.mockResolvedValue(undefined);
  mockListOwnerEntries.mockReset();
  mockListOwnerEntries.mockResolvedValue({ data: PAGE, error: null });
  mockLogged.length = 0;
});

describe('GET /api/audit/query', () => {
  it('returns 401 with no session, even when a user is named in the header (AC-21)', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await queryGET(get('?limit=10', { 'x-user-id': OWNER_B_ID }));
    expect(res.status).toBe(401);
    expect(mockListOwnerEntries).not.toHaveBeenCalled();
    // WC-10: the rejected call is counted, without the header's value.
    const rejected = mockLogged.find((l) => l.msg === 'Audit read rejected: no session');
    expect(rejected).toMatchObject({ level: 'info', fields: { legacyHeaderPresent: true } });
    expect(JSON.stringify(mockLogged)).not.toContain(OWNER_B_ID);
  });

  it("accepts the /monitoring page's own request and keeps the response shape (AC-23, AC-24)", async () => {
    mockGetUser.mockResolvedValue(OWNER_A);
    const res = await queryGET(get('?limit=1000&offset=0', { 'x-user-id': OWNER_A.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, ...PAGE });
    expect(mockListOwnerEntries).toHaveBeenCalledWith(OWNER_A.id, {
      action: undefined,
      entityType: undefined,
      severity: undefined,
      page: 1,
      limit: 1000,
    });
  });

  it('reads only the session user, whatever the header says (AC-22)', async () => {
    mockGetUser.mockResolvedValue(OWNER_A);
    await queryGET(get('', { 'x-user-id': OWNER_B_ID }));
    expect(mockListOwnerEntries).toHaveBeenCalledTimes(1);
    expect(mockListOwnerEntries.mock.calls[0][0]).toBe(OWNER_A.id);
  });

  it.each([['?limit=0'], ['?limit=5000'], ['?page=0'], ['?severity=medium'], ['?action=not%20an%20id'], ['?entityType=a;b']])(
    'rejects invalid input %s with 400 (AC-23)',
    async (query) => {
      mockGetUser.mockResolvedValue(OWNER_A);
      const res = await queryGET(get(query));
      expect(res.status).toBe(400);
      expect(mockListOwnerEntries).not.toHaveBeenCalled();
    }
  );

  it('accepts a historic entity type outside the TS union as a filter (WC-6)', async () => {
    mockGetUser.mockResolvedValue(OWNER_A);
    const res = await queryGET(get('?entityType=stripe_connect_account'));
    expect(res.status).toBe(200);
    expect(mockListOwnerEntries.mock.calls[0][1]).toMatchObject({ entityType: 'stripe_connect_account' });
  });

  it('returns no internal error text outside development (FR-26)', async () => {
    mockGetUser.mockResolvedValue(OWNER_A);
    mockListOwnerEntries.mockResolvedValue({ data: null, error: new Error('relation "secret_table" does not exist') });
    const res = await queryGET(get(''));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret_table');
  });
});

describe.each(WRITE_URLS)('POST %s', (url) => {
  const handler = writeHandler(url);
  const valid = { action: 'SETTINGS_PROFILE_UPDATED', entityType: 'user', entityId: OWNER_A.id };

  it('returns 401 with no session, whatever identity the request names, and writes nothing (AC-21)', async () => {
    mockGetUser.mockResolvedValue(null);
    for (const [body, headers] of [
      [valid, { 'x-user-id': OWNER_B_ID }],
      [{ ...valid, userId: OWNER_B_ID }, {}],
      [valid, { 'x-user-id': 'anonymous' }],
    ] as const) {
      const res = await handler(post(url, body, headers));
      expect(res.status).toBe(401);
    }
    expect(mockLog).not.toHaveBeenCalled();
    // WC-10: whether the legacy channels were used is logged, never their values.
    const rejected = mockLogged.filter((l) => l.msg === 'Audit write rejected: no session');
    expect(rejected).toHaveLength(3);
    expect(rejected[1].fields).toMatchObject({ legacyBodyUserIdPresent: true });
    expect(JSON.stringify(mockLogged)).not.toContain(OWNER_B_ID);
  });

  it('records a write under the session user, never the one the request names (AC-22)', async () => {
    mockGetUser.mockResolvedValue(OWNER_A);
    const res = await handler(post(url, { ...valid, userId: OWNER_B_ID }, { 'x-user-id': OWNER_B_ID }));
    expect(res.status).toBe(200);
    expect(mockLog).toHaveBeenCalledTimes(1);
    const input = mockLog.mock.calls[0][0];
    expect(input.userId).toBe(OWNER_A.id);
    expect(input.actorId).toBe(OWNER_A.id);
    expect(JSON.stringify({ ...input, request: undefined })).not.toContain(OWNER_B_ID);
  });

  it('never passes a client severity or compliance flags to the service (AC-23)', async () => {
    mockGetUser.mockResolvedValue(OWNER_A);
    await handler(post(url, { ...valid, severity: 'critical', complianceFlags: ['HIPAA'] }));
    const input = mockLog.mock.calls[0][0];
    expect(input).not.toHaveProperty('severity');
    expect(input).not.toHaveProperty('complianceFlags');
  });

  it.each([
    [{ ...valid, entityType: 'ai_action' }],
    [{ ...valid, action: 'BUSINESS_AI_ACTION_COMPLETED' }],
    [{ ...valid, action: 'NOT_A_REGISTERED_EVENT' }],
    [{ ...valid, entityType: 'not_an_entity' }],
    [{ entityType: 'user' }],
    [{ ...valid, details: { blob: 'x'.repeat(9000) } }],
  ])('rejects %j with 400 and writes nothing (AC-23)', async (body) => {
    mockGetUser.mockResolvedValue(OWNER_A);
    const res = await handler(post(url, body));
    expect(res.status).toBe(400);
    expect(mockLog).not.toHaveBeenCalled();
  });

  // Layer 3 step 2 registers the AI events and entity type. Registration must not
  // make them browser-writable: the step 0 allow-list still refuses every form.
  it.each([
    [{ ...valid, action: 'BUSINESS_AI_ACTION_COMPLETED', entityType: 'ai_action' }],
    [{ ...valid, action: 'BUSINESS_AI_ACTION_FAILED', entityType: 'ai_action' }],
    [{ ...valid, action: 'BUSINESS_AI_ACTION_FAILED' }],
    [{ ...valid, entityType: 'ai_action' }],
  ])('keeps rejecting a registered AI audit event or entity %j with 400 (Layer 3 step 2)', async (body) => {
    expect(Object.values(AUDIT_EVENTS)).toContain('BUSINESS_AI_ACTION_COMPLETED');
    mockGetUser.mockResolvedValue(OWNER_A);
    const res = await handler(post(url, body));
    expect(res.status).toBe(400);
    expect(mockLog).not.toHaveBeenCalled();
  });

  // SA CR-1: registered is not enough; only the browser allow-list is writable.
  it.each([
    [{ ...valid, action: 'PAYMENT_REFUNDED' }],
    [{ ...valid, action: 'BUSINESS_DATA_PURGED' }],
    [{ ...valid, action: 'SUBSCRIPTION_CANCELED' }],
    [{ ...valid, action: 'AGENT_DELETED' }],
    [{ ...valid, entityType: 'payment_transaction' }],
    [{ ...valid, entityType: 'subscription' }],
  ])('rejects a registered but server-only event or entity %j with 400, writing nothing (CR-1)', async (body) => {
    mockGetUser.mockResolvedValue(OWNER_A);
    const res = await handler(post(url, body));
    expect(res.status).toBe(400);
    expect(mockLog).not.toHaveBeenCalled();
  });

  // SA CR-2: the service's own detail keys cannot be supplied by a client.
  it('strips service-reserved keys from client details (CR-2)', async () => {
    mockGetUser.mockResolvedValue(OWNER_A);
    await handler(
      post(url, { ...valid, details: { system_action: true, changeSummary: 'forged', method: 'manual' } })
    );
    expect(mockLog.mock.calls[0][0].details).toEqual({ method: 'manual' });
  });

  it('rejects a body that is not JSON with 400', async () => {
    mockGetUser.mockResolvedValue(OWNER_A);
    const res = await handler(post(url, '{not json'));
    expect(res.status).toBe(400);
  });

  it('turns before/after into a change set, as before', async () => {
    mockGetUser.mockResolvedValue(OWNER_A);
    await handler(post(url, { ...valid, before: { name: 'Old' }, after: { name: 'New' } }));
    expect(mockLog.mock.calls[0][0].changes).toBeDefined();
  });

  it('does not wait for the audit service', async () => {
    mockGetUser.mockResolvedValue(OWNER_A);
    mockLog.mockReturnValue(new Promise(() => undefined)); // never settles
    const res = await handler(post(url, valid));
    expect(res.status).toBe(200);
  });
});

/**
 * FR-29 (Layer 3, KI-F): a logout is usually the last request on its serverless
 * instance, so its queued entry was lost in production. The logout write queues
 * the entry and then flushes, within about 2 s, before responding; nothing else
 * flushes, and a failed or slow flush never blocks the logout.
 */
describe('flush on logout (FR-29)', () => {
  const logout = { action: 'USER_LOGOUT', entityType: 'user', entityId: OWNER_A.id, details: { method: 'settings' } };

  it.each(WRITE_URLS)('%s: a logout queues the entry, then flushes exactly once, then answers success', async (url) => {
    mockGetUser.mockResolvedValue(OWNER_A);
    const order: string[] = [];
    mockLog.mockImplementation(async () => void order.push('log'));
    mockFlush.mockImplementation(async () => void order.push('flush'));

    const res = await writeHandler(url)(post(url, logout));

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['log', 'flush']); // queued before the flush looks at the queue
    expect(mockLog.mock.calls[0][0]).toMatchObject({ action: 'USER_LOGOUT', userId: OWNER_A.id });
  });

  it('still answers success when the flush throws, and logs it without content', async () => {
    mockGetUser.mockResolvedValue(OWNER_A);
    mockFlush.mockRejectedValue(new Error('database unreachable'));
    const res = await logPOST(post('http://localhost/api/audit/log', logout));
    expect(res.status).toBe(200);
    expect(mockLogged.some((l) => l.level === 'error' && l.msg === 'Audit flush on logout failed; logout continues')).toBe(true);
  });

  it('still answers success, after about 2 s, when the flush hangs', async () => {
    mockGetUser.mockResolvedValue(OWNER_A);
    mockFlush.mockReturnValue(new Promise(() => undefined)); // never settles
    const started = Date.now();
    const res = await logPOST(post('http://localhost/api/audit/log', logout));
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(elapsed).toBeLessThan(5000);
    expect(mockLogged.some((l) => l.level === 'warn' && l.msg === 'Audit flush on logout timed out; logout continues')).toBe(true);
  }, 10_000);

  it('any other event does not flush', async () => {
    mockGetUser.mockResolvedValue(OWNER_A);
    await logPOST(post('http://localhost/api/audit/log', { action: 'SETTINGS_PROFILE_UPDATED', entityType: 'user' }));
    await logPOST(post('http://localhost/api/audit/log', { action: 'USER_LOGIN', entityType: 'user' }));
    expect(mockLog).toHaveBeenCalledTimes(2);
    expect(mockFlush).not.toHaveBeenCalled();
  });
});

describe('the browser allow-list (CR-1)', () => {
  it('is exactly the 10 events and 3 entity types the surveyed callers send', () => {
    expect([...CLIENT_WRITABLE_EVENTS].sort()).toEqual(
      [
        'PLUGIN_DISCONNECTED',
        'SETTINGS_NOTIFICATIONS_UPDATED',
        'SETTINGS_PROFILE_UPDATED',
        'SETTINGS_SECURITY_UPDATED',
        'USER_DATA_EXPORTED',
        'USER_LOGIN',
        'USER_LOGOUT',
        'USER_ONBOARDING_COMPLETED',
        'USER_ONBOARDING_FAILED',
        'USER_PASSWORD_CHANGED',
      ].sort()
    );
    expect([...CLIENT_WRITABLE_ENTITY_TYPES].sort()).toEqual(['connection', 'settings', 'user']);
  });
});

describe('GET /api/audit-trail (M-4)', () => {
  it('no longer exists', () => {
    expect((auditTrailRoute as Record<string, unknown>).GET).toBeUndefined();
  });
});

/**
 * Every browser caller found in the repository (workplan §2.4), replayed with the
 * payload it sends today. Each must still be accepted (AC-24, T-C1).
 */
describe('existing browser callers keep working (T-C1)', () => {
  const callers: Array<[string, string, Record<string, unknown>]> = [
    ['auth/callback', '/api/audit/log', { action: 'USER_LOGIN', entityType: 'user', entityId: OWNER_A.id, userId: OWNER_A.id, resourceName: 'a@example.com', details: { provider: 'google' }, severity: 'info', complianceFlags: ['SOC2'] }],
    ['business-os/settings logout', '/api/audit/log', { action: 'USER_LOGOUT', entityType: 'user', entityId: OWNER_A.id, userId: OWNER_A.id, resourceName: 'a@example.com', details: { method: 'manual' }, severity: 'info', complianceFlags: ['SOC2'] }],
    ['LogoutButton', '/api/audit/log', { action: 'USER_LOGOUT', entityType: 'user', entityId: OWNER_A.id, userId: OWNER_A.id, resourceName: 'a@example.com', details: { method: 'manual' }, severity: 'info', complianceFlags: ['SOC2'] }],
    ['useOnboarding completed', '/api/audit/log', { action: 'USER_ONBOARDING_COMPLETED', entityType: 'user', entityId: OWNER_A.id, details: { role: 'owner' }, severity: 'info' }],
    ['useOnboarding failed', '/api/audit/log', { action: 'USER_ONBOARDING_FAILED', entityType: 'user', entityId: OWNER_A.id, details: { error: 'x' }, severity: 'warning' }],
    ['NotificationsTab', '/api/audit/log', { action: 'SETTINGS_NOTIFICATIONS_UPDATED', entityType: 'settings', entityId: OWNER_A.id, userId: OWNER_A.id, before: null, after: { email: true }, severity: 'info' }],
    ['ProfileTab', '/api/audit/log', { action: 'SETTINGS_PROFILE_UPDATED', entityType: 'user', entityId: OWNER_A.id, userId: OWNER_A.id, before: { full_name: 'A' }, after: { full_name: 'B' }, severity: 'info' }],
    ['SecurityTab settings', '/api/audit/log', { action: 'SETTINGS_SECURITY_UPDATED', entityType: 'settings', entityId: OWNER_A.id, userId: OWNER_A.id, before: {}, after: { two_factor: true }, severity: 'critical', complianceFlags: ['SOC2', 'GDPR'] }],
    ['SecurityTab password', '/api/audit/log', { action: 'USER_PASSWORD_CHANGED', entityType: 'user', entityId: OWNER_A.id, userId: OWNER_A.id, severity: 'critical', complianceFlags: ['SOC2', 'GDPR'] }],
    ['SecurityTabV2 data export', '/api/audit/log', { action: 'USER_DATA_EXPORTED', entityType: 'user', entityId: OWNER_A.id, userId: OWNER_A.id, severity: 'medium', complianceFlags: ['GDPR', 'CCPA'] }],
    ['PluginsTab', '/api/audit-trail', { action: 'PLUGIN_DISCONNECTED', entityType: 'connection', entityId: 'conn-1', userId: OWNER_A.id, resourceName: 'Gmail', details: { plugin_key: 'google-mail' }, severity: 'warning', complianceFlags: ['SOC2'] }],
  ];

  it.each(callers)('%s is accepted and recorded under the session user', async (_name, path, body) => {
    mockGetUser.mockResolvedValue(OWNER_A);
    const url = `http://localhost${path}` as (typeof WRITE_URLS)[number];
    const res = await writeHandler(url)(post(url, body));
    expect(res.status).toBe(200);
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockLog.mock.calls[0][0]).toMatchObject({ action: body.action, entityType: body.entityType, userId: OWNER_A.id });
  });
});
