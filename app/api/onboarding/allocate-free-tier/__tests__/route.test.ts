/**
 * POST /api/onboarding/allocate-free-tier — S-6 fix.
 *
 * Workplan §6.1 (R1–R9) plus the SA additions (R10–R13, RC-6 details hygiene).
 * The one question asked throughout: whose account can this touch? The answer
 * must be "the session user's, once" and never an id taken from the body.
 */

import { NextRequest } from 'next/server';

const getUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

const grant = jest.fn();
jest.mock('@/lib/services/FreeTierGrantService', () => ({
  freeTierGrantService: { grant: (...a: unknown[]) => grant(...a) },
}));

const auditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: (...a: unknown[]) => auditLog(...a) }) },
}));

// Capture log calls from the route's child loggers.
const logCalls: Record<'info' | 'warn' | 'error' | 'debug', unknown[][]> = { info: [], warn: [], error: [], debug: [] };
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const l: Record<string, unknown> = {};
    for (const lvl of ['info', 'warn', 'error', 'debug'] as const) {
      l[lvl] = (...a: unknown[]) => logCalls[lvl].push(a);
    }
    l.child = () => make();
    return l;
  };
  return { createLogger: () => make() };
});

import { POST } from '../route';

const SESSION = { id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', email: 'owner@example.com' };
const OTHER = '99999999-9999-4999-8999-999999999999';
const ALLOCATION = { pilot_tokens: 20834, raw_tokens: 208340, storage_mb: 1000, executions: null };

function req(body?: unknown, raw = false): NextRequest {
  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) init.body = raw ? (body as string) : JSON.stringify(body);
  return new NextRequest('http://localhost/api/onboarding/allocate-free-tier', init);
}

const ORIGINAL_ENV = process.env.NODE_ENV;
function setEnv(value: string) {
  (process.env as Record<string, string>).NODE_ENV = value;
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(logCalls) as Array<keyof typeof logCalls>) logCalls[k] = [];
  getUser.mockResolvedValue(SESSION);
  grant.mockResolvedValue({ status: 'GRANTED', path: 'insert', attempts: 1, allocation: ALLOCATION });
  auditLog.mockResolvedValue(undefined);
  setEnv('production');
});

afterAll(() => setEnv(ORIGINAL_ENV as string));

describe('POST /api/onboarding/allocate-free-tier', () => {
  it('R1: no body → 200, grants to the session user, audits once', async () => {
    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      alreadyGranted: false,
      allocation: ALLOCATION,
      message: 'Free tier quotas allocated successfully',
    });
    expect(grant).toHaveBeenCalledTimes(1);
    expect(grant.mock.calls[0][0]).toBe(SESSION.id);
    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditLog.mock.calls[0][0]).toMatchObject({
      action: 'FREE_TIER_ALLOCATED',
      entityType: 'subscription',
      entityId: SESSION.id,
      userId: SESSION.id,
      details: { pilot_tokens: 20834, raw_tokens: 208340, storage_mb: 1000, executions: 'unlimited', path: 'insert' },
    });
  });

  it('R1b: an empty JSON object body is accepted', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(grant.mock.calls[0][0]).toBe(SESSION.id);
  });

  it('R2: unauthenticated → 401, service never called', async () => {
    getUser.mockResolvedValue(null);
    const res = await POST(req({ userId: OTHER }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
    expect(grant).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('R3: body userId ≠ session → 403, service never called, warn with both ids', async () => {
    const res = await POST(req({ userId: OTHER }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'Forbidden' });
    expect(grant).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
    expect(logCalls.warn).toContainEqual([
      { sessionUserId: SESSION.id, attemptedUserId: OTHER },
      'free-tier grant: body userId mismatch',
    ]);
  });

  it('R4: body userId == session (legacy client) → 200, grant to the session id', async () => {
    const res = await POST(req({ userId: SESSION.id }));
    expect(res.status).toBe(200);
    expect(grant.mock.calls[0][0]).toBe(SESSION.id);
  });

  it('R11: mixed-case own id → 200, not a false 403 (RC-5)', async () => {
    const res = await POST(req({ userId: SESSION.id.toUpperCase() }));
    expect(res.status).toBe(200);
    expect(grant.mock.calls[0][0]).toBe(SESSION.id);
  });

  describe('R5: invalid body → 400, service never called', () => {
    it.each([
      ['non-uuid userId', { userId: 'not-a-uuid' }, false],
      ['extra key', { userId: SESSION.id, extra: 1 }, false],
      ['non-object JSON', [1, 2], false],
      ['malformed JSON', '{not json', true],
    ])('%s', async (_l, body, raw) => {
      const res = await POST(req(body, raw));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json).toEqual({ success: false, error: 'Invalid input' }); // no details in production
      expect(grant).not.toHaveBeenCalled();
    });

    it('details present (as a string) only in development', async () => {
      setEnv('development');
      const res = await POST(req({ userId: 'not-a-uuid' }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(typeof json.details).toBe('string');
    });
  });

  it('R12: injected fields → 400, service never called', async () => {
    const res = await POST(req({ userId: SESSION.id, balance: 999999, account_frozen: false, user_id: 'ATTACKER', total_earned: 1 }));
    expect(res.status).toBe(400);
    expect(grant).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('R6: ALREADY_GRANTED → 200 alreadyGranted: true, no audit', async () => {
    grant.mockResolvedValue({ status: 'ALREADY_GRANTED', attempts: 1 });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      alreadyGranted: true,
      allocation: null,
      message: 'Free tier already granted',
    });
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('R13: INELIGIBLE_FROZEN → 409, no audit, no details', async () => {
    grant.mockResolvedValue({ status: 'INELIGIBLE_FROZEN', attempts: 1 });
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, error: 'Free tier not available for this account' });
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('R8: RETRY_EXHAUSTED → 503 with a generic body', async () => {
    grant.mockResolvedValue({ status: 'RETRY_EXHAUSTED', attempts: 3 });
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ success: false, error: 'Please try again' });
    expect(auditLog).not.toHaveBeenCalled();
  });

  describe('R7: service throws → 500', () => {
    it('production: generic error and NO details key at all', async () => {
      grant.mockRejectedValue(Object.assign(new Error('relation "user_subscriptions" hint: secret'), { hint: 'x' }));
      const res = await POST(req());
      const json = await res.json();
      expect(res.status).toBe(500);
      expect(json).toEqual({ success: false, error: 'Failed to allocate free tier' });
      expect(Object.prototype.hasOwnProperty.call(json, 'details')).toBe(false);
      expect(auditLog).not.toHaveBeenCalled();
    });

    it('development: details is the message string only', async () => {
      setEnv('development');
      grant.mockRejectedValue(new Error('db exploded'));
      const res = await POST(req());
      const json = await res.json();
      expect(res.status).toBe(500);
      expect(json.details).toBe('db exploded');
    });
  });

  it('R9: audit rejects → still 200 and the error is logged', async () => {
    auditLog.mockRejectedValue(new Error('audit down'));
    const res = await POST(req());
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(logCalls.error.some((c) => c[1] === 'Audit failed (non-blocking)')).toBe(true);
  });

  it('R9b: a never-settling audit promise does not hold the response (audit is not awaited)', async () => {
    auditLog.mockReturnValue(new Promise(() => {}));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(auditLog).toHaveBeenCalledTimes(1);
  });

  it('F-3: a 500 after authentication logs the session userId', async () => {
    grant.mockRejectedValue(new Error('db exploded'));
    await POST(req());
    const failure = logCalls.error.find((c) => c[1] === 'Free-tier grant failed');
    expect(failure).toBeDefined();
    expect(failure![0]).toMatchObject({ userId: SESSION.id });
  });

  describe('QA additions (edge cases)', () => {
    it('QA-R1: whitespace-only body is treated as empty → 200, grant to the session user', async () => {
      const res = await POST(req('   \n  ', true));
      expect(res.status).toBe(200);
      expect(grant).toHaveBeenCalledTimes(1);
      expect(grant.mock.calls[0][0]).toBe(SESSION.id);
    });

    it.each([
      ['JSON null', 'null'],
      ['JSON string', '"a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"'],
      ['userId: null', '{"userId":null}'],
      ['userId: empty string', '{"userId":""}'],
      ['userId: number', '{"userId":123}'],
    ])('QA-R2: %s → 400, no grant, no audit', async (_l, raw) => {
      const res = await POST(req(raw, true));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ success: false, error: 'Invalid input' });
      expect(grant).not.toHaveBeenCalled();
      expect(auditLog).not.toHaveBeenCalled();
    });

    it('QA-R3: a foreign id in UPPER case is still a mismatch → 403, no grant', async () => {
      const res = await POST(req({ userId: OTHER.toUpperCase() }));
      expect(res.status).toBe(403);
      expect(grant).not.toHaveBeenCalled();
      expect(auditLog).not.toHaveBeenCalled();
    });

    it('QA-R4: a foreign id plus an injected field → 400 (validation first), no grant', async () => {
      const res = await POST(req({ userId: OTHER, balance: 1 }));
      expect(res.status).toBe(400);
      expect(grant).not.toHaveBeenCalled();
    });

    it('QA-R5: unauthenticated with a malformed body → 401 (auth before parsing), no grant', async () => {
      getUser.mockResolvedValue(null);
      const res = await POST(req('{not json', true));
      expect(res.status).toBe(401);
      expect(grant).not.toHaveBeenCalled();
    });

    it('QA-R6: 401/403/409/503 bodies never carry details, even in development', async () => {
      setEnv('development');
      getUser.mockResolvedValueOnce(null);
      expect(await (await POST(req())).json()).toEqual({ success: false, error: 'Unauthorized' });
      expect(await (await POST(req({ userId: OTHER }))).json()).toEqual({ success: false, error: 'Forbidden' });
      grant.mockResolvedValueOnce({ status: 'INELIGIBLE_FROZEN', attempts: 1 });
      expect(await (await POST(req())).json()).toEqual({ success: false, error: 'Free tier not available for this account' });
      grant.mockResolvedValueOnce({ status: 'RETRY_EXHAUSTED', attempts: 3 });
      expect(await (await POST(req())).json()).toEqual({ success: false, error: 'Please try again' });
    });

    it('QA-R7: a numeric executions allocation is audited as the number, with path update', async () => {
      grant.mockResolvedValue({
        status: 'GRANTED', path: 'update', attempts: 2,
        allocation: { pilot_tokens: 1, raw_tokens: 10, storage_mb: 5000, executions: 50 },
      });
      const res = await POST(req());
      expect(res.status).toBe(200);
      expect(auditLog.mock.calls[0][0].details).toMatchObject({ executions: 50, path: 'update', storage_mb: 5000 });
    });
  });

  it('R10: getUser throws → generic 500, service never called, no details in production', async () => {
    getUser.mockRejectedValue(new Error('auth backend down'));
    const res = await POST(req());
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json).toEqual({ success: false, error: 'Failed to allocate free tier' });
    expect(grant).not.toHaveBeenCalled();
  });
});
